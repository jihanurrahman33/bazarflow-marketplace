import { sha256Hex } from "@/server/shared/ids";
import { fromDecimalString, toDecimalString, type Money } from "@/server/shared/money";
import {
  ProviderError, type CreateCheckoutInput, type CreateCheckoutResult, type PaymentProviderAdapter, type PaymentProviderCapabilities,
  type ProviderPaymentStatus, type RefundInput, type RefundResult, type VerifiedPaymentStatus, type VerifiedProviderEvent, type VerifyPaymentInput, type WebhookRequest,
} from "./types";

/**
 * SSLCOMMERZ hosted-checkout adapter.
 * Written against https://developer.sslcommerz.com/doc/v4/ (reviewed 2026-10-22). Provider docs and merchant
 * eligibility can change: re-verify against the official docs and run the sandbox test plan before go-live.
 *
 * Key rules from the official docs that shape this adapter:
 *  - the IPN is untrusted input; every IPN must be confirmed through the server-side validation APIs;
 *  - the settled `amount`/`currency` may differ from what was charged, so we compare `currency_type` and
 *    `currency_amount` (what we sent at initiation) with our own records;
 *  - SSLCOMMERZ sends no stable event id, so a derived, documented dedupe key is used (see `eventKey`).
 */

const HOSTS = { sandbox: "https://sandbox.sslcommerz.com", live: "https://securepay.sslcommerz.com" } as const;

const CAPS: PaymentProviderCapabilities = {
  hostedCheckout: true, refunds: true, partialRefunds: true, webhookSignature: false, currencies: ["BDT"],
  minAmountMinor: 1000, // 10.00 BDT
  maxAmountMinor: 50_000_000, // 500000.00 BDT
  marketplacePayouts: false,
};

export interface SslCommerzConfig {
  storeId: string;
  storePassword: string;
  mode: "sandbox" | "live";
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

type Json = Record<string, unknown>;

export class SslCommerzAdapter implements PaymentProviderAdapter {
  readonly id = "sslcommerz";
  private readonly base: string;
  private readonly doFetch: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly cfg: SslCommerzConfig) {
    this.base = HOSTS[cfg.mode];
    this.doFetch = cfg.fetchImpl ?? fetch;
    this.timeoutMs = cfg.timeoutMs ?? 10_000;
  }

  capabilities() {
    return CAPS;
  }

  private async request(url: string, init: RequestInit = {}): Promise<Json> {
    let res: Response;
    try {
      res = await this.doFetch(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      // A timeout after the request left means we cannot know whether it was processed.
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) throw new ProviderError("unknown_result", "provider timed out");
      throw new ProviderError("provider_unavailable", "provider unreachable");
    }
    if (res.status >= 500) throw new ProviderError("provider_unavailable", `provider returned ${res.status}`);
    if (!res.ok) throw new ProviderError("configuration_error", `provider rejected the request (${res.status})`);
    try {
      return (await res.json()) as Json;
    } catch {
      throw new ProviderError("unknown_result", "provider returned an unreadable response");
    }
  }

  private creds() {
    return { store_id: this.cfg.storeId, store_passwd: this.cfg.storePassword };
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    const form = new URLSearchParams({
      ...this.creds(),
      total_amount: toDecimalString(input.amount),
      currency: input.amount.currency,
      tran_id: input.merchantReference,
      success_url: input.returnUrls.success,
      fail_url: input.returnUrls.fail,
      cancel_url: input.returnUrls.cancel,
      ipn_url: input.webhookUrl,
      cus_name: input.customer.name,
      cus_email: input.customer.email,
      cus_add1: input.shippingAddress.line1,
      cus_city: input.shippingAddress.city,
      cus_postcode: input.shippingAddress.postalCode,
      cus_country: "Bangladesh",
      cus_phone: input.customer.phone,
      shipping_method: "NO",
      product_name: `Order ${input.orderNumber}`,
      product_category: "general",
      product_profile: "general",
    });
    const body = await this.request(`${this.base}/gwprocess/v4/api.php`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form,
    });
    if (body.status !== "SUCCESS" || typeof body.GatewayPageURL !== "string" || !body.GatewayPageURL) {
      // The session was not created, so retrying with a fresh reference is safe.
      throw new ProviderError("declined", `session init failed: ${String(body.failedreason ?? "unknown").slice(0, 120)}`);
    }
    return { redirectUrl: body.GatewayPageURL, providerSessionId: typeof body.sessionkey === "string" ? body.sessionkey : undefined };
  }

  /** Our expected amount comes from the provider's echo of `currency_type`/`currency_amount`, never the settled amount. */
  private sentAmount(row: Json): Money | undefined {
    if (row.currency_type !== "BDT" || typeof row.currency_amount !== "string") return undefined;
    try {
      return fromDecimalString(row.currency_amount, "BDT");
    } catch {
      return undefined;
    }
  }

  private mapStatus(s: unknown): ProviderPaymentStatus {
    switch (s) {
      case "VALID": case "VALIDATED": return "succeeded";
      case "FAILED": return "failed";
      case "CANCELLED": case "EXPIRED": return "cancelled";
      case "PENDING": case "UNATTEMPTED": return "pending";
      default: return "unknown";
    }
  }

  async getPaymentStatus(input: VerifyPaymentInput): Promise<VerifiedPaymentStatus> {
    const qs = new URLSearchParams({ tran_id: input.merchantReference, ...this.creds(), format: "json" });
    const body = await this.request(`${this.base}/validator/api/merchantTransIDvalidationAPI.php?${qs}`);
    if (body.APIConnect !== "DONE") throw new ProviderError("configuration_error", `status lookup refused (${String(body.APIConnect)})`);
    const rows = (Array.isArray(body.element) ? body.element : []) as Json[];
    const mine = rows.filter((r) => r.tran_id === input.merchantReference);
    if (mine.length === 0) return { merchantReference: input.merchantReference, status: "unknown" };
    const success = mine.find((r) => this.mapStatus(r.status) === "succeeded");
    if (success) {
      return {
        merchantReference: input.merchantReference, status: "succeeded",
        providerTransactionId: typeof success.bank_tran_id === "string" ? success.bank_tran_id : undefined,
        amount: this.sentAmount(success),
      };
    }
    // No success: report the most informative state (pending beats failed so a retry-in-session is not written off).
    const statuses = mine.map((r) => this.mapStatus(r.status));
    const status = statuses.includes("pending") ? "pending" : statuses.includes("failed") ? "failed" : statuses.includes("cancelled") ? "cancelled" : "unknown";
    return { merchantReference: input.merchantReference, status };
  }

  /**
   * IPN: form-encoded, unsigned for our purposes. We read only the transaction reference from it and ask the
   * provider what really happened. The derived event key is `tran_id:val_id|none:resultingStatus`; the same IPN
   * retried yields the same key, a changed outcome yields a new one.
   */
  async parseAndVerifyWebhook(req: WebhookRequest): Promise<VerifiedProviderEvent> {
    const params = new URLSearchParams(req.rawBody);
    const tranId = params.get("tran_id");
    const valId = params.get("val_id");
    if (!tranId || tranId.length > 50) throw new ProviderError("verification_failed", "missing tran_id");

    if (valId) {
      // Order Validation API: confirms the val_id really belongs to this transaction.
      const qs = new URLSearchParams({ val_id: valId, ...this.creds(), format: "json" });
      const v = await this.request(`${this.base}/validator/api/validationserverAPI.php?${qs}`);
      const ok = (v.status === "VALID" || v.status === "VALIDATED") && v.tran_id === tranId;
      if (!ok && v.status === "INVALID_TRANSACTION") throw new ProviderError("verification_failed", "val_id rejected by provider");
      if (ok) {
        return {
          providerEventId: `${tranId}:${valId}:succeeded`, type: "ipn.validated", merchantReference: tranId, status: "succeeded",
          providerTransactionId: typeof v.bank_tran_id === "string" ? v.bank_tran_id : undefined, amount: this.sentAmount(v), payloadHash: sha256Hex(req.rawBody),
        };
      }
    }
    // Anything else: do not believe the posted status; look the transaction up.
    const looked = await this.getPaymentStatus({ merchantReference: tranId });
    return {
      providerEventId: `${tranId}:${valId ?? "none"}:${looked.status}`, type: "ipn.lookup", merchantReference: tranId, status: looked.status,
      providerTransactionId: looked.providerTransactionId, amount: looked.amount, payloadHash: sha256Hex(req.rawBody),
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const qs = new URLSearchParams({
      bank_tran_id: input.providerTransactionId, refund_trans_id: input.merchantRefundRef, ...this.creds(),
      refund_amount: toDecimalString(input.amount), refund_remarks: input.reason.slice(0, 200), format: "json",
    });
    const body = await this.request(`${this.base}/validator/api/merchantTransIDvalidationAPI.php?${qs}`);
    if (body.APIConnect !== "DONE") return { status: "failed", failureReason: `refund api: ${String(body.APIConnect)}` };
    const ref = typeof body.refund_ref_id === "string" ? body.refund_ref_id : undefined;
    if (body.status === "success") return { status: "succeeded", providerRefundId: ref };
    if (body.status === "processing") return { status: "pending", providerRefundId: ref };
    return { status: "failed", failureReason: String(body.errorReason ?? "refund failed").slice(0, 200) };
  }

  acknowledgement() {
    return { status: 200, body: "OK", contentType: "text/plain" };
  }
}

