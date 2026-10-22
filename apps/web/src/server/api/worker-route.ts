import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/server/config/env";
import { runWorkerTick } from "@/server/modules/outbox/tick";
import { logger } from "@/server/shared/logger";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Scheduled entry point for background work (Vercel Cron, a GitHub Actions schedule, or any pinger).
 * Authenticated with `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends this header itself when CRON_SECRET is set).
 * Without CRON_SECRET the endpoint does not exist, so it can never run unauthenticated.
 */
export async function workerTickHandler(req: Request): Promise<Response> {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return json(404, { error: "not_found" });
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!given || !sameSecret(given, secret)) return json(401, { error: "unauthorized" });
  try {
    const result = await runWorkerTick();
    logger.info("worker tick", { ...result });
    return json(200, { ok: true, ...result });
  } catch (e) {
    logger.error("worker tick failed", { errorName: e instanceof Error ? e.name : "unknown" });
    return json(500, { ok: false });
  }
}
