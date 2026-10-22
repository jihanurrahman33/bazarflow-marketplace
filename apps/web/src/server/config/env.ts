import { z } from "zod";

const secret = z.string().min(32, "must be at least 32 characters");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_ORIGIN: z.url(),
    MONGODB_URI: z.string().min(1),
    MONGODB_DB: z.string().min(1).default("bazarflow"),
    JWT_ACCESS_SECRET: secret,
    REFRESH_TOKEN_PEPPER: secret,
    JWT_ISSUER: z.string().min(1).default("bazarflow"),
    JWT_AUDIENCE: z.string().min(1).default("bazarflow-api"),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    PAYMENT_PROVIDER: z.enum(["mock", "sslcommerz"]).default("mock"),
    PAYMENT_MODE: z.enum(["sandbox", "live"]).default("sandbox"),
    PAYMENT_WEBHOOK_SECRET: secret,
    SSLCOMMERZ_STORE_ID: z.string().optional(),
    SSLCOMMERZ_STORE_PASSWORD: z.string().optional(),
    CLOUDINARY_CLOUD_NAME: z.string().optional(),
    CLOUDINARY_API_KEY: z.string().optional(),
    CLOUDINARY_API_SECRET: z.string().optional(),
    STOCK_RESERVATION_TTL_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
    DEFAULT_COMMISSION_BPS: z.coerce.number().int().min(0).max(10000).default(1000),
    /** Cash on delivery is opt-in: only enable once operations can actually collect and reconcile cash. */
    COD_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  })
  .superRefine((env, ctx) => {
    if (env.PAYMENT_PROVIDER === "mock" && env.PAYMENT_MODE === "live") {
      ctx.addIssue({ code: "custom", path: ["PAYMENT_PROVIDER"], message: "mock provider cannot run in live mode" });
    }
    if (env.PAYMENT_PROVIDER === "mock" && env.NODE_ENV === "production" && env.PAYMENT_MODE !== "sandbox") {
      ctx.addIssue({ code: "custom", path: ["PAYMENT_MODE"], message: "mock provider requires sandbox mode" });
    }
    if (env.PAYMENT_PROVIDER === "sslcommerz" && (!env.SSLCOMMERZ_STORE_ID || !env.SSLCOMMERZ_STORE_PASSWORD)) {
      ctx.addIssue({ code: "custom", path: ["SSLCOMMERZ_STORE_ID"], message: "SSLCOMMERZ credentials required" });
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Parse and validate the environment once; throws with a readable list on failure. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return result.data;
}

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Test hook: replace the cached environment. */
export function setEnvForTests(env: Env | undefined): void {
  cached = env;
}
