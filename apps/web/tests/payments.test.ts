import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { setupTestDb, teardownTestDb } from "./helpers/db";
import { call } from "./helpers/http";
import { makeAdmin, makeCategory, makeCustomer, makeProduct, makeVendor, uniq, useFakeMedia } from "./helpers/factory";
import {
  addCartItemHandler, cancelOrderHandler, checkoutHandler, createAddressHandler,
} from "@/server/api/handlers/shopping";
import {
  adminApproveRefundHandler, adminListRefundsHandler, adminReconcileHandler, adminRejectRefundHandler, adminRequestRefundHandler, adminRetryRefundHandler,
  getPaymentHandler, paymentReturnHandler, paymentWebhookHandler, reconciliationQueueHandler, refreshPaymentHandler, startPaymentHandler,
  vendorBalanceHandler, vendorLedgerHandler,
} from "@/server/api/handlers/payments";
import { getCollections } from "@/server/db/collections";
import { mockGateway } from "@/server/modules/payments/mock";
import { reconcileStuckPayments } from "@/server/modules/payments/service";
import { retryProcessingRefunds } from "@/server/modules/payments/refunds";
import { expireUnpaidOrders } from "@/server/modules/orders/service";
import { processOutbox } from "@/server/modules/outbox/outbox";
import { outboxHandlers } from "@/server/modules/outbox/handlers";
import { getBalance } from "@/server/modules/ledger/service";
import { SslCommerzAdapter } from "@/server/modules/payments/sslcommerz";
import { ProviderError } from "@/server/modules/payments/types";
import { money } from "@/server/shared/money";

let admin: Awaited<ReturnType<typeof makeAdmin>>;
let cat: { id: string };
let idem = 0;
const key = () => `pay-key-${Date.now()}-${++idem}-abcdef`;

beforeAll(async () => {
  await setupTestDb();
  useFakeMedia();
  admin = await makeAdmin();
  cat = await makeCategory(admin, "Pay " + uniq());
});
afterAll(teardownTestDb);
beforeEach(() => mockGateway.reset());

async function drainOutbox() {
  while ((await processOutbox(outboxHandlers)) > 0);
}

interface Setup {
  buyer: Awaited<ReturnType<typeof makeCustomer>> & { addressId: string };
  orderId: string;
  order: { id: string; orderNumber: string; totals: { totalMinor: number }; vendorOrders: { id: string }[]; status: string };
  payment: { id: string; status: string; redirectUrl?: string; canRetry: boolean; message?: string };
  ref: string;
  vendors: Awaited<ReturnType<typeof makeVendor>>[];
  products: { id: string; variantId: string }[];
}

/** One online order spanning `prices.length` vendors (one item each). */
async function onlineOrder(prices: number[] = [100000], opts: { stock?: number } = {}): Promise<Setup> {
  const buyer0 = await makeCustomer();
  const a = await call(createAddressHandler, { method: "POST", token: buyer0.token, body: { label: "Home", recipient: "Rahim", phone: "+8801712345678", line1: "House 5", city: "Dhaka", district: "Dhaka", postalCode: "1212" } });
  const buyer = { ...buyer0, addressId: a.data.id as string };
  const vendors: Setup["vendors"] = [];
  const products: Setup["products"] = [];
  for (const price of prices) {
    const v = await makeVendor();
    const p = await makeProduct(v, { categoryId: cat.id, priceMinor: price, stock: opts.stock ?? 10, publish: true, admin });
    await call(addCartItemHandler, { method: "POST", token: buyer.token, body: { productId: p.id, variantId: p.variants[0].variantId, quantity: 1 } });
    vendors.push(v);
    products.push({ id: p.id, variantId: p.variants[0].variantId });
  }
  const total = prices.reduce((x, y) => x + y, 0);
  const r = await call(checkoutHandler, { method: "POST", token: buyer.token, headers: { "idempotency-key": key() }, body: { addressId: buyer.addressId, paymentMethod: "online", expectedTotalMinor: total } });
  if (r.status !== 201) throw new Error("checkout failed " + JSON.stringify(r.json));
  const c = await getCollections();
  const pay = await c.payments.findOne({ orderId: new ObjectId(r.data.id) });
  return { buyer, orderId: r.data.id, order: r.data, payment: r.data.payment, ref: pay!.merchantReference, vendors, products };
}

const webhook = (signed: { body: string; headers: Record<string, string> }, provider = "mock") =>
  call(paymentWebhookHandler, { method: "POST", rawBody: signed.body, headers: signed.headers, params: { provider } });
const succeed = (ref: string, opts: Parameters<typeof mockGateway.signedEvent>[2] = {}) => webhook(mockGateway.signedEvent(ref, "succeeded", opts));
const orderOf = async (id: string) => (await getCollections()).orders.findOne({ _id: new ObjectId(id) });

describe("payment initiation", () => {
  it("persists the attempt before calling the provider and returns a hosted-checkout redirect", async () => {
    const s = await onlineOrder();
    expect(s.order.status).toBe("pending_payment");
    expect(s.payment).toMatchObject({ status: "requires_action", canRetry: false });
    expect(s.payment.redirectUrl).toContain("/mock-pay/");
    const c = await getCollections();
    const doc = await c.payments.findOne({ merchantReference: s.ref });
    expect(doc).toMatchObject({ provider: "mock", mode: "sandbox", amountMinor: 100000, currency: "BDT", status: "requires_action", refundedMinor: 0 });
    expect(s.ref).toBe(`${s.order.orderNumber}-1`);
    // starting again reuses the open session instead of creating a second attempt
    const again = await call(startPaymentHandler, { method: "POST", token: s.buyer.token, params: { id: s.orderId } });
    expect(again.data.id).toBe(s.payment.id);
    expect(await c.payments.countDocuments({ orderId: new ObjectId(s.orderId) })).toBe(1);
  });

  it("refuses online payment outside the provider's amount range before creating an order", async () => {
    const buyer0 = await makeCustomer();
    const a = await call(createAddressHandler, { method: "POST", token: buyer0.token, body: { label: "H", recipient: "R R", phone: "+8801712345678", line1: "House 5", city: "Dhaka", district: "Dhaka", postalCode: "1212" } });
    const v = await makeVendor();
    const p = await makeProduct(v, { categoryId: cat.id, priceMinor: 500, stock: 3, publish: true, admin }); // 5.00 BDT < 10.00 minimum
    await call(addCartItemHandler, { method: "POST", token: buyer0.token, body: { productId: p.id, variantId: p.variants[0].variantId, quantity: 1 } });
    const r = await call(checkoutHandler, { method: "POST", token: buyer0.token, headers: { "idempotency-key": key() }, body: { addressId: a.data.id, paymentMethod: "online", expectedTotalMinor: 500 } });
    expect(r.error?.details[0]?.code).toBe("AMOUNT_OUT_OF_RANGE");
    expect(await (await getCollections()).orders.countDocuments({ buyerId: buyer0.id })).toBe(0);
  });

  it("marks the attempt failed when the provider is unavailable and allows a clean retry", async () => {
    mockGateway.nextCreate = "unavailable";
    const s = await onlineOrder();
    expect(s.payment).toMatchObject({ status: "failed", canRetry: true });
    expect((await orderOf(s.orderId))!.paymentStatus).toBe("failed");
    const retry = await call(startPaymentHandler, { method: "POST", token: s.buyer.token, params: { id: s.orderId } });
    expect(retry.status).toBe(201);
    expect(retry.data.status).toBe("requires_action");
    const c = await getCollections();
    const refs = (await c.payments.find({ orderId: new ObjectId(s.orderId) }).sort({ createdAt: 1 }).toArray()).map((p) => p.merchantReference);
    expect(refs).toEqual([`${s.order.orderNumber}-1`, `${s.order.orderNumber}-2`]);
    expect((await orderOf(s.orderId))!.paymentStatus).toBe("pending");
  });

  it("treats a provider timeout as UNKNOWN: no second charge, then resolves by verification", async () => {
    mockGateway.nextCreate = "timeout";
    const s = await onlineOrder();
    expect(s.order.status).toBe("pending_payment");
    expect(s.payment.status).toBe("unknown");
    expect(s.payment.message).toMatch(/do not pay again/i);
    expect(s.payment.canRetry).toBe(false);
    // The provider did create the session; a blind retry would double charge. It must be refused.
    const blocked = await call(startPaymentHandler, { method: "POST", token: s.buyer.token, params: { id: s.orderId } });
    expect(blocked.status).toBe(409);
    expect(blocked.error?.details[0]?.code).toBe("VERIFICATION_PENDING");
    const c = await getCollections();
    expect(await c.payments.countDocuments({ orderId: new ObjectId(s.orderId) })).toBe(1);
    // customer pays on the hosted page; polling (server-side lookup) confirms it
    mockGateway.settle(s.ref, "succeeded");
    const polled = await call(refreshPaymentHandler, { method: "POST", token: s.buyer.token, params: { id: s.orderId } });
    expect(polled.data.status).toBe("succeeded");
    expect((await orderOf(s.orderId))!.status).toBe("confirmed");
  });

  it("only the buyer can start, view or refresh a payment", async () => {
    const s = await onlineOrder();
    const other = await makeCustomer();
    for (const [h, m] of [[startPaymentHandler, "POST"], [getPaymentHandler, "GET"], [refreshPaymentHandler, "POST"]] as const) {
      expect((await call(h, { method: m, token: other.token, params: { id: s.orderId } })).status).toBe(404);
      expect((await call(h, { method: m, params: { id: s.orderId } })).status).toBe(401);
    }
    expect((await call(getPaymentHandler, { token: s.buyer.token, params: { id: s.orderId } })).data.id).toBe(s.payment.id);
  });
});

describe("verified webhooks", () => {
  it("confirms the order, commits stock, posts ledger entries and notifies — all from one verified event", async () => {
    const s = await onlineOrder([100000, 50000]);
    const r = await succeed(s.ref);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ received: true }); // the provider's own acknowledgement, not our data/meta envelope
    const c = await getCollections();
    const order = await orderOf(s.orderId);
    expect(order).toMatchObject({ status: "confirmed", paymentStatus: "paid" });
    const vos = await c.vendorOrders.find({ parentOrderId: order!._id }).toArray();
    expect(vos.every((v) => v.fulfillmentStatus === "new")).toBe(true);
    expect(vos.every((v) => v.timeline.some((t) => t.note === "payment confirmed"))).toBe(true);
    for (const p of s.products) expect(await c.inventoryItems.findOne({ productId: new ObjectId(p.id) })).toMatchObject({ onHand: 9, reserved: 0 });
    expect(await c.payments.findOne({ merchantReference: s.ref })).toMatchObject({ status: "succeeded", providerTransactionId: `mock_tx_${s.ref}` });
    // ledger: gross and commission per vendor, derived from the frozen snapshot
    for (const [i, v] of s.vendors.entries()) {
      const entries = await c.ledgerEntries.find({ vendorId: v.vendorId }).toArray();
      const gross = [100000, 50000][i]!;
      expect(entries.find((e) => e.type === "sale_gross")!.amountMinor).toBe(gross);
      expect(entries.find((e) => e.type === "platform_commission")!.amountMinor).toBe(-Math.round(gross * 0.1));
      expect(entries.every((e) => e.availableAt === undefined)).toBe(true); // held until delivery
      const bal = await getBalance(v.vendorId);
      expect(bal).toMatchObject({ availableMinor: 0, pendingMinor: gross - Math.round(gross * 0.1), lifetimeSalesMinor: gross });
    }
    await drainOutbox();
    expect(await c.notifications.countDocuments({ userId: s.buyer.id, eventType: "order.confirmed" })).toBe(1);
    expect(await c.notifications.countDocuments({ eventType: "vendor_order.new", userId: { $in: s.vendors.map((v) => v.user.id) } })).toBe(2);
  });

  it("is idempotent: the same event delivered repeatedly changes nothing after the first", async () => {
    const s = await onlineOrder();
    const signed = mockGateway.signedEvent(s.ref, "succeeded", { eventId: "evt-dup-1" });
    expect((await webhook(signed)).status).toBe(200);
    expect((await webhook(signed)).status).toBe(200);
    expect((await webhook(signed)).status).toBe(200);
    const c = await getCollections();
    expect(await c.ledgerEntries.countDocuments({ vendorId: s.vendors[0]!.vendorId })).toBe(2);
    expect(await c.paymentEvents.countDocuments({ providerEventId: "evt-dup-1" })).toBe(1);
    expect(await c.inventoryItems.findOne({ productId: new ObjectId(s.products[0]!.id) })).toMatchObject({ onHand: 9, reserved: 0 });
    await drainOutbox();
    expect(await c.notifications.countDocuments({ userId: s.buyer.id, eventType: "order.confirmed" })).toBe(1);
  });

  it("five concurrent deliveries of the same event produce exactly one effect", async () => {
    const s = await onlineOrder();
    const signed = mockGateway.signedEvent(s.ref, "succeeded", { eventId: "evt-race-1" });
    const rs = await Promise.all(Array.from({ length: 5 }, () => webhook(signed)));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    const c = await getCollections();
    expect(await c.ledgerEntries.countDocuments({ vendorId: s.vendors[0]!.vendorId })).toBe(2);
    expect(await c.inventoryItems.findOne({ productId: new ObjectId(s.products[0]!.id) })).toMatchObject({ onHand: 9, reserved: 0 });
  });

  it("a different event id for the same success (provider re-send) is also harmless", async () => {
    const s = await onlineOrder();
    await succeed(s.ref, { eventId: "evt-a" });
    await succeed(s.ref, { eventId: "evt-b" });
    const c = await getCollections();
    expect(await c.ledgerEntries.countDocuments({ vendorId: s.vendors[0]!.vendorId })).toBe(2);
    expect(await c.paymentEvents.findOne({ providerEventId: "evt-b" })).toMatchObject({ outcome: "ignored_stale" });
  });

  it("ignores out-of-order events: a late 'pending' or 'failed' never downgrades a succeeded payment", async () => {
    const s = await onlineOrder();
    await succeed(s.ref);
    expect((await webhook(mockGateway.signedEvent(s.ref, "pending"))).status).toBe(200);
    expect((await webhook(mockGateway.signedEvent(s.ref, "failed"))).status).toBe(200);
    expect((await webhook(mockGateway.signedEvent(s.ref, "cancelled"))).status).toBe(200);
    const c = await getCollections();
    expect(await c.payments.findOne({ merchantReference: s.ref })).toMatchObject({ status: "succeeded" });
    expect(await orderOf(s.orderId)).toMatchObject({ status: "confirmed", paymentStatus: "paid" });
  });

  it("webhook before the customer returns (and a return URL without a webhook) are both handled correctly", async () => {
    const s = await onlineOrder();
    // Browser returns first: forwarding only, no state change, no proof of payment.
    const ret = await call(paymentReturnHandler, { params: { provider: "mock" }, query: { order: s.orderId, result: "success" } });
    expect(ret.status).toBe(303);
    expect(ret.headers.get("location")).toContain(`/orders/${s.orderId}?payment=returned`);
    expect(await orderOf(s.orderId)).toMatchObject({ status: "pending_payment", paymentStatus: "pending" });
    expect((await call(paymentReturnHandler, { params: { provider: "mock" }, query: { order: "bad" } })).status).toBe(400);
    await succeed(s.ref);
    expect((await orderOf(s.orderId))!.status).toBe("confirmed");
  });

  it("rejects forged, tampered, replayed and malformed webhooks without touching state", async () => {
    const s = await onlineOrder();
    const good = mockGateway.signedEvent(s.ref, "succeeded");
    const expectRejected = async (r: ReturnType<typeof webhook>) => {
      const res = await r;
      expect(res.status).toBe(400);
      expect(res.error?.code).toBe("PAYMENT_VERIFICATION_FAILED");
    };
    await expectRejected(webhook(mockGateway.signedEvent(s.ref, "succeeded", { secret: "x".repeat(40) }))); // wrong key
    await expectRejected(webhook({ body: good.body.replace("succeeded", "failed"), headers: good.headers })); // body tampered after signing
    await expectRejected(webhook({ body: good.body, headers: { ...good.headers, "x-mock-signature": "" } }));
    await expectRejected(webhook({ body: good.body, headers: { "content-type": "application/json" } })); // unsigned
    await expectRejected(webhook(mockGateway.signedEvent(s.ref, "succeeded", { timestamp: Date.now() - 10 * 60_000 }))); // outside replay window
    await expectRejected(webhook({ body: "not json", headers: { "x-mock-signature": "abc" } }));
    expect((await webhook(good, "sslcommerz")).status).toBe(404); // only the configured provider is addressable
    expect((await call(paymentWebhookHandler, { method: "POST", rawBody: "x".repeat(40_000), headers: good.headers, params: { provider: "mock" } })).status).toBe(413);
    expect(await orderOf(s.orderId)).toMatchObject({ status: "pending_payment" });
    expect((await (await getCollections()).payments.findOne({ merchantReference: s.ref }))!.status).toBe("requires_action");
  });

  it("acknowledges events for unknown references without creating anything", async () => {
    const r = await webhook(mockGateway.signedEvent("BF-NOSUCH-1", "succeeded", { amountMinor: 1000 }));
    expect(r.status).toBe(200);
  });

  it("parks amount or currency mismatches for a human instead of confirming the order", async () => {
    for (const bad of [{ amountMinor: 100 }, { currency: "USD" }]) {
      const s = await onlineOrder();
      const r = await succeed(s.ref, bad);
      // currency mismatch is refused by signature/format validation (400); amount mismatch is accepted-and-parked (200)
      expect([200, 400]).toContain(r.status);
      const order = await orderOf(s.orderId);
      expect(order).toMatchObject({ status: "pending_payment" });
      const c = await getCollections();
      expect(await c.ledgerEntries.countDocuments({ orderId: order!._id })).toBe(0);
      if (r.status === 200) {
        expect(await c.payments.findOne({ merchantReference: s.ref })).toMatchObject({ status: "unknown", failureReason: "amount_mismatch" });
        const audit = await c.auditLogs.findOne({ action: "payment.amount_mismatch", resourceId: s.payment.id });
        expect(audit).toBeTruthy();
        const queue = await call(reconciliationQueueHandler, { token: admin.token, query: { limit: 50 } });
        expect(queue.data.map((x: { id: string }) => x.id)).toContain(s.payment.id);
      }
    }
  });

  it("a failed payment keeps the order open and a retry can still succeed", async () => {
    const s = await onlineOrder();
    await webhook(mockGateway.signedEvent(s.ref, "failed"));
    expect(await orderOf(s.orderId)).toMatchObject({ status: "pending_payment", paymentStatus: "failed" });
    const view = await call(getPaymentHandler, { token: s.buyer.token, params: { id: s.orderId } });
    expect(view.data).toMatchObject({ status: "failed", canRetry: true });
    const retry = await call(startPaymentHandler, { method: "POST", token: s.buyer.token, params: { id: s.orderId } });
    expect(retry.data.status).toBe("requires_action");
    const c = await getCollections();
    const second = (await c.payments.findOne({ _id: new ObjectId(retry.data.id) }))!;
    await succeed(second.merchantReference);
    expect(await orderOf(s.orderId)).toMatchObject({ status: "confirmed", paymentStatus: "paid" });
    await drainOutbox();
    expect(await c.notifications.countDocuments({ userId: s.buyer.id, eventType: "payment.failed" })).toBe(1);
  });
});

describe("late and duplicate payments", () => {
  it("auto-refunds money that arrives after the order expired, with no ledger impact and the stock released", async () => {
    const s = await onlineOrder();
    expect(await expireUnpaidOrders(new Date(Date.now() + 31 * 60_000))).toBeGreaterThanOrEqual(1);
    expect(await orderOf(s.orderId)).toMatchObject({ status: "cancelled", cancellationReason: "payment_expired" });
    await succeed(s.ref);
    const c = await getCollections();
    expect(await orderOf(s.orderId)).toMatchObject({ status: "cancelled", paymentStatus: "refunded" });
    const pay = await c.payments.findOne({ merchantReference: s.ref });
    expect(pay).toMatchObject({ status: "refunded", refundedMinor: 100000 });
    const refund = await c.refunds.findOne({ paymentId: pay!._id });
    expect(refund).toMatchObject({ status: "succeeded", system: true, postLedger: false, amountMinor: 100000 });
    expect(await c.ledgerEntries.countDocuments({ orderId: new ObjectId(s.orderId) })).toBe(0);
    expect(await c.inventoryItems.findOne({ productId: new ObjectId(s.products[0]!.id) })).toMatchObject({ onHand: 10, reserved: 0 });
    expect(mockGateway.refunds.size).toBe(1);
  });

  it("refunds a second successful attempt on an already-paid order (customer paid twice)", async () => {
    const s = await onlineOrder();
    await webhook(mockGateway.signedEvent(s.ref, "failed")); // first session abandoned...
    const retry = await call(startPaymentHandler, { method: "POST", token: s.buyer.token, params: { id: s.orderId } });
    const c = await getCollections();
    const second = (await c.payments.findOne({ _id: new ObjectId(retry.data.id) }))!;
    await succeed(second.merchantReference);
    await succeed(s.ref, { eventId: "late-first-session-success" }); // ...but the customer completed it anyway
    expect(await orderOf(s.orderId)).toMatchObject({ status: "confirmed", paymentStatus: expect.stringMatching(/paid|partially_refunded|refunded/) });
    const first = await c.payments.findOne({ merchantReference: s.ref });
    expect(first).toMatchObject({ status: "refunded" });
    expect(await c.payments.findOne({ _id: second._id })).toMatchObject({ status: "succeeded", refundedMinor: 0 });
    expect(await c.ledgerEntries.countDocuments({ vendorId: s.vendors[0]!.vendorId, type: "sale_gross" })).toBe(1);
    expect(await c.inventoryItems.findOne({ productId: new ObjectId(s.products[0]!.id) })).toMatchObject({ onHand: 9, reserved: 0 });
  });

  it("success racing the expiry job ends consistent: confirmed OR cancelled+refunded, never both, stock never leaks", async () => {
    for (let i = 0; i < 4; i++) {
      const s = await onlineOrder();
      const later = new Date(Date.now() + 31 * 60_000);
      await Promise.allSettled([succeed(s.ref), expireUnpaidOrders(later)]);
      await succeed(s.ref, { eventId: `retry-${i}` }); // provider redelivers if the first attempt failed
      const c = await getCollections();
      const order = (await orderOf(s.orderId))!;
      const item = (await c.inventoryItems.findOne({ productId: new ObjectId(s.products[0]!.id) }))!;
      expect(item.reserved).toBe(0);
      const pay = (await c.payments.findOne({ merchantReference: s.ref }))!;
      if (order.status === "confirmed") {
        expect(item.onHand).toBe(9);
        expect(pay.status).toBe("succeeded");
      } else {
        expect(order.status).toBe("cancelled");
        expect(item.onHand).toBe(10);
        expect(pay.status).toBe("refunded");
      }
    }
  });
});

describe("polling and reconciliation", () => {
  it("'check status' asks the provider server-side; repeated checks and provider outages are safe", async () => {
    const s = await onlineOrder();
    const first = await call(refreshPaymentHandler, { method: "POST", token: s.buyer.token, params: { id: s.orderId } });
    expect(first.data.status).toBe("pending"); // provider says the hosted page is still open
    mockGateway.nextStatusLookup = "unavailable";
    expect((await call(refreshPaymentHandler, { method: "POST", token: s.buyer.token, params: { id: s.orderId } })).data.status).toBe("pending");
    mockGateway.settle(s.ref, "succeeded");
    const done = await call(refreshPaymentHandler, { method: "POST", token: s.buyer.token, params: { id: s.orderId } });
    expect(done.data.status).toBe("succeeded");
    await call(refreshPaymentHandler, { method: "POST", token: s.buyer.token, params: { id: s.orderId } });
    const c = await getCollections();
    expect(await c.ledgerEntries.countDocuments({ vendorId: s.vendors[0]!.vendorId })).toBe(2);
  });

  it("the scheduled reconciler resolves stuck attempts; admins can reconcile on demand", async () => {
    const s = await onlineOrder();
    const s2 = await onlineOrder();
    mockGateway.settle(s.ref, "succeeded");
    const c = await getCollections();
    await c.payments.updateMany({ merchantReference: { $in: [s.ref, s2.ref] } }, { $set: { updatedAt: new Date(Date.now() - 60 * 60_000) } });
    const queue = await call(reconciliationQueueHandler, { token: admin.token, query: { limit: 50 } });
    expect(queue.data.map((x: { id: string }) => x.id)).toEqual(expect.arrayContaining([s.payment.id, s2.payment.id]));
    expect(await reconcileStuckPayments()).toBeGreaterThanOrEqual(1);
    expect(await orderOf(s.orderId)).toMatchObject({ status: "confirmed" });
    expect(await orderOf(s2.orderId)).toMatchObject({ status: "pending_payment" });
    mockGateway.settle(s2.ref, "failed");
    const adminRun = await call(adminReconcileHandler, { method: "POST", token: admin.token, params: { id: s2.payment.id } });
    expect(adminRun.data.status).toBe("failed");
    const support = await makeAdmin(["order.read_all"]);
    expect((await call(adminReconcileHandler, { method: "POST", token: support.token, params: { id: s2.payment.id } })).status).toBe(403);
    expect((await call(reconciliationQueueHandler, { token: support.token })).status).toBe(403);
    expect((await call(reconciliationQueueHandler, { token: (await makeCustomer()).token })).status).toBe(403);
  });
});

describe("refunds", () => {
  it("customer cancels a paid order before fulfilment: full refund, stock back, ledger nets to zero", async () => {
    const s = await onlineOrder([100000, 50000]);
    await succeed(s.ref);
    const cancelled = await call(cancelOrderHandler, { method: "POST", token: s.buyer.token, params: { id: s.orderId }, body: { reason: "changed my mind" } });
    expect(cancelled.status).toBe(200);
    expect(cancelled.data.status).toBe("cancelled");
    const c = await getCollections();
    const pay = (await c.payments.findOne({ merchantReference: s.ref }))!;
    expect(pay).toMatchObject({ status: "refunded", refundedMinor: 150000 });
    expect(await c.refunds.countDocuments({ paymentId: pay._id, status: "succeeded" })).toBe(2);
    expect(await orderOf(s.orderId)).toMatchObject({ paymentStatus: "refunded", status: "cancelled" });
    for (const p of s.products) expect(await c.inventoryItems.findOne({ productId: new ObjectId(p.id) })).toMatchObject({ onHand: 10, reserved: 0 });
    for (const v of s.vendors) {
      expect(await getBalance(v.vendorId)).toMatchObject({ availableMinor: 0, pendingMinor: 0 });
      const sum = (await c.ledgerEntries.find({ vendorId: v.vendorId }).toArray()).reduce((a, e) => a + e.amountMinor, 0);
      expect(sum).toBe(0);
    }
    // cancelling again does not refund twice
    await call(cancelOrderHandler, { method: "POST", token: s.buyer.token, params: { id: s.orderId }, body: {} });
    expect(mockGateway.refunds.size).toBe(2);
    await drainOutbox();
    expect(await c.notifications.countDocuments({ userId: s.buyer.id, eventType: "refund.completed" })).toBe(2);
  });

  it("cannot cancel (and so cannot refund via cancel) once a seller accepted", async () => {
    const s = await onlineOrder();
    await succeed(s.ref);
    const c = await getCollections();
    await c.vendorOrders.updateOne({ parentOrderId: new ObjectId(s.orderId) }, { $set: { fulfillmentStatus: "accepted" } });
    expect((await call(cancelOrderHandler, { method: "POST", token: s.buyer.token, params: { id: s.orderId }, body: {} })).error?.code).toBe("BUSINESS_RULE_VIOLATION");
    expect(mockGateway.refunds.size).toBe(0);
  });

  it("admin partial refunds: scoped, cumulative-capped, proportional commission reversal, permission-gated", async () => {
    const s = await onlineOrder([100000]);
    await succeed(s.ref);
    const voId = s.order.vendorOrders[0]!.id;
    const request = (amountMinor: number, token = admin.token) =>
      call(adminRequestRefundHandler, { method: "POST", token, body: { orderId: s.orderId, vendorOrderId: voId, amountMinor, reason: "damaged item" } });
    const finance = await makeAdmin(["refund.approve"]);
    const second = await makeAdmin(["refund.approve"]);
    expect((await request(10000, (await makeCustomer()).token)).status).toBe(403);
    expect((await request(10000, (await makeAdmin(["order.read_all"])).token)).status).toBe(403);
    expect((await request(0)).status).toBe(400);
    expect((await request(100001)).error?.code).toBe("BUSINESS_RULE_VIOLATION"); // exceeds the vendor order

    const r1 = await request(40000, finance.token);
    expect(r1.status).toBe(201);
    expect(r1.data.status).toBe("requested");
    const approved = await call(adminApproveRefundHandler, { method: "POST", token: second.token, params: { id: r1.data.id } });
    expect(approved.data.status).toBe("succeeded");
    // headroom now 60000 (40000 refunded)
    expect((await request(60001)).status).toBe(422);
    const r2 = await request(60000);
    await call(adminApproveRefundHandler, { method: "POST", token: second.token, params: { id: r2.data.id } });
    expect((await request(1)).status).toBe(422); // fully refunded

    const c = await getCollections();
    expect(await c.payments.findOne({ merchantReference: s.ref })).toMatchObject({ status: "refunded", refundedMinor: 100000 });
    const entries = await c.ledgerEntries.find({ vendorId: s.vendors[0]!.vendorId }).toArray();
    const by = (t: string) => entries.filter((e) => e.type === t).reduce((a, e) => a + e.amountMinor, 0);
    expect(by("sale_gross")).toBe(100000);
    expect(by("platform_commission")).toBe(-10000);
    expect(by("refund_debit")).toBe(-100000);
    expect(by("refund_commission_reversal")).toBe(10000); // exactly the commission back — no rounding drift
    expect(entries.reduce((a, e) => a + e.amountMinor, 0)).toBe(0);
    const list = await call(adminListRefundsHandler, { token: finance.token, query: { orderId: s.orderId } });
    expect(list.data).toHaveLength(2);
  });

  it("enforces maker-checker above the threshold, supports rejection, and audits decisions", async () => {
    const s = await onlineOrder([800000]);
    await succeed(s.ref);
    const voId = s.order.vendorOrders[0]!.id;
    const maker = await makeAdmin(["refund.approve"]);
    const checker = await makeAdmin(["refund.approve"]);
    const big = await call(adminRequestRefundHandler, { method: "POST", token: maker.token, body: { orderId: s.orderId, vendorOrderId: voId, amountMinor: 600000, reason: "large dispute" } });
    const self = await call(adminApproveRefundHandler, { method: "POST", token: maker.token, params: { id: big.data.id } });
    expect(self.status).toBe(403);
    expect(self.error?.details[0]?.code).toBe("MAKER_CHECKER");
    const rej = await call(adminRejectRefundHandler, { method: "POST", token: checker.token, params: { id: big.data.id }, body: { reason: "not justified" } });
    expect(rej.data.status).toBe("rejected");
    expect((await call(adminApproveRefundHandler, { method: "POST", token: checker.token, params: { id: big.data.id } })).error?.code).toBe("INVALID_STATE_TRANSITION");
    expect(mockGateway.refunds.size).toBe(0);
    // below the threshold the maker may approve their own request
    const small = await call(adminRequestRefundHandler, { method: "POST", token: maker.token, body: { orderId: s.orderId, vendorOrderId: voId, amountMinor: 1000, reason: "goodwill gesture" } });
    expect((await call(adminApproveRefundHandler, { method: "POST", token: maker.token, params: { id: small.data.id } })).data.status).toBe("succeeded");
    const c = await getCollections();
    const actions = (await c.auditLogs.find({ resourceType: "refund" }).toArray()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["refund.request", "refund.reject", "refund.approve", "refund.completed"]));
    // rejected refunds free their headroom
    const again = await call(adminRequestRefundHandler, { method: "POST", token: maker.token, body: { orderId: s.orderId, vendorOrderId: voId, amountMinor: 799000, reason: "full remaining" } });
    expect(again.status).toBe(201);
  });

  it("two concurrent refund requests cannot jointly exceed the refundable amount", async () => {
    const s = await onlineOrder([100000]);
    await succeed(s.ref);
    const voId = s.order.vendorOrders[0]!.id;
    const rs = await Promise.allSettled(
      Array.from({ length: 4 }, () => call(adminRequestRefundHandler, { method: "POST", token: admin.token, body: { orderId: s.orderId, vendorOrderId: voId, amountMinor: 40000, reason: "race test" } })),
    );
    const created = rs.filter((r) => r.status === "fulfilled" && r.value.status === 201).length;
    expect(created).toBe(2); // 2 x 40000 fits in 100000, a third does not
  });

  it("a provider failure is recorded and retryable; a timeout resolves through the idempotent worker without double refunding", async () => {
    const s = await onlineOrder([100000]);
    await succeed(s.ref);
    const voId = s.order.vendorOrders[0]!.id;
    const approver = await makeAdmin(["refund.approve"]);
    const req = (amountMinor: number) => call(adminRequestRefundHandler, { method: "POST", token: admin.token, body: { orderId: s.orderId, vendorOrderId: voId, amountMinor, reason: "provider test" } });

    mockGateway.nextRefund = "failed";
    const r1 = await req(20000);
    const failed = await call(adminApproveRefundHandler, { method: "POST", token: approver.token, params: { id: r1.data.id } });
    expect(failed.data).toMatchObject({ status: "failed", failureReason: expect.stringContaining("declined") });
    const c = await getCollections();
    expect(await c.payments.findOne({ merchantReference: s.ref })).toMatchObject({ refundedMinor: 0, status: "succeeded" });
    expect(await c.ledgerEntries.countDocuments({ refundId: new ObjectId(r1.data.id) })).toBe(0);
    const retried = await call(adminRetryRefundHandler, { method: "POST", token: approver.token, params: { id: r1.data.id } });
    expect(retried.data.status).toBe("succeeded");

    mockGateway.nextRefund = "timeout";
    const r2 = await req(30000);
    const timedOut = await call(adminApproveRefundHandler, { method: "POST", token: approver.token, params: { id: r2.data.id } });
    expect(timedOut.data.status).toBe("processing"); // unknown outcome: not failed, not succeeded
    expect(await c.payments.findOne({ merchantReference: s.ref })).toMatchObject({ refundedMinor: 20000 });
    await c.refunds.updateOne({ _id: new ObjectId(r2.data.id) }, { $set: { updatedAt: new Date(Date.now() - 10 * 60_000) } });
    expect(await retryProcessingRefunds()).toBeGreaterThanOrEqual(1);
    expect(await c.refunds.findOne({ _id: new ObjectId(r2.data.id) })).toMatchObject({ status: "succeeded" });
    expect(await c.payments.findOne({ merchantReference: s.ref })).toMatchObject({ refundedMinor: 50000, status: "partially_refunded" });
    expect(mockGateway.refunds.size).toBe(2); // the retry reused the same provider reference
    await retryProcessingRefunds();
    expect(await c.payments.findOne({ merchantReference: s.ref })).toMatchObject({ refundedMinor: 50000 });
    expect((await call(adminRetryRefundHandler, { method: "POST", token: approver.token, params: { id: r2.data.id } })).status).toBe(409);
  });

  it("COD orders have no provider refund path", async () => {
    // COD is enabled in the test env; refunds for it are manual by design.
    const buyer0 = await makeCustomer();
    const a = await call(createAddressHandler, { method: "POST", token: buyer0.token, body: { label: "H", recipient: "R R", phone: "+8801712345678", line1: "House 5", city: "Dhaka", district: "Dhaka", postalCode: "1212" } });
    const v = await makeVendor();
    const p = await makeProduct(v, { categoryId: cat.id, priceMinor: 20000, stock: 3, publish: true, admin });
    await call(addCartItemHandler, { method: "POST", token: buyer0.token, body: { productId: p.id, variantId: p.variants[0].variantId, quantity: 1 } });
    const o = await call(checkoutHandler, { method: "POST", token: buyer0.token, headers: { "idempotency-key": key() }, body: { addressId: a.data.id, paymentMethod: "cod", expectedTotalMinor: 20000 } });
    expect(o.data.payment).toBeNull();
    const r = await call(adminRequestRefundHandler, { method: "POST", token: admin.token, body: { orderId: o.data.id, vendorOrderId: o.data.vendorOrders[0].id, amountMinor: 1000, reason: "cod refund" } });
    expect(r.error?.code).toBe("CAPABILITY_UNSUPPORTED");
    expect((await call(getPaymentHandler, { token: buyer0.token, params: { id: o.data.id } })).data).toBeNull();
  });
});

describe("vendor ledger visibility", () => {
  it("vendors see only their own balance and ledger; others and guests are refused", async () => {
    const s = await onlineOrder([100000, 50000]);
    await succeed(s.ref);
    const [a, b] = s.vendors;
    const balA = await call(vendorBalanceHandler, { token: a!.user.token });
    expect(balA.data).toMatchObject({ pendingMinor: 90000, availableMinor: 0, lifetimeSalesMinor: 100000 });
    const ledA = await call(vendorLedgerHandler, { token: a!.user.token });
    expect(ledA.data).toHaveLength(2);
    expect(ledA.data.every((e: { orderId: string }) => e.orderId === s.orderId)).toBe(true);
    expect((await call(vendorBalanceHandler, { token: b!.user.token })).data.pendingMinor).toBe(45000);
    expect((await call(vendorBalanceHandler, { token: s.buyer.token })).status).toBe(403);
    expect((await call(vendorLedgerHandler)).status).toBe(401);
  });

  it("cannot post the same sale twice even if ledger posting is replayed directly", async () => {
    const s = await onlineOrder();
    await succeed(s.ref);
    const c = await getCollections();
    const vo = (await c.vendorOrders.findOne({ parentOrderId: new ObjectId(s.orderId) }))!;
    const { postOnlineSale } = await import("@/server/modules/ledger/service");
    const { withTransaction } = await import("@/server/db/transaction");
    await withTransaction((session) => postOnlineSale(vo, new ObjectId(s.payment.id), session));
    expect(await c.ledgerEntries.countDocuments({ vendorOrderId: vo._id })).toBe(2);
  });
});

describe("SSLCOMMERZ adapter contract (deterministic stub — NOT proof of sandbox access)", () => {
  type Handler = (url: URL, init?: RequestInit) => unknown;
  const adapterWith = (handler: Handler) =>
    new SslCommerzAdapter({
      storeId: "teststore", storePassword: "secret", mode: "sandbox",
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
        const out = handler(new URL(String(input)), init);
        if (out instanceof Error) throw out;
        return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
      }) as typeof fetch,
    });
  const input = {
    merchantReference: "BF-TEST-1", amount: money(150000), orderNumber: "BF-TEST", customer: { name: "A B", email: "a@b.co", phone: "01700000000" },
    shippingAddress: { line1: "House 1", city: "Dhaka", postalCode: "1212", country: "BD" },
    returnUrls: { success: "https://x/s", fail: "https://x/f", cancel: "https://x/c" }, webhookUrl: "https://x/ipn",
  };

  it("builds a session request with decimal amounts and maps the redirect", async () => {
    let seen: URLSearchParams | undefined;
    const a = adapterWith((url, init) => {
      expect(url.href).toBe("https://sandbox.sslcommerz.com/gwprocess/v4/api.php");
      seen = new URLSearchParams(String(init?.body));
      return { status: "SUCCESS", GatewayPageURL: "https://sandbox.sslcommerz.com/gw/abc", sessionkey: "K1" };
    });
    const r = await a.createCheckout(input);
    expect(r).toEqual({ redirectUrl: "https://sandbox.sslcommerz.com/gw/abc", providerSessionId: "K1" });
    expect(seen!.get("total_amount")).toBe("1500.00");
    expect(seen!.get("tran_id")).toBe("BF-TEST-1");
    expect(seen!.get("currency")).toBe("BDT");
    expect(seen!.get("ipn_url")).toBe("https://x/ipn");
    await expect(adapterWith(() => ({ status: "FAILED", failedreason: "bad store" })).createCheckout(input)).rejects.toMatchObject({ kind: "declined" });
    await expect(adapterWith(() => new Error("ECONNREFUSED")).createCheckout(input)).rejects.toMatchObject({ kind: "provider_unavailable" });
    const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
    await expect(adapterWith(() => timeout).createCheckout(input)).rejects.toMatchObject({ kind: "unknown_result" });
  });

  it("never trusts IPN fields: confirms through the validation API and compares what WE sent", async () => {
    const calls: string[] = [];
    const ok = adapterWith((url) => {
      calls.push(url.pathname);
      return { status: "VALID", tran_id: "BF-TEST-1", bank_tran_id: "BANK1", currency_type: "BDT", currency_amount: "1500.00", amount: "1479.00", currency: "BDT" };
    });
    const ev = await ok.parseAndVerifyWebhook({ rawBody: "status=VALID&tran_id=BF-TEST-1&val_id=V1&amount=1.00", headers: new Headers(), contentType: "application/x-www-form-urlencoded" });
    expect(calls).toEqual(["/validator/api/validationserverAPI.php"]);
    expect(ev).toMatchObject({ status: "succeeded", merchantReference: "BF-TEST-1", providerTransactionId: "BANK1", providerEventId: "BF-TEST-1:V1:succeeded" });
    expect(ev.amount).toEqual(money(150000)); // currency_amount, not the posted "1.00" nor the settled 1479.00

    const other = adapterWith(() => ({ status: "VALID", tran_id: "SOMEONE-ELSE", currency_type: "BDT", currency_amount: "1500.00" }));
    // val_id belongs to a different transaction -> fall back to a lookup by tran_id, which finds nothing -> unknown, not success
    const lookupEmpty = adapterWith((url) => (url.pathname.includes("validationserver") ? { status: "VALID", tran_id: "SOMEONE-ELSE", currency_type: "BDT", currency_amount: "1500.00" } : { APIConnect: "DONE", no_of_trans_found: 0, element: [] }));
    const mism = await lookupEmpty.parseAndVerifyWebhook({ rawBody: "status=VALID&tran_id=BF-TEST-1&val_id=V9", headers: new Headers(), contentType: "" });
    expect(mism.status).toBe("unknown");
    await expect(adapterWith(() => ({ status: "INVALID_TRANSACTION" })).parseAndVerifyWebhook({ rawBody: "tran_id=BF-TEST-1&val_id=FORGED", headers: new Headers(), contentType: "" })).rejects.toBeInstanceOf(ProviderError);
    await expect(other.parseAndVerifyWebhook({ rawBody: "status=VALID", headers: new Headers(), contentType: "" })).rejects.toMatchObject({ kind: "verification_failed" });
    // a forged "FAILED" IPN is checked against the provider too
    const pending = adapterWith(() => ({ APIConnect: "DONE", no_of_trans_found: 1, element: [{ status: "PENDING", tran_id: "BF-TEST-1" }] }));
    expect((await pending.parseAndVerifyWebhook({ rawBody: "status=FAILED&tran_id=BF-TEST-1", headers: new Headers(), contentType: "" })).status).toBe("pending");
  });

  it("maps transaction query results, preferring success and keeping pending sessions alive", async () => {
    const rows = (el: object[]) => adapterWith(() => ({ APIConnect: "DONE", no_of_trans_found: el.length, element: el }));
    const q = { merchantReference: "BF-TEST-1" };
    expect((await rows([{ status: "FAILED", tran_id: "BF-TEST-1" }, { status: "VALID", tran_id: "BF-TEST-1", bank_tran_id: "B", currency_type: "BDT", currency_amount: "1500.00" }]).getPaymentStatus(q))).toMatchObject({ status: "succeeded", providerTransactionId: "B" });
    expect((await rows([{ status: "FAILED", tran_id: "BF-TEST-1" }, { status: "PENDING", tran_id: "BF-TEST-1" }]).getPaymentStatus(q)).status).toBe("pending");
    expect((await rows([{ status: "FAILED", tran_id: "BF-TEST-1" }]).getPaymentStatus(q)).status).toBe("failed");
    expect((await rows([]).getPaymentStatus(q)).status).toBe("unknown");
    expect((await rows([{ status: "VALID", tran_id: "OTHER", currency_type: "BDT", currency_amount: "1.00" }]).getPaymentStatus(q)).status).toBe("unknown");
    await expect(adapterWith(() => ({ APIConnect: "INACTIVE" })).getPaymentStatus(q)).rejects.toMatchObject({ kind: "configuration_error" });
  });

  it("sends refunds with our reference and maps success / processing / failure", async () => {
    let seen: URLSearchParams | undefined;
    const mk = (body: object) => adapterWith((url) => ((seen = url.searchParams), body));
    const r = { merchantRefundRef: "RF1", merchantReference: "BF-TEST-1", providerTransactionId: "BANK1", amount: money(25050), reason: "damaged" };
    expect(await mk({ APIConnect: "DONE", status: "success", refund_ref_id: "R9" }).refund(r)).toEqual({ status: "succeeded", providerRefundId: "R9" });
    expect(seen!.get("bank_tran_id")).toBe("BANK1");
    expect(seen!.get("refund_trans_id")).toBe("RF1");
    expect(seen!.get("refund_amount")).toBe("250.50");
    expect((await mk({ APIConnect: "DONE", status: "processing", refund_ref_id: "R9" }).refund(r)).status).toBe("pending");
    expect(await mk({ APIConnect: "DONE", status: "failed", errorReason: "limit" }).refund(r)).toMatchObject({ status: "failed", failureReason: "limit" });
    expect((await mk({ APIConnect: "INVALID_REQUEST" }).refund(r)).status).toBe("failed");
  });
});
