import type { ObjectId } from "mongodb";
import { getCollections } from "@/server/db/collections";
import type { CartDoc, ProductDoc, VendorDoc } from "@/server/db/schema";
import { DEFAULT_CURRENCY, type CurrencyCode } from "@/server/shared/money";
import { getShippingStrategy } from "@/server/modules/shipping/strategy";
import { availableOf } from "@/server/modules/inventory/service";
import { variantLabel } from "@/server/modules/catalog/products";
import { getMediaProvider } from "@/server/modules/media/cloudinary";
import { checkCoupon, ISSUE_MESSAGE, type AppliedCoupon, type CouponIssueReason } from "@/server/modules/coupons/service";

export type QuoteIssueCode = "PRODUCT_UNAVAILABLE" | "VARIANT_UNAVAILABLE" | "INSUFFICIENT_STOCK" | "VENDOR_INACTIVE";

export interface QuoteIssue {
  itemId: string;
  code: QuoteIssueCode;
  availableQuantity?: number;
}

export interface QuoteLine {
  itemId: string;
  productId: string;
  productSlug: string;
  variantId: string;
  inventoryItemId: ObjectId;
  sku: string;
  title: string;
  variantLabel: string;
  imageUrl?: string;
  unitPriceMinor: number;
  quantity: number;
  lineTotalMinor: number;
  vendorId: string;
  available: number;
}

export interface QuoteVendorGroup {
  vendorId: string;
  vendor: Pick<VendorDoc, "name" | "slug" | "commissionBps" | "commissionRuleVersion">;
  lines: QuoteLine[];
  subtotalMinor: number;
  shippingMinor: number;
  /** Seller-funded coupon discount on this seller's items. Zero when no coupon applies here. */
  discountMinor: number;
  /** The seller's shipping rule, so the cart can show how far a shopper is from free shipping. */
  shippingPolicy: { flatFeeMinor: number; freeOverMinor: number | null };
  totalMinor: number;
}

export interface Quote {
  currency: CurrencyCode;
  groups: QuoteVendorGroup[];
  issues: QuoteIssue[];
  /** The coupon in effect, or why the shopper's code does not apply (the cart still works without it). */
  coupon?: AppliedCoupon;
  couponIssue?: { code: string; reason: CouponIssueReason; message: string };
  totals: { subtotalMinor: number; shippingMinor: number; discountMinor: number; totalMinor: number };
  itemCount: number;
}

function imageFor(p: ProductDoc): string | undefined {
  const first = p.media[0];
  if (!first) return undefined;
  try {
    return getMediaProvider().deliveryUrl(first.publicId, "thumb");
  } catch {
    return first.url;
  }
}

/**
 * Single source of truth for prices, availability and shipping. Used by the cart view, the quote endpoint and
 * checkout, so what the shopper sees is exactly what gets charged. Client-supplied prices never enter here.
 */
export async function buildQuote(lines: CartDoc["lines"], district: string | undefined, opts: { couponCode?: string; userId?: ObjectId } = {}): Promise<Quote> {
  const c = await getCollections();
  const issues: QuoteIssue[] = [];
  const productIds = [...new Set(lines.map((l) => l.productId.toHexString()))];
  const products = productIds.length
    ? await c.products.find({ _id: { $in: lines.map((l) => l.productId) } }).toArray()
    : [];
  const pmap = new Map(products.map((p) => [p._id.toHexString(), p]));
  const vendorIds = [...new Set(products.map((p) => p.vendorId.toHexString()))];
  const [vendors, inventory] = await Promise.all([
    vendorIds.length ? c.vendors.find({ _id: { $in: products.map((p) => p.vendorId) } }).toArray() : [],
    productIds.length ? c.inventoryItems.find({ productId: { $in: products.map((p) => p._id) } }).toArray() : [],
  ]);
  const vmap = new Map(vendors.map((v) => [v._id.toHexString(), v]));
  const imap = new Map(inventory.map((i) => [`${i.productId.toHexString()}.${i.variantId}`, i]));

  const groups = new Map<string, QuoteVendorGroup>();
  let itemCount = 0;
  for (const l of lines) {
    const itemId = `${l.productId.toHexString()}.${l.variantId}`;
    const p = pmap.get(l.productId.toHexString());
    if (!p || p.status !== "published" || !p.vendorActive) {
      issues.push({ itemId, code: "PRODUCT_UNAVAILABLE" });
      continue;
    }
    const vendor = vmap.get(p.vendorId.toHexString());
    if (!vendor || vendor.status !== "active") {
      issues.push({ itemId, code: "VENDOR_INACTIVE" });
      continue;
    }
    const variant = p.variants.find((v) => v.variantId === l.variantId && v.active);
    const inv = imap.get(itemId);
    if (!variant || !inv) {
      issues.push({ itemId, code: "VARIANT_UNAVAILABLE" });
      continue;
    }
    const available = Math.max(0, availableOf(inv));
    if (l.quantity > available) issues.push({ itemId, code: "INSUFFICIENT_STOCK", availableQuantity: available });
    const group = groups.get(vendor._id.toHexString()) ?? {
      vendorId: vendor._id.toHexString(),
      vendor: { name: vendor.name, slug: vendor.slug, commissionBps: vendor.commissionBps, commissionRuleVersion: vendor.commissionRuleVersion },
      lines: [], subtotalMinor: 0, shippingMinor: 0, discountMinor: 0, totalMinor: 0,
      shippingPolicy: { flatFeeMinor: vendor.shipping.flatFeeMinor, freeOverMinor: vendor.shipping.freeOverMinor ?? null },
    };
    const lineTotal = variant.priceMinor * l.quantity;
    group.lines.push({
      itemId, productId: p._id.toHexString(), productSlug: p.slug, variantId: variant.variantId, inventoryItemId: inv._id, sku: variant.sku, title: p.title,
      variantLabel: variantLabel(variant), imageUrl: imageFor(p), unitPriceMinor: variant.priceMinor, quantity: l.quantity,
      lineTotalMinor: lineTotal, vendorId: vendor._id.toHexString(), available,
    });
    group.subtotalMinor += lineTotal;
    itemCount += l.quantity;
    groups.set(group.vendorId, group);
  }

  let coupon: AppliedCoupon | undefined;
  let couponIssue: Quote["couponIssue"];
  if (opts.couponCode && groups.size > 0) {
    const check = await checkCoupon(opts.couponCode, opts.userId, [...groups.values()].map((g) => ({ vendorId: g.vendorId, subtotalMinor: g.subtotalMinor })));
    if (check.ok) coupon = check.coupon;
    else couponIssue = { code: opts.couponCode, reason: check.reason, message: ISSUE_MESSAGE[check.reason] };
  }

  const strategy = getShippingStrategy();
  let subtotal = 0;
  let shipping = 0;
  let discount = 0;
  for (const g of groups.values()) {
    // Shipping is judged on the list subtotal, so a coupon never takes away a shopper's free shipping.
    g.shippingMinor = strategy.quote({ vendor: vmap.get(g.vendorId)!, subtotalMinor: g.subtotalMinor, district: district ?? "" });
    g.discountMinor = coupon && coupon.vendorId === g.vendorId ? coupon.discountMinor : 0;
    g.totalMinor = g.subtotalMinor - g.discountMinor + g.shippingMinor;
    subtotal += g.subtotalMinor;
    shipping += g.shippingMinor;
    discount += g.discountMinor;
  }
  return {
    currency: DEFAULT_CURRENCY,
    groups: [...groups.values()],
    issues,
    ...(coupon ? { coupon } : {}),
    ...(couponIssue ? { couponIssue } : {}),
    totals: { subtotalMinor: subtotal, shippingMinor: shipping, discountMinor: discount, totalMinor: subtotal - discount + shipping },
    itemCount,
  };
}

/** Wire format for clients: internal ids (ObjectId) are stringified. */
export function toQuoteDto(q: Quote) {
  return {
    currency: q.currency,
    groups: q.groups.map((g) => ({
      ...g,
      vendor: { name: g.vendor.name, slug: g.vendor.slug },
      lines: g.lines.map(({ inventoryItemId: _drop, ...l }) => l),
    })),
    issues: q.issues,
    coupon: q.coupon, couponIssue: q.couponIssue,
    totals: q.totals,
    itemCount: q.itemCount,
  };
}
