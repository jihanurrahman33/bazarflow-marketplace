import { MongoServerError, ObjectId, type Filter } from "mongodb";
import { getEnv } from "@/server/config/env";
import { getCollections } from "@/server/db/collections";
import { withTransaction } from "@/server/db/transaction";
import type { OrderDoc, PaymentDoc, PaymentStatus } from "@/server/db/schema";
import { AppError } from "@/server/shared/errors";
import { newId } from "@/server/shared/ids";
import { logger } from "@/server/shared/logger";
import { money } from "@/server/shared/money";
import { decodeCursor, encodeCursor, slicePage } from "@/server/shared/pagination";
import { writeAudit } from "@/server/modules/audit/audit";
import { enqueue } from "@/server/modules/outbox/outbox";
import { enqueueOrderConfirmed } from "@/server/modules/checkout/service";
import { settleReservation } from "@/server/modules/inventory/service";
import { postOnlineSale } from "@/server/modules/ledger/service";
import { getPaymentAdapter } from "./registry";
import { LIVE_PAYMENT_STATES, paymentMachine } from "./state";
import { ProviderError, type PaymentProviderAdapter, type VerifiedProviderEvent } from "./types";
import { createSystemRefundForPayment } from "./refunds";

// ---------- views ----------

export interface PaymentView {
  id: string;
  status: PaymentStatus;
  provider: string;
  amountMinor: number;
  currency: string;
  /** Present while the customer still needs to complete the hosted page. */
  redirectUrl?: string;
  /** True when starting a new attempt is safe. False while a previous attempt might still turn into money. */
  canRetry: boolean;
  message?: string;
}

export function toPaymentView(p: PaymentDoc): PaymentView {
  const live = (LIVE_PAYMENT_STATES as readonly string[]).includes(p.status);
  return {
    id: p._id.toHexString(), status: p.status, provider: p.provider, amountMinor: p.amountMinor, currency: p.currency,
    redirectUrl: p.status === "requires_action" || p.status === "pending" ? p.redirectUrl : undefined,
    canRetry: p.status === "failed" || p.status === "cancelled",
    message:
      p.status === "unknown" ? "We are confirming this payment with the provider. Do not pay again; check the status in a moment."
      : p.status === "pending" && live ? "Waiting for the provider to confirm your payment." : undefined,
  };
}

async function latestPayment(orderId: ObjectId): Promise<PaymentDoc | null> {
  const c = await getCollections();
  return c.payments.find({ orderId }).sort({ createdAt: -1, _id: -1 }).limit(1).next();
}

async function loadOwnedOrder(buyerId: ObjectId, orderId: ObjectId): Promise<OrderDoc> {
  const c = await getCollections();
  const order = await c.orders.findOne({ _id: orderId, buyerId });
  if (!order) throw new AppError("NOT_FOUND");
  return order;
}

export async function getPaymentForOrder(buyerId: ObjectId, orderId: ObjectId): Promise<PaymentView | null> {
  const order = await loadOwnedOrder(buyerId, orderId);
  if (order.paymentMethod !== "online") return null;
  const p = await latestPayment(orderId);
  return p ? toPaymentView(p) : null;
}

// ---------- initiation (provider call is OUTSIDE any DB transaction) ----------

export async function initiatePayment(buyerId: ObjectId, orderId: ObjectId): Promise<PaymentView> {
  const c = await getCollections();
  const order = await loadOwnedOrder(buyerId, orderId);
  if (order.paymentMethod !== "online") throw new AppError("BUSINESS_RULE_VIOLATION", { message: "This order is not paid online." });
  if (order.status !== "pending_payment") throw new AppError("INVALID_STATE_TRANSITION", { message: "This order is not awaiting payment." });
  const adapter = getPaymentAdapter();
  const caps = adapter.capabilities();
  if (order.totals.totalMinor < caps.minAmountMinor || order.totals.totalMinor > caps.maxAmountMinor) {
    throw new AppError("BUSINESS_RULE_VIOLATION", { message: "This order total cannot be paid online.", details: [{ field: "total", code: "AMOUNT_OUT_OF_RANGE" }] });
  }

  const existing = await latestPayment(orderId);
  if (existing && (LIVE_PAYMENT_STATES as readonly string[]).includes(existing.status)) {
    if (existing.status === "requires_action" && existing.redirectUrl) return toPaymentView(existing); // idempotent: reuse the open session
    // Unknown outcome: never start a second charge blindly. Verify first.
    const verified = await refreshPayment(existing._id).catch(() => existing);
    if ((LIVE_PAYMENT_STATES as readonly string[]).includes(verified.status)) {
      if (verified.status === "requires_action" && verified.redirectUrl) return toPaymentView(verified);
      throw new AppError("CONFLICT", { message: "Your previous payment attempt is still being verified. Check the status shortly.", details: [{ field: "payment", code: "VERIFICATION_PENDING" }] });
    }
    const fresh = await c.orders.findOne({ _id: orderId });
    if (fresh?.status !== "pending_payment") return toPaymentView(verified);
  }

  // Persist the attempt BEFORE contacting the provider so a crash/timeout leaves a record to reconcile.
  const now = new Date();
  let payment: PaymentDoc | undefined;
  for (let n = (await c.payments.countDocuments({ orderId })) + 1; n < 50 && !payment; n++) {
    const doc: PaymentDoc = {
      _id: newId(), orderId, provider: adapter.id, mode: getEnv().PAYMENT_MODE, merchantReference: `${order.publicOrderNumber}-${n}`,
      amountMinor: order.totals.totalMinor, currency: order.currency, refundedMinor: 0, status: "created", version: 1, createdAt: now, updatedAt: now,
    };
    try {
      await c.payments.insertOne(doc);
      payment = doc;
    } catch (e) {
      if (!(e instanceof MongoServerError && e.code === 11000)) throw e;
    }
  }
  if (!payment) throw new AppError("INTERNAL");
  await c.orders.updateOne({ _id: orderId, status: "pending_payment" }, { $set: { paymentStatus: "pending", updatedAt: now } });

  const buyer = await c.users.findOne({ _id: buyerId }, { projection: { name: 1, email: 1, phone: 1 } });
  const base = getEnv().APP_ORIGIN;
  try {
    const res = await adapter.createCheckout({
      merchantReference: payment.merchantReference, amount: money(payment.amountMinor, order.currency), orderNumber: order.publicOrderNumber,
      customer: { name: order.shippingAddress.recipient, email: buyer?.email ?? "customer@invalid.example", phone: order.shippingAddress.phone },
      shippingAddress: { line1: order.shippingAddress.line1, city: order.shippingAddress.city, postalCode: order.shippingAddress.postalCode, country: "BD" },
      returnUrls: {
        success: `${base}/api/v1/payments/return/${adapter.id}?order=${orderId.toHexString()}&result=success`,
        fail: `${base}/api/v1/payments/return/${adapter.id}?order=${orderId.toHexString()}&result=fail`,
        cancel: `${base}/api/v1/payments/return/${adapter.id}?order=${orderId.toHexString()}&result=cancel`,
      },
      webhookUrl: `${base}/api/v1/webhooks/payments/${adapter.id}`,
    });
    const updated = await c.payments.findOneAndUpdate(
      { _id: payment._id, status: "created" },
      { $set: { status: "requires_action", redirectUrl: res.redirectUrl, updatedAt: new Date() }, $inc: { version: 1 } },
      { returnDocument: "after" },
    );
    // If a webhook already moved the payment on (fast provider), return that truth instead.
    return toPaymentView(updated ?? (await c.payments.findOne({ _id: payment._id }))!);
  } catch (e) {
    if (!(e instanceof ProviderError)) throw e;
    // unknown_result: the session may exist. Park it for reconciliation; do NOT allow an immediate second attempt.
    const next: PaymentStatus = e.kind === "unknown_result" ? "unknown" : "failed";
    const updated = await c.payments.findOneAndUpdate(
      { _id: payment._id, status: "created" },
      { $set: { status: next, failureReason: e.kind, updatedAt: new Date() }, $inc: { version: 1 } },
      { returnDocument: "after" },
    );
    if (next === "failed") await c.orders.updateOne({ _id: orderId, status: "pending_payment" }, { $set: { paymentStatus: "failed", updatedAt: new Date() } });
    logger.warn("payment initiation failed", { orderId: orderId.toHexString(), paymentId: payment._id.toHexString(), code: e.kind, provider: adapter.id });
    return toPaymentView(updated ?? (await c.payments.findOne({ _id: payment._id }))!);
  }
}

// ---------- applying verified provider evidence ----------

export type ApplyOutcome = "applied" | "duplicate" | "stale" | "rejected" | "unknown_payment";

/**
 * Apply one verified event. All state changes plus the dedupe row commit in ONE short transaction, so a crash
 * can never leave an event marked "seen" without its effects (or effects without the marker).
 */
export async function applyVerifiedEvent(adapter: PaymentProviderAdapter, event: VerifiedProviderEvent): Promise<ApplyOutcome> {
  const c = await getCollections();
  const found = await c.payments.findOne({ merchantReference: event.merchantReference, provider: adapter.id });
  if (!found) {
    logger.warn("payment event for unknown reference", { provider: adapter.id, eventId: event.providerEventId });
    return "unknown_payment";
  }
  const payment: PaymentDoc = found;

  // Success must be backed by an amount that matches what we asked the customer to pay.
  const amountOk = event.status !== "succeeded" || (!!event.amount && event.amount.currency === payment.currency && event.amount.amountMinor === payment.amountMinor);

  // Fast path for the common redelivery. The unique index is still the authority (see the catch below).
  if (await c.paymentEvents.findOne({ provider: adapter.id, providerEventId: event.providerEventId }, { projection: { _id: 1 } })) return "duplicate";

  let autoRefundId: ObjectId | undefined;
  let outcome: ApplyOutcome;
  try {
    outcome = await applyInTransaction();
  } catch (e) {
    // A duplicate-key error aborts the whole transaction, so it cannot be handled inside it: a concurrent
    // delivery of the same event won the race and has already applied (or is applying) it.
    if (e instanceof MongoServerError && e.code === 11000) return "duplicate";
    throw e;
  }
  if (autoRefundId) {
    const { executeRefund } = await import("./refunds");
    await executeRefund(autoRefundId).catch((e) => logger.warn("auto refund deferred", { code: e instanceof Error ? e.name : "unknown" }));
  }
  return outcome;

  function applyInTransaction(): Promise<ApplyOutcome> {
    return withTransaction(async (session): Promise<ApplyOutcome> => {
    const now = new Date();
    await c.paymentEvents.insertOne(
      { _id: newId(), provider: adapter.id, providerEventId: event.providerEventId, paymentId: payment._id, type: event.type, payloadHash: event.payloadHash, outcome: "applied", receivedAt: now },
      { session },
    );
    const mark = (o: "ignored_stale" | "rejected") => c.paymentEvents.updateOne({ provider: adapter.id, providerEventId: event.providerEventId }, { $set: { outcome: o } }, { session });

    if (!amountOk) {
      // Never trust a "success" for a different amount/currency. Park for a human.
      await c.payments.updateOne(
        { _id: payment._id, status: { $in: [...LIVE_PAYMENT_STATES] } },
        { $set: { status: "unknown", failureReason: "amount_mismatch", updatedAt: now }, $inc: { version: 1 } },
        { session },
      );
      await writeAudit({ actorRole: "system", action: "payment.amount_mismatch", resourceType: "payment", resourceId: payment._id.toHexString(), after: { expectedMinor: payment.amountMinor, reportedMinor: event.amount?.amountMinor } }, session);
      await mark("rejected");
      return "rejected";
    }

    if (event.status === "unknown") {
      await mark("ignored_stale");
      return "stale";
    }

    const target: PaymentStatus = event.status === "succeeded" ? "succeeded" : event.status;
    const from = paymentMachine.predecessors(target).filter((s) => s !== "refunding");
    const filter: Filter<PaymentDoc> = { _id: payment._id, status: { $in: from } };
    const moved = await c.payments.findOneAndUpdate(
      filter,
      {
        $set: { status: target, lastVerifiedAt: now, updatedAt: now, ...(event.providerTransactionId ? { providerTransactionId: event.providerTransactionId } : {}) },
        $unset: { failureReason: "" },
        $inc: { version: 1 },
      },
      { session, returnDocument: "after" },
    );
    if (!moved) {
      await mark("ignored_stale"); // duplicate/out-of-order: already at (or past) this state
      return "stale";
    }

    const order = await c.orders.findOne({ _id: payment.orderId }, { session });
    if (!order) throw new AppError("INTERNAL");

    if (target === "succeeded") {
      const otherPaid = await c.payments.countDocuments(
        { orderId: order._id, _id: { $ne: payment._id }, status: { $in: ["succeeded", "partially_refunded", "refunded"] } },
        { session },
      );
      if (order.status === "pending_payment" && otherPaid === 0) {
        const confirmed = await c.orders.findOneAndUpdate(
          { _id: order._id, status: "pending_payment" },
          { $set: { status: "confirmed", paymentStatus: "paid", updatedAt: now }, $inc: { version: 1 } },
          { session, returnDocument: "after" },
        );
        if (!confirmed) throw new AppError("CONFLICT"); // concurrent change: abort, transaction retries with fresh state
        await c.vendorOrders.updateMany(
          { parentOrderId: order._id, fulfillmentStatus: "awaiting_payment" },
          { $set: { fulfillmentStatus: "new", updatedAt: now }, $push: { timeline: { status: "new", at: now, note: "payment confirmed" } }, $inc: { version: 1 } },
          { session },
        );
        await settleReservation(session, order._id, "commit");
        const vos = await c.vendorOrders.find({ parentOrderId: order._id }, { session }).toArray();
        for (const vo of vos) await postOnlineSale(vo, payment._id, session);
        await enqueueOrderConfirmed(confirmed, vos, session);
      } else {
        // Money arrived for an order that is already cancelled/paid: give it back automatically.
        autoRefundId = await createSystemRefundForPayment(session, moved, order, order.status === "pending_payment" ? "duplicate_payment" : "late_payment_on_closed_order");
      }
    } else if ((target === "failed" || target === "cancelled") && order.status === "pending_payment") {
      const stillLive = await c.payments.countDocuments({ orderId: order._id, _id: { $ne: payment._id }, status: { $in: [...LIVE_PAYMENT_STATES] } }, { session });
      if (stillLive === 0) await c.orders.updateOne({ _id: order._id, status: "pending_payment" }, { $set: { paymentStatus: "failed", updatedAt: now } }, { session });
      await enqueue(
        {
          type: "notify.user", aggregateType: "payment", aggregateId: payment._id.toHexString(), dedupeKey: `payment-${target}:${payment._id.toHexString()}`,
          payload: { userId: order.buyerId.toHexString(), eventType: `payment.${target}`, title: "Payment not completed", body: `Payment for order ${order.publicOrderNumber} was ${target}. You can try again.`, deepLink: `/orders/${order._id.toHexString()}` },
        },
        session,
      );
    } else if (target === "pending" && order.status === "pending_payment") {
      await c.orders.updateOne({ _id: order._id, status: "pending_payment" }, { $set: { paymentStatus: "pending", updatedAt: now } }, { session });
    }
    return "applied";
    });
  }
}

// ---------- polling / reconciliation ----------

/**
 * Ask the provider what really happened and apply it. Safe to call repeatedly: the synthetic event id embeds
 * the observed status, so identical observations are deduplicated.
 */
export async function refreshPayment(paymentId: ObjectId): Promise<PaymentDoc> {
  const c = await getCollections();
  const payment = await c.payments.findOne({ _id: paymentId });
  if (!payment) throw new AppError("NOT_FOUND");
  if (!(LIVE_PAYMENT_STATES as readonly string[]).includes(payment.status) && payment.status !== "failed" && payment.status !== "cancelled") return payment;
  const adapter = getPaymentAdapter();
  if (adapter.id !== payment.provider) return payment;
  let looked;
  try {
    looked = await adapter.getPaymentStatus({ merchantReference: payment.merchantReference, providerTransactionId: payment.providerTransactionId });
  } catch (e) {
    if (e instanceof ProviderError) return payment; // provider down: stay in the current (honest) state
    throw e;
  }
  let status = looked.status;
  if (status === "unknown") {
    // The provider has no record. After the reservation window nothing can still complete, so close the attempt.
    const ageMs = Date.now() - payment.createdAt.getTime();
    if (payment.status === "unknown" || payment.status === "created") {
      if (ageMs > (getEnv().STOCK_RESERVATION_TTL_MINUTES + 5) * 60_000) status = "failed";
    }
  }
  if (status === "unknown" || (status === "failed" && payment.status === "failed") || (status === "cancelled" && payment.status === "cancelled")) {
    return (await c.payments.findOne({ _id: paymentId })) ?? payment;
  }
  await applyVerifiedEvent(adapter, {
    providerEventId: `poll:${payment._id.toHexString()}:${status}`, type: "poll", merchantReference: payment.merchantReference, status,
    providerTransactionId: looked.providerTransactionId, amount: looked.amount, payloadHash: `poll:${status}`,
  });
  return (await c.payments.findOne({ _id: paymentId }))!;
}

export async function refreshOrderPayment(buyerId: ObjectId, orderId: ObjectId): Promise<PaymentView | null> {
  await loadOwnedOrder(buyerId, orderId);
  const p = await latestPayment(orderId);
  if (!p) return null;
  return toPaymentView(await refreshPayment(p._id));
}

/** Scheduled job: re-verify attempts that have been in flight longer than the reconcile window. */
export async function reconcileStuckPayments(now = new Date(), limit = 50): Promise<number> {
  const c = await getCollections();
  const cutoff = new Date(now.getTime() - getEnv().PAYMENT_RECONCILE_AFTER_MINUTES * 60_000);
  const stuck = await c.payments.find({ status: { $in: [...LIVE_PAYMENT_STATES] }, updatedAt: { $lte: cutoff } }).limit(limit).toArray();
  let changed = 0;
  for (const p of stuck) {
    const after = await refreshPayment(p._id).catch(() => p);
    if (after.status !== p.status) changed++;
    else await c.payments.updateOne({ _id: p._id }, { $set: { updatedAt: new Date() } }); // back off until the next window
  }
  return changed;
}

// ---------- admin ----------

export async function listReconciliationQueue(q: { limit: number; cursor?: string }) {
  const c = await getCollections();
  const cutoff = new Date(Date.now() - getEnv().PAYMENT_RECONCILE_AFTER_MINUTES * 60_000);
  const cur = decodeCursor<{ id: string }>(q.cursor);
  const filter: Filter<PaymentDoc> = {
    $or: [{ status: "unknown" }, { status: { $in: ["created", "requires_action", "pending"] }, updatedAt: { $lte: cutoff } }],
    ...(cur ? { _id: { $gt: new ObjectId(cur.id) } } : {}),
  };
  const rows = await c.payments.find(filter).sort({ _id: 1 }).limit(q.limit + 1).toArray();
  const { items, hasMore } = slicePage(rows, q.limit);
  const last = items[items.length - 1];
  return {
    items: items.map((p) => ({
      id: p._id.toHexString(), orderId: p.orderId.toHexString(), provider: p.provider, merchantReference: p.merchantReference, status: p.status,
      amountMinor: p.amountMinor, currency: p.currency, failureReason: p.failureReason, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
    })),
    nextCursor: hasMore && last ? encodeCursor({ id: last._id.toHexString() }) : null,
  };
}

export async function adminReconcile(adminId: ObjectId, paymentId: ObjectId, requestId?: string) {
  const before = await refreshPayment(paymentId);
  await writeAudit({ actorId: adminId, actorRole: "admin", action: "payment.reconcile", resourceType: "payment", resourceId: paymentId.toHexString(), after: { status: before.status }, requestId });
  return toPaymentView(before);
}
