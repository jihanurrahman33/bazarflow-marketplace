import type { ObjectId } from "mongodb";
import { getEnv } from "@/server/config/env";
import { getCollections } from "@/server/db/collections";

/**
 * Cash on delivery means the seller ships before being paid, so the shop limits it where abuse is most likely: very large
 * orders, many unpaid orders at once, and shoppers whose earlier cash orders were refused at the door or sent back.
 * Online payment is never restricted by these rules.
 */
export type CodDecision = { ok: true } | { ok: false; code: "LIMIT" | "OPEN_ORDERS" | "HISTORY"; message: string };

const HISTORY_DAYS = 180;
const OPEN = ["new", "accepted", "shipped"] as const;

export async function codEligibility(userId: ObjectId, totalMinor: number): Promise<CodDecision> {
  const env = getEnv();
  if (totalMinor > env.COD_MAX_ORDER_MINOR) {
    return { ok: false, code: "LIMIT", message: `Cash on delivery is available for orders up to ৳${(env.COD_MAX_ORDER_MINOR / 100).toLocaleString("en-BD")}. Please pay online for this order.` };
  }
  const c = await getCollections();
  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000);
  const parents = await c.orders.find({ buyerId: userId, paymentMethod: "cod", createdAt: { $gte: since } }, { projection: { _id: 1 } }).toArray();
  if (parents.length === 0) return { ok: true };
  const ids = parents.map((p) => p._id);
  const [openRows, failed] = await Promise.all([
    c.vendorOrders.find({ parentOrderId: { $in: ids }, fulfillmentStatus: { $in: [...OPEN] } }, { projection: { parentOrderId: 1 } }).toArray(),
    // refused at the door (cancelled after it shipped) or sent back after delivery
    c.vendorOrders.distinct("parentOrderId", { parentOrderId: { $in: ids }, $or: [{ fulfillmentStatus: "returned" }, { fulfillmentStatus: "cancelled", "timeline.status": "shipped" }] }),
  ]);
  const open = new Set(openRows.map((v) => v.parentOrderId.toHexString())).size;
  if (failed.length >= env.COD_BLOCK_AFTER_FAILURES) {
    return { ok: false, code: "HISTORY", message: "Cash on delivery isn't available on your account right now because earlier cash orders were returned. Pay online to continue." };
  }
  if (open >= env.COD_MAX_OPEN_ORDERS) {
    return { ok: false, code: "OPEN_ORDERS", message: "You already have several cash-on-delivery orders on the way. Pay online for this one, or wait until they arrive." };
  }
  return { ok: true };
}
