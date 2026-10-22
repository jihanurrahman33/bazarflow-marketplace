# 13 — Observability, Firebase, CI/CD and Deployment

## 1. Server observability

- Emit structured JSON logs with timestamp, severity, environment, service/module, request ID/correlation ID, actor ID when safe, route/template, result code, duration and trace/job IDs.
- Never log tokens, passwords, OTPs, payment credentials, complete addresses, raw card data or unrestricted webhook bodies. Redact by allowlist, not just regex cleanup after logging.
- Monitor request error rate/latency, checkout conversion/failure, payment pending/unknown age, webhook verification failures, reconciliation backlog, inventory reservation expiry, order state failures, notification retries, job dead letters, MongoDB slow queries and database saturation.
- Define alert thresholds and owner/runbook for payment verification, order finalization and financial reconciliation alerts.
- `requestId` is returned to clients in safe errors so support can locate the log trace.

## 2. Metrics and business-event model

Define a central event catalogue, including examples:
- `catalog.product_viewed`
- `cart.item_added`
- `checkout.started`
- `checkout.completed`
- `payment.attempt_created`
- `payment.confirmed`
- `payment.failed`
- `order.vendor_order_shipped`
- `refund.completed`

Specify event producer, allowed properties, unique event/correlation ID, environment and retention. Avoid logging raw PII or user-authored content. Do not treat analytics events as the financial system of record; orders/payments/ledger are authoritative.

## 3. Firebase integration

For each Flutter app, decide whether to use a dedicated Firebase app registration or a shared Firebase project with separate app registrations. Maintain dev/staging/prod separation where practicable.

- **Crashlytics:** capture uncaught Flutter errors and async errors intentionally; report meaningful nonfatal exceptions. Verify test crash delivery before release. Add breadcrumbs via approved Analytics/events when appropriate.
- **Analytics:** use a documented event schema and verify with DebugView. Follow applicable consent, platform disclosure and retention obligations; never include tokens, payment data, full address or raw support text.
- **FCM:** register/refresh the device registration with API, associate device to authenticated user, remove or deactivate on logout/device unlink where the design requires, handle invalid tokens, and route message taps to an authorized resource fetch.
- **App Check:** consider enabling for Firebase resources; API access still requires normal authz, rate limits and server-side validation.

## 4. Background work and outbox

Use a durable outbox/worker for side effects that must follow a database commit: order/payment notifications, receipts, seller alerts, search indexing and AI document ingestion. Worker requirements:
- idempotent handler;
- retryable vs terminal error classification;
- exponential backoff with jitter and max attempts;
- dead-letter queue/collection and re-drive tooling;
- attempt timestamps and redacted error codes;
- metrics/alerts for oldest unprocessed event;
- no assumption that delivery is exactly once.

Redis + BullMQ or another compatible queue may be introduced for worker execution, but outbox state in MongoDB remains durable. Do not use fire-and-forget promises from a Route Handler for critical side effects.

## 5. Environment/configuration

Validate environment variables once at startup with a schema. Fail fast on missing required variables; do not silently default production to sandbox or an insecure mode. Maintain `.env.example` with placeholder values and document which app/route requires each variable.

Separate at minimum:
- local development;
- automated test;
- staging/sandbox payment environment;
- production/live payment environment.

Include explicit variables for app origin/public URL, MongoDB URI/database, token signing/verification keys or key references, refresh hashing pepper if used, Cloudinary server credentials, payment provider credentials/base URL selector, Firebase server credentials or workload identity, AI provider/model (only when enabled), rate-limiter/queue config and observability exporter.

Keep public `NEXT_PUBLIC_*` values strictly non-secret. Payment mode must be selected server-side via validated deployment config; don't let a request parameter switch a live gateway to another environment.

## 6. Deployment and release

- Deploy Next.js to a platform that supports the chosen Route Handler, webhook timeout/body-size and background-worker model. Keep a worker separately runnable if long-running tasks are needed.
- Prefer managed MongoDB with backups and monitoring. Ensure replica-set transactions are supported in the target configuration.
- Put CDN caching only in front of appropriate public content. Test private-response cache isolation and catalog invalidation.
- Use secret manager/short-lived cloud identity and TLS. Restrict database and admin access by network/IAM where possible.
- Use backward-compatible migrations: add field/index, deploy compatible code, backfill, then remove old behaviour in a later release.
- Use feature flags for payments/provider activation, AI, payout automation and high-risk policies.
- Run a staged rollout; keep a rollback plan for code and data changes.
- Verify app signing/release credentials and environment bundles for Android/iOS; no sandbox/live crossover.

## 7. Launch operations

Maintain runbooks for:
- gateway outage/timeouts/unknown payments;
- payment reconciliation and duplicate callback investigation;
- stuck inventory reservations;
- stuck outbox events/FCM failures;
- MongoDB failover and restore;
- compromised provider credentials/session revocation;
- bad deployment/rollback;
- user/vendor report, suspension and refund review.

Before live launch perform a backup restore drill, payment test in the provider-approved production preflight process, limited-value pilot where permitted, daily ledger/provider reconciliation and support ownership assignment.
