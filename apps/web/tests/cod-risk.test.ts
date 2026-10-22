import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { setupTestDb, teardownTestDb } from "./helpers/db";
import { call } from "./helpers/http";
import { installFakeMedia, makeAdmin, makeCategory, makeProduct, makeVendor } from "./helpers/factory";
import { idemKey, makeShopper } from "./helpers/shop";
import { addCartItemHandler, checkoutHandler, getCartHandler, quoteHandler } from "@/server/api/handlers/shopping";
import { getEnv, setEnvForTests } from "@/server/config/env";
import { getCollections } from "@/server/db/collections";

let admin: Awaited<ReturnType<typeof makeAdmin>>;
let cat: { id: string };
const base = () => ({ ...getEnv() });
let original: ReturnType<typeof getEnv>;

beforeAll(async () => {
  await setupTestDb();
  installFakeMedia();
  admin = await makeAdmin();
  cat = await makeCategory(admin);
  original = base();
});
beforeEach(() => setEnvForTests(original));
afterAll(teardownTestDb);

type Buyer = Awaited<ReturnType<typeof makeShopper>>;
const addToCart = async (buyer: Buyer, priceMinor: number) => {
  const v = await makeVendor();
  const p = await makeProduct(v, { categoryId: cat.id, priceMinor, stock: 20, publish: true, admin });
  await call(addCartItemHandler, { method: "POST", token: buyer.token, body: { productId: p.id, variantId: p.variants[0].variantId, quantity: 1 } });
  return v;
};
const order = async (buyer: Buyer, method: "cod" | "online") => {
  const total = (await call(getCartHandler, { token: buyer.token })).data.totals.totalMinor as number;
  return call(checkoutHandler, { method: "POST", token: buyer.token, headers: { "idempotency-key": idemKey() }, body: { addressId: buyer.addressId, paymentMethod: method, expectedTotalMinor: total } });
};
const quote = (buyer: Buyer) => call(quoteHandler, { method: "POST", token: buyer.token, body: { addressId: buyer.addressId } });

describe("cash on delivery guard rails", () => {
  it("refuses cash orders above the limit, explains why, and still allows paying online", async () => {
    setEnvForTests({ ...original, COD_MAX_ORDER_MINOR: 100_000 });
    const buyer = await makeShopper();
    await addToCart(buyer, 150_000);
    const q = await quote(buyer);
    expect(q.data.paymentMethods).toEqual(["online"]);
    expect(q.data.codNotice).toMatch(/up to ৳1,000/);
    const cod = await order(buyer, "cod");
    expect(cod.status).toBe(422);
    expect(cod.error?.details[0]?.code).toBe("COD_LIMIT");
    expect((await order(buyer, "online")).status).toBe(201);
  });

  it("limits how many cash orders can be on the way at once", async () => {
    setEnvForTests({ ...original, COD_MAX_OPEN_ORDERS: 1 });
    const buyer = await makeShopper();
    await addToCart(buyer, 50_000);
    expect((await order(buyer, "cod")).status).toBe(201);
    await addToCart(buyer, 50_000);
    const second = await order(buyer, "cod");
    expect(second.status).toBe(422);
    expect(second.error?.details[0]?.code).toBe("COD_OPEN_ORDERS");
    expect((await quote(buyer)).data.paymentMethods).toEqual(["online"]);
    const stranger = await makeShopper(); // someone else is unaffected
    await addToCart(stranger, 50_000);
    expect((await order(stranger, "cod")).status).toBe(201);
  });

  it("stops cash orders after repeated returned or refused ones, but only for that shopper", async () => {
    setEnvForTests({ ...original, COD_BLOCK_AFTER_FAILURES: 2, COD_MAX_OPEN_ORDERS: 10 });
    const buyer = await makeShopper();
    const c = await getCollections();
    const placed: string[] = [];
    for (let i = 0; i < 2; i++) { await addToCart(buyer, 40_000); const r = await order(buyer, "cod"); expect(r.status).toBe(201); placed.push(r.data.id); }
    await c.vendorOrders.updateOne({ parentOrderId: new ObjectId(placed[0]!) }, { $set: { fulfillmentStatus: "returned" } });
    await addToCart(buyer, 40_000);
    expect((await order(buyer, "cod")).status).toBe(201); // one failure is tolerated
    await c.vendorOrders.updateOne({ parentOrderId: new ObjectId(placed[1]!) }, { $set: { fulfillmentStatus: "cancelled", timeline: [{ status: "shipped", at: new Date() }, { status: "cancelled", at: new Date() }] } }); // refused at the door
    await addToCart(buyer, 40_000);
    const blocked = await order(buyer, "cod");
    expect(blocked.status).toBe(422);
    expect(blocked.error?.details[0]?.code).toBe("COD_HISTORY");
    expect((await order(buyer, "online")).status).toBe(201);
    const other = await makeShopper();
    await addToCart(other, 40_000);
    expect((await order(other, "cod")).status).toBe(201);
  });
});
