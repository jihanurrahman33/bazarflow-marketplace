import type { ClientSession } from "mongodb";
import { getCollections } from "@/server/db/collections";
import { newId } from "@/server/shared/ids";
import { logger } from "@/server/shared/logger";
import type { OutboxEventDoc } from "@/server/db/schema";

export interface EnqueueInput {
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  /** Unique per business transition: enqueueing twice is a no-op. */
  dedupeKey: string;
  delayMs?: number;
}

/** Write inside the same transaction as the state change so the event cannot be lost between commit and publish. */
export async function enqueue(input: EnqueueInput, session?: ClientSession): Promise<void> {
  const c = await getCollections();
  const now = new Date();
  await c.outboxEvents.updateOne(
    { dedupeKey: input.dedupeKey },
    {
      $setOnInsert: {
        _id: newId(),
        type: input.type,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        payload: input.payload,
        dedupeKey: input.dedupeKey,
        state: "pending",
        attempts: 0,
        nextAttemptAt: new Date(now.getTime() + (input.delayMs ?? 0)),
        createdAt: now,
      },
    },
    { upsert: true, session },
  );
}

export type OutboxHandler = (event: OutboxEventDoc) => Promise<void>;
export class TerminalOutboxError extends Error {}

const MAX_ATTEMPTS = 8;
const LEASE_MS = 60_000;

export function backoffMs(attempt: number, rand: () => number = Math.random): number {
  const base = Math.min(15 * 60_000, 2_000 * 2 ** attempt);
  return Math.round(base / 2 + rand() * (base / 2)); // equal jitter
}

/** Claim and process due events. Handlers must be idempotent: delivery is at-least-once. */
export async function processOutbox(handlers: Record<string, OutboxHandler>, opts: { batch?: number; now?: Date } = {}): Promise<number> {
  const c = await getCollections();
  let processed = 0;
  for (let i = 0; i < (opts.batch ?? 25); i++) {
    const now = opts.now ?? new Date();
    const event = await c.outboxEvents.findOneAndUpdate(
      {
        $or: [
          { state: "pending", nextAttemptAt: { $lte: now } },
          { state: "processing", lockedUntil: { $lte: now } },
        ],
      },
      { $set: { state: "processing", lockedUntil: new Date(now.getTime() + LEASE_MS) }, $inc: { attempts: 1 } },
      { sort: { nextAttemptAt: 1 }, returnDocument: "after" },
    );
    if (!event) break;
    const handler = handlers[event.type];
    try {
      if (!handler) throw new TerminalOutboxError(`no handler for ${event.type}`);
      await handler(event);
      await c.outboxEvents.updateOne({ _id: event._id }, { $set: { state: "done", processedAt: new Date() }, $unset: { lockedUntil: "" } });
    } catch (e) {
      const terminal = e instanceof TerminalOutboxError || event.attempts >= MAX_ATTEMPTS;
      await c.outboxEvents.updateOne(
        { _id: event._id },
        {
          $set: {
            state: terminal ? "dead" : "pending",
            nextAttemptAt: new Date(now.getTime() + backoffMs(event.attempts)),
            lastErrorCode: e instanceof Error ? e.name : "UNKNOWN",
          },
          $unset: { lockedUntil: "" },
        },
      );
      logger.warn("outbox handler failed", { eventId: event._id.toHexString(), attempt: event.attempts, code: terminal ? "dead" : "retry", errorName: e instanceof Error ? e.name : "unknown" });
    }
    processed++;
  }
  return processed;
}
