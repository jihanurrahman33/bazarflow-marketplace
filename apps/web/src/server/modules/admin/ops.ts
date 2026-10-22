import { ObjectId, type Filter } from "mongodb";
import { getCollections } from "@/server/db/collections";
import type { OrderDoc, OrderStatus } from "@/server/db/schema";
import { AppError } from "@/server/shared/errors";
import { decodeCursor, encodeCursor, slicePage } from "@/server/shared/pagination";
import { toRefundDto } from "@/server/modules/payments/refunds";
import { toPaymentView } from "@/server/modules/payments/service";

const toAdminOrder = (o: OrderDoc) => ({
  id: o._id.toHexString(), orderNumber: o.publicOrderNumber, buyerId: o.buyerId.toHexString(), status: o.status, paymentStatus: o.paymentStatus,
  paymentMethod: o.paymentMethod, totals: o.totals, createdAt: o.createdAt.toISOString(), updatedAt: o.updatedAt.toISOString(),
});

export async function searchOrders(q: { orderNumber?: string; buyerEmail?: string; status?: OrderStatus; limit: number; cursor?: string }) {
  const c = await getCollections();
  const filter: Filter<OrderDoc> = {};
  if (q.orderNumber) filter.publicOrderNumber = q.orderNumber.toUpperCase(); // exact match only: no regex scans
  if (q.status) filter.status = q.status;
  if (q.buyerEmail) {
    const u = await c.users.findOne({ emailNormalized: q.buyerEmail.trim().toLowerCase() }, { projection: { _id: 1 } });
    if (!u) return { items: [], nextCursor: null };
    filter.buyerId = u._id;
  }
  const cur = decodeCursor<{ id: string }>(q.cursor);
  if (cur) filter._id = { $lt: new ObjectId(cur.id) };
  const rows = await c.orders.find(filter).sort({ _id: -1 }).limit(q.limit + 1).toArray();
  const { items, hasMore } = slicePage(rows, q.limit);
  const last = items[items.length - 1];
  return { items: items.map(toAdminOrder), nextCursor: hasMore && last ? encodeCursor({ id: last._id.toHexString() }) : null };
}

/** Full support view: both sides of the money (commission included), payments and refunds. */
export async function getOrderForSupport(id: ObjectId) {
  const c = await getCollections();
  const order = await c.orders.findOne({ _id: id });
  if (!order) throw new AppError("NOT_FOUND");
  const [vos, payments, refunds, buyer] = await Promise.all([
    c.vendorOrders.find({ parentOrderId: id }).toArray(),
    c.payments.find({ orderId: id }).sort({ createdAt: 1 }).toArray(),
    c.refunds.find({ orderId: id }).sort({ createdAt: 1 }).toArray(),
    c.users.findOne({ _id: order.buyerId }, { projection: { name: 1, email: 1, phone: 1 } }),
  ]);
  return {
    ...toAdminOrder(order),
    buyer: buyer ? { name: buyer.name, email: buyer.email, phone: buyer.phone } : undefined,
    shippingAddress: order.shippingAddress,
    vendorOrders: vos.map((v) => ({
      id: v._id.toHexString(), vendorId: v.vendorId.toHexString(), vendorName: v.vendorName, status: v.fulfillmentStatus, totals: v.totals, commission: v.commission,
      items: v.items.map((i) => ({ title: i.title, sku: i.sku, quantity: i.quantity, unitPriceMinor: i.unitPriceMinor })), shipment: v.shipment, timeline: v.timeline,
    })),
    payments: payments.map((p) => ({ ...toPaymentView(p), merchantReference: p.merchantReference, refundedMinor: p.refundedMinor, failureReason: p.failureReason })),
    refunds: refunds.map(toRefundDto),
  };
}

const MAX_REPORT_DAYS = 92;

/** Bounded sales summary: result size and time range are capped so reporting can't become a scan-the-world query. */
export async function salesSummary(from: Date, to: Date) {
  if (to <= from || (to.getTime() - from.getTime()) / 86_400_000 > MAX_REPORT_DAYS) {
    throw new AppError("VALIDATION_FAILED", { details: [{ field: "range", code: `MAX_${MAX_REPORT_DAYS}_DAYS` }] });
  }
  const c = await getCollections();
  const paid = ["confirmed", "processing", "partially_fulfilled", "shipped", "delivered", "closed"];
  const [orders, vendorOrders, refunds] = await Promise.all([
    c.orders.aggregate<{ _id: string; n: number; gmv: number }>([
      { $match: { createdAt: { $gte: from, $lt: to } } },
      { $group: { _id: "$status", n: { $sum: 1 }, gmv: { $sum: "$totals.totalMinor" } } },
    ]).toArray(),
    c.vendorOrders.aggregate<{ _id: null; commission: number; sellerNet: number }>([
      { $match: { createdAt: { $gte: from, $lt: to }, fulfillmentStatus: { $nin: ["awaiting_payment", "cancelled"] } } },
      { $group: { _id: null, commission: { $sum: "$commission.amountMinor" }, sellerNet: { $sum: "$commission.vendorNetMinor" } } },
    ]).toArray(),
    c.refunds.aggregate<{ _id: null; n: number; total: number }>([
      { $match: { createdAt: { $gte: from, $lt: to }, status: "succeeded" } },
      { $group: { _id: null, n: { $sum: 1 }, total: { $sum: "$amountMinor" } } },
    ]).toArray(),
  ]);
  const byStatus = Object.fromEntries(orders.map((o) => [o._id, { orders: o.n, totalMinor: o.gmv }]));
  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    byStatus,
    paidOrders: orders.filter((o) => paid.includes(o._id)).reduce((a, o) => a + o.n, 0),
    grossMerchandiseMinor: orders.filter((o) => paid.includes(o._id)).reduce((a, o) => a + o.gmv, 0),
    platformCommissionMinor: vendorOrders[0]?.commission ?? 0,
    sellerNetMinor: vendorOrders[0]?.sellerNet ?? 0,
    refunds: { count: refunds[0]?.n ?? 0, totalMinor: refunds[0]?.total ?? 0 },
  };
}
