import { getCollections } from "@/server/db/collections";
import { AppError } from "@/server/shared/errors";
import { newId, sha256Hex } from "@/server/shared/ids";
import { MongoServerError } from "mongodb";

const KEY_RE = /^[A-Za-z0-9_\-:.]{8,128}$/;
const LOCK_MS = 60_000;
const RETENTION_MS = 24 * 3600_000;

export function requireIdempotencyKey(header: string | null): string {
  if (!header) throw new AppError("IDEMPOTENCY_KEY_REQUIRED");
  if (!KEY_RE.test(header)) throw new AppError("VALIDATION_FAILED", { details: [{ field: "Idempotency-Key", code: "INVALID_FORMAT" }] });
  return header;
}

export interface StoredResponse {
  status: number;
  body: unknown;
}

/**
 * Atomic claim + replay. Scope = actor + operation.
 * - first call: runs `fn`, stores its response
 * - same key + same request hash: returns the stored response (or 409 while still in progress)
 * - same key + different request: 409 IDEMPOTENCY_KEY_REUSED
 * If `fn` throws, the claim is released so the client can retry with the same key.
 */
export async function withIdempotency(
  args: { actorScope: string; operation: string; key: string; request: unknown },
  fn: () => Promise<StoredResponse>,
): Promise<StoredResponse & { replayed: boolean }> {
  const c = await getCollections();
  const scope = `${args.actorScope}:${args.operation}`;
  const requestHash = sha256Hex(JSON.stringify(args.request));
  const now = new Date();

  try {
    await c.idempotencyKeys.insertOne({
      _id: newId(), actorScope: scope, key: args.key, operation: args.operation, requestHash,
      state: "in_progress", createdAt: now, lockedUntil: new Date(now.getTime() + LOCK_MS),
      expiresAt: new Date(now.getTime() + RETENTION_MS),
    });
  } catch (e) {
    if (!(e instanceof MongoServerError) || e.code !== 11000) throw e;
    const existing = await c.idempotencyKeys.findOne({ actorScope: scope, key: args.key });
    if (!existing) throw new AppError("CONFLICT");
    if (existing.requestHash !== requestHash) throw new AppError("IDEMPOTENCY_KEY_REUSED");
    if (existing.state === "completed") {
      return { status: existing.responseStatus ?? 200, body: existing.responseBody, replayed: true };
    }
    if (existing.lockedUntil > now) throw new AppError("IDEMPOTENCY_IN_PROGRESS", { headers: { "Retry-After": "2" } });
    // Stale lock from a crashed attempt: take it over atomically.
    const taken = await c.idempotencyKeys.updateOne(
      { _id: existing._id, state: "in_progress", lockedUntil: { $lte: now } },
      { $set: { lockedUntil: new Date(now.getTime() + LOCK_MS) } },
    );
    if (taken.modifiedCount === 0) throw new AppError("IDEMPOTENCY_IN_PROGRESS", { headers: { "Retry-After": "2" } });
  }

  try {
    const res = await fn();
    await c.idempotencyKeys.updateOne(
      { actorScope: scope, key: args.key },
      { $set: { state: "completed", responseStatus: res.status, responseBody: res.body } },
    );
    return { ...res, replayed: false };
  } catch (e) {
    // Release only for failures that did not create the resource; business errors are safe to retry.
    await c.idempotencyKeys.deleteOne({ actorScope: scope, key: args.key, state: "in_progress" });
    throw e;
  }
}
