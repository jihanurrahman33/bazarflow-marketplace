import { getEnv } from "@/server/config/env";
import { hmacHex, safeEqual, sha256Hex } from "@/server/shared/ids";
import { money } from "@/server/shared/money";
import {
  ProviderError, type CreateCheckoutInput, type CreateCheckoutResult, type PaymentProviderAdapter, type PaymentProviderCapabilities,
  type ProviderPaymentStatus, type RefundInput, type RefundResult, type VerifiedPaymentStatus, type VerifiedProviderEvent, type VerifyPaymentInput, type WebhookRequest,
} from "./types";

interface Session {
  amountMinor: number;
  currency: string;
  status: ProviderPaymentStatus;
  transactionId?: string;
}

/**
 * Deterministic in-process "gateway" used for development, tests and demos. It models the behaviours the real
 * integration must survive: asynchronous confirmation, duplicate/out-of-order events, timeouts and refunds.
 * It refuses to run in live mode (see env validation).
 */
export class MockGateway {
  readonly sessions = new Map<string, Session>();
  readonly refunds = new Map<string, { amountMinor: number; status: "succeeded" | "pending" | "failed" }>();
  /** One-shot behaviours for the next call, keyed by operation. */
  nextCreate: "ok" | "unavailable" | "timeout" = "ok";
  nextRefund: "ok" | "failed" | "timeout" | "pending" = "ok";
  nextStatusLookup: "ok" | "unavailable" = "ok";
  refundAttempts = 0;
  reset() {
    this.sessions.clear();
    this.refunds.clear();
    this.nextCreate = "ok";
    this.nextRefund = "ok";
    this.nextStatusLookup = "ok";
    this.refundAttempts = 0;
  }

  /** Build a signed webhook the way the provider would deliver it. */
  signedEvent(ref: string, status: ProviderPaymentStatus, opts: { eventId?: string; amountMinor?: number; currency?: string; timestamp?: number; secret?: string } = {}) {
    const s = this.sessions.get(ref);
    const body = JSON.stringify({
      eventId: opts.eventId ?? `evt_${ref}_${status}`, type: `payment.${status}`, merchantReference: ref, status,
      transactionId: s?.transactionId ?? `mock_tx_${ref}`, amountMinor: opts.amountMinor ?? s?.amountMinor ?? 0, currency: opts.currency ?? s?.currency ?? "BDT",
      timestamp: opts.timestamp ?? Date.now(),
    });
    const signature = hmacHex(opts.secret ?? getEnv().PAYMENT_WEBHOOK_SECRET, body);
    return { body, headers: { "x-mock-signature": signature, "content-type": "application/json" } };
  }

  /** The customer completed (or abandoned) the hosted page. Server-side lookups now reflect it. */
  settle(ref: string, status: ProviderPaymentStatus) {
    const s = this.sessions.get(ref);
    if (!s) throw new Error(`unknown mock session ${ref}`);
    s.status = status;
    if (status === "succeeded") s.transactionId ??= `mock_tx_${ref}`;
  }
}

export const mockGateway = new MockGateway();

const CAPS: PaymentProviderCapabilities = {
  hostedCheckout: true, refunds: true, partialRefunds: true, webhookSignature: true, currencies: ["BDT"],
  minAmountMinor: 1000, maxAmountMinor: 50_000_000, marketplacePayouts: false,
};

const REPLAY_WINDOW_MS = 5 * 60_000;

export class MockPaymentAdapter implements PaymentProviderAdapter {
  readonly id = "mock";
  constructor(private readonly gateway: MockGateway = mockGateway) {}

  capabilities() {
    return CAPS;
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    const g = this.gateway;
    const mode = g.nextCreate;
    g.nextCreate = "ok";
    if (mode === "unavailable") throw new ProviderError("provider_unavailable", "mock gateway unavailable");
    // Timeout AFTER the provider created the session: the classic "unknown result".
    g.sessions.set(input.merchantReference, { amountMinor: input.amount.amountMinor, currency: input.amount.currency, status: "pending" });
    if (mode === "timeout") throw new ProviderError("unknown_result", "mock gateway timed out");
    return { redirectUrl: `${getEnv().APP_ORIGIN}/mock-pay/${encodeURIComponent(input.merchantReference)}`, providerSessionId: `sess_${input.merchantReference}` };
  }

  async getPaymentStatus(input: VerifyPaymentInput): Promise<VerifiedPaymentStatus> {
    const g = this.gateway;
    if (g.nextStatusLookup === "unavailable") {
      g.nextStatusLookup = "ok";
      throw new ProviderError("provider_unavailable", "mock status lookup unavailable");
    }
    const s = g.sessions.get(input.merchantReference);
    if (!s) return { merchantReference: input.merchantReference, status: "unknown" };
    return {
      merchantReference: input.merchantReference, status: s.status, providerTransactionId: s.transactionId,
      amount: s.status === "succeeded" ? money(s.amountMinor, "BDT") : undefined,
    };
  }

  async parseAndVerifyWebhook(req: WebhookRequest): Promise<VerifiedProviderEvent> {
    const sig = req.headers.get("x-mock-signature");
    const secret = getEnv().PAYMENT_WEBHOOK_SECRET;
    if (!sig || !safeEqual(sig, hmacHex(secret, req.rawBody))) throw new ProviderError("verification_failed", "bad signature");
    let p: { eventId?: string; type?: string; merchantReference?: string; status?: ProviderPaymentStatus; transactionId?: string; amountMinor?: number; currency?: string; timestamp?: number };
    try {
      p = JSON.parse(req.rawBody);
    } catch {
      throw new ProviderError("verification_failed", "malformed body");
    }
    if (!p.eventId || !p.merchantReference || !p.status || typeof p.timestamp !== "number") throw new ProviderError("verification_failed", "missing fields");
    if (Math.abs(Date.now() - p.timestamp) > REPLAY_WINDOW_MS) throw new ProviderError("verification_failed", "outside replay window");
    if (!Number.isSafeInteger(p.amountMinor) || p.currency !== "BDT") throw new ProviderError("verification_failed", "bad amount");
    return {
      providerEventId: p.eventId, type: p.type ?? `payment.${p.status}`, merchantReference: p.merchantReference, status: p.status,
      providerTransactionId: p.transactionId, amount: money(p.amountMinor!, "BDT"), payloadHash: sha256Hex(req.rawBody),
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const g = this.gateway;
    g.refundAttempts++;
    const mode = g.nextRefund;
    g.nextRefund = "ok";
    // Idempotent by merchantRefundRef, exactly like a well-behaved provider.
    const existing = g.refunds.get(input.merchantRefundRef);
    if (existing && mode !== "timeout") return { status: existing.status, providerRefundId: `mock_rf_${input.merchantRefundRef}` };
    if (mode === "failed") return { status: "failed", failureReason: "mock refund declined" };
    g.refunds.set(input.merchantRefundRef, { amountMinor: input.amount.amountMinor, status: mode === "pending" ? "pending" : "succeeded" });
    if (mode === "timeout") throw new ProviderError("unknown_result", "mock refund timed out");
    return { status: mode === "pending" ? "pending" : "succeeded", providerRefundId: `mock_rf_${input.merchantRefundRef}` };
  }

  acknowledgement() {
    return { status: 200, body: JSON.stringify({ received: true }), contentType: "application/json" };
  }
}
