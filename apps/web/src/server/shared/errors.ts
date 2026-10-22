/** Stable, machine-readable error codes. Clients branch on these, never on messages. */
export const ErrorCodes = {
  VALIDATION_FAILED: { status: 400, message: "The request is invalid." },
  MALFORMED_JSON: { status: 400, message: "The request body is not valid JSON." },
  UNAUTHENTICATED: { status: 401, message: "Authentication is required." },
  TOKEN_EXPIRED: { status: 401, message: "The access token has expired." },
  INVALID_CREDENTIALS: { status: 401, message: "Email or password is incorrect." },
  REFRESH_TOKEN_INVALID: { status: 401, message: "The session is no longer valid." },
  FORBIDDEN: { status: 403, message: "You are not allowed to perform this action." },
  ACCOUNT_SUSPENDED: { status: 403, message: "This account is suspended." },
  STEP_UP_REQUIRED: { status: 403, message: "Please confirm your password to continue." },
  ORIGIN_NOT_ALLOWED: { status: 403, message: "Request origin is not allowed." },
  NOT_FOUND: { status: 404, message: "The resource was not found." },
  CONFLICT: { status: 409, message: "The request conflicts with the current state." },
  EMAIL_TAKEN: { status: 409, message: "An account with this email already exists." },
  INVALID_STATE_TRANSITION: { status: 409, message: "This state transition is not allowed." },
  IDEMPOTENCY_KEY_REQUIRED: { status: 400, message: "An Idempotency-Key header is required." },
  IDEMPOTENCY_KEY_REUSED: { status: 409, message: "This Idempotency-Key was used with a different request." },
  IDEMPOTENCY_IN_PROGRESS: { status: 409, message: "A request with this Idempotency-Key is still in progress." },
  INVENTORY_UNAVAILABLE: { status: 409, message: "The requested quantity is no longer available." },
  PRODUCT_UNAVAILABLE: { status: 409, message: "A product in the request is no longer available." },
  PRICE_CHANGED: { status: 409, message: "A price has changed since the quote." },
  VENDOR_NOT_ACTIVE: { status: 403, message: "The vendor is not active." },
  CART_EMPTY: { status: 422, message: "The cart is empty." },
  BUSINESS_RULE_VIOLATION: { status: 422, message: "The request violates a business rule." },
  PAYLOAD_TOO_LARGE: { status: 413, message: "The request body is too large." },
  RATE_LIMITED: { status: 429, message: "Too many requests. Try again later." },
  PAYMENT_PROVIDER_UNAVAILABLE: { status: 502, message: "The payment provider is unavailable." },
  PAYMENT_VERIFICATION_FAILED: { status: 400, message: "Payment event verification failed." },
  CAPABILITY_UNSUPPORTED: { status: 501, message: "This capability is not supported." },
  INTERNAL: { status: 500, message: "An unexpected error occurred." },
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

export interface FieldIssue {
  field: string;
  code: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: FieldIssue[];
  readonly headers: Record<string, string>;

  constructor(code: ErrorCode, opts: { message?: string; details?: FieldIssue[]; headers?: Record<string, string>; cause?: unknown } = {}) {
    super(opts.message ?? ErrorCodes[code].message, { cause: opts.cause });
    this.name = "AppError";
    this.code = code;
    this.status = ErrorCodes[code].status;
    this.details = opts.details ?? [];
    this.headers = opts.headers ?? {};
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;
