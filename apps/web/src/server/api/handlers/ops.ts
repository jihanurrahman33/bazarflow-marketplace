import { getEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { ok, route } from "@/server/api/route";
import { requirePermission } from "@/server/modules/authorization/actor";
import { opsHealth } from "@/server/modules/admin/health";

export const opsHealthHandler = route({ name: "admin.ops.health" }, async (ctx) => {
  requirePermission(ctx.actor, "report.read");
  return ok(await opsHealth());
});

/** Liveness: the process is up. No dependencies, so a database blip does not restart healthy instances. */
export const livenessHandler = route({ name: "health.live", auth: false }, async () => ok({ status: "ok" }));

/** Readiness: configuration parses and the database answers. Used by the load balancer before routing traffic. */
export const readinessHandler = route({ name: "health.ready", auth: false }, async () => {
  getEnv();
  await (await getDb()).command({ ping: 1 });
  return ok({ status: "ready" });
});
