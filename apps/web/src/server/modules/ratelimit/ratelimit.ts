import { getCollections } from "@/server/db/collections";
import { AppError } from "@/server/shared/errors";

export interface RateLimitRule {
  /** Logical bucket, e.g. "auth.login". */
  name: string;
  limit: number;
  windowSeconds: number;
}

/** Fixed-window counter in MongoDB so limits hold across instances. Throws RATE_LIMITED when exceeded. */
export async function enforceRateLimit(rule: RateLimitRule, subject: string, now = new Date()): Promise<void> {
  const windowStart = Math.floor(now.getTime() / (rule.windowSeconds * 1000));
  const id = `${rule.name}:${subject}:${windowStart}`;
  const c = await getCollections();
  const doc = await c.rateLimits.findOneAndUpdate(
    { _id: id },
    {
      $inc: { count: 1 },
      $setOnInsert: { expiresAt: new Date((windowStart + 2) * rule.windowSeconds * 1000) },
    },
    { upsert: true, returnDocument: "after" },
  );
  if (doc && doc.count > rule.limit) {
    const retryAfter = Math.max(1, Math.ceil(((windowStart + 1) * rule.windowSeconds * 1000 - now.getTime()) / 1000));
    throw new AppError("RATE_LIMITED", { headers: { "Retry-After": String(retryAfter) } });
  }
}
