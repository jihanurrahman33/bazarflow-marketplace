import { defineStateMachine } from "@/server/shared/state-machine";

/**
 * Payment attempt lifecycle. Only verified provider evidence moves a payment to `succeeded`.
 * `failed`/`cancelled` -> `succeeded` exists on purpose: a late verified success means money was taken.
 */
export const paymentMachine = defineStateMachine({
  created: ["requires_action", "pending", "failed", "cancelled", "unknown", "succeeded"],
  requires_action: ["pending", "succeeded", "failed", "cancelled", "unknown"],
  pending: ["succeeded", "failed", "cancelled", "unknown"],
  unknown: ["pending", "succeeded", "failed", "cancelled"],
  failed: ["succeeded"],
  cancelled: ["succeeded"],
  succeeded: ["partially_refunded", "refunded"],
  partially_refunded: ["partially_refunded", "refunded"],
  refunded: [],
  refunding: ["refunded", "partially_refunded", "succeeded"],
} as const);

/** States in which a payment attempt may still turn into money. */
export const LIVE_PAYMENT_STATES = ["created", "requires_action", "pending", "unknown"] as const;
