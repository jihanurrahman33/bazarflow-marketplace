import type { FulfillmentStatus, OrderStatus } from "@/server/db/schema";
import { defineStateMachine } from "@/server/shared/state-machine";

/** Per-vendor fulfilment lifecycle. Independent from payment state. */
export const fulfillmentMachine = defineStateMachine({
  awaiting_payment: ["new", "cancelled"],
  new: ["accepted", "cancelled"],
  accepted: ["shipped", "cancelled"],
  shipped: ["delivered", "returned"],
  delivered: ["return_requested"],
  return_requested: ["returned", "delivered"],
  cancelled: [],
  returned: [],
} as const);

/** Parent order lifecycle. Everything after payment is derived from the vendor orders. */
export const orderMachine = defineStateMachine({
  pending_payment: ["confirmed", "cancelled"],
  confirmed: ["processing", "partially_fulfilled", "shipped", "delivered", "cancelled"],
  processing: ["confirmed", "partially_fulfilled", "shipped", "delivered", "cancelled"],
  partially_fulfilled: ["confirmed", "processing", "shipped", "delivered", "cancelled"],
  shipped: ["partially_fulfilled", "delivered", "cancelled"],
  delivered: ["closed", "shipped"],
  cancelled: [],
  closed: [],
} as const);

const DELIVERED_LIKE: FulfillmentStatus[] = ["delivered", "return_requested", "returned"];
const SHIPPED_LIKE: FulfillmentStatus[] = ["shipped", ...DELIVERED_LIKE];

/**
 * Parent status as a pure function of its vendor orders. Payment-driven states (pending_payment, cancelled
 * by the customer/expiry) are decided elsewhere and are never overridden here.
 */
export function deriveOrderStatus(current: OrderStatus, vendorOrders: { fulfillmentStatus: FulfillmentStatus }[]): OrderStatus {
  if (current === "pending_payment" || current === "cancelled" || current === "closed") return current;
  const active = vendorOrders.filter((v) => v.fulfillmentStatus !== "cancelled");
  if (active.length === 0) return "cancelled";
  if (active.every((v) => DELIVERED_LIKE.includes(v.fulfillmentStatus))) return "delivered";
  if (active.every((v) => SHIPPED_LIKE.includes(v.fulfillmentStatus))) return "shipped";
  if (active.some((v) => SHIPPED_LIKE.includes(v.fulfillmentStatus))) return "partially_fulfilled";
  if (active.some((v) => v.fulfillmentStatus === "accepted")) return "processing";
  return "confirmed";
}
