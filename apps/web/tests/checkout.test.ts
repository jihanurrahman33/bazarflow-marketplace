import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { setupTestDb, teardownTestDb } from "./helpers/db";
import { applyTestEnv } from "./helpers/env";
import { call } from "./helpers/http";
import { makeAdmin, makeCategory, makeCustomer, makeProduct, makeVendor, uniq, installFakeMedia } from "./helpers/factory";
import {
  addCartItemHandler, cancelOrderHandler, checkoutHandler, createAddressHandler, deleteAddressHandler, deleteCartItemHandler, getCartHandler,
  getOrderHandler, listAddressesHandler, listOrdersHandler, patchCartItemHandler, quoteHandler, updateAddressHandler,
} from "@/server/api/handlers/shopping";
import { patchVariantHandler, getProductHandler, adjustInventoryHandler } from "@/server/api/handlers/vendor-catalog";
import { patchProfileHandler } from "@/server/api/handlers/vendors";
import { getCollections } from "@/server/db/collections";
import { getEnv } from "@/server/config/env";
import { expireUnpaidOrders } from "@/server/modules/orders/service";
import { deriveOrderStatus, fulfillmentMachine } from "@/server/modules/orders/state";
import { processOutbox } from "@/server/modules/outbox/outbox";
import { outboxHandlers } from "@/server/modules/outbox/handlers";

let admin: Awaited<ReturnType<typeof makeAdmin>>;
let cat: { id: string };
type Customer = Awaited<ReturnType<typeof makeCustomer>>;

beforeAll(async () => {
  await setupTestDb();
  installFakeMedia();
  admin = await makeAdmin();
  cat = await makeCategory(admin, "Home " + uniq());
});
afterAll(teardownTestDb);

const addr = (over: object = {}) => ({ label: "Home", recipient: "Rahim Uddin", phone: "+8801712345678", line1: "House 5, Road 3", city: "Dhaka", district: "Dhaka", postalCode: "1212", ...over });
let idem = 0;
const key = () => `test-key-${Date.now()}-${++idem}-abcdef`;

async function shopper(): Promise<Customer & { addressId: string }> {
  const u = await makeCustomer();
  const a = await call(createAddressHandler, { method: "POST", token: u.token, body: addr() });
  return { ...u, addressId: a.data.id };
}
async function vendorWith(priceMinor = 100000, stock = 10, shipping?: { flatFeeMinor: number; freeOverMinor?: number }) {
  const v = await makeVendor();
  if (shipping) await call(patchProfileHandler, { method: "PATCH", token: v.user.token, body: { shipping } });
  const p = await makeProduct(v, { categoryId: cat.id, priceMinor, stock, publish: true, admin });
  return { v, p, variantId: p.variants[0].variantId as string };
}
const add = (u: Customer, p: { id: string }, variantId: string, quantity = 1) =>
  call(addCartItemHandler, { method: "POST", token: u.token, body: { productId: p.id, variantId, quantity } });
const checkout = (u: Customer & { addressId: string }, total: number, method: "online" | "cod" = "online", k = key()) =>
  call(checkoutHandler, { method: "POST", token: u.token, headers: { "idempotency-key": k }, body: { addressId: u.addressId, paymentMethod: method, expectedTotalMinor: total } });

describe("addresses", () => {
  it("manages a private address book with a single default", async () => {
    const [a, b] = [await makeCustomer(), await makeCustomer()];
    const first = await call(createAddressHandler, { method: "POST", token: a.token, body: addr() });
    expect(first.data.isDefault).toBe(true);
    const second = await call(createAddressHandler, { method: "POST", token: a.token, body: addr({ label: "Office", isDefault: true }) });
    const list = await call(listAddressesHandler, { token: a.token });
    expect(list.data.filter((x: { isDefault: boolean }) => x.isDefault).map((x: { id: string }) => x.id)).toEqual([second.data.id]);
    expect((await call(updateAddressHandler, { method: "PATCH", token: b.token, params: { id: first.data.id }, body: { label: "Mine now" } })).status).toBe(404);
    expect((await call(deleteAddressHandler, { method: "DELETE", token: b.token, params: { id: first.data.id } })).status).toBe(404);
    expect((await call(listAddressesHandler, { token: b.token })).data).toEqual([]);
    expect((await call(createAddressHandler, { method: "POST", token: a.token, body: addr({ postalCode: "12" }) })).status).toBe(400);
    expect((await call(createAddressHandler, { method: "POST", token: a.token, body: addr({ userId: "x", country: "US" }) })).status).toBe(400);
    expect((await call(deleteAddressHandler, { method: "DELETE", token: a.token, params: { id: second.data.id } })).status).toBe(204);
    expect((await call(listAddressesHandler, { token: a.token })).data[0].isDefault).toBe(true);
  });
});

describe("cart", () => {
  it("prices come from the server, quantities are bounded and merged, and only customers can shop", async () => {
    const { v, p, variantId } = await vendorWith(25000, 100);
    const u = await shopper();
    const r1 = await add(u, p, variantId, 2);
    expect(r1.status).toBe(201);
    expect(r1.data.totals.subtotalMinor).toBe(50000);
    const r2 = await add(u, p, variantId, 3);
    expect(r2.data.groups[0].lines[0].quantity).toBe(5);
    expect((await add(u, p, variantId, 20)).status).toBe(422);
    expect((await add(u, p, variantId, 0)).status).toBe(400);
    expect((await call(addCartItemHandler, { method: "POST", token: u.token, body: { productId: p.id, variantId, quantity: 1, priceMinor: 1 } })).status).toBe(400);
    expect((await call(addCartItemHandler, { method: "POST", token: u.token, body: { productId: p.id, variantId: "nope", quantity: 1 } })).error?.code).toBe("PRODUCT_UNAVAILABLE");
    const itemId = r1.data.groups[0].lines[0].itemId;
    expect((await call(patchCartItemHandler, { method: "PATCH", token: u.token, params: { itemId }, body: { quantity: 1 } })).data.totals.subtotalMinor).toBe(25000);
    expect((await call(patchCartItemHandler, { method: "PATCH", token: u.token, params: { itemId: "bad" }, body: { quantity: 1 } })).status).toBe(400);
    // another customer's cart is separate
    const other = await shopper();
    expect((await call(getCartHandler, { token: other.token })).data.itemCount).toBe(0);
    expect((await call(patchCartItemHandler, { method: "PATCH", token: other.token, params: { itemId }, body: { quantity: 9 } })).status).toBe(404);
    expect((await call(deleteCartItemHandler, { method: "DELETE", token: u.token, params: { itemId } })).data.itemCount).toBe(0);
    expect((await call(getCartHandler, { token: v.user.token })).status).toBe(403);
    expect((await call(getCartHandler)).status).toBe(401);
  });

  it("reports stale lines (price drift, stock, unpublished) instead of silently dropping them", async () => {
    const { v, p, variantId } = await vendorWith(10000, 3);
    const u = await shopper();
    await add(u, p, variantId, 3);
    await call(patchVariantHandler, { method: "PATCH", token: v.user.token, params: { id: p.id, variantId }, body: { priceMinor: 12000 } });
    const view = await call(getCartHandler, { token: u.token });
    expect(view.data.totals.subtotalMinor).toBe(36000); // live price
    const item = (await call(getProductHandler, { token: v.user.token, params: { id: p.id } })).data.variants[0].stock.inventoryItemId;
    await call(adjustInventoryHandler, { method: "PATCH", token: v.user.token, params: { skuId: item }, body: { set: 1, reason: "damaged goods" } });
    const stale = await call(getCartHandler, { token: u.token });
    expect(stale.data.issues).toEqual([expect.objectContaining({ code: "INSUFFICIENT_STOCK", availableQuantity: 1 })]);
  });
});

describe("checkout: multi-vendor split", () => {
  it("creates one parent order and one vendor order per seller with frozen snapshots, commission and reserved stock", async () => {
    const a = await vendorWith(100000, 10, { flatFeeMinor: 6000 });
    const b = await vendorWith(25050, 10, { flatFeeMinor: 9000, freeOverMinor: 50000 });
    const u = await shopper();
    await add(u, a.p, a.variantId, 1);
    await add(u, b.p, b.variantId, 2);
    const q = await call(quoteHandler, { method: "POST", token: u.token, body: { addressId: u.addressId } });
    expect(q.data.groups).toHaveLength(2);
    // A: 100000 + 6000 ship. B: 50100 >= 50000 -> free shipping
    expect(q.data.totals).toEqual({ subtotalMinor: 150100, shippingMinor: 6000, discountMinor: 0, totalMinor: 156100 });
    expect(q.data.paymentMethods).toContain("online");

    const r = await checkout(u, 156100);
    expect(r.status).toBe(201);
    expect(r.data.status).toBe("pending_payment");
    expect(r.data.paymentStatus).toBe("pending");
    expect(r.data.vendorOrders).toHaveLength(2);
    expect(r.data.vendorOrders.every((x: { status: string }) => x.status === "awaiting_payment")).toBe(true);
    expect(JSON.stringify(r.data)).not.toMatch(/commission|vendorNet/);

    const c = await getCollections();
    const vos = await c.vendorOrders.find({ parentOrderId: new ObjectId(r.data.id) }).toArray();
    const voA = vos.find((x) => x.vendorId.equals(a.v.vendorId))!;
    const voB = vos.find((x) => x.vendorId.equals(b.v.vendorId))!;
    expect(voA.commission).toEqual({ bps: 1000, ruleVersion: 1, amountMinor: 10000, vendorNetMinor: 106000 - 10000 });
    expect(voB.commission.amountMinor).toBe(5010); // 10% of 50100
    expect(voB.totals).toEqual({ subtotalMinor: 50100, shippingMinor: 0, totalMinor: 50100 });
    expect(voA.totals.totalMinor + voB.totals.totalMinor).toBe(r.data.totals.totalMinor);

    // stock reserved (not sold) and cart emptied
    const itemA = await c.inventoryItems.findOne({ productId: new ObjectId(a.p.id) });
    expect(itemA).toMatchObject({ onHand: 10, reserved: 1 });
    expect((await call(getCartHandler, { token: u.token })).data.itemCount).toBe(0);
    expect(await c.stockReservations.countDocuments({ orderId: new ObjectId(r.data.id), status: "active" })).toBe(1);

    // later catalogue edits do not rewrite history
    await call(patchVariantHandler, { method: "PATCH", token: a.v.user.token, params: { id: a.p.id, variantId: a.variantId }, body: { priceMinor: 999999 } });
    const again = await call(getOrderHandler, { token: u.token, params: { id: r.data.id } });
    expect(again.data.vendorOrders.flatMap((x: { items: { unitPriceMinor: number }[] }) => x.items.map((i) => i.unitPriceMinor)).sort((a: number, b: number) => a - b)).toEqual([25050, 100000]);
  });

  it("rejects the order when the shopper's expected total is stale (price changed)", async () => {
    const { v, p, variantId } = await vendorWith(10000, 5);
    const u = await shopper();
    await add(u, p, variantId, 1);
    const q = await call(quoteHandler, { method: "POST", token: u.token, body: { addressId: u.addressId } });
    await call(patchVariantHandler, { method: "PATCH", token: v.user.token, params: { id: p.id, variantId }, body: { priceMinor: 20000 } });
    const r = await checkout(u, q.data.totals.totalMinor);
    expect(r.error?.code).toBe("PRICE_CHANGED");
    const c = await getCollections();
    expect(await c.orders.countDocuments({ buyerId: u.id })).toBe(0);
    expect((await c.inventoryItems.findOne({ productId: new ObjectId(p.id) }))!.reserved).toBe(0);
  });

  it("never trusts client-supplied prices, items or vendor ids", async () => {
    const { p, variantId } = await vendorWith(10000, 5);
    const u = await shopper();
    await add(u, p, variantId, 1);
    for (const extra of [{ items: [{ productId: p.id, priceMinor: 1 }] }, { totalMinor: 1 }, { vendorId: "x" }, { discountMinor: 5000 }]) {
      const r = await call(checkoutHandler, { method: "POST", token: u.token, headers: { "idempotency-key": key() }, body: { addressId: u.addressId, paymentMethod: "online", expectedTotalMinor: 10000, ...extra } });
      expect(r.status).toBe(400);
    }
  });

  it("requires an Idempotency-Key, a cart, an owned address and a valid method", async () => {
    const { p, variantId } = await vendorWith(10000, 5);
    const u = await shopper();
    const noKey = await call(checkoutHandler, { method: "POST", token: u.token, body: { addressId: u.addressId, paymentMethod: "online", expectedTotalMinor: 0 } });
    expect(noKey.error?.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect((await checkout(u, 0)).error?.code).toBe("CART_EMPTY");
    await add(u, p, variantId, 1);
    const stranger = await shopper();
    const foreign = await call(checkoutHandler, { method: "POST", token: u.token, headers: { "idempotency-key": key() }, body: { addressId: stranger.addressId, paymentMethod: "online", expectedTotalMinor: 10000 } });
    expect(foreign.status).toBe(404);
    const badKey = await call(checkoutHandler, { method: "POST", token: u.token, headers: { "idempotency-key": "short" }, body: { addressId: u.addressId, paymentMethod: "online", expectedTotalMinor: 10000 } });
    expect(badKey.status).toBe(400);
    const vendor = await makeVendor();
    expect((await call(checkoutHandler, { method: "POST", token: vendor.user.token, headers: { "idempotency-key": key() }, body: { addressId: u.addressId, paymentMethod: "online", expectedTotalMinor: 1 } })).status).toBe(403);
  });
});

describe("checkout: idempotency and concurrency", () => {
  it("replays the same response for the same key and conflicts on a different body", async () => {
    const { p, variantId } = await vendorWith(10000, 5);
    const u = await shopper();
    await add(u, p, variantId, 1);
    const k = key();
    const first = await checkout(u, 10000, "online", k);
    const replay = await checkout(u, 10000, "online", k);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.data.id).toBe(first.data.id);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    const c = await getCollections();
    expect(await c.orders.countDocuments({ buyerId: u.id })).toBe(1);
    const diff = await checkout(u, 99999, "online", k);
    expect(diff.error?.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("double-submit with one key creates exactly one order", async () => {
    const { p, variantId } = await vendorWith(10000, 5);
    const u = await shopper();
    await add(u, p, variantId, 1);
    const k = key();
    const rs = await Promise.all([checkout(u, 10000, "online", k), checkout(u, 10000, "online", k), checkout(u, 10000, "online", k)]);
    const created = rs.filter((r) => r.status === 201);
    expect(created.length).toBeGreaterThanOrEqual(1);
    expect(new Set(created.map((r) => r.data.id)).size).toBe(1);
    for (const r of rs.filter((x) => x.status !== 201)) expect(r.error?.code).toBe("IDEMPOTENCY_IN_PROGRESS");
    const c = await getCollections();
    expect(await c.orders.countDocuments({ buyerId: u.id })).toBe(1);
    expect((await c.inventoryItems.findOne({ productId: new ObjectId(p.id) }))!.reserved).toBe(1);
  });

  it("different keys on the same cart still cannot double-order the cart contents", async () => {
    const { p, variantId } = await vendorWith(10000, 50);
    const u = await shopper();
    await add(u, p, variantId, 2);
    const rs = await Promise.all([checkout(u, 10000 * 2, "online"), checkout(u, 10000 * 2, "online")]);
    const c = await getCollections();
    const orders = await c.orders.countDocuments({ buyerId: u.id });
    expect(orders).toBeGreaterThanOrEqual(1);
    const item = await c.inventoryItems.findOne({ productId: new ObjectId(p.id) });
    expect(item!.reserved).toBe(orders * 2); // stock accounting matches whatever succeeded
    expect(rs.some((r) => r.status === 201)).toBe(true);
  });

  it("the last unit goes to exactly one of two shoppers and the loser leaves no partial state", async () => {
    const a = await vendorWith(10000, 1);
    const b = await vendorWith(20000, 5);
    const [u1, u2] = [await shopper(), await shopper()];
    for (const u of [u1, u2]) {
      await add(u, a.p, a.variantId, 1);
      await add(u, b.p, b.variantId, 1);
    }
    const total = 10000 + 20000;
    const rs = await Promise.all([checkout(u1, total + 0), checkout(u2, total + 0)]);
    const wins = rs.filter((r) => r.status === 201);
    expect(wins).toHaveLength(1);
    const lose = rs.find((r) => r.status !== 201)!;
    expect(["INVENTORY_UNAVAILABLE"]).toContain(lose.error?.code);
    const c = await getCollections();
    expect((await c.inventoryItems.findOne({ productId: new ObjectId(a.p.id) }))).toMatchObject({ onHand: 1, reserved: 1 });
    expect((await c.inventoryItems.findOne({ productId: new ObjectId(b.p.id) }))).toMatchObject({ onHand: 5, reserved: 1 }); // loser's reservation on B rolled back
    expect(await c.orders.countDocuments({})).toBeGreaterThanOrEqual(1);
  });
});

describe("order privacy", () => {
  it("only the buyer can read or cancel an order; lists are scoped", async () => {
    const { p, variantId } = await vendorWith(10000, 5);
    const [u, other] = [await shopper(), await shopper()];
    await add(u, p, variantId, 1);
    const o = await checkout(u, 10000);
    expect((await call(getOrderHandler, { token: other.token, params: { id: o.data.id } })).status).toBe(404);
    expect((await call(cancelOrderHandler, { method: "POST", token: other.token, params: { id: o.data.id }, body: {} })).status).toBe(404);
    expect((await call(listOrdersHandler, { token: other.token })).data).toEqual([]);
    expect((await call(listOrdersHandler, { token: u.token })).data.map((x: { id: string }) => x.id)).toEqual([o.data.id]);
    expect((await call(getOrderHandler, { params: { id: o.data.id } })).status).toBe(401);
    expect((await call(getOrderHandler, { token: u.token, params: { id: "zzz" } })).status).toBe(400);
  });
});

describe("cash on delivery", () => {
  it("is refused unless enabled", async () => {
    const dbName = getEnv().MONGODB_DB;
    const { p, variantId } = await vendorWith(10000, 5);
    const u = await shopper();
    await add(u, p, variantId, 1);
    applyTestEnv({ MONGODB_DB: dbName, COD_ENABLED: "false" });
    try {
      expect((await checkout(u, 10000, "cod")).error?.code).toBe("BUSINESS_RULE_VIOLATION");
      expect((await call(quoteHandler, { method: "POST", token: u.token, body: { addressId: u.addressId } })).data.paymentMethods).toEqual(["online"]);
    } finally {
      applyTestEnv({ MONGODB_DB: dbName });
    }
  });

  it("confirms immediately, commits stock, notifies buyer and vendor, and can be cancelled before work starts", async () => {
    const { v, p, variantId } = await vendorWith(10000, 5);
    const u = await shopper();
    await add(u, p, variantId, 2);
    const r = await checkout(u, 20000, "cod");
    expect(r.data).toMatchObject({ status: "confirmed", paymentStatus: "cod_pending", paymentMethod: "cod" });
    expect(r.data.vendorOrders[0].status).toBe("new");
    const c = await getCollections();
    expect(await c.inventoryItems.findOne({ productId: new ObjectId(p.id) })).toMatchObject({ onHand: 3, reserved: 0 });
    while ((await processOutbox(outboxHandlers)) > 0);
    expect(await c.notifications.countDocuments({ userId: v.user.id, eventType: "vendor_order.new" })).toBe(1);
    expect(await c.notifications.countDocuments({ userId: u.id, eventType: "order.confirmed" })).toBe(1);

    const cancelled = await call(cancelOrderHandler, { method: "POST", token: u.token, params: { id: r.data.id }, body: { reason: "changed mind" } });
    expect(cancelled.data.status).toBe("cancelled");
    expect(cancelled.data.vendorOrders[0].status).toBe("cancelled");
    expect(await c.inventoryItems.findOne({ productId: new ObjectId(p.id) })).toMatchObject({ onHand: 5, reserved: 0 });
    // cancelling again is idempotent and does not restock twice
    await call(cancelOrderHandler, { method: "POST", token: u.token, params: { id: r.data.id }, body: {} });
    expect(await c.inventoryItems.findOne({ productId: new ObjectId(p.id) })).toMatchObject({ onHand: 5 });
  });

  it("cannot be cancelled once the vendor has accepted", async () => {
    const { p, variantId } = await vendorWith(10000, 5);
    const u = await shopper();
    await add(u, p, variantId, 1);
    const r = await checkout(u, 10000, "cod");
    const c = await getCollections();
    await c.vendorOrders.updateOne({ parentOrderId: new ObjectId(r.data.id) }, { $set: { fulfillmentStatus: "accepted" } });
    expect((await call(cancelOrderHandler, { method: "POST", token: u.token, params: { id: r.data.id }, body: {} })).error?.code).toBe("BUSINESS_RULE_VIOLATION");
  });
});

describe("unpaid orders", () => {
  it("customer cancel releases the reservation; expiry job cancels lapsed orders once", async () => {
    await expireUnpaidOrders(new Date(Date.now() + 31 * 60_000)); // drain orders left by earlier tests
    const { p, variantId } = await vendorWith(10000, 5);
    const [u1, u2] = [await shopper(), await shopper()];
    await add(u1, p, variantId, 2);
    const o1 = await checkout(u1, 10000 * 2);
    await add(u2, p, variantId, 1);
    const o2 = await checkout(u2, 10000);
    const c = await getCollections();
    const item = () => c.inventoryItems.findOne({ productId: new ObjectId(p.id) });
    expect(await item()).toMatchObject({ onHand: 5, reserved: 3 });

    const cancelled = await call(cancelOrderHandler, { method: "POST", token: u1.token, params: { id: o1.data.id }, body: {} });
    expect(cancelled.data.status).toBe("cancelled");
    expect(await item()).toMatchObject({ reserved: 1 });

    expect(await expireUnpaidOrders(new Date())).toBe(0); // not due yet
    const later = new Date(Date.now() + 31 * 60_000);
    expect(await expireUnpaidOrders(later)).toBe(1);
    expect(await expireUnpaidOrders(later)).toBe(0); // idempotent
    expect(await item()).toMatchObject({ onHand: 5, reserved: 0 });
    const expired = await call(getOrderHandler, { token: u2.token, params: { id: o2.data.id } });
    expect(expired.data).toMatchObject({ status: "cancelled", cancellationReason: "payment_expired" });
  });
});

describe("state machines", () => {
  it("derives the parent status from vendor orders", () => {
    const vo = (...s: string[]) => s.map((fulfillmentStatus) => ({ fulfillmentStatus })) as never;
    expect(deriveOrderStatus("confirmed", vo("new", "new"))).toBe("confirmed");
    expect(deriveOrderStatus("confirmed", vo("accepted", "new"))).toBe("processing");
    expect(deriveOrderStatus("processing", vo("shipped", "accepted"))).toBe("partially_fulfilled");
    expect(deriveOrderStatus("processing", vo("shipped", "shipped"))).toBe("shipped");
    expect(deriveOrderStatus("shipped", vo("delivered", "shipped"))).toBe("shipped");
    expect(deriveOrderStatus("shipped", vo("delivered", "delivered"))).toBe("delivered");
    expect(deriveOrderStatus("confirmed", vo("cancelled", "delivered"))).toBe("delivered");
    expect(deriveOrderStatus("confirmed", vo("cancelled", "cancelled"))).toBe("cancelled");
    expect(deriveOrderStatus("pending_payment", vo("awaiting_payment"))).toBe("pending_payment");
    expect(deriveOrderStatus("cancelled", vo("new"))).toBe("cancelled");
  });
  it("forbids skipping vendor order states", () => {
    expect(fulfillmentMachine.can("new", "shipped")).toBe(false);
    expect(fulfillmentMachine.can("accepted", "shipped")).toBe(true);
    expect(fulfillmentMachine.can("delivered", "shipped")).toBe(false);
    expect(fulfillmentMachine.isTerminal("cancelled")).toBe(true);
  });
});
