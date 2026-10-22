import { z } from "zod";
import { created, ok, page, route } from "@/server/api/route";
import { requirePermission } from "@/server/modules/authorization/actor";
import { parseObjectId } from "@/server/shared/ids";
import { pageQuery } from "@/server/shared/pagination";
import { SLUG_RE } from "@/server/shared/slug";
import { createCategory, listCategoryTree, updateCategory } from "@/server/modules/catalog/categories";
import { getPublicProduct, listPublicProducts } from "@/server/modules/catalog/public";
import { OPTION_PRESETS } from "@/lib/option-presets";
import { productsByIds, recommendForViewer, relatedProducts, topRatedProducts, trendingProducts } from "@/server/modules/catalog/recommend";
import { moderateProduct, reviewQueue } from "@/server/modules/catalog/products";

const PUBLIC_CACHE = "public, s-maxage=30, stale-while-revalidate=120";

export const categoriesHandler = route({ name: "categories.list", auth: false }, async () =>
  ok(await listCategoryTree(), undefined, { cache: PUBLIC_CACHE }),
);

/** Shared option library (Colour, Size, Fit...) for seller product forms on web and mobile. */
export const optionPresetsHandler = route({ name: "option-presets.list", auth: false }, async () =>
  ok(OPTION_PRESETS, undefined, { cache: "public, s-maxage=3600, stale-while-revalidate=86400" }),
);

// ----- ranking: trending, top rated, personalised -----
const idList = z.string().regex(/^[0-9a-f]{24}(,[0-9a-f]{24}){0,19}$/i).transform((v) => v.split(",").map((x) => parseObjectId(x)));
const rankLimit = z.coerce.number().int().min(1).max(24).default(12);
const RANK_CACHE = "public, s-maxage=300, stale-while-revalidate=600";
const NO_STORE = "private, no-store";

export const trendingHandler = route({ name: "products.trending", auth: false, rateLimit: { rule: { name: "products.rank", limit: 120, windowSeconds: 60 }, by: "ip" } }, async (ctx) => {
  const q = ctx.query(z.strictObject({ limit: rankLimit }));
  return ok(await trendingProducts(q.limit), undefined, { cache: RANK_CACHE });
});

export const topRatedHandler = route({ name: "products.top-rated", auth: false, rateLimit: { rule: { name: "products.rank", limit: 120, windowSeconds: 60 }, by: "ip" } }, async (ctx) => {
  const q = ctx.query(z.strictObject({ limit: rankLimit }));
  return ok(await topRatedProducts(q.limit), undefined, { cache: RANK_CACHE });
});

/** The shopper's recently viewed products live in their own browser; the server only turns ids into cards. */
export const productsByIdsHandler = route({ name: "products.by-ids", auth: false, rateLimit: { rule: { name: "products.rank", limit: 120, windowSeconds: 60 }, by: "ip" } }, async (ctx) => {
  const q = ctx.query(z.strictObject({ ids: idList }));
  return ok(await productsByIds(q.ids), undefined, { cache: NO_STORE });
});

export const recommendationsHandler = route({ name: "products.recommendations", auth: false, rateLimit: { rule: { name: "products.rank", limit: 120, windowSeconds: 60 }, by: "ip" } }, async (ctx) => {
  const q = ctx.query(z.strictObject({ viewed: idList.optional(), exclude: idList.optional(), limit: rankLimit }));
  const r = await recommendForViewer(q.viewed ?? [], q.exclude ?? [], q.limit);
  return ok(r.items, { because: r.because }, { cache: NO_STORE });
});

export const relatedProductsHandler = route<{ slug: string }>({ name: "products.related", auth: false, rateLimit: { rule: { name: "products.rank", limit: 120, windowSeconds: 60 }, by: "ip" } }, async (ctx) => {
  const p = await getPublicProduct(ctx.params.slug);
  return ok(await relatedProducts(parseObjectId(p.id), 12), undefined, { cache: RANK_CACHE });
});

const productsQuery = pageQuery.extend({
  q: z.string().trim().min(2).max(100).optional(),
  category: z.string().regex(SLUG_RE).max(60).optional(),
  vendor: z.string().regex(SLUG_RE).max(60).optional(),
  minPrice: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  maxPrice: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  sort: z.enum(["newest", "price_asc", "price_desc", "relevance"]).default("newest"),
});

export const productsHandler = route(
  { name: "products.list", auth: false, rateLimit: { rule: { name: "products.list", limit: 120, windowSeconds: 60 }, by: "ip" } },
  async (ctx) => {
    const q = ctx.query(productsQuery);
    const r = await listPublicProducts({ ...q, minPriceMinor: q.minPrice, maxPriceMinor: q.maxPrice });
    return page(r.items, r, { cache: PUBLIC_CACHE });
  },
);

export const vendorProductsPublicHandler = route<{ slug: string }>({ name: "vendors.products", auth: false }, async (ctx) => {
  const q = ctx.query(productsQuery);
  const r = await listPublicProducts({ ...q, vendor: ctx.params.slug, minPriceMinor: q.minPrice, maxPriceMinor: q.maxPrice });
  return page(r.items, r, { cache: PUBLIC_CACHE });
});

export const productDetailHandler = route<{ slug: string }>({ name: "products.get", auth: false }, async (ctx) =>
  // Availability changes fast, so keep the CDN window short.
  ok(await getPublicProduct(ctx.params.slug), undefined, { cache: "public, s-maxage=15, stale-while-revalidate=60" }),
);

// ----- admin -----

export const createCategoryHandler = route({ name: "admin.categories.create" }, async (ctx) => {
  requirePermission(ctx.actor, "category.manage");
  const b = await ctx.body(z.strictObject({
    name: z.string().trim().min(2).max(80), slug: z.string().regex(SLUG_RE).min(2).max(60),
    parentId: z.string().optional(), sortOrder: z.number().int().min(0).max(10_000).default(0),
  }));
  return created(await createCategory(ctx.actor, { ...b, parentId: b.parentId ? parseObjectId(b.parentId, "parentId") : undefined }, ctx.requestId));
});

export const updateCategoryHandler = route<{ id: string }>({ name: "admin.categories.update" }, async (ctx) => {
  requirePermission(ctx.actor, "category.manage");
  const b = await ctx.body(z.strictObject({ name: z.string().trim().min(2).max(80).optional(), sortOrder: z.number().int().min(0).max(10_000).optional(), visible: z.boolean().optional() }));
  return ok(await updateCategory(ctx.actor, parseObjectId(ctx.params.id), b, ctx.requestId));
});

export const reviewQueueHandler = route({ name: "admin.products.queue" }, async (ctx) => {
  requirePermission(ctx.actor, "catalog.moderate");
  const r = await reviewQueue(ctx.query(pageQuery));
  return page(r.items, r);
});

export const approveProductHandler = route<{ id: string }>({ name: "admin.products.approve" }, async (ctx) => {
  requirePermission(ctx.actor, "catalog.moderate");
  return ok(await moderateProduct(ctx.actor, parseObjectId(ctx.params.id), "published", undefined, ctx.requestId));
});

export const rejectProductHandler = route<{ id: string }>({ name: "admin.products.reject" }, async (ctx) => {
  requirePermission(ctx.actor, "catalog.moderate");
  const b = await ctx.body(z.strictObject({ reason: z.string().trim().min(3).max(500) }));
  return ok(await moderateProduct(ctx.actor, parseObjectId(ctx.params.id), "rejected", b.reason, ctx.requestId));
});
