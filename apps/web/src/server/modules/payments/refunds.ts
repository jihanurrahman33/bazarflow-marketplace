import { ObjectId, type ClientSession, type Filter } from "mongodb";
import { getEnv } from "@/server/config/env";
import { getCollections } from "@/server/db/collections";
import { withTransaction } from "@/server/db/transaction";
import type { OrderDoc, PaymentDoc, RefundDoc, RefundStatus } from "@/server/db/schema";
import { AppError } from "@/server/shared/errors";
import { newId } from "@/server/shared/ids";
import { logger } from "@/server/shared/logger";
import { money } from "@/server/shared/money";
import { decodeCursor, encodeCursor, slicePage } from "@/server/shared/pagination";
import { defineStateMachine } from "@/server/shared/state-machine";
import { writeAudit } from "@/server/modules/audit/audit";
import { enqueue } from "@/server/modules/outbox/outbox";
import type { Actor } from "@/server/modules/authorization/actor";
import { postRefund } from "@/server/modules/ledger/service";
import { cancelConfirmedOrder } from "@/server/modules/orders/service";
import { getPaymentAdapter } from "./registry";
import { ProviderError } from "./types";

export const refundMachine = defineStateMachine({
  requested: ["approved", "rejected"],
  approved: ["processing"],
  processing: ["succeeded", "failed", "approved"],
  failed: ["approved"],
  succeeded: [],
  rejected: [],
} as const);

/** Statuses that reserve refundable headroom (a refund that might still succeed counts). */
const COMMITTED: RefundStatus[] = ["requested", "approved", "processing", "succeeded"];
const STALE_PROCESSING_MS = 2 * 60_000;

export const toRefundDto = (r: RefundDoc) => ({
  id: r._id.toHexString(), orderId: r.orderId.toHexString(), vendorOrderId: r.vendorOrderId?.toHexString(), paymentId: r.paymentId.toHexString(),
  amountMinor: r.amountMinor, currency: r.currency, reason: r.reason, status: r.status, system: !!r.system, failureReason: r.failureReason,
  requestedBy: r.requestedBy.toHexString(), decidedBy: r.decidedBy?.toHexString(), decisionReason: r.decisionReason,
  createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
});

function enqueueExecution(refundId: ObjectId, session?: ClientSession) {
  return enqueue({ type: "refund.execute", aggregateType: "refund", aggregateId: refundId.toHexString(), dedupeKey: `refund-exec:${refundId.toHexString()}`, payload: { refundId: refundId.toHexString() } }, session);
}

/**
 * Reserve headroom and insert a refund. The payment document is touched first so that two concurrent refund
 * requests serialise on it (write conflict -> retry) and cannot jointly exceed the refundable amount.
 */
async function insertRefund(
  session: ClientSession,
  args: { order: OrderDoc; payment: PaymentDoc; vendorOrderId?: ObjectId; amountMinor: number; reason: string; requestedBy: ObjectId; status: "requested" | "approved"; postLedger: boolean; system: boolean },
): Promise<RefundDoc> {
  const c = await getCollections();
  const now = new Date();
  const locked = await c.payments.findOneAndUpdate({ _id: args.payment._id }, { $inc: { version: 1 } }, { session, returnDocument: "after" });
  if (!locked || !["succeeded", "partially_refunded"].includes(locked.status)) throw new AppError("BUSINESS_RULE_VIOLATION", { message: "This payment cannot be refunded." });

  const paymentCommitted = await c.refunds.aggregate<{ t: number }>(
    [{ $match: { paymentId: locked._id, status: { $in: COMMITTED } } }, { $group: { _id: null, t: { $sum: "$amountMinor" } } }],
    { session },
  ).toArray();
  if ((paymentCommitted[0]?.t ?? 0) + args.amountMinor > locked.amountMinor) {
    throw new AppError("BUSINESS_RULE_VIOLATION", { message: "The refund exceeds the refundable amount.", details: [{ field: "amountMinor", code: "EXCEEDS_REFUNDABLE" }] });
  }
  let vendorId: ObjectId | undefined;
  if (args.vendorOrderId) {
    const vo = await c.vendorOrders.findOne({ _id: args.vendorOrderId, parentOrderId: args.order._id }, { session });
    if (!vo) throw new AppError("VALIDATION_FAILED", { details: [{ field: "vendorOrderId", code: "NOT_FOUND" }] });
    vendorId = vo.vendorId;
    const voCommitted = await c.refunds.aggregate<{ t: number }>(
      [{ $match: { vendorOrderId: vo._id, status: { $in: COMMITTED } } }, { $group: { _id: null, t: { $sum: "$amountMinor" } } }],
      { session },
    ).toArray();
    if ((voCommitted[0]?.t ?? 0) + args.amountMinor > vo.totals.totalMinor) {
      throw new AppError("BUSINESS_RULE_VIOLATION", { message: "The refund exceeds this seller order's total.", details: [{ field: "amountMinor", code: "EXCEEDS_REFUNDABLE" }] });
    }
  }
  const doc: RefundDoc = {
    _id: newId(), orderId: args.order._id, paymentId: locked._id, vendorOrderId: args.vendorOrderId, vendorId, amountMinor: args.amountMinor,
    currency: locked.currency, reason: args.reason, postLedger: args.postLedger, system: args.system || undefined, status: args.status,
    requestedBy: args.requestedBy, version: 1, createdAt: now, updatedAt: now,
  };
  await c.refunds.insertOne(doc, { session });
  return doc;
}

/** Money arrived that should not stay (duplicate or late payment on a closed order): refund everything, no ledger impact. */
export async function createSystemRefundForPayment(session: ClientSession, payment: PaymentDoc, order: OrderDoc, why: string): Promise<ObjectId> {
  const refund = await insertRefund(session, {
    order, payment: { ...payment, status: "succeeded" }, amountMinor: payment.amountMinor - payment.refundedMinor, reason: why,
    requestedBy: order.buyerId, status: "approved", postLedger: false, system: true,
  });
  await writeAudit({ actorRole: "system", action: "refund.auto_created", resourceType: "refund", resourceId: refund._id.toHexString(), reason: why }, session);
  await enqueueExecution(refund._id, session);
  return refund._id;
}

/** Customer cancels a paid online order before any seller started work: cancel + refund each seller order in full. */
export async function cancelPaidOrderWithRefund(actor: Actor, order: OrderDoc, note: string): Promise<void> {
  const c = await getCollections();
  const payment = await c.payments.findOne({ orderId: order._id, status: "succeeded" });
  if (!payment) throw new AppError("BUSINESS_RULE_VIOLATION", { message: "No completed payment was found for this order." });
  if (!getPaymentAdapter().capabilities().refunds) throw new AppError("CAPABILITY_UNSUPPORTED", { message: "Refunds are not supported by the payment provider." });
  const ids = await withTransaction(async (session) => {
    await cancelConfirmedOrder(session, order, "cancelled_by_customer", note, actor.userId);
    const vos = await c.vendorOrders.find({ parentOrderId: order._id }, { session }).toArray();
    const out: ObjectId[] = [];
    for (const vo of vos) {
      const r = await insertRefund(session, {
        order, payment, vendorOrderId: vo._id, amountMinor: vo.totals.totalMinor, reason: "order cancelled by customer before fulfilment",
        requestedBy: actor.userId, status: "approved", postLedger: true, system: true,
      });
      await writeAudit({ actorId: actor.userId, actorRole: actor.role, action: "refund.auto_created", resourceType: "refund", resourceId: r._id.toHexString(), reason: "customer cancellation" }, session);
      await enqueueExecution(r._id, session);
      out.push(r._id);
    }
    return out;
  });
  for (const id of ids) await executeRefund(id).catch((e) => logger.warn("refund deferred to worker", { code: e instanceof Error ? e.name : "unknown" }));
}

// ---------- admin-initiated flow ----------

export async function adminRequestRefund(admin: Actor, input: { orderId: ObjectId; vendorOrderId: ObjectId; amountMinor: number; reason: string }, requestId?: string) {
  const c = await getCollections();
  const order = await c.orders.findOne({ _id: input.orderId });
  if (!order) throw new AppError("NOT_FOUND");
  if (order.paymentMethod !== "online") throw new AppError("CAPABILITY_UNSUPPORTED", { message: "Cash-on-delivery refunds are handled manually." });
  const payment = await c.payments.findOne({ orderId: order._id, status: { $in: ["succeeded", "partially_refunded"] } });
  if (!payment) throw new AppError("BUSINESS_RULE_VIOLATION", { message: "No completed payment to refund." });
  const caps = getPaymentAdapter().capabilities();
  if (!caps.refunds || (!caps.partialRefunds && input.amountMinor < payment.amountMinor)) throw new AppError("CAPABILITY_UNSUPPORTED", { message: "The payment provider does not support this refund." });
  const refund = await withTransaction(async (session) => {
    const r = await insertRefund(session, {
      order, payment, vendorOrderId: input.vendorOrderId, amountMinor: input.amountMinor, reason: input.reason,
      requestedBy: admin.userId, status: "requested", postLedger: true, system: false,
    });
    await writeAudit({ actorId: admin.userId, actorRole: admin.role, action: "refund.request", resourceType: "refund", resourceId: r._id.toHexString(), reason: input.reason, after: { amountMinor: input.amountMinor }, requestId }, session);
    return r;
  });
  return toRefundDto(refund);
}

export async function approveRefund(admin: Actor, id: ObjectId, requestId?: string) {
  const c = await getCollections();
  const r = await c.refunds.findOne({ _id: id });
  if (!r) throw new AppError("NOT_FOUND");
  refundMachine.assert(r.status, "approved");
  const threshold = getEnv().REFUND_MAKER_CHECKER_MINOR;
  // Maker-checker: large refunds need a second person.
  if (threshold > 0 && r.amountMinor >= threshold && r.requestedBy.equals(admin.userId)) {
    throw new AppError("FORBIDDEN", { message: "This refund needs approval from a different administrator.", details: [{ field: "approver", code: "MAKER_CHECKER" }] });
  }
  const now = new Date();
  const updated = await withTransaction(async (session) => {
    const u = await c.refunds.findOneAndUpdate(
      { _id: id, status: "requested", version: r.version },
      { $set: { status: "approved", decidedBy: admin.userId, updatedAt: now }, $inc: { version: 1 } },
      { session, returnDocument: "after" },
    );
    if (!u) throw new AppError("INVALID_STATE_TRANSITION");
    await writeAudit({ actorId: admin.userId, actorRole: admin.role, action: "refund.approve", resourceType: "refund", resourceId: id.toHexString(), requestId }, session);
    await enqueueExecution(id, session);
    return u;
  });
  const done = await executeRefund(id).catch(() => updated);
  return toRefundDto(done ?? updated);
}

export async function rejectRefund(admin: Actor, id: ObjectId, reason: string, requestId?: string) {
  const c = await getCollections();
  const r = await c.refunds.findOne({ _id: id });
  if (!r) throw new AppError("NOT_FOUND");
  refundMachine.assert(r.status, "rejected");
  const u = await c.refunds.findOneAndUpdate(
    { _id: id, status: "requested", version: r.version },
    { $set: { status: "rejected", decidedBy: admin.userId, decisionReason: reason, updatedAt: new Date() }, $inc: { version: 1 } },
    { returnDocument: "after" },
  );
  if (!u) throw new AppError("INVALID_STATE_TRANSITION");
  await writeAudit({ actorId: admin.userId, actorRole: admin.role, action: "refund.reject", resourceType: "refund", resourceId: id.toHexString(), reason, requestId });
  return toRefundDto(u);
}

export async function retryRefund(admin: Actor, id: ObjectId, requestId?: string) {
  const c = await getCollections();
  const r = await c.refunds.findOne({ _id: id });
  if (!r) throw new AppError("NOT_FOUND");
  refundMachine.assert(r.status, "approved");
  if (r.status !== "failed") throw new AppError("INVALID_STATE_TRANSITION", { message: "Only failed refunds can be retried." });
  const u = await c.refunds.findOneAndUpdate({ _id: id, status: "failed", version: r.version }, { $set: { status: "approved", updatedAt: new Date() }, $unset: { failureReason: "" }, $inc: { version: 1 } }, { returnDocument: "after" });
  if (!u) throw new AppError("INVALID_STATE_TRANSITION");
  await writeAudit({ actorId: admin.userId, actorRole: admin.role, action: "refund.retry", resourceType: "refund", resourceId: id.toHexString(), requestId });
  return toRefundDto((await executeRefund(id).catch(() => u)) ?? u);
}

export async function listRefunds(q: { status?: RefundStatus; orderId?: ObjectId; limit: number; cursor?: string }) {
  const c = await getCollections();
  const cur = decodeCursor<{ id: string }>(q.cursor);
  const filter: Filter<RefundDoc> = {};
  if (q.status) filter.status = q.status;
  if (q.orderId) filter.orderId = q.orderId;
  if (cur) filter._id = { $lt: new ObjectId(cur.id) };
  const rows = await c.refunds.find(filter).sort({ _id: -1 }).limit(q.limit + 1).toArray();
  const { items, hasMore } = slicePage(rows, q.limit);
  const last = items[items.length - 1];
  return { items: items.map(toRefundDto), nextCursor: hasMore && last ? encodeCursor({ id: last._id.toHexString() }) : null };
}

// ---------- execution ----------

/**
 * Claim and run an approved refund. The provider call happens outside any transaction and is idempotent by our
 * refund id. A timeout leaves the refund `processing`; the worker re-runs it (same reference) until it resolves.
 */
export async function executeRefund(id: ObjectId): Promise<RefundDoc | null> {
  const c = await getCollections();
  const now = new Date();
  const claimed = await c.refunds.findOneAndUpdate(
    { _id: id, $or: [{ status: "approved" }, { status: "processing", updatedAt: { $lte: new Date(now.getTime() - STALE_PROCESSING_MS) } }] },
    { $set: { status: "processing", updatedAt: now }, $inc: { version: 1 } },
    { returnDocument: "after" },
  );
  if (!claimed) return c.refunds.findOne({ _id: id }); // someone else is on it, or it is already settled

  const payment = await c.payments.findOne({ _id: claimed.paymentId });
  const adapter = getPaymentAdapter();
  if (!payment?.providerTransactionId || !adapter.refund || adapter.id !== payment.provider) {
    return failRefund(claimed, "provider cannot refund this payment");
  }
  try {
    const res = await adapter.refund({
      merchantRefundRef: claimed._id.toHexString(), merchantReference: payment.merchantReference, providerTransactionId: payment.providerTransactionId,
      amount: money(claimed.amountMinor, claimed.currency), reason: claimed.reason,
    });
    if (res.status === "failed") return failRefund(claimed, res.failureReason ?? "declined");
    if (res.status === "pending") return c.refunds.findOne({ _id: id }); // stays `processing`; the worker re-checks via the same reference
    return finalizeRefund(claimed, res.providerRefundId);
  } catch (e) {
    if (e instanceof ProviderError && e.kind === "provider_unavailable") {
      await c.refunds.updateOne({ _id: id, status: "processing" }, { $set: { status: "approved", updatedAt: new Date() } }); // safe: nothing was sent
      return c.refunds.findOne({ _id: id });
    }
    if (e instanceof ProviderError) return c.refunds.findOne({ _id: id }); // unknown_result: remain processing
    throw e;
  }
}

async function failRefund(r: RefundDoc, reason: string): Promise<RefundDoc | null> {
  const c = await getCollections();
  const u = await c.refunds.findOneAndUpdate(
    { _id: r._id, status: "processing" },
    { $set: { status: "failed", failureReason: reason.slice(0, 200), updatedAt: new Date() }, $inc: { version: 1 } },
    { returnDocument: "after" },
  );
  if (u) await writeAudit({ actorRole: "system", action: "refund.failed", resourceType: "refund", resourceId: r._id.toHexString(), reason });
  return u;
}

async function finalizeRefund(r: RefundDoc, providerRefundId?: string): Promise<RefundDoc | null> {
  const c = await getCollections();
  return withTransaction(async (session) => {
    const now = new Date();
    const done = await c.refunds.findOneAndUpdate(
      { _id: r._id, status: "processing" },
      { $set: { status: "succeeded", providerRefundId, updatedAt: now }, $inc: { version: 1 } },
      { session, returnDocument: "after" },
    );
    if (!done) return c.refunds.findOne({ _id: r._id }, { session }); // already finalised by a concurrent run
    const payment = await c.payments.findOneAndUpdate(
      { _id: r.paymentId, status: { $in: ["succeeded", "partially_refunded"] }, $expr: { $lte: [{ $add: ["$refundedMinor", r.amountMinor] }, "$amountMinor"] } },
      { $inc: { refundedMinor: r.amountMinor, version: 1 }, $set: { updatedAt: now } },
      { session, returnDocument: "after" },
    );
    if (!payment) throw new AppError("INTERNAL", { message: "Refund accounting mismatch." });
    const full = payment.refundedMinor === payment.amountMinor;
    await c.payments.updateOne({ _id: payment._id }, { $set: { status: full ? "refunded" : "partially_refunded" } }, { session });
    await c.orders.updateOne({ _id: r.orderId }, { $set: { paymentStatus: full ? "refunded" : "partially_refunded", updatedAt: now } }, { session });

    if (r.postLedger && r.vendorOrderId) {
      const vo = await c.vendorOrders.findOne({ _id: r.vendorOrderId }, { session });
      if (vo) {
        const before = await c.refunds.aggregate<{ t: number }>(
          [{ $match: { vendorOrderId: vo._id, status: "succeeded", _id: { $ne: r._id } } }, { $group: { _id: null, t: { $sum: "$amountMinor" } } }],
          { session },
        ).toArray();
        await postRefund({ refundId: r._id, vo, paymentId: payment._id, amountMinor: r.amountMinor, refundedBeforeMinor: before[0]?.t ?? 0 }, session);
      }
    }
    const order = await c.orders.findOne({ _id: r.orderId }, { session });
    if (order) {
      await enqueue(
        {
          type: "notify.user", aggregateType: "refund", aggregateId: r._id.toHexString(), dedupeKey: `refund-done:${r._id.toHexString()}`,
          payload: { userId: order.buyerId.toHexString(), eventType: "refund.completed", title: "Refund issued", body: `Order ${order.publicOrderNumber}: ৳${(r.amountMinor / 100).toFixed(2)} refunded.`, deepLink: `/orders/${order._id.toHexString()}` },
        },
        session,
      );
    }
    await writeAudit({ actorRole: "system", action: "refund.completed", resourceType: "refund", resourceId: r._id.toHexString(), after: { amountMinor: r.amountMinor } }, session);
    return done;
  });
}

/** Scheduled job: re-run refunds whose provider outcome is still unknown (idempotent by refund reference). */
export async function retryProcessingRefunds(now = new Date(), limit = 25): Promise<number> {
  const c = await getCollections();
  const rows = await c.refunds.find({ $or: [{ status: "approved" }, { status: "processing", updatedAt: { $lte: new Date(now.getTime() - STALE_PROCESSING_MS) } }] }).limit(limit).toArray();
  let n = 0;
  for (const r of rows) {
    const after = await executeRefund(r._id).catch(() => null);
    if (after && after.status !== r.status) n++;
  }
  return n;
}
