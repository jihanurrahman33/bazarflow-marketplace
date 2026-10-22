import { parseEnv, setEnvForTests } from "@/server/config/env";

export const TEST_ENV_SOURCE = {
  NODE_ENV: "test",
  APP_ORIGIN: "http://localhost:3000",
  MONGODB_URI: "mongodb://placeholder",
  MONGODB_DB: "bazarflow_test",
  JWT_ACCESS_SECRET: "test-access-secret-0123456789abcdef-0123456789",
  REFRESH_TOKEN_PEPPER: "test-pepper-secret-0123456789abcdef-0123456789",
  PAYMENT_WEBHOOK_SECRET: "test-webhook-secret-0123456789abcdef-0123456789",
  PAYMENT_PROVIDER: "mock",
  PAYMENT_MODE: "sandbox",
  STOCK_RESERVATION_TTL_MINUTES: "30",
  DEFAULT_COMMISSION_BPS: "1000",
} as const;

export function useTestEnv(overrides: Record<string, string> = {}) {
  const env = parseEnv({ ...TEST_ENV_SOURCE, MONGODB_URI: process.env.TEST_MONGODB_URI ?? "mongodb://localhost", ...overrides });
  setEnvForTests(env);
  return env;
}
