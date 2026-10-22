import { ObjectId, type ClientSession, type Filter } from "mongodb";
import { getEnv } from "@/server/config/env";
import { getCollections } from "@/server/db/collections";
import { withTransaction } from "@/server/db/transaction";
import type { FulfillmentStatus, OrderDoc, VendorOrderDoc } from "@/server/db/schema";
import { AppError } from "@/server/shared/errors";
import { decodeCursor, encodeCursor, slicePage } from "@/server/shared/pagination";
import { writeAudit } from "@/server/modules/audit/audit";
import { enqueue } from "@/server/modules/outbox/outbox";
import type { Actor } from "@/server/modules/authorization/actor";
import { restock } from "@/server/modules/inventory/service";
import { postCodCommission, postEntry, releaseSaleEntries } from "@/server/modules/ledger/service";
import { createVendorOrderRefund, executeRefund } from "@/server/modules/payments/refunds";
import { requireActiveVendor } from "@/server/modules/vendors/service";
import { getCourierAdapter } from "@/server/modules/couriers/registry";
import { logger } from "@/server/shared/logger";
import { deriveOrderStatus, fulfillmentMachine } from "./state";

// ---------- vendor view ----------

export const toVendorOrderDto = (v: VendorOrderDoc, order?: Pick<OrderDoc, "paymentMethod" | "paymentStatus" | "buyerId">) => ({
  id: v._id.toHexString(), orderId: v.parentOrderId.toHexString(), orderNumber: v.publicOrderNumber, status: v.fulfillmentStatus,
  paymentMethod: order?.paymentMethod, paymentStatus: order?.paymentStatus,
  /** Cash the courier/vendor must collect (COD only). */
  collectOnDeliveryMinor: order?.paymentMethod === "cod" ? v.totals.totalMinor : 0,
  items: v.items.map((i) => ({ productId: i.productId.toHexString(), variantId: i.variantId, sku: i.sku, title: i.title, variantLabel: i.variantLabel, imageUrl: i.imageUrl, unitPriceMinor: i.unitPriceMinor, quantity: i.quantity, lineTotalMinor: i.lineTotalMinor })),
  totals: v.totals,
  commission: { bps: v.commission.bps, amountMinor: v.commission.amountMinor, vendorNetMinor: v.commission.vendorNetMinor },
  // Only what is needed to deliver: no buyer account details.
  shippingAddress: v.shippingAddress,
  shipment: v.shipment ? { carrier: v.shipment.carrier, trackingNumber: v.shipment.trackingNumber, shippedAt: v.shipment.shippedAt.toISOString() } : undefined,
  deliveredAt: v.deliveredAt?.toISOString(),
  timeline: v.timeline.map((t) => ({ status: t.status, at: t.at.toISOString(), note: t.note })),
  createdAt: v.createdAt.toISOString(),
});

export async function listVendorOrders(vendorId: ObjectId, q: { status?: FulfillmentStatus; limit: number; cursor?: string }) {
  const c = await getCollections();
  const cur = decodeCursor<{ id: string }>(q.cursor);
  const filter: Filter<VendorOrderDoc> = { vendorId };
  // The queue never shows unpaid orders: a seller must not act before payment is confirmed.
  filter.fulfillmentStatus = q.status ?? { $ne: "awaiting_payment" };
  if (q.status === "awaiting_payment") filter.fulfillmentStatus = { $in: [] };
  if (cur) filter._id = { $lt: new ObjectId(cur.id) };
  const rows = await c.vendorOrders.find(filter).sort({ _id: -1 }).limit(q.limit + 1).toArray();
  const { items, hasMore } = slicePage(rows, q.limit);
  const parents = await c.orders.find({ _id: { $in: items.map((i) => i.parentOrderId) } }, { projection: { paymentMethod: 1, paymentStatus: 1, buyerId: 1 } }).toArray();
  const pmap = new Map(parents.map((p) => [p._id.toHexString(), p]));
  const last = items[items.length - 1];
  return { items: items.map((v) => toVendorOrderDto(v, pmap.get(v.parentOrderId.toHexString()))), nextCursor: hasMore && last ? encodeCursor({ id: last._id.toHexString() }) : null };
}

export async function getVendorOrder(vendorId: ObjectId, id: ObjectId) {
  const c = await getCollections();
  const vo = await c.vendorOrders.findOne({ _id: id, vendorId, fulfillmentStatus: { $ne: "awaiting_payment" } });
  if (!vo) throw new AppError("NOT_FOUND");
  const parent = await c.orders.findOne({ _id: vo.parentOrderId }, { projection: { paymentMethod: 1, paymentStatus: 1, buyerId: 1 } });
  return toVendorOrderDto(vo, parent ?? undefined);
}

// ---------- transitions ----------

type Scope = { kind: "vendor"; userId: ObjectId; vendorId: ObjectId } | { kind: "admin"; actor: Actor } | { kind: "buyer"; userId: ObjectId };

const actorIdOf = (s: Scope): ObjectId => (s.kind === "admin" ? s.actor.userId : s.userId);

/** Re-derive the parent order's status from its vendor orders (CAS on the previous status). */
async function syncParent(session: ClientSession, orderId: ObjectId): Promise<OrderDoc> {
  const c = await getCollections();
  const order = await c.orders.findOne({ _id: orderId }, { session });
  if (!order) throw new AppError("INTERNAL");
  const vos = await c.vendorOrders.find({ parentOrderId: orderId }, { session }).toArray();
  const next = deriveOrderStatus(order.status, vos);
  if (next === order.status) return order;
  const set: Partial<OrderDoc> = { status: next, updatedAt: new Date() };
  if (next === "delivered" && order.paymentMethod === "cod") set.paymentStatus = "paid"; // cash collected on delivery
  if (next === "cancelled" && order.paymentMethod === "cod") set.paymentStatus = "none";
  const res = await c.orders.findOneAndUpdate({ _id: orderId, status: order.status }, { $set: set, $inc: { version: 1 } }, { session, returnDocument: "after" });
  return res ?? order;
}

function notifyBuyer(session: ClientSession, order: OrderDoc, vo: VendorOrderDoc, eventType: string, title: string, body: string) {
  return enqueue(
    {
      type: "notify.user", aggregateType: "vendor_order", aggregateId: vo._id.toHexString(), dedupeKey: `${eventType}:${vo._id.toHexString()}`,
      payload: { userId: order.buyerId.toHexString(), eventType, title, body, deepLink: `/orders/${order._id.toHexString()}` },
    },
    session,
  );
}

export interface TransitionInput {
  to: FulfillmentStatus;
  note?: string;
  shipment?: { carrier: string; trackingNumber: string };
}

/**
 * The single place a vendor order changes state. Guarded by (1) scope/ownership in the lookup, (2) the transition
 * table, (3) a compare-and-set on status+version, so concurrent or replayed requests apply at most once.
 */
export async function transitionVendorOrder(scope: Scope, id: ObjectId, input: TransitionInput, requestId?: string) {
  const c = await getCollections();
  const filter: Filter<VendorOrderDoc> = { _id: id };
  if (scope.kind === "vendor") filter.vendorId = scope.vendorId;
  if (scope.kind === "buyer") filter.buyerId = scope.userId;
  const vo = await c.vendorOrders.findOne(filter);
  if (!vo) throw new AppError("NOT_FOUND");
  fulfillmentMachine.assert(vo.fulfillmentStatus, input.to);

  // A suspended vendor may not take on or advance work; cancelling stays possible so customers are not stranded.
  if (scope.kind === "vendor" && input.to !== "cancelled") await requireActiveVendor(scope.vendorId);

  let refundIds: ObjectId[] = [];
  const now = new Date();
  const updated = await withTransaction(async (session) => {
    const set: Partial<VendorOrderDoc> = { fulfillmentStatus: input.to, updatedAt: now };
    if (input.to === "shipped" && input.shipment) set.shipment = { ...input.shipment, shippedAt: now };
    if (input.to === "delivered" && !vo.deliveredAt) set.deliveredAt = now; // a rejected return must not restart the return window
    const next = await c.vendorOrders.findOneAndUpdate(
      { _id: vo._id, fulfillmentStatus: vo.fulfillmentStatus, version: vo.version },
      { $set: set, $push: { timeline: { status: input.to, at: now, actorId: actorIdOf(scope), note: input.note } }, $inc: { version: 1 } },
      { session, returnDocument: "after" },
    );
    if (!next) throw new AppError("INVALID_STATE_TRANSITION", { message: "This order was changed by someone else. Reload and try again." });

    const parentBefore = await c.orders.findOne({ _id: vo.parentOrderId }, { session });
    if (!parentBefore) throw new AppError("INTERNAL");

    if (input.to === "cancelled") {
      // Goods go back on the shelf (stock was committed at confirmation) ...
      for (const item of vo.items) {
        const inv = await c.inventoryItems.findOne({ productId: item.productId, variantId: item.variantId }, { session });
        if (inv) await restock(session, inv._id, item.quantity, "seller order cancelled", vo.parentOrderId);
      }
      // ... and an online payment is refunded for this seller's share.
      const rid = await createVendorOrderRefund(session, { order: parentBefore, vendorOrderId: vo._id, amountMinor: vo.totals.totalMinor, reason: input.note ?? "seller order cancelled", requestedBy: actorIdOf(scope), status: "approved", system: true });
      if (rid) refundIds = [rid];
    }
    if (input.to === "delivered") {
      if (parentBefore.paymentMethod === "online") await releaseSaleEntries(vo._id, now, session);
      else await postCodCommission(next, now, session);
    }
    if (input.to === "returned" && parentBefore.paymentMethod === "cod") {
      // The vendor owed commission on a sale that was undone: give it back.
      await postEntry({ vendorId: vo.vendorId, currency: vo.currency, orderId: vo.parentOrderId, vendorOrderId: vo._id, type: "reversal", amountMinor: vo.commission.amountMinor, idempotencyReference: `cod-return:${vo._id.toHexString()}`, availableAt: now }, session);
    }

    const parent = await syncParent(session, vo.parentOrderId);
    const copy: Partial<Record<FulfillmentStatus, [string, string, string]>> = {
      accepted: ["order.accepted", "Seller accepted your order", `${vo.vendorName} is preparing your items.`],
      shipped: ["order.shipped", "Your order has shipped", `${vo.vendorName}${input.shipment ? ` · ${input.shipment.carrier} ${input.shipment.trackingNumber}` : ""}`],
      delivered: ["order.delivered", "Your order was delivered", `Order ${vo.publicOrderNumber} from ${vo.vendorName}.`],
      cancelled: ["order.vendor_cancelled", "A seller cancelled part of your order", input.note ?? `${vo.vendorName} could not fulfil your items.`],
      returned: ["order.returned", "Return completed", `Order ${vo.publicOrderNumber} from ${vo.vendorName}.`],
    };
    const c2 = copy[input.to];
    if (c2) await notifyBuyer(session, parent, next, c2[0], c2[1], c2[2]);
    await writeAudit({ actorId: actorIdOf(scope), actorRole: scope.kind === "admin" ? "admin" : scope.kind === "vendor" ? "vendor" : "customer", action: `vendor_order.${input.to}`, resourceType: "vendor_order", resourceId: vo._id.toHexString(), reason: input.note, requestId }, session);
    return next;
  });

  for (const rid of refundIds) await executeRefund(rid).catch((e) => logger.warn("refund deferred to worker", { code: e instanceof Error ? e.name : "unknown" }));
  return updated;
}

// ---------- returns ----------

export async function requestReturn(buyerId: ObjectId, vendorOrderId: ObjectId, reason: string, requestId?: string) {
  const c = await getCollections();
  const vo = await c.vendorOrders.findOne({ _id: vendorOrderId, buyerId });
  if (!vo) throw new AppError("NOT_FOUND");
  if (vo.fulfillmentStatus !== "delivered" || !vo.deliveredAt) throw new AppError("BUSINESS_RULE_VIOLATION", { message: "Only delivered orders can be returned." });
  const windowMs = getEnv().RETURN_WINDOW_DAYS * 86_400_000;
  if (Date.now() - vo.deliveredAt.getTime() > windowMs) {
    throw new AppError("BUSINESS_RULE_VIOLATION", { message: "The return window for this order has closed.", details: [{ field: "vendorOrderId", code: "RETURN_WINDOW_CLOSED" }] });
  }
  const next = await transitionVendorOrder({ kind: "buyer", userId: buyerId }, vendorOrderId, { to: "return_requested", note: reason }, requestId);
  const vendor = await c.vendors.findOne({ _id: vo.vendorId }, { projection: { ownerUserId: 1 } });
  if (vendor) {
    await enqueue({
      type: "notify.user", aggregateType: "vendor_order", aggregateId: vo._id.toHexString(), dedupeKey: `return-requested:${vo._id.toHexString()}`,
      payload: { userId: vendor.ownerUserId.toHexString(), eventType: "vendor_order.return_requested", title: "Return requested", body: reason.slice(0, 120), deepLink: `/vendor/orders/${vo._id.toHexString()}` },
    });
  }
  return next;
}

/** Vendor accepts the return: order becomes `returned` and (online) a refund request goes to finance for approval. */
export async function approveReturn(scope: Extract<Scope, { kind: "vendor" | "admin" }>, vendorOrderId: ObjectId, requestId?: string) {
  const c = await getCollections();
  const vo = await c.vendorOrders.findOne({ _id: vendorOrderId, ...(scope.kind === "vendor" ? { vendorId: scope.vendorId } : {}) });
  if (!vo) throw new AppError("NOT_FOUND");
  const next = await transitionVendorOrder(scope, vendorOrderId, { to: "returned", note: "return accepted" }, requestId);
  const parent = await c.orders.findOne({ _id: vo.parentOrderId });
  if (parent && parent.paymentMethod === "online") {
    await withTransaction(async (session) => {
      await createVendorOrderRefund(session, { order: parent, vendorOrderId: vo._id, amountMinor: vo.totals.totalMinor, reason: "return accepted", requestedBy: parent.buyerId, status: "requested", system: false });
    });
  }
  return next;
}

export async function rejectReturn(scope: Extract<Scope, { kind: "vendor" | "admin" }>, vendorOrderId: ObjectId, reason: string, requestId?: string) {
  return transitionVendorOrder(scope, vendorOrderId, { to: "delivered", note: `return rejected: ${reason}` }, requestId);
}

export async function dispatchWithCourier(
  scope: Scope,
  vendorOrderId: ObjectId,
  input: { carrier?: string; weightGrams?: number } = {},
  requestId?: string,
) {
  const c = await getCollections();
  const filter: Filter<VendorOrderDoc> = { _id: vendorOrderId };
  if (scope.kind === "vendor") filter.vendorId = scope.vendorId;
  const vo = await c.vendorOrders.findOne(filter);
  if (!vo) throw new AppError("NOT_FOUND");
  if (vo.fulfillmentStatus !== "accepted" && vo.fulfillmentStatus !== "new") {
    throw new AppError("INVALID_STATE_TRANSITION", { message: `Cannot dispatch order in ${vo.fulfillmentStatus} status.` });
  }

  if (vo.fulfillmentStatus === "new") {
    await transitionVendorOrder(scope, vo._id, { to: "accepted" }, requestId);
  }

  const parent = await c.orders.findOne({ _id: vo.parentOrderId });
  if (!parent) throw new AppError("INTERNAL");

  const courier = getCourierAdapter(input.carrier ?? "redx");

  const parcel = await courier.createParcel({
    orderNumber: vo.publicOrderNumber,
    recipient: {
      recipient: vo.shippingAddress.recipient,
      phone: vo.shippingAddress.phone,
      line1: vo.shippingAddress.line1,
      line2: vo.shippingAddress.line2,
      city: vo.shippingAddress.city,
      district: vo.shippingAddress.district,
      postalCode: vo.shippingAddress.postalCode,
    },
    items: vo.items.map((i) => ({ title: i.title, quantity: i.quantity })),
    amountToCollectMinor: parent.paymentMethod === "cod" ? vo.totals.totalMinor : 0,
    declaredValueMinor: vo.totals.totalMinor,
    weightGrams: input.weightGrams ?? 500,
  });

  return transitionVendorOrder(
    scope,
    vo._id,
    {
      to: "shipped",
      shipment: {
        carrier: parcel.carrier,
        trackingNumber: parcel.trackingId,
      },
      note: `Dispatched via ${parcel.carrier} (${parcel.trackingId})`,
    },
    requestId,
  );
}

export async function getShipmentTracking(carrier: string, trackingNumber: string) {
  const courier = getCourierAdapter(carrier);
  return courier.trackParcel(trackingNumber);
}
