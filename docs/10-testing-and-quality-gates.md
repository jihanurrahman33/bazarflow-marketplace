# 10 — Testing Strategy and Quality Gates

## 1. Testing pyramid

1. **Unit tests:** domain rules, money/commission calculations, eligibility specifications, state transitions, normalizers, permission policies and provider payload mapping.
2. **Integration tests:** MongoDB repositories against a real test replica set or supported disposable environment; index constraints, transactions, optimistic concurrency, TTL-related behaviour and unique event/idempotency keys.
3. **API tests:** request validation, auth, RBAC, object/property authorization, response DTOs, rate limits and error shape.
4. **Provider contract tests:** adapters against deterministic mocks and official sandbox workflows. Mock tests are not proof of sandbox or live eligibility.
5. **Web tests:** user journey/component tests for form state, route access, public SEO rendering/caching and safe error rendering.
6. **Flutter tests:** repository tests, BLoC transition tests, widget state matrix and end-to-end tests for auth, checkout status, order updates and notification routing.
7. **Operational tests:** duplicate webhook replay, worker retry/dead letter, restore/reconciliation runbooks, alert delivery and staged deployment rollback.

## 2. Required high-value cases

### Identity/security
- no token, expired token, bad signature/algorithm, rotated/revoked refresh token, refresh-token reuse, user suspended, wrong permission, wrong object owner, mass assignment of forbidden fields.

### Catalog and inventory
- missing/inactive product, variant unavailable, seller unapproved, changed price, duplicate SKU, stock update race, concurrent checkout with limited stock, reservation timeout/release, moderation rejection.

### Checkout/payment
- same idempotency key/same body returns same resource; same key/different body conflicts; gateway decline; redirect without webhook; webhook before redirect; duplicate/out-of-order webhook; invalid signature; amount/currency mismatch; provider timeout/unknown result; verification API timeout; cancellation; partial/full refund; refund retry; reconciliation after worker crash.

### Multi-vendor isolation
- one checkout with two sellers yields one parent order and the correct two vendor orders; vendor A cannot read vendor B's order or ledger; vendor fulfillment update doesn't mutate another child; a vendor cancellation/refund doesn't incorrectly cancel the whole order.

### Observability and notifications
- one business transition produces at-most-once durable notification intent; failed delivery is retried safely; analytics are emitted without PII; logging exceptions never crash a business flow.

### Flutter
- initial/loading/loaded/empty/error/pending/retrying/cancelled states; multiple simultaneous 401s share one refresh; refresh failure logs out cleanly; request is not retried endlessly; stale search results do not overwrite newer results; app opened from foreground/background/terminated notification state.

## 3. Payment provider contract test matrix

For every supported payment method, exercise provider-approved test cases including success, decline, cancellation, asynchronous notification delay, duplicate notifications, malformed signature, wrong amount/currency/reference, refund and edge result codes. Assert both provider adapter output and the business state after handling. Run against the provider sandbox before merging release-ready integration work.

## 4. CI gates

Required checks for every PR, adapted for changed packages:
- format check, lint, TypeScript strict compile or `dart analyze`;
- unit tests and relevant integration/API tests;
- production build for affected app;
- dependency/security audit and secret scanning;
- OpenAPI contract validation and generated-client drift check if applicable;
- migration/index script lint or test;
- no high-severity unresolved security findings without a recorded exception;
- tests cannot rely on production secrets or external live payment accounts.

Coverage target may be used as a signal (e.g. aim for 80%+ on critical domain/application code), but a passing number does not replace meaningful assertion coverage. Prioritize money, authorization and concurrency logic.

## 5. Definition of done for each feature

- A brief feature plan exists, including data/state transitions and dependencies.
- Acceptance criteria are linked to automated tests or documented manual test steps.
- Input validation, auth, permission and ownership checks are implemented.
- Loading, empty, error, pending, cancellation and recovery states exist as applicable.
- Logging and analytics follow privacy policy; sensitive data is redacted.
- Accessibility and responsive layout are checked.
- No placeholder secrets, unapproved provider calls, bypassed guards or untracked side effects remain.
- DB indexes/migrations, API contracts and docs are updated.
- PR summary includes design decisions, risk, tests run, screenshot/state matrix for UI and deployment/config changes.
