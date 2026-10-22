# 05 — API Contract and Endpoint Inventory

## 1. API style

- REST under `/api/v1`; use plural resource names and standard HTTP semantics.
- Mobile and external provider callbacks use Route Handlers. Internal web pages may use server-side application services, but must not bypass shared authorization/domain rules.
- Publish an OpenAPI contract and use it for review and optionally generated typed clients. Keep request/response schemas versioned.
- All request payloads, query parameters and path identifiers are validated at the boundary. Do not leak MongoDB documents directly.

## 2. Response shape

Success:

```json
{
  "data": { "id": "..." },
  "meta": { "requestId": "..." }
}
```

Paged response:

```json
{
  "data": [],
  "meta": { "requestId": "...", "nextCursor": "opaque-or-null", "hasMore": false }
}
```

Error:

```json
{
  "error": {
    "code": "INVENTORY_UNAVAILABLE",
    "message": "The requested quantity is no longer available.",
    "details": [{ "field": "quantity", "code": "OUT_OF_RANGE" }],
    "requestId": "..."
  }
}
```

`details` are safe, field-level diagnostics only. Production responses must not include stack traces, raw database errors, provider payloads or secret configuration. Use stable machine-readable error codes; client UI should branch on code/status, not the English message.

## 3. HTTP and cache rules

- `200` successful read/update, `201` created resource, `202` durably accepted asynchronous work, `204` successful no-content result.
- `400` malformed/invalid request, `401` missing/invalid authentication, `403` authenticated but not allowed, `404` absent or intentionally concealed resource, `409` state/idempotency conflict, `422` business rule violation where appropriate, `429` rate limit, `5xx` unexpected/transient server failure.
- Private account/order/vendor/admin responses: `Cache-Control: no-store` unless a reviewed design proves otherwise.
- Public catalog responses may be cached with explicit policies and safe invalidation.
- Use cursor pagination with bounded `limit`; never allow arbitrary huge result limits.

## 4. Endpoint inventory (initial proposal)

### Identity
- `POST /auth/register`
- `POST /auth/verify-contact`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `POST /auth/logout-all`
- `POST /auth/password/forgot`
- `POST /auth/password/reset`
- `GET /me`, `PATCH /me`
- `GET /me/sessions`, `DELETE /me/sessions/:sessionId`
- `POST /devices` / `DELETE /devices/:deviceId` for FCM registration lifecycle

### Public catalog
- `GET /categories`
- `GET /products` (query + filter + cursor + sort allowlist)
- `GET /products/:slug`
- `GET /vendors/:slug`
- `GET /vendors/:slug/products`

### Customer
- `GET /cart`, `POST /cart/items`, `PATCH /cart/items/:itemId`, `DELETE /cart/items/:itemId`
- `GET /addresses`, `POST /addresses`, `PATCH /addresses/:id`, `DELETE /addresses/:id`
- `POST /checkout/quote`
- `POST /checkout` — idempotency key required; revalidates all product/stock/shipping details
- `GET /orders`, `GET /orders/:id`
- `POST /orders/:id/cancel` — only eligible states/policies
- `POST /vendor-orders/:id/return-requests` (phase 2 or when policy is ready)
- `POST /products/:id/reviews` (verified purchase and moderation checks)
- `GET /notifications`, `PATCH /notifications/:id/read`

### Vendor
- `POST /vendor/applications`, `GET /vendor/application`
- `GET /vendor/profile`, `PATCH /vendor/profile`
- `GET /vendor/products`, `POST /vendor/products`, `GET /vendor/products/:id`, `PATCH /vendor/products/:id`, `POST /vendor/products/:id/submit-review`
- `POST /vendor/uploads/signature` — signed, permission-scoped upload params
- `GET /vendor/inventory`, `PATCH /vendor/inventory/:skuId`
- `GET /vendor/orders`, `GET /vendor/orders/:id`, `POST /vendor/orders/:id/accept`, `POST /vendor/orders/:id/ship`
- `GET /vendor/ledger`, `GET /vendor/payouts`

### Admin
- `GET /admin/vendors`, `POST /admin/vendor-applications/:id/approve`, `POST /admin/vendor-applications/:id/reject`, `POST /admin/vendors/:id/suspend`
- `GET /admin/products/review-queue`, `POST /admin/products/:id/approve`, `POST /admin/products/:id/reject`
- `GET /admin/orders`, `GET /admin/orders/:id`
- `GET /admin/payments/reconciliation`, `POST /admin/payments/:id/reconcile`
- `POST /admin/refunds/:id/approve` and payout approval endpoints only after financial workflows are specified
- `GET /admin/audit-logs`
- `GET /admin/reports/...` with permission and result-size limits

### Provider callbacks / webhooks
- `POST /webhooks/payments/:provider` — provider-specific signature/status verification, durable deduplication, strict size limit. These are not authenticated like a user route; they use provider authentication and reconcile against a stored payment attempt.
- Callbacks must not be coupled to the browser session.

## 5. Idempotency contract

Use `Idempotency-Key` for checkout, payment creation where suitable, refunds, payout requests and other external-money actions. Scope the key to actor + operation; store request hash and outcome/resource reference. Reuse of the same key with the same request should return the original result. Reuse with a different request should return `409 IDEMPOTENCY_KEY_REUSED`. Define retention, concurrent-request locking and recovery for an in-progress attempt.

Idempotency is not simply accepting a header: it requires a unique index/atomic claim, payload consistency, and a clear strategy when a provider response is unknown.

## 6. Contract design requirements

- Use DTOs, never return password/session/provider secret fields.
- Filter/sort fields are allowlisted; no client-controlled MongoDB selectors/pipelines.
- Use ISO 8601 UTC timestamps over the API, with local-time formatting only in presentation.
- Money includes both integer `amountMinor` and ISO currency code. Do not infer currency from locale.
- Enum/state values are centrally defined and documented. Additive enum growth must be handled safely by older clients.
- Every error response has a stable `code` and `requestId`.
- Document auth requirement, permissions, rate limits, idempotency, cache policy, error codes and tests for each endpoint.
