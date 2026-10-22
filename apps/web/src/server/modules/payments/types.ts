import type { Money } from "@/server/shared/money";

/** Normalised provider error kinds (docs/06 §3). Adapters map every provider quirk onto these. */
export type ProviderErrorKind = "declined" | "provider_unavailable" | "configuration_error" | "unknown_result" | "verification_failed";

export class ProviderError extends Error {
  constructor(readonly kind: ProviderErrorKind, message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

export type ProviderPaymentStatus = "succeeded" | "failed" | "cancelled" | "pending" | "unknown";

export interface PaymentProviderCapabilities {
  hostedCheckout: boolean;
  refunds: boolean;
  partialRefunds: boolean;
  /** The provider signs webhooks (true) or requires a server-side status lookup to trust them (false). */
  webhookSignature: boolean;
  currencies: readonly string[];
  /** Inclusive provider limits in minor units. */
  minAmountMinor: number;
  maxAmountMinor: number;
  marketplacePayouts: false;
}

export interface CreateCheckoutInput {
  merchantReference: string;
  amount: Money;
  orderNumber: string;
  customer: { name: string; email: string; phone: string };
  shippingAddress: { line1: string; city: string; postalCode: string; country: string };
  /** Return URLs only tell the browser to refresh status; they are never proof of payment. */
  returnUrls: { success: string; fail: string; cancel: string };
  webhookUrl: string;
}

export interface CreateCheckoutResult {
  redirectUrl: string;
  providerSessionId?: string;
}

export interface VerifyPaymentInput {
  merchantReference: string;
  providerTransactionId?: string;
}

export interface VerifiedPaymentStatus {
  merchantReference: string;
  status: ProviderPaymentStatus;
  providerTransactionId?: string;
  /** Amount the provider reports for what the customer actually paid, in OUR currency/amount terms. */
  amount?: Money;
}

export interface VerifiedProviderEvent {
  /** Stable provider event id, or a documented derived key (see adapter). */
  providerEventId: string;
  type: string;
  merchantReference: string;
  status: ProviderPaymentStatus;
  providerTransactionId?: string;
  amount?: Money;
  payloadHash: string;
}

export interface RefundInput {
  /** Our refund id: sent to the provider as its idempotency/unique refund reference. */
  merchantRefundRef: string;
  merchantReference: string;
  providerTransactionId: string;
  amount: Money;
  reason: string;
}

export interface RefundResult {
  status: "succeeded" | "pending" | "failed";
  providerRefundId?: string;
  failureReason?: string;
}

export interface WebhookRequest {
  rawBody: string;
  headers: Headers;
  contentType: string;
}

export interface PaymentProviderAdapter {
  readonly id: string;
  capabilities(): PaymentProviderCapabilities;
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;
  getPaymentStatus(input: VerifyPaymentInput): Promise<VerifiedPaymentStatus>;
  /** Authenticates the request (signature and/or server-side lookup) and normalises it. Throws ProviderError('verification_failed'). */
  parseAndVerifyWebhook(req: WebhookRequest): Promise<VerifiedProviderEvent>;
  /** Present only when capabilities().refunds is true. */
  refund?(input: RefundInput): Promise<RefundResult>;
  /** Response body/status the provider expects after an event is durably handled. */
  acknowledgement(): { status: number; body: string; contentType: string };
}
