import { z } from "zod";
import { vendorSalesAnalytics } from "@/server/modules/vendors/analytics";
import { bulkUpdate, catalogExport, MAX_BULK_ROWS } from "@/server/modules/vendors/bulk";
import { createCoupon, listCoupons, updateCoupon } from "@/server/modules/coupons/service";
import { created, ok, page, route, type Ctx } from "@/server/api/route";
import { requireVendor } from "@/server/modules/authorization/actor";
import { parseObjectId } from "@/server/shared/ids";
import { pageQuery } from "@/server/shared/pagination";
import {
  addVariants, archiveProduct, createProduct, getVendorProduct, listVendorProducts, submitForReview, updateProduct, updateVariant,
} from "@/server/modules/catalog/products";
import { adjustStock, listMovements, listVendorInventory } from "@/server/modules/inventory/service";
import { getMediaProvider, vendorMediaFolder } from "@/server/modules/media/cloudinary";

const vendorOf = <P>(ctx: Ctx<P>) => ({ userId: ctx.actor.userId, vendorId: requireVendor(ctx.actor) });

const sku = z.string().regex(/^[A-Za-z0-9._-]{2,40}$/);
const price = z.number().int().min(1).max(100_000_000);
const objectIdStr = z.string().regex(/^[0-9a-f]{24}$/i);
const optionValues = z.record(z.string().min(1).max(40), z.string().min(1).max(60));
const variantInput = z.strictObject({
  sku, optionValues: optionValues.default({}), priceMinor: price, compareAtMinor: price.optional(), initialStock: z.number().int().min(0).max(1_000_000).default(0),
});
const mediaInput = z.array(z.strictObject({
  publicId: z.string().min(1).max(250).regex(/^[A-Za-z0-9_\-/]+$/),
  forOption: z.strictObject({ name: z.string().trim().min(1).max(40), value: z.string().trim().min(1).max(60) }).optional(),
})).max(10);

const createBody = z.strictObject({
  title: z.string().trim().min(3).max(150),
  description: z.string().trim().min(10).max(5000),
  categoryIds: z.array(objectIdStr).min(1).max(5),
  options: z.array(z.strictObject({ name: z.string().trim().min(1).max(40), values: z.array(z.string().trim().min(1).max(60)).min(1).max(30) })).max(3).default([]),
  variants: z.array(variantInput).min(1).max(100),
});

export const createProductHandler = route({ name: "vendor.products.create", rateLimit: { rule: { name: "vendor.products.create", limit: 60, windowSeconds: 3600 }, by: "actor" } }, async (ctx) => {
  const v = vendorOf(ctx);
  const b = await ctx.body(createBody);
  return created(await createProduct({ ...ctx.actor, vendorId: v.vendorId }, { ...b, categoryIds: b.categoryIds.map((x) => parseObjectId(x)) }));
});

export const listProductsHandler = route({ name: "vendor.products.list" }, async (ctx) => {
  const q = ctx.query(pageQuery.extend({ status: z.enum(["draft", "pending_review", "rejected", "published", "archived"]).optional() }));
  const r = await listVendorProducts(vendorOf(ctx).vendorId, q);
  return page(r.items, r);
});

export const getProductHandler = route<{ id: string }>({ name: "vendor.products.get" }, async (ctx) =>
  ok(await getVendorProduct(vendorOf(ctx).vendorId, parseObjectId(ctx.params.id))),
);

export const patchProductHandler = route<{ id: string }>({ name: "vendor.products.patch" }, async (ctx) => {
  vendorOf(ctx); // authorize before parsing the body
  const b = await ctx.body(z.strictObject({
    title: z.string().trim().min(3).max(150).optional(), description: z.string().trim().min(10).max(5000).optional(),
    categoryIds: z.array(objectIdStr).min(1).max(5).optional(), media: mediaInput.optional(),
  }));
  return ok(await updateProduct(vendorOf(ctx), parseObjectId(ctx.params.id), { ...b, categoryIds: b.categoryIds?.map((x) => parseObjectId(x)) }));
});

export const submitReviewHandler = route<{ id: string }>({ name: "vendor.products.submit" }, async (ctx) =>
  ok(await submitForReview(vendorOf(ctx), parseObjectId(ctx.params.id))),
);

export const archiveProductHandler = route<{ id: string }>({ name: "vendor.products.archive" }, async (ctx) =>
  ok(await archiveProduct(vendorOf(ctx), parseObjectId(ctx.params.id))),
);

export const addVariantsHandler = route<{ id: string }>({ name: "vendor.variants.add" }, async (ctx) => {
  vendorOf(ctx); // authorize before parsing the body
  const b = await ctx.body(z.strictObject({ newOptionValues: z.record(z.string(), z.array(z.string().min(1).max(60)).max(30)).optional(), variants: z.array(variantInput).min(1).max(50) }));
  return created(await addVariants(vendorOf(ctx), parseObjectId(ctx.params.id), b));
});

export const patchVariantHandler = route<{ id: string; variantId: string }>({ name: "vendor.variants.patch" }, async (ctx) => {
  vendorOf(ctx); // authorize before parsing the body
  const b = await ctx.body(z.strictObject({ priceMinor: price.optional(), compareAtMinor: price.nullable().optional(), active: z.boolean().optional() }));
  return ok(await updateVariant(vendorOf(ctx), parseObjectId(ctx.params.id), ctx.params.variantId, b));
});

export const uploadSignatureHandler = route({ name: "vendor.uploads.signature", rateLimit: { rule: { name: "vendor.uploads", limit: 60, windowSeconds: 3600 }, by: "actor" } }, async (ctx) => {
  const { vendorId } = vendorOf(ctx);
  // Folder is derived from the authenticated vendor — never from client input.
  return ok(getMediaProvider().authorizeUpload(vendorMediaFolder(vendorId.toHexString())));
});

export const listInventoryHandler = route({ name: "vendor.inventory.list" }, async (ctx) => {
  const q = ctx.query(pageQuery.extend({ lowStock: z.coerce.number().int().min(0).max(1000).optional(), productId: objectIdStr.optional() }));
  const r = await listVendorInventory(vendorOf(ctx).vendorId, { ...q, productId: q.productId ? parseObjectId(q.productId) : undefined });
  return page(r.items, r);
});

export const adjustInventoryHandler = route<{ skuId: string }>({ name: "vendor.inventory.adjust" }, async (ctx) => {
  vendorOf(ctx); // authorize before parsing the body
  const b = await ctx.body(z.strictObject({
    set: z.number().int().min(0).max(1_000_000).optional(), delta: z.number().int().min(-1_000_000).max(1_000_000).optional(),
    reason: z.string().trim().min(3).max(200),
  }).refine((x) => (x.set === undefined) !== (x.delta === undefined), { message: "Provide exactly one of set or delta" }));
  return ok(await adjustStock(vendorOf(ctx), parseObjectId(ctx.params.skuId), { set: b.set, delta: b.delta }, b.reason));
});

export const movementsHandler = route<{ skuId: string }>({ name: "vendor.inventory.movements" }, async (ctx) =>
  ok(await listMovements(vendorOf(ctx).vendorId, parseObjectId(ctx.params.skuId))),
);

// ----- coupons (seller-funded) -----
const couponBody = z.strictObject({
  code: z.string().trim().min(3).max(20),
  kind: z.enum(["percent", "fixed"]),
  value: z.number().int().min(1).max(100_000_000),
  minSubtotalMinor: z.number().int().min(1).max(100_000_000).optional(),
  maxDiscountMinor: z.number().int().min(1).max(100_000_000).optional(),
  startsAt: z.iso.datetime().optional(),
  expiresAt: z.iso.datetime().optional(),
  maxRedemptions: z.number().int().min(1).max(1_000_000).optional(),
  perUserLimit: z.number().int().min(1).max(10).default(1),
});

export const listCouponsHandler = route({ name: "vendor.coupons.list" }, async (ctx) => ok(await listCoupons(vendorOf(ctx).vendorId)));

export const createCouponHandler = route({ name: "vendor.coupons.create", rateLimit: { rule: { name: "vendor.coupons.create", limit: 30, windowSeconds: 3600 }, by: "actor" } }, async (ctx) => {
  const v = vendorOf(ctx);
  const b = await ctx.body(couponBody);
  return created(await createCoupon(v.vendorId, { ...b, startsAt: b.startsAt ? new Date(b.startsAt) : undefined, expiresAt: b.expiresAt ? new Date(b.expiresAt) : undefined }));
});

export const patchCouponHandler = route<{ id: string }>({ name: "vendor.coupons.patch" }, async (ctx) => {
  const v = vendorOf(ctx);
  const b = await ctx.body(z.strictObject({ active: z.boolean().optional(), expiresAt: z.iso.datetime().nullable().optional(), maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().optional() }));
  return ok(await updateCoupon(v.vendorId, parseObjectId(ctx.params.id), { active: b.active, expiresAt: b.expiresAt === null ? null : b.expiresAt ? new Date(b.expiresAt) : undefined, maxRedemptions: b.maxRedemptions }));
});

// ----- analytics and bulk edit -----
export const vendorAnalyticsHandler = route({ name: "vendor.analytics" }, async (ctx) => {
  const q = ctx.query(z.strictObject({ days: z.coerce.number().int().min(1).max(90).default(30) }));
  return ok(await vendorSalesAnalytics(vendorOf(ctx).vendorId, q.days));
});

export const catalogExportHandler = route({ name: "vendor.catalog.export" }, async (ctx) => ok(await catalogExport(vendorOf(ctx).vendorId)));

const bulkRow = z.strictObject({ sku, priceMinor: price.optional(), stock: z.number().int().min(0).max(1_000_000).optional() }).refine((r) => r.priceMinor !== undefined || r.stock !== undefined, { message: "Give a price, a stock level, or both." });
export const bulkUpdateHandler = route({ name: "vendor.products.bulk", rateLimit: { rule: { name: "vendor.products.bulk", limit: 20, windowSeconds: 3600 }, by: "actor" }, maxBodyBytes: 256 * 1024 }, async (ctx) => {
  const v = vendorOf(ctx);
  const b = await ctx.body(z.strictObject({ dryRun: z.boolean().default(false), rows: z.array(bulkRow).min(1).max(MAX_BULK_ROWS) }));
  const results = await bulkUpdate({ ...ctx.actor, vendorId: v.vendorId }, b.rows, { dryRun: b.dryRun });
  return ok(results, { dryRun: b.dryRun, updated: results.filter((r) => r.status === "updated").length, errors: results.filter((r) => r.status === "error").length });
});
