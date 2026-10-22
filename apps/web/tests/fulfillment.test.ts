import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { setupTestDb, teardownTestDb } from "./helpers/db";
import { call } from "./helpers/http";
import { makeAdmin, makeCustomer, makeUser, installFakeMedia } from "./helpers/factory";
import { makeShop, placeShopOrder, type Shop } from "./helpers/shop";
import {
  acceptOrderHandler, adminCancelVendorOrderHandler, approveReturnHandler, cancelOrderVendorHandler, deliverOrderHandler, dispatchOrderHandler, rejectReturnHandler,
  requestReturnHandler, shipOrderHandler, trackShipmentHandler, vendorOrderHandler, vendorOrdersHandler,
} from "@/server/api/handlers/fulfillment";
import { getOrderHandler } from "@/server/api/handlers/shopping";
import { adminApproveRefundHandler, vendorBalanceHandler, vendorLedgerHandler } from "@/server/api/handlers/payments";
import {
  adminOrderHandler, adminOrdersHandler, adminPayoutsHandler, approvePayoutHandler, cancelPayoutHandler, createReviewHandler, hideReviewHandler,
  listReviewsHandler, markFailedHandler, markPaidHandler, rejectPayoutHandler, requestPayoutHandler, salesReportHandler, vendorPayoutsHandler,
} from "@/server/api/handlers/commerce-ops";
import { patchProfileHandler } from "@/server/api/handlers/vendors";
import { suspendVendorHandler, reinstateVendorHandler } from "@/server/api/handlers/admin";
import { getCollections } from "@/server/db/collections";
import { getBalance } from "@/server/modules/ledger/service";
import { mockGateway } from "@/server/modules/payments/mock";
import { processOutbox } from "@/server/modules/outbox/outbox";
import { outboxHandlers } from "@/server/modules/outbox/handlers";

let shop: Shop;

beforeAll(async () => {
  await setupTestDb();
  installFakeMedia();
  shop = await makeShop();
});
afterAll(teardownTestDb);
beforeEach(() => mockGateway.reset());

const act = (h: Parameters<typeof call>[0], token: string, id: string, body?: unknown) => call(h, { method: "POST", token, params: { id }, body });
const ship = (token: string, id: string) => act(shipOrderHandler, token, id, { carrier: "Pathao", trackingNumber: "PT-123456" });
async function drain() {
  while ((await processOutbox(outboxHandlers)) > 0);
}
/** Run a vendor order through accept -> ship -> deliver. */
async function fulfil(v: { user: { token: string } }, voId: string) {
  expect((await act(acceptOrderHandler, v.user.token, voId)).status).toBe(200);
  expect((await ship(v.user.token, voId)).status).toBe(200);
  expect((await act(deliverOrderHandler, v.user.token, voId)).status).toBe(200);
}
const parent = async (id: string) => (await getCollections()).orders.findOne({ _id: new ObjectId(id) });

describe("vendor order queue", () => {
  it("shows a vendor only paid orders for their own store, with what is needed to deliver and nothing more", async () => {
    const unpaid = await placeShopOrder(shop, { method: "online" }); // awaiting payment
    const paid = await placeShopOrder(shop, { method: "online", pay: true });
    const cod = await placeShopOrder(shop, { prices: [20000], method: "cod" });

    const unpaidList = await call(vendorOrdersHandler, { token: unpaid.vendors[0]!.user.token });
    expect(unpaidList.data).toEqual([]); // sellers never see (or act on) unpaid orders
    expect((await call(vendorOrderHandler, { token: unpaid.vendors[0]!.user.token, params: { id: unpaid.vos[0]!._id.toHexString() } })).status).toBe(404);

    const mine = await call(vendorOrdersHandler, { token: paid.vendors[0]!.user.token });
    expect(mine.data).toHaveLength(1);
    expect(mine.data[0]).toMatchObject({ orderNumber: paid.order.orderNumber, status: "new", paymentMethod: "online", collectOnDeliveryMinor: 0 });
    expect(mine.data[0].commission).toMatchObject({ bps: 1000, amountMinor: 10000, vendorNetMinor: 90000 });
    const json = JSON.stringify(mine.data[0]);
    expect(json).toContain("Rahim Uddin");
    expect(json).not.toMatch(/@example\.com|buyerId|passwordHash/);

    const codView = await call(vendorOrderHandler, { token: cod.vendors[0]!.user.token, params: { id: cod.vos[0]!._id.toHexString() } });
    expect(codView.data).toMatchObject({ paymentMethod: "cod", collectOnDeliveryMinor: 20000 });
  });

  it("isolates vendors and roles on every order operation", async () => {
    const o = await placeShopOrder(shop, { prices: [50000, 60000], method: "cod" });
    const [a, b] = o.vendors;
    const aOrder = o.vos[0]!._id.toHexString();
    const bOrder = o.vos[1]!._id.toHexString();
    // vendor B cannot touch vendor A's order in any way (404, not 403: existence is not revealed)
    expect((await call(vendorOrderHandler, { token: b!.user.token, params: { id: aOrder } })).status).toBe(404);
    for (const h of [acceptOrderHandler, deliverOrderHandler]) expect((await act(h, b!.user.token, aOrder)).status).toBe(404);
    expect((await ship(b!.user.token, aOrder)).status).toBe(404);
    expect((await act(cancelOrderVendorHandler, b!.user.token, aOrder, { reason: "sabotage" })).status).toBe(404);
    expect((await call(vendorOrdersHandler, { token: b!.user.token })).data.map((x: { id: string }) => x.id)).toEqual([bOrder]);
    // customers, guests and unprivileged admins are refused
    expect((await act(acceptOrderHandler, o.buyer.token, aOrder)).status).toBe(403);
    expect((await call(vendorOrdersHandler, { token: o.buyer.token })).status).toBe(403);
    expect((await call(acceptOrderHandler, { method: "POST", params: { id: aOrder } })).status).toBe(401);
    expect((await act(adminCancelVendorOrderHandler, (await makeAdmin(["order.read_all"])).token, aOrder, { reason: "no permission" })).status).toBe(403);
    expect((await call(vendorOrderHandler, { token: a!.user.token, params: { id: "nope" } })).status).toBe(400);
    expect(await (await getCollections()).vendorOrders.findOne({ _id: o.vos[0]!._id })).toMatchObject({ fulfillmentStatus: "new" });
  });
});

describe("fulfilment lifecycle", () => {
  it("moves each seller independently; the parent status is derived; COD is marked paid on full delivery", async () => {
    const o = await placeShopOrder(shop, { prices: [100000, 50000], method: "cod" });
    const [a, b] = o.vendors;
    const [aId, bId] = o.vos.map((v) => v._id.toHexString()) as [string, string];
    expect(o.order.status).toBe("confirmed");

    await act(acceptOrderHandler, a!.user.token, aId);
    expect((await parent(o.orderId))!.status).toBe("processing");
    await ship(a!.user.token, aId);
    expect((await parent(o.orderId))!.status).toBe("partially_fulfilled"); // A shipped, B untouched
    expect(await (await getCollections()).vendorOrders.findOne({ _id: o.vos[1]!._id })).toMatchObject({ fulfillmentStatus: "new" });

    await act(acceptOrderHandler, b!.user.token, bId);
    await ship(b!.user.token, bId);
    expect((await parent(o.orderId))!.status).toBe("shipped");
    await act(deliverOrderHandler, a!.user.token, aId);
    expect((await parent(o.orderId))!.status).toBe("shipped"); // B still on the road
    expect((await parent(o.orderId))!.paymentStatus).toBe("cod_pending");
    await act(deliverOrderHandler, b!.user.token, bId);
    expect(await parent(o.orderId)).toMatchObject({ status: "delivered", paymentStatus: "paid" });

    // customer sees per-seller progress with tracking, no commission data
    const view = await call(getOrderHandler, { token: o.buyer.token, params: { id: o.orderId } });
    expect(view.data.vendorOrders.map((v: { status: string }) => v.status)).toEqual(["delivered", "delivered"]);
    expect(view.data.vendorOrders[0].shipment).toMatchObject({ carrier: "Pathao", trackingNumber: "PT-123456" });
    expect(JSON.stringify(view.data)).not.toMatch(/commission|vendorNet/);

    // COD: the platform never held the money, so each seller simply owes commission once delivered
    const c = await getCollections();
    const led = await c.ledgerEntries.find({ vendorId: a!.vendorId }).toArray();
    expect(led).toHaveLength(1);
    expect(led[0]).toMatchObject({ type: "platform_commission", amountMinor: -10000 });
    await drain();
    for (const ev of ["order.accepted", "order.shipped", "order.delivered"]) expect(await c.notifications.countDocuments({ userId: o.buyer.id, eventType: ev })).toBe(2);
  });

  it("rejects skipped, repeated and backwards transitions, and double-ship races apply once", async () => {
    const o = await placeShopOrder(shop, { method: "cod" });
    const v = o.vendors[0]!;
    const id = o.vos[0]!._id.toHexString();
    expect((await ship(v.user.token, id)).error?.code).toBe("INVALID_STATE_TRANSITION"); // not accepted yet
    expect((await act(deliverOrderHandler, v.user.token, id)).error?.code).toBe("INVALID_STATE_TRANSITION");
    expect((await act(acceptOrderHandler, v.user.token, id)).status).toBe(200);
    expect((await act(acceptOrderHandler, v.user.token, id)).error?.code).toBe("INVALID_STATE_TRANSITION");
    const [r1, r2] = await Promise.all([ship(v.user.token, id), ship(v.user.token, id)]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const c = await getCollections();
    const vo = await c.vendorOrders.findOne({ _id: o.vos[0]!._id });
    expect(vo!.timeline.filter((t) => t.status === "shipped")).toHaveLength(1);
    expect((await act(acceptOrderHandler, v.user.token, id)).status).toBe(409); // cannot go backwards
    expect((await call(shipOrderHandler, { method: "POST", token: v.user.token, params: { id }, body: { carrier: "x", trackingNumber: "<script>" } })).status).toBe(400);
  });

  it("never changes payment state: fulfilment of a paid online order leaves the payment untouched", async () => {
    const o = await placeShopOrder(shop, { method: "online", pay: true });
    const c = await getCollections();
    const before = await c.payments.findOne({ merchantReference: o.ref });
    await fulfil(o.vendors[0]!, o.vos[0]!._id.toHexString());
    const after = await c.payments.findOne({ merchantReference: o.ref });
    expect(after).toMatchObject({ status: "succeeded", refundedMinor: 0, version: before!.version });
    expect(await parent(o.orderId)).toMatchObject({ status: "delivered", paymentStatus: "paid" });
  });

  it("a suspended seller cannot accept or ship, but can still cancel so the customer is not stranded", async () => {
    const o = await placeShopOrder(shop, { prices: [100000, 40000], method: "cod" });
    const [a] = o.vendors;
    const aId = o.vos[0]!._id.toHexString();
    await act(acceptOrderHandler, a!.user.token, aId);
    await call(suspendVendorHandler, { method: "POST", token: shop.admin.token, params: { id: a!.vendorId.toHexString() }, body: { reason: "investigation" } });
    expect((await ship(a!.user.token, aId)).error?.code).toBe("VENDOR_NOT_ACTIVE");
    expect((await act(acceptOrderHandler, o.vendors[1]!.user.token, o.vos[1]!._id.toHexString())).status).toBe(200); // other sellers unaffected
    const cancelled = await act(cancelOrderVendorHandler, a!.user.token, aId, { reason: "store suspended" });
    expect(cancelled.data.status).toBe("cancelled");
    await call(reinstateVendorHandler, { method: "POST", token: shop.admin.token, params: { id: a!.vendorId.toHexString() }, body: { reason: "cleared" } });
  });
});

describe("seller cancellation and refunds", () => {
  it("cancelling one seller's share restocks it and refunds only that share; the other seller continues", async () => {
    const o = await placeShopOrder(shop, { prices: [100000, 50000], method: "online", pay: true });
    const [a, b] = o.vendors;
    const c = await getCollections();
    expect(await c.inventoryItems.findOne({ productId: new ObjectId(o.products[0]!.id) })).toMatchObject({ onHand: 9 });

    const cancelled = await act(cancelOrderVendorHandler, a!.user.token, o.vos[0]!._id.toHexString(), { reason: "out of stock" });
    expect(cancelled.data.status).toBe("cancelled");
    expect(await c.inventoryItems.findOne({ productId: new ObjectId(o.products[0]!.id) })).toMatchObject({ onHand: 10, reserved: 0 });
    const pay = await c.payments.findOne({ merchantReference: o.ref });
    expect(pay).toMatchObject({ refundedMinor: 100000, status: "partially_refunded" });
    expect(await c.refunds.countDocuments({ paymentId: pay!._id, vendorOrderId: o.vos[0]!._id, status: "succeeded" })).toBe(1);
    // seller A nets to zero; seller B untouched
    expect((await c.ledgerEntries.find({ vendorId: a!.vendorId }).toArray()).reduce((s, e) => s + e.amountMinor, 0)).toBe(0);
    expect(await getBalance(b!.vendorId)).toMatchObject({ pendingMinor: 45000 });
    expect(await parent(o.orderId)).toMatchObject({ status: "confirmed", paymentStatus: "partially_refunded" });

    await fulfil(b!, o.vos[1]!._id.toHexString());
    expect(await parent(o.orderId)).toMatchObject({ status: "delivered" }); // cancelled shares don't block completion
  });

  it("cancelling every seller cancels the order; cancel needs a reason; delivered orders cannot be cancelled", async () => {
    const o = await placeShopOrder(shop, { prices: [30000, 30000], method: "cod" });
    expect((await act(cancelOrderVendorHandler, o.vendors[0]!.user.token, o.vos[0]!._id.toHexString(), {})).status).toBe(400);
    await act(cancelOrderVendorHandler, o.vendors[0]!.user.token, o.vos[0]!._id.toHexString(), { reason: "cannot supply" });
    expect((await parent(o.orderId))!.status).toBe("confirmed");
    await act(cancelOrderVendorHandler, o.vendors[1]!.user.token, o.vos[1]!._id.toHexString(), { reason: "cannot supply" });
    expect(await parent(o.orderId)).toMatchObject({ status: "cancelled", paymentStatus: "none" });

    const d = await placeShopOrder(shop, { method: "cod" });
    await fulfil(d.vendors[0]!, d.vos[0]!._id.toHexString());
    expect((await act(cancelOrderVendorHandler, d.vendors[0]!.user.token, d.vos[0]!._id.toHexString(), { reason: "too late" })).error?.code).toBe("INVALID_STATE_TRANSITION");
  });

  it("admins with order.manage can cancel a stuck seller order; the action is audited", async () => {
    const o = await placeShopOrder(shop, { method: "cod" });
    const manager = await makeAdmin(["order.manage"]);
    const r = await act(adminCancelVendorOrderHandler, manager.token, o.vos[0]!._id.toHexString(), { reason: "seller unresponsive" });
    expect(r.data.status).toBe("cancelled");
    const audit = await (await getCollections()).auditLogs.findOne({ action: "vendor_order.cancelled", resourceId: o.vos[0]!._id.toHexString() });
    expect(audit).toMatchObject({ actorRole: "admin", reason: "seller unresponsive" });
  });
});

describe("returns", () => {
  it("customer requests within the window; vendor approves; finance approves the refund; ledger reverses exactly", async () => {
    const o = await placeShopOrder(shop, { method: "online", pay: true });
    const v = o.vendors[0]!;
    const voId = o.vos[0]!._id.toHexString();
    expect((await act(requestReturnHandler, o.buyer.token, voId, { reason: "too early" })).error?.code).toBe("BUSINESS_RULE_VIOLATION"); // not delivered
    await fulfil(v, voId);
    const stranger = await makeCustomer();
    expect((await act(requestReturnHandler, stranger.token, voId, { reason: "not mine" })).status).toBe(404);
    expect((await act(requestReturnHandler, v.user.token, voId, { reason: "vendor cannot" })).status).toBe(403);
    expect((await act(requestReturnHandler, o.buyer.token, voId, { reason: "wrong size" })).status).toBe(201);
    expect((await act(requestReturnHandler, o.buyer.token, voId, { reason: "again again" })).status).toBe(422);

    const ok = await act(approveReturnHandler, v.user.token, voId);
    expect(ok.data.status).toBe("returned");
    const c = await getCollections();
    const refund = (await c.refunds.findOne({ vendorOrderId: o.vos[0]!._id }))!;
    expect(refund).toMatchObject({ status: "requested", amountMinor: 100000 }); // needs a finance decision
    expect(refund.system).toBeUndefined();
    expect(mockGateway.refunds.size).toBe(0);
    const finance = await makeAdmin(["refund.approve"]);
    expect((await call(adminApproveRefundHandler, { method: "POST", token: finance.token, params: { id: refund._id.toHexString() } })).data.status).toBe("succeeded");
    const sum = (await c.ledgerEntries.find({ vendorId: v.vendorId }).toArray()).reduce((s, e) => s + e.amountMinor, 0);
    expect(sum).toBe(0);
  });

  it("enforces the return window and a rejected return does not restart it", async () => {
    const o = await placeShopOrder(shop, { method: "cod" });
    const v = o.vendors[0]!;
    const voId = o.vos[0]!._id.toHexString();
    await fulfil(v, voId);
    const c = await getCollections();
    const old = new Date(Date.now() - 8 * 86_400_000);
    await c.vendorOrders.updateOne({ _id: o.vos[0]!._id }, { $set: { deliveredAt: old } });
    expect((await act(requestReturnHandler, o.buyer.token, voId, { reason: "too late now" })).error?.details[0]?.code).toBe("RETURN_WINDOW_CLOSED");

    const fresh = new Date(Date.now() - 2 * 86_400_000);
    await c.vendorOrders.updateOne({ _id: o.vos[0]!._id }, { $set: { deliveredAt: fresh } });
    await act(requestReturnHandler, o.buyer.token, voId, { reason: "defective" });
    const rej = await act(rejectReturnHandler, v.user.token, voId, { reason: "item shows wear" });
    expect(rej.data.status).toBe("delivered");
    expect((await c.vendorOrders.findOne({ _id: o.vos[0]!._id }))!.deliveredAt!.getTime()).toBe(fresh.getTime());
  });

  it("a COD return gives the seller their commission back", async () => {
    const o = await placeShopOrder(shop, { method: "cod" });
    const v = o.vendors[0]!;
    const voId = o.vos[0]!._id.toHexString();
    await fulfil(v, voId);
    await act(requestReturnHandler, o.buyer.token, voId, { reason: "changed mind" });
    await act(approveReturnHandler, v.user.token, voId);
    const c = await getCollections();
    const sum = (await c.ledgerEntries.find({ vendorId: v.vendorId }).toArray()).reduce((s, e) => s + e.amountMinor, 0);
    expect(sum).toBe(0);
    expect(await c.refunds.countDocuments({ vendorOrderId: o.vos[0]!._id })).toBe(0); // cash refunds are manual
  });
});

describe("reviews", () => {
  it("only verified buyers can review, once per product; ratings are summarised; admins can hide", async () => {
    const o = await placeShopOrder(shop, { method: "cod" });
    const slug = o.products[0]!.slug;
    const review = (token: string, body: object) => call(createReviewHandler, { method: "POST", token, params: { slug }, body });
    const good = { rating: 5, body: "Great quality, arrived quickly." };
    expect((await review(o.buyer.token, good)).error?.details[0]?.code).toBe("NOT_VERIFIED_PURCHASE"); // not delivered yet
    await fulfil(o.vendors[0]!, o.vos[0]!._id.toHexString());
    expect((await review((await makeCustomer()).token, good)).status).toBe(403);
    expect((await review(o.buyer.token, { rating: 6, body: "Great quality, arrived." })).status).toBe(400);
    expect((await review(o.buyer.token, { rating: 4, body: "short" })).status).toBe(400);
    expect((await review(o.buyer.token, { ...good, userId: "x", status: "published" })).status).toBe(400);
    const created = await review(o.buyer.token, good);
    expect(created.status).toBe(201);
    expect((await review(o.buyer.token, good)).error?.code).toBe("CONFLICT");

    const list = await call(listReviewsHandler, { params: { slug } });
    expect(list.data).toHaveLength(1);
    expect(list.data[0].author).toMatch(/^Test$|^Test c\.$|^Test customer$|^Test/); // never the full account name/email
    expect(JSON.stringify(list.data)).not.toMatch(/@/);
    expect(list.json.meta?.summary).toMatchObject({ count: 1, average: 5 });
    expect((await call(hideReviewHandler, { method: "POST", token: o.buyer.token, params: { id: created.data.id }, body: { reason: "nope nope" } })).status).toBe(403);
    expect((await call(hideReviewHandler, { method: "POST", token: shop.admin.token, params: { id: created.data.id }, body: { reason: "abusive text" } })).data.id).toBe(created.data.id);
    const after = await call(listReviewsHandler, { params: { slug } });
    expect(after.data).toEqual([]);
    expect(after.json.meta?.summary.count).toBe(0);
  });
});

describe("balances and payouts", () => {
  async function settledVendor(price = 400000) {
    const o = await placeShopOrder(shop, { prices: [price], method: "online", pay: true });
    const v = o.vendors[0]!;
    await fulfil(v, o.vos[0]!._id.toHexString());
    const c = await getCollections();
    return { o, v, c };
  }
  const dest = { payoutDestination: { method: "bkash", accountName: "Shop Owner", accountRef: "01712345678" } };

  it("sale earnings stay pending through the hold period, then become available", async () => {
    const { v, c } = await settledVendor();
    const entries = await c.ledgerEntries.find({ vendorId: v.vendorId }).toArray();
    expect(entries.every((e) => e.availableAt && e.availableAt.getTime() > Date.now() + 6 * 86_400_000)).toBe(true);
    expect(await getBalance(v.vendorId)).toMatchObject({ availableMinor: 0, pendingMinor: 360000 });
    expect((await call(vendorBalanceHandler, { token: v.user.token })).data.pendingMinor).toBe(360000);
    await c.ledgerEntries.updateMany({ vendorId: v.vendorId }, { $set: { availableAt: new Date(Date.now() - 1000) } });
    expect(await getBalance(v.vendorId)).toMatchObject({ availableMinor: 360000, pendingMinor: 0 });
    expect((await call(vendorLedgerHandler, { token: v.user.token })).data).toHaveLength(2);
  });

  it("validates payout requests: destination, minimum, balance, and concurrent requests cannot overdraw", async () => {
    const { v, c } = await settledVendor();
    await c.ledgerEntries.updateMany({ vendorId: v.vendorId }, { $set: { availableAt: new Date(Date.now() - 1000) } });
    const req = (amountMinor: number, token = v.user.token) => call(requestPayoutHandler, { method: "POST", token, body: { amountMinor } });
    expect((await req(100000)).error?.details[0]?.code).toBe("REQUIRED"); // no destination yet
    expect((await call(patchProfileHandler, { method: "PATCH", token: v.user.token, body: dest })).data.payoutDestination.accountRef).toBe("*******5678");
    expect((await call(patchProfileHandler, { method: "PATCH", token: v.user.token, body: { payoutDestination: { method: "crypto", accountName: "x y", accountRef: "123456" } } })).status).toBe(400);
    expect((await req(100)).error?.details[0]?.code).toBe("BELOW_MINIMUM");
    expect((await req(360001)).error?.details[0]?.code).toBe("EXCEEDS_AVAILABLE");
    expect((await req(100000, (await makeCustomer()).token)).status).toBe(403);
    const rs = await Promise.all([req(360000), req(360000), req(360000)]);
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await getBalance(v.vendorId)).toMatchObject({ availableMinor: 0 });
    expect(await c.payouts.countDocuments({ vendorId: v.vendorId })).toBe(1);
  });

  it("walks approve -> paid with maker-checker, masks account refs from vendors, and restores funds on reject/cancel/fail", async () => {
    const { v, c } = await settledVendor(2_000_000); // net 1,800,000: above the payout maker-checker threshold
    await c.ledgerEntries.updateMany({ vendorId: v.vendorId }, { $set: { availableAt: new Date(Date.now() - 1000) } });
    await call(patchProfileHandler, { method: "PATCH", token: v.user.token, body: dest });
    const req = (amountMinor: number) => call(requestPayoutHandler, { method: "POST", token: v.user.token, body: { amountMinor } });
    const a1 = await makeAdmin(["payout.approve"]);
    const a2 = await makeAdmin(["payout.approve"]);

    const p1 = await req(1_500_000);
    expect(p1.data.destination.accountRef).toBe("01712345678"); // the requester sees their own request
    expect((await call(vendorPayoutsHandler, { token: v.user.token })).data[0].destination.accountRef).toBe("*******5678");
    expect((await call(adminPayoutsHandler, { token: a1.token })).data[0].destination.accountRef).toBe("01712345678");
    expect((await call(adminPayoutsHandler, { token: v.user.token })).status).toBe(403);
    expect((await call(approvePayoutHandler, { method: "POST", token: v.user.token, params: { id: p1.data.id } })).status).toBe(403);
    expect((await call(markPaidHandler, { method: "POST", token: a1.token, params: { id: p1.data.id }, body: { providerRef: "TXN-1" } })).error?.code).toBe("INVALID_STATE_TRANSITION"); // must be approved first
    expect((await call(approvePayoutHandler, { method: "POST", token: a1.token, params: { id: p1.data.id } })).data.status).toBe("approved");
    const self = await call(markPaidHandler, { method: "POST", token: a1.token, params: { id: p1.data.id }, body: { providerRef: "TXN-1" } });
    expect(self.error?.details[0]?.code).toBe("MAKER_CHECKER");
    expect((await call(markPaidHandler, { method: "POST", token: a2.token, params: { id: p1.data.id }, body: { providerRef: "TXN-1" } })).data).toMatchObject({ status: "paid", providerRef: "TXN-1" });
    expect(await getBalance(v.vendorId)).toMatchObject({ availableMinor: 1_800_000 - 1_500_000 });

    // reject / cancel / fail all give the money back exactly once
    const p2 = await req(100000);
    await call(rejectPayoutHandler, { method: "POST", token: a1.token, params: { id: p2.data.id }, body: { reason: "details mismatch" } });
    const p3 = await req(100000);
    expect((await call(cancelPayoutHandler, { method: "POST", token: v.user.token, params: { id: p3.data.id } })).data.status).toBe("cancelled");
    const p4 = await req(100000);
    await call(approvePayoutHandler, { method: "POST", token: a1.token, params: { id: p4.data.id } });
    await call(markFailedHandler, { method: "POST", token: a2.token, params: { id: p4.data.id }, body: { reason: "bank rejected transfer" } });
    expect(await getBalance(v.vendorId)).toMatchObject({ availableMinor: 300000 });
    expect((await call(rejectPayoutHandler, { method: "POST", token: a1.token, params: { id: p2.data.id }, body: { reason: "again again" } })).status).toBe(409); // terminal
    expect(await c.ledgerEntries.countDocuments({ vendorId: v.vendorId, type: "reversal" })).toBe(3);
    // another vendor cannot cancel it
    const other = await settledVendor();
    expect((await call(cancelPayoutHandler, { method: "POST", token: other.v.user.token, params: { id: p1.data.id } })).status).toBe(404);
  });

  it("requires a verified email to request a payout", async () => {
    const { v, c } = await settledVendor();
    await c.ledgerEntries.updateMany({ vendorId: v.vendorId }, { $set: { availableAt: new Date(Date.now() - 1000) } });
    await call(patchProfileHandler, { method: "PATCH", token: v.user.token, body: dest });
    await c.users.updateOne({ _id: v.user.id }, { $unset: { emailVerifiedAt: "" } });
    const r = await call(requestPayoutHandler, { method: "POST", token: v.user.token, body: { amountMinor: 100000 } });
    expect(r.error?.details[0]?.code).toBe("UNVERIFIED");
  });
});

describe("admin support and reports", () => {
  it("looks orders up by number, buyer email and status with a full money breakdown; permission-gated", async () => {
    const o = await placeShopOrder(shop, { prices: [100000, 50000], method: "online", pay: true });
    const support = await makeAdmin(["order.read_all"]);
    const byNumber = await call(adminOrdersHandler, { token: support.token, query: { orderNumber: o.order.orderNumber.toLowerCase() } });
    expect(byNumber.data).toHaveLength(1);
    const byEmail = await call(adminOrdersHandler, { token: support.token, query: { buyerEmail: o.buyer.email.toUpperCase(), status: "confirmed" } });
    expect(byEmail.data.map((x: { id: string }) => x.id)).toEqual([o.orderId]);
    expect((await call(adminOrdersHandler, { token: support.token, query: { buyerEmail: "ghost@example.com" } })).data).toEqual([]);
    const full = await call(adminOrderHandler, { token: support.token, params: { id: o.orderId } });
    expect(full.data.buyer.email).toBe(o.buyer.email);
    expect(full.data.vendorOrders).toHaveLength(2);
    expect(full.data.vendorOrders[0].commission).toBeTruthy();
    expect(full.data.payments[0]).toMatchObject({ status: "succeeded", merchantReference: o.ref });
    for (const t of [o.buyer.token, o.vendors[0]!.user.token, (await makeAdmin(["audit.read"])).token]) {
      expect((await call(adminOrdersHandler, { token: t })).status).toBe(403);
      expect((await call(adminOrderHandler, { token: t, params: { id: o.orderId } })).status).toBe(403);
    }
  });

  it("produces a bounded sales summary", async () => {
    await placeShopOrder(shop, { prices: [100000], method: "online", pay: true });
    const reporter = await makeAdmin(["report.read"]);
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 86_400_000).toISOString();
    const r = await call(salesReportHandler, { token: reporter.token, query: { from, to } });
    expect(r.status).toBe(200);
    expect(r.data.paidOrders).toBeGreaterThanOrEqual(1);
    expect(r.data.platformCommissionMinor).toBeGreaterThan(0);
    const tooWide = await call(salesReportHandler, { token: reporter.token, query: { from: new Date(Date.now() - 200 * 86_400_000).toISOString(), to } });
    expect(tooWide.status).toBe(400);
    expect((await call(salesReportHandler, { token: reporter.token, query: { from: "yesterday", to } })).status).toBe(400);
    expect((await call(salesReportHandler, { token: (await makeUser({ role: "customer" })).token, query: { from, to } })).status).toBe(403);
  });
});

describe("courier dispatch and tracking", () => {
  it("dispatches vendor order via REDX sandbox and looks up public tracking timeline", async () => {
    const o = await placeShopOrder(shop, { prices: [45000, 55000], method: "online", pay: true });
    const [vendorA, vendorB] = o.vendors;
    const voId = o.vos[0]!._id.toHexString();

    // Wrong vendor (404) and customer (403) rejected
    expect((await call(dispatchOrderHandler, { method: "POST", token: vendorB!.user.token, params: { id: voId }, body: { carrier: "redx" } })).status).toBe(404);
    expect((await call(dispatchOrderHandler, { method: "POST", token: o.buyer.token, params: { id: voId }, body: { carrier: "redx" } })).status).toBe(403);

    // Vendor dispatches order with REDX
    const res = await call(dispatchOrderHandler, {
      method: "POST",
      token: vendorA!.user.token,
      params: { id: voId },
      body: { carrier: "redx", weightGrams: 750 },
    });

    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      status: "shipped",
      shipment: {
        carrier: "REDX",
        trackingNumber: expect.stringMatching(/^RDX-SB-/),
      },
    });

    const trackingNumber = res.data.shipment.trackingNumber;

    // Public tracking endpoint works without auth
    const trackingRes = await call(trackShipmentHandler, {
      params: { carrier: "redx", trackingNumber },
    });

    expect(trackingRes.status).toBe(200);
    expect(trackingRes.data).toMatchObject({
      carrier: "REDX",
      trackingId: trackingNumber,
      status: "in-transit",
      events: expect.arrayContaining([
        expect.objectContaining({ messageEn: expect.any(String), time: expect.any(String) }),
      ]),
    });
  });
});
