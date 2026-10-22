import { z } from "zod";
import { ok, route } from "@/server/api/route";
import { requirePermission } from "@/server/modules/authorization/actor";
import { EVENT_TYPES, recordEvents } from "@/server/modules/analytics/events";
import { experimentsReport, funnelReport } from "@/server/modules/analytics/report";

const objectIdStr = z.string().regex(/^[0-9a-f]{24}$/i);
const event = z.strictObject({
  type: z.enum(EVENT_TYPES),
  productId: objectIdStr.optional(),
  orderId: objectIdStr.optional(),
  query: z.string().max(100).optional(),
  results: z.number().int().min(0).max(100_000).optional(),
  source: z.string().regex(/^[a-z0-9_-]{1,30}$/).optional(),
  experiment: z.strictObject({ key: z.string().regex(/^[a-z0-9_]{1,40}$/), variant: z.string().regex(/^[a-z0-9_]{1,40}$/) }).optional(),
});

/** Anonymous behaviour events from the storefront. Public on purpose (shoppers are usually signed out); rate-limited per IP. */
export const recordEventsHandler = route({ name: "events.record", auth: "optional", rateLimit: { rule: { name: "events.record", limit: 240, windowSeconds: 60 }, by: "ip" } }, async (ctx) => {
  const b = await ctx.body(z.strictObject({ anonId: z.string().regex(/^[a-z0-9-]{16,40}$/), events: z.array(event).min(1).max(20) }));
  return ok({ accepted: await recordEvents(b.anonId, b.events, ctx.actor) });
});

const range = z.strictObject({ days: z.coerce.number().int().min(1).max(90).default(7) });

export const funnelReportHandler = route({ name: "admin.analytics.funnel" }, async (ctx) => {
  requirePermission(ctx.actor, "report.read");
  return ok(await funnelReport(ctx.query(range).days));
});

export const experimentsReportHandler = route({ name: "admin.analytics.experiments" }, async (ctx) => {
  requirePermission(ctx.actor, "report.read");
  return ok(await experimentsReport(ctx.query(range).days));
});
