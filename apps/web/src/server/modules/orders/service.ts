import { ObjectId, type ClientSession } from "mongodb";
import { releaseCouponForOrder } from "@/server/modules/coupons/service";
import { getCollections } from "@/server/db/collections";
import { withTransaction } from "@/server/db/transaction";
import type { OrderDoc } from "@/server/db/schema";
import { AppError } from "@/server/shared/errors";
import { decodeCursor, encodeCursor, slicePage } from "@/server/shared/pagination";
import { enqueue } from "@/server/modules/outbox/outbox";
import { restock, settleReservation } from "@/server/modules/inventory/service";
import type { Actor } from "@/server/modules/authorization/actor";
import { toOrderDto } from "./dto";
import { fulfillmentMachine, orderMachine } from "./state";

export async function listOrders(buyerId: ObjectId, q: { limit: number; cursor?: string }) {
  const c = await getCollections();
  const cur = decodeCursor<{ id: string }>(q.cursor);
  const rows = await c.orders
    .find({ buyerId, ...(cur ? { _id: { $lt: new ObjectId(cur.id) } } : {}) })
    .sort({ _id: -1 })
    .limit(q.limit + 1)
    .toArray();
  const { items, hasMore } = slicePage(rows, q.limit);
  const last = items[items.length - 1];
  return { items: items.map((o) => toOrderDto(o)), nextCursor: hasMore && last ? encodeCursor({ id: last._id.toHexString() }) : null };
}

/** Ownership is part of the query: another customer's order id is indistinguishable from a missing one. */
export async function getOrder(buyerId: ObjectId, orderId: ObjectId) {
  const c = await getCollections();
  const order = await c.orders.findOne({ _id: orderId, buyerId });
  if (!order) throw new AppError("NOT_FOUND");
  const vendorOrders = await c.vendorOrders.find({ parentOrderId: orderId }).toArray();
  return toOrderDto(order, vendorOrders);
}

/**
 * Cancel an order that never got paid: the CAS on `pending_payment` makes this safe against a concurrent
 * payment confirmation (whichever transition wins, the other becomes a no-op), then the reservation is released.
 * Returns false when the order had already moved on.
 */
export async function cancelUnpaidOrder(session: ClientSession, orderId: ObjectId, reason: string): Promise<boolean> {
  const c = await getCollections();
  const now = new Date();
  orderMachine.assert("pending_payment", "cancelled");
  const order = await c.orders.findOneAndUpdate(
    { _id: orderId, status: "pending_payment" },
    { $set: { status: "cancelled", paymentStatus: "failed", cancellationReason: reason, updatedAt: now }, $inc: { version: 1 } },
    { session, returnDocument: "after" },
  );
  if (!order) return false;
  await c.vendorOrders.updateMany(
    { parentOrderId: orderId, fulfillmentStatus: "awaiting_payment" },
    { $set: { fulfillmentStatus: "cancelled", updatedAt: now }, $push: { timeline: { status: "cancelled", at: now, note: reason } }, $inc: { version: 1 } },
    { session },
  );
  await c.payments.updateMany(
    { orderId, status: { $in: ["created", "requires_action", "pending"] } },
    { $set: { status: "cancelled", failureReason: reason, updatedAt: now }, $inc: { version: 1 } },
    { session },
  );
  await settleReservation(session, orderId, "release");
  await releaseCouponForOrder(session, orderId);
  await enqueue(
    {
      type: "notify.user", aggregateType: "order", aggregateId: orderId.toHexString(), dedupeKey: `order-cancelled:${orderId.toHexString()}`,
      payload: { userId: order.buyerId.toHexString(), eventType: "order.cancelled", title: `Order ${order.publicOrderNumber} cancelled`, body: reason === "payment_expired" ? "Payment was not completed in time." : "Your order was cancelled.", deepLink: `/orders/${orderId.toHexString()}` },
    },
    session,
  );
  return true;
}

/** Customer-initiated cancel. Allowed before any vendor starts work; paid online orders need the refund flow. */
export async function cancelOrder(actor: Actor, orderId: ObjectId, reason: string) {
  const c = await getCollections();
  const order = await c.orders.findOne({ _id: orderId, buyerId: actor.userId });
  if (!order) throw new AppError("NOT_FOUND");
  if (order.status === "cancelled") return getOrder(actor.userId, orderId);

  if (order.status === "pending_payment") {
    const done = await withTransaction((s) => cancelUnpaidOrder(s, orderId, "cancelled_by_customer"));
    if (!done) throw new AppError("CONFLICT", { message: "The order changed while cancelling. Reload and retry." });
    return getOrder(actor.userId, orderId);
  }

  const vendorOrders = await c.vendorOrders.find({ parentOrderId: orderId }).toArray();
  if (!vendorOrders.every((v) => v.fulfillmentStatus === "new")) {
    throw new AppError("BUSINESS_RULE_VIOLATION", { message: "A seller has already started this order. Request a return after delivery instead." });
  }
  if (order.paymentMethod === "cod") {
    await withTransaction((s) => cancelConfirmedOrder(s, order, "cancelled_by_customer", reason, actor.userId));
    return getOrder(actor.userId, orderId);
  }
  // Paid online orders: money must be returned — handled by the payments module (wired in the payments phase).
  const { cancelPaidOrderWithRefund } = await import("@/server/modules/payments/refunds");
  await cancelPaidOrderWithRefund(actor, order, reason);
  return getOrder(actor.userId, orderId);
}

/**
 * Cancel a confirmed order whose vendor orders are all still `new` (no work started):
 * flips every vendor order, returns the committed stock, and marks the parent cancelled.
 * Callers that owe money back (paid online orders) create the refund in the same transaction.
 */
export async function cancelConfirmedOrder(session: ClientSession, order: OrderDoc, systemReason: string, note: string, actorId: ObjectId): Promise<void> {
  const c = await getCollections();
  const now = new Date();
  const updated = await c.orders.findOneAndUpdate(
    { _id: order._id, status: "confirmed", version: order.version },
    { $set: { status: "cancelled", cancellationReason: systemReason, updatedAt: now, ...(order.paymentMethod === "cod" ? { paymentStatus: "none" as const } : {}) }, $inc: { version: 1 } },
    { session, returnDocument: "after" },
  );
  if (!updated) throw new AppError("CONFLICT", { message: "The order changed while cancelling. Reload and retry." });
  const vendorOrders = await c.vendorOrders.find({ parentOrderId: order._id }, { session }).toArray();
  for (const vo of vendorOrders) {
    fulfillmentMachine.assert(vo.fulfillmentStatus, "cancelled");
    const res = await c.vendorOrders.updateOne(
      { _id: vo._id, fulfillmentStatus: "new", version: vo.version },
      { $set: { fulfillmentStatus: "cancelled", updatedAt: now }, $push: { timeline: { status: "cancelled", at: now, actorId, note } }, $inc: { version: 1 } },
      { session },
    );
    if (res.modifiedCount !== 1) throw new AppError("CONFLICT", { message: "A seller accepted the order at the same moment." });
    for (const item of vo.items) {
      const inv = await c.inventoryItems.findOne({ productId: item.productId, variantId: item.variantId }, { session });
      if (inv) await restock(session, inv._id, item.quantity, "order cancelled", order._id);
    }
  }
  await releaseCouponForOrder(session, order._id);
  await enqueue(
    {
      type: "notify.user", aggregateType: "order", aggregateId: order._id.toHexString(), dedupeKey: `order-cancelled:${order._id.toHexString()}`,
      payload: { userId: order.buyerId.toHexString(), eventType: "order.cancelled", title: `Order ${order.publicOrderNumber} cancelled`, body: "Your order was cancelled.", deepLink: `/orders/${order._id.toHexString()}` },
    },
    session,
  );
}

/** Scheduled job: cancel unpaid orders whose stock reservation has lapsed, then release the stock. */
export async function expireUnpaidOrders(now = new Date(), batch = 100): Promise<number> {
  const c = await getCollections();
  const due = await c.stockReservations.find({ status: "active", expiresAt: { $lte: now } }).limit(batch).toArray();
  let cancelled = 0;
  for (const r of due) {
    const done = await withTransaction((s) => cancelUnpaidOrder(s, r.orderId, "payment_expired"));
    if (done) cancelled++;
  }
  return cancelled;
}
