import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, teardownTestDb } from "./helpers/db";
import { call } from "./helpers/http";
import { installFakeMedia, makeAdmin, makeCategory, makeProduct, makeVendor, uniq } from "./helpers/factory";
import { productsHandler } from "@/server/api/handlers/catalog";
import { clearSearchCache, editDistance, expandTerms, searchCategoryFacets } from "@/server/modules/catalog/search";

let shoes: { id: string }, tech: { id: string };
const search = async (q: string) => {
  const r = await call(productsHandler, { query: { q, limit: 24 } });
  return { status: r.status, titles: (r.data as { title: string }[]).map((p) => p.title), corrected: r.json.meta?.corrected as { from: string; to: string } | undefined };
};

beforeAll(async () => {
  await setupTestDb();
  installFakeMedia();
  const admin = await makeAdmin();
  shoes = await makeCategory(admin, "Shoes " + uniq());
  tech = await makeCategory(admin, "Tech " + uniq());
  const v = await makeVendor();
  const mk = (title: string, categoryId: string, publish = true) => makeProduct(v, { title, categoryId, publish, admin });
  await Promise.all([
    mk("Running Sneakers", shoes.id), mk("Formal Leather Shoes", shoes.id), mk("Cotton T-Shirt", shoes.id),
    mk("Wireless Headphones", tech.id), mk("Leather Wallet", tech.id), mk("Hidden Draft Sneakers", shoes.id, false),
  ]);
  clearSearchCache();
});
afterAll(teardownTestDb);

describe("search", () => {
  it("finds whole words, ignores unpublished products, and understands synonyms", async () => {
    expect((await search("sneakers")).titles).toEqual(["Running Sneakers"]);
    expect((await search("tee")).titles).toContain("Cotton T-Shirt");
    expect((await search("mobile")).titles).toEqual([]);
  });

  it("understands common Bangla shopping words", async () => {
    const shoesBn = await search("জুতা");
    expect(shoesBn.titles).toEqual(expect.arrayContaining(["Formal Leather Shoes", "Running Sneakers"]));
    expect((await search("ঘড়ি")).titles).toEqual([]); // no watch in this catalogue: no invented matches
    expect(expandTerms("জুতা")).toContain("shoes");
  });

  it("matches the start of words as you type", async () => {
    expect((await search("sneak")).titles).toEqual(["Running Sneakers"]);
    expect((await search("head")).titles).toEqual(["Wireless Headphones"]);
    expect((await search("run sneak")).titles).toEqual(["Running Sneakers"]);
    expect((await search("leath")).titles.sort()).toEqual(["Formal Leather Shoes", "Leather Wallet"]);
  });

  it("corrects spelling mistakes and says what it did", async () => {
    const r = await search("sneekers");
    expect(r.titles).toEqual(["Running Sneakers"]);
    expect(r.corrected).toEqual({ from: "sneekers", to: "sneakers" });
    const swap = await search("walelt");
    expect(swap.titles).toEqual(["Leather Wallet"]);
    expect(swap.corrected?.to).toBe("wallet");
    expect((await search("headfones")).corrected?.to).toBe("headphones");
    expect((await search("sneakers")).corrected).toBeUndefined(); // a correct query is never rewritten
  });

  it("returns nothing, honestly, for gibberish", async () => {
    const r = await search("zzqqxx");
    expect(r.status).toBe(200);
    expect(r.titles).toEqual([]);
    expect(r.corrected).toBeUndefined();
  });

  it("counts matches per category for the filter sidebar", async () => {
    const facets = await searchCategoryFacets({ status: "published", vendorActive: true }, "leather");
    expect(facets.map((f) => f.count).sort()).toEqual([1, 1]);
    expect(facets).toHaveLength(2);
    expect(await searchCategoryFacets({ status: "published", vendorActive: true }, "zzqqxx")).toEqual([]);
  });

  it("measures edit distance with adjacent swaps as one edit", () => {
    expect(editDistance("sneakers", "sneakers")).toBe(0);
    expect(editDistance("sneakres", "sneakers")).toBe(1);
    expect(editDistance("sneekers", "sneakers")).toBe(1);
    expect(editDistance("cat", "dog")).toBe(3);
  });
});
