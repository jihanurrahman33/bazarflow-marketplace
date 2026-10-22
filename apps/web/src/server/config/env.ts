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
    /** Refunds at or above this amount (minor units) need a second admin (maker-checker). 0 disables the threshold. */
    REFUND_MAKER_CHECKER_MINOR: z.coerce.number().int().min(0).default(500000),
    PAYMENT_RECONCILE_AFTER_MINUTES: z.coerce.number().int().min(1).max(1440).default(10),
    RETURN_WINDOW_DAYS: z.coerce.number().int().min(0).max(60).default(7),
    /** Payouts at or above this amount need a different admin to mark them paid than the one who approved. */
    PAYOUT_MAKER_CHECKER_MINOR: z.coerce.number().int().min(0).default(1000000),
    MIN_PAYOUT_MINOR: z.coerce.number().int().min(1).default(50000),
    PAYOUT_HOLD_DAYS: z.coerce.number().int().min(0).max(90).default(7),
    /** Serves the fake hosted-payment page. Always off in production unless explicitly enabled for a demo environment. */
    MOCK_PAYMENT_UI: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
    /** Feature flag: the help assistant is off until explicitly enabled. */
    AI_ASSISTANT_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
    /** "none" = retrieval-only answers extracted from approved content (no model involved). */
    AI_PROVIDER: z.enum(["none", "anthropic"]).default("none"),
    ANTHROPIC_API_KEY: z.string().optional(),
    AI_MODEL: z.string().min(1).default("claude-haiku-5-5"),
    SUPPORT_CONTACT: z.string().min(3).default("support@bazarflow.example"),
    /** Raw questions are NOT logged unless a documented purpose/consent/retention plan exists. */
    SUPPORT_LOG_QUESTIONS: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
    COD_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  })
  .superRefine((env, ctx) => {
    if (env.PAYMENT_PROVIDER === "mock" && env.PAYMENT_MODE === "live") {
      ctx.addIssue({ code: "custom", path: ["PAYMENT_PROVIDER"], message: "mock provider cannot run in live mode" });
    }
    if (env.PAYMENT_PROVIDER === "mock" && env.NODE_ENV === "production" && env.PAYMENT_MODE !== "sandbox") {
      ctx.addIssue({ code: "custom", path: ["PAYMENT_MODE"], message: "mock provider requires sandbox mode" });
    }
    if (env.AI_PROVIDER === "anthropic" && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["ANTHROPIC_API_KEY"], message: "required when AI_PROVIDER=anthropic" });
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
