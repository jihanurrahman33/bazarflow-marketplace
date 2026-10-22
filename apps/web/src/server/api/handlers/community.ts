import { z } from "zod";
import { created, ok, page, route } from "@/server/api/route";
import { requirePermission, requireRole, requireVendor } from "@/server/modules/authorization/actor";
import { parseObjectId } from "@/server/shared/ids";
import { pageQuery } from "@/server/shared/pagination";
import { answerQuestion, askQuestion, hideQuestion, listQuestions, listVendorQuestions } from "@/server/modules/community/service";
import { listReviewsForSeller, replyToReview } from "@/server/modules/reviews/service";

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

// ----- shoppers -----
export const askQuestionHandler = route<{ slug: string }>(
  { name: "questions.ask", rateLimit: { rule: { name: "questions.ask", limit: 8, windowSeconds: 86_400 }, by: "actor" } },
  async (ctx) => {
    requireRole(ctx.actor, "customer");
    const b = await ctx.body(z.strictObject({ body: text(10, 300) }));
    return created(await askQuestion(ctx.actor, ctx.params.slug, b.body));
  },
);

export const listQuestionsHandler = route<{ slug: string }>({ name: "products.questions", auth: false }, async (ctx) => {
  const r = await listQuestions(ctx.params.slug, ctx.query(pageQuery));
  return page(r.items, r, { cache: "public, s-maxage=30, stale-while-revalidate=120" });
});

// ----- sellers -----
export const vendorQuestionsHandler = route({ name: "vendor.questions.list" }, async (ctx) => {
  const vendorId = requireVendor(ctx.actor);
  const q = ctx.query(pageQuery.extend({ answered: z.enum(["true", "false"]).optional() }));
  const r = await listVendorQuestions(vendorId, { limit: q.limit, cursor: q.cursor, answered: q.answered === undefined ? undefined : q.answered === "true" });
  return page(r.items, r);
});

export const answerQuestionHandler = route<{ id: string }>({ name: "vendor.questions.answer", rateLimit: { rule: { name: "vendor.community", limit: 120, windowSeconds: 3600 }, by: "actor" } }, async (ctx) => {
  const vendorId = requireVendor(ctx.actor);
  const b = await ctx.body(z.strictObject({ body: text(2, 1000) }));
  return ok(await answerQuestion(vendorId, parseObjectId(ctx.params.id), b.body));
});

export const vendorReviewsHandler = route({ name: "vendor.reviews.list" }, async (ctx) => {
  const vendorId = requireVendor(ctx.actor);
  const q = ctx.query(pageQuery.extend({ unanswered: z.enum(["true", "false"]).optional() }));
  const r = await listReviewsForSeller(vendorId, { limit: q.limit, cursor: q.cursor, unanswered: q.unanswered === "true" });
  return page(r.items, r);
});

export const replyReviewHandler = route<{ id: string }>({ name: "vendor.reviews.reply", rateLimit: { rule: { name: "vendor.community", limit: 120, windowSeconds: 3600 }, by: "actor" } }, async (ctx) => {
  const vendorId = requireVendor(ctx.actor);
  const b = await ctx.body(z.strictObject({ body: text(2, 1000) }));
  return ok(await replyToReview(vendorId, parseObjectId(ctx.params.id), b.body));
});

// ----- moderation -----
export const hideQuestionHandler = route<{ id: string }>({ name: "admin.questions.hide" }, async (ctx) => {
  requirePermission(ctx.actor, "catalog.moderate");
  const b = await ctx.body(z.strictObject({ reason: text(3, 300) }));
  return ok(await hideQuestion(ctx.actor, parseObjectId(ctx.params.id), b.reason, ctx.requestId));
});
