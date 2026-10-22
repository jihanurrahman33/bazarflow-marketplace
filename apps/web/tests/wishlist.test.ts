import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { setupTestDb, teardownTestDb } from "./helpers/db";
import { call } from "./helpers/http";
import { installFakeMedia, makeAdmin, makeCategory, makeCustomer, makeProduct, makeVendor } from "./helpers/factory";
import { addWishlistHandler, listWishlistHandler, removeWishlistHandler, wishlistIdsHandler } from "@/server/api/handlers/wishlist";
import { adjustInventoryHandler, patchVariantHandler } from "@/server/api/handlers/vendor-catalog";
import { listNotificationsHandler } from "@/server/api/handlers/notifications";
import { runWorkerTick } from "@/server/modules/outbox/tick";
import { MAX_WISHLIST } from "@/server/modules/wishlist/service";
import { getCollections } from "@/server/db/collections";

let vendor: Awaited<ReturnType<typeof makeVendor>>;
let product: Awaited<ReturnType<typeof makeProduct>>;
let admin: Awaited<ReturnType<typeof makeAdmin>>;
let cat: { id: string };

const save = (token: string, id: string) => call(addWishlistHandler, { method: "PUT", token, params: { productId: id } });
const inbox = async (token: string) => (await call(listNotificationsHandler, { token })).data as { eventType: string; body: string; deepLink?: string }[];

beforeAll(async () => {
  await setupTestDb();
  installFakeMedia();
  admin = await makeAdmin();
  cat = await makeCategory(admin);
  vendor = await makeVendor();
  product = await makeProduct(vendor, { categoryId: cat.id, priceMinor: 200000, stock: 5, publish: true, admin });
});
afterAll(teardownTestDb);

describe("wishlist", () => {
  it("saves, lists and removes items, and saving twice changes nothing", async () => {
    const me = await makeCustomer();
    expect((await save(me.token, product.id)).status).toBe(204);
    expect((await save(me.token, product.id)).status).toBe(204);
    expect((await call(wishlistIdsHandler, { token: me.token })).data).toEqual([product.id]);
    const list = await call(listWishlistHandler, { token: me.token });
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({ id: product.id, savedPriceMinor: 200000, priceDropped: false });
    expect((await call(removeWishlistHandler, { method: "DELETE", token: me.token, params: { productId: product.id } })).status).toBe(204);
    expect((await call(wishlistIdsHandler, { token: me.token })).data).toEqual([]);
  });

  it("is for signed-in customers only, and only for products on sale", async () => {
    const draft = await makeProduct(vendor, { categoryId: cat.id, publish: false });
    const me = await makeCustomer();
    expect((await save(me.token, draft.id)).status).toBe(404);
    expect((await save(me.token, new ObjectId().toHexString())).status).toBe(404);
    expect((await call(addWishlistHandler, { method: "PUT", params: { productId: product.id } })).status).toBe(401);
    expect((await save(vendor.user.token, product.id)).status).toBe(403);
    expect((await call(wishlistIdsHandler, { token: admin.token })).status).toBe(403);
  });

  it("caps how many items one person can save", async () => {
    const me = await makeCustomer();
    const c = await getCollections();
    await c.wishlistItems.insertMany(Array.from({ length: MAX_WISHLIST }, () => ({ _id: new ObjectId(), userId: me.id, productId: new ObjectId(), priceMinorWhenSaved: 100, createdAt: new Date() })));
    const r = await save(me.token, product.id);
    expect(r.status).toBe(422);
  });

  it("tells savers when the price drops, not when it rises, and when stock returns", async () => {
    const fan = await makeCustomer();
    const bystander = await makeCustomer();
    await save(fan.token, product.id);
    const variantId = product.variants[0].variantId as string;
    const patch = (priceMinor: number) => call(patchVariantHandler, { method: "PATCH", token: vendor.user.token, params: { id: product.id, variantId }, body: { priceMinor } });

    expect((await patch(250000)).status).toBe(200); // a rise: no alert
    await runWorkerTick();
    expect((await inbox(fan.token)).filter((n) => n.eventType === "wishlist.price_drop")).toHaveLength(0);

    expect((await patch(150000)).status).toBe(200); // a drop
    await runWorkerTick();
    const drops = (await inbox(fan.token)).filter((n) => n.eventType === "wishlist.price_drop");
    expect(drops).toHaveLength(1);
    expect(drops[0]!.body).toContain("1,500");
    expect(drops[0]!.deepLink).toBe(`/products/${product.slug}`);
    expect((await inbox(bystander.token)).filter((n) => n.eventType.startsWith("wishlist"))).toHaveLength(0);
    const list = await call(listWishlistHandler, { token: fan.token });
    expect(list.data[0]).toMatchObject({ savedPriceMinor: 200000, priceDropped: true });

    // out of stock, then restocked
    const c = await getCollections();
    const item = (await c.inventoryItems.findOne({ productId: new ObjectId(product.id) }))!;
    const adjust = (set: number) => call(adjustInventoryHandler, { method: "PATCH", token: vendor.user.token, params: { skuId: item._id.toHexString() }, body: { set, reason: "count" } });
    expect((await adjust(0)).status).toBe(200);
    await runWorkerTick();
    expect((await inbox(fan.token)).filter((n) => n.eventType === "wishlist.restock")).toHaveLength(0);
    expect((await adjust(8)).status).toBe(200);
    await runWorkerTick();
    expect((await inbox(fan.token)).filter((n) => n.eventType === "wishlist.restock")).toHaveLength(1);
    expect((await adjust(9)).status).toBe(200); // already in stock: no second alert
    await runWorkerTick();
    expect((await inbox(fan.token)).filter((n) => n.eventType === "wishlist.restock")).toHaveLength(1);
  });
});
