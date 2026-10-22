import { getEnv } from "@/server/config/env";
import { AppError } from "@/server/shared/errors";
import { MockPaymentAdapter } from "./mock";
import { SslCommerzAdapter } from "./sslcommerz";
import type { PaymentProviderAdapter } from "./types";

let override: PaymentProviderAdapter | undefined;
export const setPaymentAdapter = (a: PaymentProviderAdapter | undefined): void => {
  override = a;
};

let cached: { key: string; adapter: PaymentProviderAdapter } | undefined;

/** The single enabled provider, resolved from validated server configuration. Never from request input. */
export function getPaymentAdapter(): PaymentProviderAdapter {
  if (override) return override;
  const env = getEnv();
  const key = `${env.PAYMENT_PROVIDER}:${env.PAYMENT_MODE}`;
  if (cached?.key === key) return cached.adapter;
  let adapter: PaymentProviderAdapter;
  switch (env.PAYMENT_PROVIDER) {
    case "mock":
      adapter = new MockPaymentAdapter();
      break;
    case "sslcommerz":
      adapter = new SslCommerzAdapter({ storeId: env.SSLCOMMERZ_STORE_ID!, storePassword: env.SSLCOMMERZ_STORE_PASSWORD!, mode: env.PAYMENT_MODE });
      break;
    default:
      throw new AppError("CAPABILITY_UNSUPPORTED", { message: "No payment provider is configured." });
  }
  cached = { key, adapter };
  return adapter;
}

/** Webhook routes name a provider in the path; only the configured, enabled one is accepted. */
export function getAdapterForWebhook(providerId: string): PaymentProviderAdapter {
  const adapter = getPaymentAdapter();
  if (adapter.id !== providerId) throw new AppError("NOT_FOUND");
  return adapter;
}
