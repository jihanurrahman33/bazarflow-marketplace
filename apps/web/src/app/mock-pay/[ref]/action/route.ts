import { ObjectId } from "mongodb";
import { getEnv } from "@/server/config/env";
import { getCollections } from "@/server/db/collections";
import { paymentWebhookHandler } from "@/server/api/handlers/payments";
import { mockGateway } from "@/server/modules/payments/mock";
import type { ProviderPaymentStatus } from "@/server/modules/payments/types";

/**
 * Sandbox-only stand-in for a provider's hosted page. It drives the real server paths: the "customer" outcome is
 * delivered as a SIGNED webhook through the same handler a real provider would call.
 */
function enabled(): boolean {
  const env = getEnv();
  return env.PAYMENT_PROVIDER === "mock" && (env.NODE_ENV !== "production" || env.MOCK_PAYMENT_UI);
}
const notFound = () => new Response("Not found", { status: 404 });

export async function GET(_req: Request, ctx: { params: Promise<{ ref: string }> }) {
  if (!enabled()) return notFound();
  const { ref } = await ctx.params;
  const c = await getCollections();
  const p = await c.payments.findOne({ merchantReference: ref });
  if (!p) return notFound();
  const order = await c.orders.findOne({ _id: p.orderId }, { projection: { publicOrderNumber: 1 } });
  return Response.json({ amountMinor: p.amountMinor, currency: p.currency, status: p.status, orderNumber: order?.publicOrderNumber, orderId: p.orderId.toHexString() });
}

export async function POST(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  if (!enabled()) return notFound();
  const origin = req.headers.get("origin");
  const configured = new URL(getEnv().APP_ORIGIN).origin;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  if (!origin || (origin !== configured && (!host || origin !== `${proto}://${host}`))) return new Response("Forbidden", { status: 403 });
  const { ref } = await ctx.params;
  const { outcome } = (await req.json().catch(() => ({}))) as { outcome?: string };
  const status: ProviderPaymentStatus | undefined = outcome === "success" ? "succeeded" : outcome === "fail" ? "failed" : outcome === "cancel" ? "cancelled" : undefined;
  if (!status) return new Response("Bad request", { status: 400 });
  const c = await getCollections();
  const p = await c.payments.findOne({ merchantReference: ref });
  if (!p) return notFound();
  if (!mockGateway.sessions.has(ref)) {
    mockGateway.sessions.set(ref, { amountMinor: p.amountMinor, currency: p.currency, status: "pending" }); // session lost across a restart: recreate it
  }
  mockGateway.settle(ref, status);
  const signed = mockGateway.signedEvent(ref, status, { eventId: `evt_${ref}_${status}_${Date.now()}` });
  const res = await paymentWebhookHandler(
    new Request(`${getEnv().APP_ORIGIN}/api/v1/webhooks/payments/mock`, { method: "POST", headers: signed.headers, body: signed.body }),
    { params: Promise.resolve({ provider: "mock" }) },
  );
  return Response.json({ ok: res.ok, redirect: `/orders/${(p.orderId as ObjectId).toHexString()}?payment=returned` });
}
