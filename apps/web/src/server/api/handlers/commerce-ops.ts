import { z } from "zod";
import { created, ok, page, route } from "@/server/api/route";
import { requirePermission, requireRole, requireVendor } from "@/server/modules/authorization/actor";
import { parseObjectId } from "@/server/shared/ids";
import { pageQuery } from "@/server/shared/pagination";
import { getOrderForSupport, salesSummary, searchOrders } from "@/server/modules/admin/ops";
import { approvePayout, cancelPayout, listPayouts, markPayoutFailed, markPayoutPaid, rejectPayout, requestPayout } from "@/server/modules/payouts/service";
import { createReview, listProductReviews, setReviewStatus } from "@/server/modules/reviews/service";

const objectIdStr = z.string().regex(/^[0-9a-f]{24}$/i);

// ----- reviews -----
export const createReviewHandler = route<{ slug: string }>(
  { name: "reviews.create", rateLimit: { rule: { name: "reviews.create", limit: 10, windowSeconds: 3600 }, by: "actor" } },
  async (ctx) => {
    requireRole(ctx.actor, "customer");
    const b = await ctx.body(z.strictObject({ rating: z.number().int().min(1).max(5), title: z.string().trim().max(100).optional(), body: z.string().trim().min(10).max(2000) }));
    return created(await createReview(ctx.actor, ctx.params.slug, b));
  },
);

export const listReviewsHandler = route<{ slug: string }>({ name: "products.reviews", auth: false }, async (ctx) => {
  const r = await listProductReviews(ctx.params.slug, ctx.query(pageQuery));
  return page(r.items, r, { meta: { ...{ nextCursor: r.nextCursor, hasMore: r.nextCursor !== null }, summary: r.summary }, cache: "public, s-maxage=30, stale-while-revalidate=120" });
});

export const hideReviewHandler = route<{ id: string }>({ name: "admin.reviews.hide" }, async (ctx) => {
  requirePermission(ctx.actor, "catalog.moderate");
  const b = await ctx.body(z.strictObject({ reason: z.string().trim().min(3).max(300) }));
  return ok(await setReviewStatus(ctx.actor, parseObjectId(ctx.params.id), "hidden", b.reason, ctx.requestId));
});

// ----- payouts (vendor) -----
export const requestPayoutHandler = route(
  { name: "vendor.payouts.request", rateLimit: { rule: { name: "vendor.payouts.request", limit: 5, windowSeconds: 3600 }, by: "actor" } },
  async (ctx) => {
    const vendorId = requireVendor(ctx.actor);
    const b = await ctx.body(z.strictObject({ amountMinor: z.number().int().min(1).max(1_000_000_000) }));
    return created(await requestPayout({ ...ctx.actor, vendorId }, b.amountMinor, ctx.requestId));
  },
);

export const vendorPayoutsHandler = route({ name: "vendor.payouts.list" }, async (ctx) => {
  const r = await listPayouts({ vendorId: requireVendor(ctx.actor) }, ctx.query(pageQuery), false);
  return page(r.items, r);
});

export const cancelPayoutHandler = route<{ id: string }>({ name: "vendor.payouts.cancel" }, async (ctx) =>
  ok(await cancelPayout({ userId: ctx.actor.userId, vendorId: requireVendor(ctx.actor) }, parseObjectId(ctx.params.id))),
);

// ----- payouts (admin) -----
export const adminPayoutsHandler = route({ name: "admin.payouts.list" }, async (ctx) => {
  requirePermission(ctx.actor, "payout.approve");
  const q = ctx.query(pageQuery.extend({ status: z.enum(["requested", "approved", "paid", "failed", "rejected", "cancelled"]).optional(), vendorId: objectIdStr.optional() }));
  const r = await listPayouts({ status: q.status, vendorId: q.vendorId ? parseObjectId(q.vendorId) : undefined }, q, true);
  return page(r.items, r);
});

export const approvePayoutHandler = route<{ id: string }>({ name: "admin.payouts.approve" }, async (ctx) => {
  requirePermission(ctx.actor, "payout.approve");
  return ok(await approvePayout(ctx.actor, parseObjectId(ctx.params.id), ctx.requestId));
});
export const rejectPayoutHandler = route<{ id: string }>({ name: "admin.payouts.reject" }, async (ctx) => {
  requirePermission(ctx.actor, "payout.approve");
  const b = await ctx.body(z.strictObject({ reason: z.string().trim().min(3).max(300) }));
  return ok(await rejectPayout(ctx.actor, parseObjectId(ctx.params.id), b.reason, ctx.requestId));
});
export const markPaidHandler = route<{ id: string }>({ name: "admin.payouts.paid" }, async (ctx) => {
  requirePermission(ctx.actor, "payout.approve");
  const b = await ctx.body(z.strictObject({ providerRef: z.string().trim().min(4).max(80) }));
  return ok(await markPayoutPaid(ctx.actor, parseObjectId(ctx.params.id), b.providerRef, ctx.requestId));
});
export const markFailedHandler = route<{ id: string }>({ name: "admin.payouts.failed" }, async (ctx) => {
  requirePermission(ctx.actor, "payout.approve");
  const b = await ctx.body(z.strictObject({ reason: z.string().trim().min(3).max(300) }));
  return ok(await markPayoutFailed(ctx.actor, parseObjectId(ctx.params.id), b.reason, ctx.requestId));
});

// ----- admin support & reports -----
export const adminOrdersHandler = route({ name: "admin.orders.search" }, async (ctx) => {
  requirePermission(ctx.actor, "order.read_all");
  const q = ctx.query(pageQuery.extend({
    orderNumber: z.string().max(20).optional(), buyerEmail: z.string().max(254).optional(),
    status: z.enum(["pending_payment", "confirmed", "processing", "partially_fulfilled", "shipped", "delivered", "cancelled", "closed"]).optional(),
  }));
  const r = await searchOrders(q);
  return page(r.items, r);
});

export const adminOrderHandler = route<{ id: string }>({ name: "admin.orders.get" }, async (ctx) => {
  requirePermission(ctx.actor, "order.read_all");
  return ok(await getOrderForSupport(parseObjectId(ctx.params.id)));
});

export const salesReportHandler = route({ name: "admin.reports.sales" }, async (ctx) => {
  requirePermission(ctx.actor, "report.read");
  const q = ctx.query(z.object({ from: z.iso.datetime(), to: z.iso.datetime() }));
  return ok(await salesSummary(new Date(q.from), new Date(q.to)));
});

