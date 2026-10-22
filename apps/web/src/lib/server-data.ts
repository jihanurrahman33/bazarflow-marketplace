import "server-only";
import { listCategoryTree } from "@/server/modules/catalog/categories";
import { getPublicProduct, listPublicProducts, type ListProductsQuery } from "@/server/modules/catalog/public";
import { getPublicVendorBySlug, listVendors } from "@/server/modules/vendors/service";
import { listProductReviews } from "@/server/modules/reviews/service";
import { isAppError } from "@/server/shared/errors";
import { logger } from "@/server/shared/logger";

/** Server-component data access: same use cases as the REST API, never raw DB access from UI code. */
export type Loaded<T> = { ok: true; value: T } | { ok: false; notFound: boolean };

async function load<T>(name: string, fn: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (isAppError(e) && e.status === 404) return { ok: false, notFound: true };
    logger.error("page data failed", { route: name, errorName: e instanceof Error ? e.name : "unknown" });
    return { ok: false, notFound: false };
  }
}

export const getCategories = () => load("categories", () => listCategoryTree());
export const getProducts = (q: ListProductsQuery) => load("products", () => listPublicProducts(q));
export const getProduct = (slug: string) => load("product", () => getPublicProduct(slug));
export const getVendor = (slug: string) => load("vendor", () => getPublicVendorBySlug(slug));
export const getReviews = (slug: string) => load("reviews", () => listProductReviews(slug, { limit: 5 }));
export const getStores = (limit = 12) => load(`stores:${limit}`, async () => (await listVendors({ status: "active", limit })).items.map((v) => ({ id: v.id, slug: v.slug, name: v.name, description: v.description })));
