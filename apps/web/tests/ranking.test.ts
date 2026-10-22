import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { setupTestDb, teardownTestDb } from "./helpers/db";
import { call } from "./helpers/http";
import { installFakeMedia, makeAdmin, makeCategory, makeProduct, makeVendor, uniq } from "./helpers/factory";
import { productsByIdsHandler, recommendationsHandler, relatedProductsHandler, topRatedHandler, trendingHandler } from "@/server/api/handlers/catalog";
import { listReviewsHandler } from "@/server/api/handlers/commerce-ops";
import { clearRecommendationCache } from "@/server/modules/catalog/recommend";
import { getCollections } from "@/server/db/collections";
import type { ReviewDoc } from "@/server/db/schema";

type Made = { id: string; slug: string };
let admin: Awaited<ReturnType<typeof makeAdmin>>;
let a1: Made, a2: Made, a3: Made, b1: Made, b2: Made, draft: Made;
let catA: { id: string }, catB: { id: string };

async function addReviews(productId: string, ratings: number[]) {
  const c = await getCollections();
  const p = (await c.products.findOne({ _id: new ObjectId(productId) }))!;
  const docs: ReviewDoc[] = ratings.map((rating, i) => ({
    _id: new ObjectId(), productId: p._id, vendorId: p.vendorId, userId: new ObjectId(), vendorOrderId: new ObjectId(), rating, body: `Review number ${i} for this product.`, status: "published", createdAt: new Date(Date.now() + i),
  }));
  await c.reviews.insertMany(docs);
  clearRecommendationCache();
}

beforeAll(async () => {
  await setupTestDb();
  installFakeMedia();
  admin = await makeAdmin();
  catA = await makeCategory(admin, "Rank A " + uniq());
  catB = await makeCategory(admin, "Rank B " + uniq());
  const v1 = await makeVendor(), v2 = await makeVendor(), v3 = await makeVendor();
  const mk = (v: typeof v1, categoryId: string, publish = true) => makeProduct(v, { categoryId, publish, admin, priceMinor: 150000 });
  const made = (await Promise.all([mk(v1, catA.id), mk(v2, catA.id), mk(v3, catA.id), mk(v1, catB.id), mk(v2, catB.id)])) as Made[];
  a1 = made[0]!; a2 = made[1]!; a3 = made[2]!; b1 = made[3]!; b2 = made[4]!;
  draft = (await mk(v3, catB.id, false)) as Made;
});
afterAll(teardownTestDb);

const ids = (r: { data: { id: string }[] }) => r.data.map((p) => p.id);

describe("recently viewed and ranking endpoints", () => {
  it("turn ids into cards in the order given, skipping unknown and unpublished ones, and validate input", async () => {
    const ghost = new ObjectId().toHexString();
    const r = await call(productsByIdsHandler, { query: { ids: [b1.id, ghost, a2.id, draft.id].join(",") } });
    expect(r.status).toBe(200);
    expect(ids(r)).toEqual([b1.id, a2.id]);
    expect(r.headers.get("cache-control")).toMatch(/no-store/);
    expect((await call(productsByIdsHandler, { query: { ids: "nope" } })).status).toBe(400);
    expect((await call(productsByIdsHandler, { query: { ids: Array.from({ length: 21 }, () => ghost).join(",") } })).status).toBe(400);
    expect((await call(productsByIdsHandler, {})).status).toBe(400);
  });

  it("recommend by what was viewed: same-category items first, never the viewed ones, only published stock", async () => {
    const r = await call(recommendationsHandler, { query: { viewed: [b1.id].join(","), limit: 6 } });
    expect(r.status).toBe(200);
    expect(ids(r)[0]).toBe(b2.id); // the only other product in the viewed category
    expect(ids(r)).not.toContain(b1.id);
    expect(ids(r)).not.toContain(draft.id);
    expect(r.json.meta?.because).toMatchObject({ slug: b1.slug });
    const again = await call(recommendationsHandler, { query: { viewed: b1.id, exclude: b2.id, limit: 6 } });
    expect(ids(again)).not.toContain(b2.id);
  });

  it("falls back to popular items for a shopper with no history, with at most 3 per seller", async () => {
    const r = await call(recommendationsHandler, { query: { limit: 12 } });
    expect(r.status).toBe(200);
    expect(r.json.meta?.because ?? null).toBeNull();
    const t = await call(trendingHandler, { query: { limit: 12 } });
    expect(ids(t)).not.toContain(draft.id);
    const perVendor = new Map<string, number>();
    for (const p of t.data as { vendor: { slug: string } }[]) perVendor.set(p.vendor.slug, (perVendor.get(p.vendor.slug) ?? 0) + 1);
    expect(Math.max(...perVendor.values())).toBeLessThanOrEqual(3);
    expect((await call(trendingHandler, { query: { limit: 99 } })).status).toBe(400);
  });

  it("rank well-reviewed items higher, and need real reviews for 'top rated'", async () => {
    expect((await call(topRatedHandler, {})).data).toEqual([]); // nothing has 3 reviews yet
    await addReviews(a3.id, [5, 5, 5, 4, 5]);
    await addReviews(a1.id, [5]); // one lucky review must not outrank real volume
    const top = await call(topRatedHandler, {});
    expect(ids(top)).toEqual([a3.id]);
    const t = await call(trendingHandler, { query: { limit: 12 } });
    expect(ids(t).indexOf(a3.id)).toBeLessThan(ids(t).indexOf(a1.id));
    const related = await call(relatedProductsHandler, { params: { slug: a1.slug } });
    expect(related.status).toBe(200);
    expect(related.data.similar.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining([a2.id, a3.id]));
    expect(related.data.similar.map((p: { id: string }) => p.id)).not.toContain(a1.id);
    expect(related.data.alsoBought).toEqual([]); // no repeat purchases yet, so nothing is claimed
  });
});

describe("a product with many reviews", () => {
  it("pages through every review exactly once in each sort order, and can filter by stars", async () => {
    const ratings = Array.from({ length: 57 }, (_, i) => [5, 5, 4, 5, 3, 4, 1, 2][i % 8]!);
    await addReviews(b2.id, ratings);
    const all = async (query: Record<string, string | number>) => {
      const seen: { id: string; rating: number }[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 20; guard++) {
        const r = await call(listReviewsHandler, { params: { slug: b2.slug }, query: { limit: 10, ...query, ...(cursor ? { cursor } : {}) } });
        expect(r.status).toBe(200);
        seen.push(...r.data);
        cursor = r.json.meta?.nextCursor ?? undefined;
        if (!cursor) break;
      }
      return seen;
    };
    const newest = await all({});
    expect(newest).toHaveLength(57);
    expect(new Set(newest.map((r) => r.id)).size).toBe(57);
    const high = await all({ sort: "highest" });
    expect(high).toHaveLength(57);
    expect(new Set(high.map((r) => r.id)).size).toBe(57);
    expect(high.map((r) => r.rating)).toEqual([...high.map((r) => r.rating)].sort((x, y) => y - x));
    const low = await all({ sort: "lowest" });
    expect(low.map((r) => r.rating)).toEqual([...low.map((r) => r.rating)].sort((x, y) => x - y));
    expect(new Set(low.map((r) => r.id)).size).toBe(57);
    const fives = await all({ rating: 5 });
    expect(fives.every((r) => r.rating === 5)).toBe(true);
    expect(fives).toHaveLength(ratings.filter((x) => x === 5).length);
    const first = await call(listReviewsHandler, { params: { slug: b2.slug }, query: { limit: 5 } });
    expect(first.json.meta?.summary).toMatchObject({ count: 57, distribution: { 5: ratings.filter((x) => x === 5).length } });
    expect((await call(listReviewsHandler, { params: { slug: b2.slug }, query: { cursor: "garbage" } })).status).toBe(400);
    expect((await call(listReviewsHandler, { params: { slug: b2.slug }, query: { rating: 9 } })).status).toBe(400);
  });
});
