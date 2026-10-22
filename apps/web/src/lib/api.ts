/** Browser API client. Cookie-authenticated; one shared refresh so concurrent 401s never race to rotate the token. */

export interface ApiMeta {
  requestId?: string;
  nextCursor?: string | null;
  hasMore?: boolean;
  [k: string]: unknown;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: { field: string; code: string }[] = [],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
  /** Field-level messages keyed by field, for forms. */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries(this.details.map((d) => [d.field, d.code]));
  }
  get retryable(): boolean {
    return this.status >= 500 || this.code === "NETWORK" || this.code === "TIMEOUT" || this.status === 429;
  }
}

let refreshing: Promise<boolean> | null = null;

export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch("/api/v1/auth/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: "{}", credentials: "same-origin" })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

async function send(path: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  try {
    return await fetch(`/api/v1${path}`, {
      method: opts.method ?? "GET", headers, credentials: "same-origin",
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal ?? AbortSignal.timeout(25_000),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw new ApiError(0, "CANCELLED", "Request cancelled");
    if (e instanceof DOMException && e.name === "TimeoutError") throw new ApiError(0, "TIMEOUT", "The request timed out. Check your connection and try again.");
    throw new ApiError(0, "NETWORK", "You appear to be offline. Check your connection and try again.");
  }
}

/** Registered by the UI: asks the user for their password and resolves true once the server accepted it. */
let stepUpHandler: (() => Promise<boolean>) | null = null;
export const setStepUpHandler = (fn: (() => Promise<boolean>) | null): void => {
  stepUpHandler = fn;
};

export async function api<T = unknown>(path: string, opts: RequestOptions = {}, steppedUp = false): Promise<{ data: T; meta: ApiMeta }> {
  let res = await send(path, opts);
  if (res.status === 401 && !path.startsWith("/auth/")) {
    const peek = await res.clone().json().catch(() => ({}));
    const code = peek?.error?.code;
    if ((code === "TOKEN_EXPIRED" || code === "UNAUTHENTICATED") && (await refreshSession())) res = await send(path, opts);
  }
  if (res.status === 204) return { data: undefined as T, meta: {} };
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.error) {
    const e = json?.error;
    // High-risk admin action: confirm the password once, then retry the SAME request (it was rejected before running).
    if (e?.code === "STEP_UP_REQUIRED" && !steppedUp && stepUpHandler && (await stepUpHandler())) return api<T>(path, opts, true);
    throw new ApiError(res.status, e?.code ?? "INTERNAL", e?.message ?? "Something went wrong.", e?.details ?? [], e?.requestId);
  }
  return { data: json.data as T, meta: (json.meta ?? {}) as ApiMeta };
}

/** Stable per-attempt key: reuse the same value when retrying the SAME logical submission. */
export function newIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return "web-" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** User-facing copy for stable error codes. Never show raw server messages for unknown codes. */
const COPY: Record<string, string> = {
  INVALID_CREDENTIALS: "Email or password is incorrect.",
  EMAIL_TAKEN: "An account with this email already exists. Try signing in.",
  INVENTORY_UNAVAILABLE: "Some items are no longer available in the quantity you chose.",
  PRODUCT_UNAVAILABLE: "An item in your cart is no longer available.",
  PRICE_CHANGED: "Prices changed since you last looked. Please review your order.",
  CART_EMPTY: "Your cart is empty.",
  RATE_LIMITED: "Too many attempts. Please wait a moment and try again.",
  IDEMPOTENCY_IN_PROGRESS: "We are still processing your request. Please wait a moment.",
  VENDOR_NOT_ACTIVE: "This store is not active right now.",
  FORBIDDEN: "You do not have permission to do that.",
  STEP_UP_REQUIRED: "Confirm your password to continue.",
  NETWORK: "You appear to be offline. Check your connection and try again.",
  TIMEOUT: "The request timed out. Please try again.",
  ACCOUNT_SUSPENDED: "This account is suspended. Contact support.",
};

export function messageFor(e: unknown): string {
  if (e instanceof ApiError) return COPY[e.code] ?? (e.status >= 500 ? "Something went wrong on our side. Please try again." : e.message);
  return "Something went wrong. Please try again.";
}
