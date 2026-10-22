import { z } from "zod";
import { getEnv } from "@/server/config/env";
import { ok, page, route, created } from "@/server/api/route";
import { AppError } from "@/server/shared/errors";
import { parseObjectId } from "@/server/shared/ids";
import { pageQuery } from "@/server/shared/pagination";
import { requirePermission, requireRole, requireVendor } from "@/server/modules/authorization/actor";
import { getAdapterForWebhook } from "@/server/modules/payments/registry";
import { ProviderError } from "@/server/modules/payments/types";
import { adminReconcile, applyVerifiedEvent, getPaymentForOrder, initiatePayment, listReconciliationQueue, refreshOrderPayment } from "@/server/modules/payments/service";
import { adminRequestRefund, approveRefund, listRefunds, rejectRefund, retryRefund } from "@/server/modules/payments/refunds";
import { getBalance, listLedger } from "@/server/modules/ledger/service";
import { logger } from "@/server/shared/logger";

const objectIdStr = z.string().regex(/^[0-9a-f]{24}$/i);

// ----- customer -----
export const startPaymentHandler = route<{ id: string }>(
  { name: "orders.payments.start", rateLimit: { rule: { name: "payments.start", limit: 10, windowSeconds: 600 }, by: "actor" } },
  async (ctx) => {
    requireRole(ctx.actor, "customer");
    return created(await initiatePayment(ctx.actor.userId, parseObjectId(ctx.params.id)));
  },
);

export const getPaymentHandler = route<{ id: string }>({ name: "orders.payments.get" }, async (ctx) => {
  requireRole(ctx.actor, "customer");
  return ok(await getPaymentForOrder(ctx.actor.userId, parseObjectId(ctx.params.id)));
});

/** "Check status": asks the provider (server-side) and applies verified evidence. Never trusts the browser. */
export const refreshPaymentHandler = route<{ id: string }>(
  { name: "orders.payments.refresh", rateLimit: { rule: { name: "payments.refresh", limit: 20, windowSeconds: 300 }, by: "actor" } },
  async (ctx) => {
    requireRole(ctx.actor, "customer");
    return ok(await refreshOrderPayment(ctx.actor.userId, parseObjectId(ctx.params.id)));
  },
);

/** Browser lands here after the hosted page. It only forwards the shopper to the order page; it changes no state. */
export const paymentReturnHandler = route<{ provider: string }>({ name: "payments.return", auth: false }, async (ctx) => {
  const q = ctx.query(z.object({ order: objectIdStr, result: z.enum(["success", "fail", "cancel"]).optional() }));
  return { status: 303, redirectTo: `${getEnv().APP_ORIGIN}/orders/${q.order}?payment=returned` };
});

// ----- provider webhook -----
export const paymentWebhookHandler = route<{ provider: string }>(
  { name: "webhooks.payments", auth: false, maxBodyBytes: 32 * 1024, rateLimit: { rule: { name: "webhooks.payments", limit: 600, windowSeconds: 60 }, by: "ip" } },
  async (ctx) => {
    const adapter = getAdapterForWebhook(ctx.params.provider);
    const rawBody = await ctx.rawBody();
    let event;
    try {
      event = await adapter.parseAndVerifyWebhook({ rawBody, headers: ctx.req.headers, contentType: ctx.req.headers.get("content-type") ?? "" });
    } catch (e) {
      if (e instanceof ProviderError && e.kind === "verification_failed") throw new AppError("PAYMENT_VERIFICATION_FAILED");
      // Could not verify (provider lookup down/timeout): answer 5xx so the provider redelivers later.
      if (e instanceof ProviderError) throw new AppError("PAYMENT_PROVIDER_UNAVAILABLE");
      throw e;
    }
    const outcome = await applyVerifiedEvent(adapter, event);
    logger.info("payment webhook", { provider: adapter.id, eventId: event.providerEventId, code: outcome });
    // Acknowledge only after durable handling (the transaction above has committed).
    return { status: adapter.acknowledgement().status, raw: { body: adapter.acknowledgement().body, contentType: adapter.acknowledgement().contentType } };
  },
);

// ----- admin -----
export const reconciliationQueueHandler = route({ name: "admin.payments.reconciliation" }, async (ctx) => {
  requirePermission(ctx.actor, "payment.reconcile");
  const r = await listReconciliationQueue(ctx.query(pageQuery));
  return page(r.items, r);
});

export const adminReconcileHandler = route<{ id: string }>({ name: "admin.payments.reconcile" }, async (ctx) => {
  requirePermission(ctx.actor, "payment.reconcile");
  return ok(await adminReconcile(ctx.actor.userId, parseObjectId(ctx.params.id), ctx.requestId));
});

export const adminListRefundsHandler = route({ name: "admin.refunds.list" }, async (ctx) => {
  requirePermission(ctx.actor, "refund.approve");
  const q = ctx.query(pageQuery.extend({ status: z.enum(["requested", "approved", "processing", "succeeded", "failed", "rejected"]).optional(), orderId: objectIdStr.optional() }));
  const r = await listRefunds({ ...q, orderId: q.orderId ? parseObjectId(q.orderId) : undefined });
  return page(r.items, r);
});

export const adminRequestRefundHandler = route(
  { name: "admin.refunds.request", rateLimit: { rule: { name: "admin.refunds.request", limit: 30, windowSeconds: 600 }, by: "actor" } },
  async (ctx) => {
    requirePermission(ctx.actor, "refund.approve");
    const b = await ctx.body(z.strictObject({ orderId: objectIdStr, vendorOrderId: objectIdStr, amountMinor: z.number().int().min(1).max(100_000_000), reason: z.string().trim().min(3).max(300) }));
    return created(await adminRequestRefund(ctx.actor, { orderId: parseObjectId(b.orderId), vendorOrderId: parseObjectId(b.vendorOrderId), amountMinor: b.amountMinor, reason: b.reason }, ctx.requestId));
  },
);

export const adminApproveRefundHandler = route<{ id: string }>({ name: "admin.refunds.approve" }, async (ctx) => {
  requirePermission(ctx.actor, "refund.approve");
  return ok(await approveRefund(ctx.actor, parseObjectId(ctx.params.id), ctx.requestId));
});

export const adminRejectRefundHandler = route<{ id: string }>({ name: "admin.refunds.reject" }, async (ctx) => {
  requirePermission(ctx.actor, "refund.approve");
  const b = await ctx.body(z.strictObject({ reason: z.string().trim().min(3).max(300) }));
  return ok(await rejectRefund(ctx.actor, parseObjectId(ctx.params.id), b.reason, ctx.requestId));
});

export const adminRetryRefundHandler = route<{ id: string }>({ name: "admin.refunds.retry" }, async (ctx) => {
  requirePermission(ctx.actor, "refund.approve");
  return ok(await retryRefund(ctx.actor, parseObjectId(ctx.params.id), ctx.requestId));
});

// ----- vendor ledger (read-only) -----
export const vendorBalanceHandler = route({ name: "vendor.balance" }, async (ctx) => ok(await getBalance(requireVendor(ctx.actor))));
export const vendorLedgerHandler = route({ name: "vendor.ledger" }, async (ctx) => {
  const r = await listLedger(requireVendor(ctx.actor), ctx.query(pageQuery));
  return page(r.items, r);
});
