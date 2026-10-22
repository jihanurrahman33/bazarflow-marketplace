import { getEnv } from "@/server/config/env";
import { getCollections } from "@/server/db/collections";
import { LIVE_PAYMENT_STATES } from "@/server/modules/payments/state";

/**
 * Operational signals for alerting (docs/13 §1). Everything here is a cheap indexed count; wire the numbers to
 * alert thresholds: oldestPendingAgeSeconds, dead, unknownPayments, stuckLivePayments, expiredReservations.
 */
export async function opsHealth(now = new Date()) {
  const c = await getCollections();
  const env = getEnv();
  const stuckBefore = new Date(now.getTime() - env.PAYMENT_RECONCILE_AFTER_MINUTES * 60_000);
  const [pending, dead, oldest, unknown, stuck, expired, refundsProcessing, refundsFailed, payoutsRequested, payoutsApproved] = await Promise.all([
    c.outboxEvents.countDocuments({ state: { $in: ["pending", "processing"] } }),
    c.outboxEvents.countDocuments({ state: "dead" }),
    c.outboxEvents.find({ state: "pending" }).sort({ nextAttemptAt: 1 }).limit(1).next(),
    c.payments.countDocuments({ status: "unknown" }),
    c.payments.countDocuments({ status: { $in: [...LIVE_PAYMENT_STATES] }, updatedAt: { $lte: stuckBefore } }),
    c.stockReservations.countDocuments({ status: "active", expiresAt: { $lte: now } }),
    c.refunds.countDocuments({ status: "processing" }),
    c.refunds.countDocuments({ status: "failed" }),
    c.payouts.countDocuments({ status: "requested" }),
    c.payouts.countDocuments({ status: "approved" }),
  ]);
  return {
    at: now.toISOString(),
    outbox: { pending, dead, oldestPendingAgeSeconds: oldest ? Math.max(0, Math.round((now.getTime() - oldest.nextAttemptAt.getTime()) / 1000)) : 0 },
    payments: { unknown, stuckLive: stuck },
    reservations: { expiredActive: expired },
    refunds: { processing: refundsProcessing, failed: refundsFailed },
    payouts: { requested: payoutsRequested, approved: payoutsApproved },
  };
}
