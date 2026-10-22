import { AppError } from "@/server/shared/errors";
import { logger } from "@/server/shared/logger";
import type { CourierAdapter, CourierParcelInput, CourierParcelResult, CourierTrackingResult } from "./types";

const HOSTS = {
  sandbox: "https://sandbox.redx.com.bd/v1.0.0-beta",
  live: "https://openapi.redx.com.bd/v1.0.0-beta",
} as const;

export interface RedxConfig {
  apiToken?: string;
  mode?: "sandbox" | "live";
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class RedxAdapter implements CourierAdapter {
  readonly id = "redx";
  readonly name = "REDX";
  private readonly base: string;
  private readonly doFetch: typeof fetch;
  private readonly timeoutMs: number;
  private readonly token?: string;
  private readonly isSandbox: boolean;

  constructor(cfg: RedxConfig = {}) {
    this.isSandbox = cfg.mode !== "live";
    this.base = cfg.mode === "live" ? HOSTS.live : HOSTS.sandbox;
    this.doFetch = cfg.fetchImpl ?? fetch;
    this.timeoutMs = cfg.timeoutMs ?? 10_000;
    this.token = cfg.apiToken;
  }

  private headers(): Record<string, string> {
    const bearer = this.token?.startsWith("Bearer ") ? this.token : `Bearer ${this.token ?? ""}`;
    return {
      "Content-Type": "application/json",
      "API-ACCESS-TOKEN": bearer,
    };
  }

  async createParcel(input: CourierParcelInput): Promise<CourierParcelResult> {
    // If no token is provided in sandbox/development, provide deterministic sandbox generation
    if (!this.token && this.isSandbox) {
      const trackingId = `RDX-SB-${input.orderNumber}-${Math.floor(Math.random() * 900000 + 100000)}`;
      return {
        carrier: this.name,
        trackingId,
        trackingUrl: `https://redx.com.bd/track/${trackingId}`,
        status: "pickup-pending",
      };
    }

    const body = {
      customer_name: input.recipient.recipient,
      customer_phone: input.recipient.phone,
      customer_address: `${input.recipient.line1}${input.recipient.line2 ? `, ${input.recipient.line2}` : ""}`,
      delivery_area: input.recipient.city || input.recipient.district,
      merchant_invoice_id: input.orderNumber,
      cash_collection_amount: Math.round(input.amountToCollectMinor / 100),
      parcel_weight: input.weightGrams ?? 500,
      value: Math.round(input.declaredValueMinor / 100),
    };

    try {
      const res = await this.doFetch(`${this.base}/parcel`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const data = (await res.json().catch(() => ({}))) as { tracking_id?: string; message?: string; error?: string };

      if (!res.ok || !data.tracking_id) {
        logger.warn("REDX parcel creation failed", {
          status: res.status,
          code: data.message ?? data.error,
        });
        throw new AppError("BUSINESS_RULE_VIOLATION", {
          message: data.message ?? data.error ?? "Failed to create parcel with REDX",
          details: [{ field: "courier", code: "PARCEL_CREATE_FAILED" }],
        });
      }

      return {
        carrier: this.name,
        trackingId: data.tracking_id,
        trackingUrl: `https://redx.com.bd/track/${data.tracking_id}`,
        status: "pickup-pending",
        raw: data as Record<string, unknown>,
      };
    } catch (e: unknown) {
      if (e instanceof AppError) throw e;
      logger.error("REDX request network error", { code: String(e) });
      throw new AppError("INTERNAL", { message: "Courier service currently unreachable" });
    }
  }

  async trackParcel(trackingId: string): Promise<CourierTrackingResult> {
    if (!this.token && this.isSandbox) {
      return {
        carrier: this.name,
        trackingId,
        status: "in-transit",
        events: [
          {
            messageEn: "Parcel received at hub",
            messageBn: "পার্সেলটি হাবে পৌঁছেছে",
            time: new Date(Date.now() - 3600000).toISOString(),
          },
          {
            messageEn: "Package is created successfully",
            messageBn: "পার্সেলটি সফল ভাবে প্লেস করা হয়েছে",
            time: new Date(Date.now() - 7200000).toISOString(),
          },
        ],
      };
    }

    try {
      const res = await this.doFetch(`${this.base}/parcel/track/${encodeURIComponent(trackingId)}`, {
        method: "GET",
        headers: this.headers(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const data = (await res.json().catch(() => ({}))) as {
        tracking?: { message_en?: string; message_bn?: string; time?: string }[];
      };

      const events = (data.tracking ?? []).map((t) => ({
        messageEn: t.message_en ?? "Update",
        messageBn: t.message_bn,
        time: t.time ?? new Date().toISOString(),
      }));

      const latest = events[0]?.messageEn?.toLowerCase() ?? "";
      const status = latest.includes("delivered")
        ? "delivered"
        : latest.includes("return")
        ? "returned"
        : latest.includes("cancel")
        ? "cancelled"
        : "in-transit";

      return {
        carrier: this.name,
        trackingId,
        status,
        events,
      };
    } catch (e: unknown) {
      logger.warn("REDX tracking lookup error", { code: String(e) });
      return {
        carrier: this.name,
        trackingId,
        status: "unknown",
        events: [],
      };
    }
  }
}
