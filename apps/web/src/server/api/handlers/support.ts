import { z } from "zod";
import { created, ok, route } from "@/server/api/route";
import { requirePermission } from "@/server/modules/authorization/actor";
import { askSupport } from "@/server/modules/support/assistant";
import { listKnowledge, setKnowledgeStatus, upsertKnowledge } from "@/server/modules/support/knowledge";

const sourceId = z.string().regex(/^[a-z0-9][a-z0-9._-]{1,79}$/);

/** Anyone may ask; what they can see depends on who they are (decided server-side from the token, never the body). */
export const askHandler = route(
  { name: "support.ask", auth: "optional", maxBodyBytes: 4 * 1024, rateLimit: { rule: { name: "support.ask", limit: 20, windowSeconds: 60 }, by: "ip" } },
  async (ctx) => {
    const b = await ctx.body(z.strictObject({ question: z.string().min(3).max(500) }));
    return ok(await askSupport(b.question, ctx.actor));
  },
);

export const listKnowledgeHandler = route({ name: "admin.knowledge.list" }, async (ctx) => {
  requirePermission(ctx.actor, "knowledge.manage");
  return ok(await listKnowledge());
});

/** Saves a draft. Nothing is served until it is approved. */
export const upsertKnowledgeHandler = route({ name: "admin.knowledge.upsert" }, async (ctx) => {
  requirePermission(ctx.actor, "knowledge.manage");
  const b = await ctx.body(z.strictObject({
    sourceId, title: z.string().trim().min(3).max(150), body: z.string().trim().min(20).max(8000),
    visibility: z.enum(["public", "vendor", "admin"]), locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional(),
  }));
  return created(await upsertKnowledge(ctx.actor, b));
});

export const approveKnowledgeHandler = route<{ sourceId: string }>({ name: "admin.knowledge.approve" }, async (ctx) => {
  requirePermission(ctx.actor, "knowledge.manage");
  return ok(await setKnowledgeStatus(ctx.actor, sourceId.parse(ctx.params.sourceId), "approved"));
});

export const retireKnowledgeHandler = route<{ sourceId: string }>({ name: "admin.knowledge.retire" }, async (ctx) => {
  requirePermission(ctx.actor, "knowledge.manage");
  return ok(await setKnowledgeStatus(ctx.actor, sourceId.parse(ctx.params.sourceId), "retired"));
});
