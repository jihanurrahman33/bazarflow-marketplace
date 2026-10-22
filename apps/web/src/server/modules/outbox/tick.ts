import { processOutbox } from "./outbox";
import { outboxHandlers } from "./handlers";
import { expireUnpaidOrders } from "@/server/modules/orders/service";
import { reconcileStuckPayments } from "@/server/modules/payments/service";
import { retryProcessingRefunds } from "@/server/modules/payments/refunds";

export interface TickResult { expiredOrders: number; reconciledPayments: number; refundRetries: number; outboxProcessed: number; ms: number }

/**
 * One pass of background work: time-based jobs, then the outbox (notifications, emails, payment follow-ups) until it is
 * empty or the time budget runs out. Every job is idempotent, so overlapping callers (cron, a worker process) are safe.
 * Used by scripts/worker.ts and by the scheduled HTTP endpoint, so serverless hosting needs no always-on process.
 */
export async function runWorkerTick(budgetMs = 45_000): Promise<TickResult> {
  const started = Date.now();
  const expiredOrders = (await expireUnpaidOrders()) ?? 0;
  const reconciledPayments = (await reconcileStuckPayments()) ?? 0;
  const refundRetries = (await retryProcessingRefunds()) ?? 0;
  let outboxProcessed = 0;
  while (Date.now() - started < budgetMs) {
    const n = await processOutbox(outboxHandlers);
    outboxProcessed += n;
    if (n === 0) break;
  }
  return { expiredOrders, reconciledPayments, refundRetries, outboxProcessed, ms: Date.now() - started };
}
