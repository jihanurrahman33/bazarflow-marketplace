import { ObjectId, type Filter } from "mongodb";
import { getCollections } from "@/server/db/collections";
import type { ProductDoc } from "@/server/db/schema";
import { AppError } from "@/server/shared/errors";
import { decodeCursor, encodeCursor, slicePage } from "@/server/shared/pagination";
import { variantLabel } from "./products";
import { getMediaProvider } from "@/server/modules/media/cloudinary";

export type ProductSort = "newest" | "price_asc" | "price_desc" | "relevance";
const LOW_STOCK_THRESHOLD = 5;
const MAX_SEARCH_OFFSET = 400;

export interface ListProductsQuery {
  q?: string;
  category?: string;
  vendor?: string;
  minPriceMinor?: number;
  maxPriceMinor?: number;
  sort: ProductSort;
  limit: number;
  cursor?: string;
}

function cardImage(p: ProductDoc): string | undefined {
  const first = p.media[0];
  if (!first) return undefined;
  try {
    return getMediaProvider().deliveryUrl(first.publicId, "card");
  } catch {
    return first.url; // media provider not configured: fall back to the stored URL
  }
}

async function availabilityByVariant(productIds: ObjectId[]) {
  const c = await getCollections();
  const items = await c.inventoryItems.find({ productId: { $in: productIds } }).toArray();
  const map = new Map<string, number>();
  for (const i of items) map.set(`${i.productId.toHexString()}:${i.variantId}`, i.onHand - i.reserved);
  return map;
}

/** List price of the cheapest active variant, when it is genuinely discounted (compare-at above the selling price). */
function discountOf(p: ProductDoc): { compareAtMinor: number; discountPercent: number } | undefined {
  const cheapest = p.variants.filter((v) => v.active).sort((a, b) => a.priceMinor - b.priceMinor)[0];
  if (!cheapest?.compareAtMinor || cheapest.compareAtMinor <= cheapest.priceMinor) return undefined;
  return { compareAtMinor: cheapest.compareAtMinor, discountPercent: Math.round(((cheapest.compareAtMinor - cheapest.priceMinor) / cheapest.compareAtMinor) * 100) };
}

export async function listPublicProducts(q: ListProductsQuery) {
  const c = await getCollections();
  const filter: Filter<ProductDoc> = { status: "published", vendorActive: true };

  if (q.category) {
    const cat = await c.categories.findOne({ slug: q.category, visible: true });
    if (!cat) return { items: [], nextCursor: null };
    const ids = [cat._id, ...(await c.categories.find({ parentId: cat._id, visible: true }).project({ _id: 1 }).toArray()).map((x) => x._id)];
    filter.categoryIds = { $in: ids };
  }
  if (q.vendor) {
    const v = await c.vendors.findOne({ slug: q.vendor, status: "active" }, { projection: { _id: 1 } });
    if (!v) return { items: [], nextCursor: null };
    filter.vendorId = v._id;
  }
  const price: Record<string, number> = {};
  if (q.minPriceMinor !== undefined) price.$gte = q.minPriceMinor;
  if (q.maxPriceMinor !== undefined) price.$lte = q.maxPriceMinor;
  if (Object.keys(price).length) filter.minPriceMinor = price;

  let rows: ProductDoc[];
  let nextCursor: string | null = null;

  if (q.q) {
    // Text search: relevance order with a bounded offset (a keyset cursor over text scores is not stable).
    const offset = Number(decodeCursor<{ o: number }>(q.cursor)?.o ?? 0);
    if (!Number.isInteger(offset) || offset < 0 || offset > MAX_SEARCH_OFFSET) throw new AppError("VALIDATION_FAILED", { details: [{ field: "cursor", code: "INVALID" }] });
    const found = await c.products
      .find({ ...filter, $text: { $search: q.q } }, { projection: { score: { $meta: "textScore" } } })
      .sort({ score: { $meta: "textScore" }, _id: 1 })
      .skip(offset)
      .limit(q.limit + 1)
      .toArray();
    const { items, hasMore } = slicePage(found, q.limit);
    rows = items;
    if (hasMore && offset + q.limit <= MAX_SEARCH_OFFSET) nextCursor = encodeCursor({ o: offset + q.limit });
  } else {
    const cur = decodeCursor<{ p: number; id: string }>(q.cursor);
    const dir = q.sort === "price_desc" || q.sort === "newest" || q.sort === "relevance" ? -1 : 1;
    const field = q.sort === "price_asc" || q.sort === "price_desc" ? "minPriceMinor" : "publishedAt";
    const value = (p: ProductDoc): number => (field === "minPriceMinor" ? p.minPriceMinor : (p.publishedAt ?? p.createdAt).getTime());
    if (cur) {
      const pv = field === "publishedAt" ? new Date(cur.p) : cur.p;
      const cmp = dir === -1 ? "$lt" : "$gt";
      const clause = { $or: [{ [field]: { [cmp]: pv } }, { [field]: pv, _id: { [cmp]: new ObjectId(cur.id) } }] };
      filter.$and = [...(filter.$and ?? []), clause];
    }
    const found = await c.products.find(filter).sort({ [field]: dir, _id: dir }).limit(q.limit + 1).toArray();
    const { items, hasMore } = slicePage(found, q.limit);
    rows = items;
    const last = items[items.length - 1];
    if (hasMore && last) nextCursor = encodeCursor({ p: value(last), id: last._id.toHexString() });
  }

  const [vendors, avail] = await Promise.all([
    c.vendors.find({ _id: { $in: [...new Set(rows.map((r) => r.vendorId.toHexString()))].map((x) => new ObjectId(x)) } }).toArray(),
    availabilityByVariant(rows.map((r) => r._id)),
  ]);
  const vmap = new Map(vendors.map((v) => [v._id.toHexString(), v]));
  // One grouped query for the whole page: average rating and review count per product (published reviews only).
  const ratingRows = rows.length
    ? await c.reviews.aggregate<{ _id: ObjectId; n: number; avg: number }>([
        { $match: { productId: { $in: rows.map((r) => r._id) }, status: "published" } },
        { $group: { _id: "$productId", n: { $sum: 1 }, avg: { $avg: "$rating" } } },
      ]).toArray()
    : [];
  const ratings = new Map(ratingRows.map((r) => [r._id.toHexString(), { average: Math.round(r.avg * 10) / 10, count: r.n }]));
  return {
    items: rows.map((p) => ({
      id: p._id.toHexString(), slug: p.slug, title: p.title, image: cardImage(p), minPriceMinor: p.minPriceMinor, currency: p.currency, ...discountOf(p), ...(ratings.has(p._id.toHexString()) ? { rating: ratings.get(p._id.toHexString()) } : {}),
      inStock: p.variants.some((v) => v.active && (avail.get(`${p._id.toHexString()}:${v.variantId}`) ?? 0) > 0),
      vendor: { slug: vmap.get(p.vendorId.toHexString())?.slug, name: vmap.get(p.vendorId.toHexString())?.name },
    })),
    nextCursor,
  };
}

export async function getPublicProduct(slug: string) {
  const c = await getCollections();
  const p = await c.products.findOne({ slug, status: "published", vendorActive: true });
  if (!p) throw new AppError("NOT_FOUND");
  const [vendor, avail, cats] = await Promise.all([
    c.vendors.findOne({ _id: p.vendorId }),
    availabilityByVariant([p._id]),
    c.categories.find({ _id: { $in: p.categoryIds } }).toArray(),
  ]);
  let media = p.media.map((m) => ({ url: m.url, width: m.width, height: m.height }));
  try {
    const provider = getMediaProvider();
    media = p.media.map((m) => ({ url: provider.deliveryUrl(m.publicId, "gallery"), width: m.width, height: m.height }));
  } catch {
    /* keep stored URLs */
  }
  return {
    id: p._id.toHexString(), slug: p.slug, title: p.title, description: p.description, currency: p.currency, minPriceMinor: p.minPriceMinor,
    options: p.options, media,
    variants: p.variants.filter((v) => v.active).map((v) => {
      const available = avail.get(`${p._id.toHexString()}:${v.variantId}`) ?? 0;
      return {
        variantId: v.variantId, sku: v.sku, optionValues: v.optionValues, label: variantLabel(v), priceMinor: v.priceMinor, compareAtMinor: v.compareAtMinor,
        inStock: available > 0, ...(available > 0 && available <= LOW_STOCK_THRESHOLD ? { lowStock: available } : {}),
      };
    }),
    categories: cats.map((x) => ({ id: x._id.toHexString(), name: x.name, slug: x.slug })),
    vendor: vendor ? { slug: vendor.slug, name: vendor.name } : undefined,
    publishedAt: p.publishedAt?.toISOString(),
  };
}
