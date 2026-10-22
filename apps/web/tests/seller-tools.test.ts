import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { setupTestDb, teardownTestDb } from "./helpers/db";
import { call } from "./helpers/http";
import { installFakeMedia, makeAdmin, makeCategory, makeCustomer, makeProduct, makeVendor, uniq } from "./helpers/factory";
import { makeShop, placeShopOrder, type Shop } from "./helpers/shop";
import { bulkUpdateHandler, catalogExportHandler, vendorAnalyticsHandler } from "@/server/api/handlers/vendor-catalog";
import { getCollections } from "@/server/db/collections";

let shop: Shop;
let admin: Awaited<ReturnType<typeof makeAdmin>>;
let cat: { id: string };

beforeAll(async () => {
  await setupTestDb();
  installFakeMedia();
  shop = await makeShop();
  admin = shop.admin;
  cat = await makeCategory(admin);
});
afterAll(teardownTestDb);

const sku = () => uniq("BULK").toUpperCase();
const bulk = (token: string, rows: object[], dryRun = false) => call(bulkUpdateHandler, { method: "POST", token, body: { dryRun, rows } });

describe("bulk price and stock update", () => {
  it("previews with a dry run, applies by SKU, and reports bad rows without stopping the good ones", async () => {
    const v = await makeVendor(), rival = await makeVendor();
    const a = sku(), b = sku(), theirs = sku();
    const mine = await makeProduct(v, { categoryId: cat.id, publish: true, admin, variants: [
      { sku: a, optionValues: {}, priceMinor: 100000, initialStock: 10 },
    ] });
    const mine2 = await makeProduct(v, { categoryId: cat.id, publish: true, admin, variants: [{ sku: b, optionValues: {}, priceMinor: 50000, compareAtMinor: 70000, initialStock: 5 }] });
    await makeProduct(rival, { categoryId: cat.id, publish: true, admin, variants: [{ sku: theirs, optionValues: {}, priceMinor: 1000, initialStock: 1 }] });
    const rows = [{ sku: a, priceMinor: 120000, stock: 25 }, { sku: "NOPE-1", stock: 3 }, { sku: theirs, priceMinor: 1 }, { sku: b, priceMinor: 90000 }, { sku: a, stock: 1 }];

    const dry = await bulk(v.user.token, rows, true);
    expect(dry.status).toBe(200);
    expect(dry.json.meta).toMatchObject({ dryRun: true, updated: 1, errors: 4 });
    const c = await getCollections();
    expect((await c.products.findOne({ _id: new ObjectId(mine.id) }))!.variants[0]!.priceMinor).toBe(100000); // nothing changed

    const real = await bulk(v.user.token, rows);
    expect(real.status).toBe(200);
    const by = (s: string, i = 0) => real.data.filter((r: { sku: string }) => r.sku === s)[i];
    expect(by(a)).toMatchObject({ status: "updated", price: [100000, 120000], stock: [10, 25] });
    expect(by("NOPE-1")).toMatchObject({ status: "error", message: expect.stringContaining("No variant") });
    expect(by(theirs).status).toBe("error"); // another store's SKU is invisible, never edited
    expect(by(b).status).toBe("error"); // new price would not be below the "was" price of 700
    expect(by(a, 1)).toMatchObject({ status: "error", message: expect.stringContaining("more than once") });
    const after = (await c.products.findOne({ _id: new ObjectId(mine.id) }))!;
    expect(after.variants[0]!.priceMinor).toBe(120000);
    expect(after.minPriceMinor).toBe(120000);
    expect((await c.inventoryItems.findOne({ productId: new ObjectId(mine.id) }))!.onHand).toBe(25);
    expect((await c.products.findOne({ _id: new ObjectId(mine2.id) }))!.variants[0]!.priceMinor).toBe(50000);
    expect((await c.products.findOne({ vendorId: rival.vendorId }))!.variants[0]!.priceMinor).toBe(1000);

    // running it again changes nothing
    const again = await bulk(v.user.token, [{ sku: a, priceMinor: 120000, stock: 25 }]);
    expect(again.data[0].status).toBe("unchanged");
  });

  it("validates the request and is for sellers only", async () => {
    const v = await makeVendor();
    expect((await bulk(v.user.token, [])).status).toBe(400);
    expect((await bulk(v.user.token, [{ sku: "ABC-1" }])).status).toBe(400); // needs a price or stock
    expect((await bulk(v.user.token, [{ sku: "ABC-1", priceMinor: -5 }])).status).toBe(400);
    expect((await bulk(v.user.token, Array.from({ length: 501 }, (_, i) => ({ sku: `S-${i}`, stock: 1 })))).status).toBe(400);
    const shopper = await makeCustomer();
    expect((await bulk(shopper.token, [{ sku: "ABC-1", stock: 1 }])).status).toBe(403);
  });

  it("exports only the seller's own variants", async () => {
    const v = await makeVendor(), other = await makeVendor();
    const mine = sku(), theirs = sku();
    await makeProduct(v, { categoryId: cat.id, variants: [{ sku: mine, optionValues: {}, priceMinor: 250000, initialStock: 7 }] });
    await makeProduct(other, { categoryId: cat.id, variants: [{ sku: theirs, optionValues: {}, priceMinor: 1000, initialStock: 1 }] });
    const rows = (await call(catalogExportHandler, { token: v.user.token })).data as { sku: string; priceMinor: number; stock: number }[];
    expect(rows.find((r) => r.sku === mine)).toMatchObject({ priceMinor: 250000, stock: 7 });
    expect(rows.some((r) => r.sku === theirs)).toBe(false);
  });
});

describe("seller analytics", () => {
  it("reports real sales, top products and storefront views for the seller's own store", async () => {
    const o = await placeShopOrder(shop, { prices: [200000], method: "cod" });
    const v = o.vendors[0]!;
    const c = await getCollections();
    const pid = new ObjectId(o.products[0]!.id);
    await c.analyticsEvents.insertMany([
      ...Array.from({ length: 6 }, () => ({ _id: new ObjectId(), anonId: "anon-x-0123456789abcdef", type: "view_product", at: new Date(), expiresAt: new Date(Date.now() + 1e9), productId: pid })),
      { _id: new ObjectId(), anonId: "anon-x-0123456789abcdef", type: "add_to_cart", at: new Date(), expiresAt: new Date(Date.now() + 1e9), productId: pid },
    ]);
    const res = await call(vendorAnalyticsHandler, { token: v.user.token, query: { days: 7 } });
    expect(res.status).toBe(200);
    const vo = o.vos[0]!;
    expect(res.data.summary).toMatchObject({ orders: 1, units: 1, grossMinor: vo.totals.totalMinor, netMinor: vo.commission.vendorNetMinor });
    expect(res.data.perDay).toHaveLength(1);
    expect(res.data.topProducts[0]).toMatchObject({ units: 1, revenueMinor: 200000 });
    expect(res.data.mostViewed[0]).toMatchObject({ views: 6, addedToCart: 1, unitsSold: 1 });

    const rival = await makeVendor();
    const theirs = await call(vendorAnalyticsHandler, { token: rival.user.token });
    expect(theirs.data.summary.orders).toBe(0);
    expect(theirs.data.topProducts).toEqual([]);
    expect((await call(vendorAnalyticsHandler, { token: o.buyer.token })).status).toBe(403);
  });
});
