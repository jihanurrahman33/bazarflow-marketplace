# 16 — Operations Runbook

Companion to docs/13. Commands assume the repository root. Every incident below is something the system is designed to survive; the point of each runbook is to *verify before acting* (never re-charge, never release stock, never mark paid on a hunch).

## 1. Environments and configuration

`apps/web/.env.example` documents every variable. The server validates the environment once at boot (`src/instrumentation.ts`) and refuses to start on a bad value. Keep four separate configurations: local, automated test, staging (sandbox payments) and production (live payments).

Rules that the code enforces — do not work around them:

- `PAYMENT_PROVIDER=mock` is rejected with `PAYMENT_MODE=live`. The mock hosted page (`/mock-pay`) is served only outside production unless `MOCK_PAYMENT_UI=true` (for a staging demo).
- `AI_PROVIDER=anthropic` requires `ANTHROPIC_API_KEY`; the help assistant is off unless `AI_ASSISTANT_ENABLED=true`.
- Secrets are ≥ 32 characters; `NEXT_PUBLIC_*` is never used for anything secret.
- Email and push are **not sent** unless `SMTP_URL` / `FCM_SERVICE_ACCOUNT_JSON` are set (a warning is logged and the in-app inbox still works). Without SMTP nobody can verify an email or reset a password — set it before any real user signs up.

## 2. Deploying

- The web app is a stateless Next.js server (`npm run build`, `npm start`). It needs outbound HTTPS (payment provider, Cloudinary, SMTP, FCM) and a MongoDB **replica set** (Atlas or self-hosted) — transactions are mandatory.
- Run **one or more `npm run worker` processes** next to it. The worker drains the outbox, reconciles stuck payments, cancels unpaid orders whose reservation expired, and retries unresolved refunds. All of its jobs are idempotent, so overlap and restarts are safe. Without a worker: no notifications, no expiry, no reconciliation.
- Order of a release: (1) deploy backward-compatible code, (2) `npm run db:indexes` (idempotent), (3) backfill if needed, (4) remove old behaviour in a later release. Never run a destructive migration in the same release that stops reading the old field.
- Webhook endpoint: `POST https://<origin>/api/v1/webhooks/payments/<provider>` must be reachable by the provider over TLS; payload limit 32 KB. Register it in the provider's dashboard together with the IPN/return URLs used in the checkout request (`APP_ORIGIN` must be the public origin).
- Public pages send `Cache-Control: public, s-maxage` only on catalogue reads; everything private is `no-store`. If a CDN is added, never cache `/api/v1/*` except the routes that send `s-maxage`.

## 3. First-day checklist

1. Generate secrets (`openssl rand -base64 48`) for `JWT_ACCESS_SECRET`, `REFRESH_TOKEN_PEPPER`, `PAYMENT_WEBHOOK_SECRET`.
2. `npm run db:indexes`, then create the first admin: `SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… npm run db:seed` (all permissions; create narrower admins afterwards through the database or a future admin-management screen).
3. Create categories in the admin console; `npm run knowledge:seed` for help content.
4. Verify `/api/health` (liveness) and `/api/ready` (config + database); point the load balancer at `/api/ready`.
5. Confirm a verification email arrives and a push reaches a test device **before** inviting users.

## 4. Mobile apps and Firebase

Each app has its own application id (`com.bazarflow.customer|vendor|admin`). Per app and per environment run `flutterfire configure` (creates `firebase_options`/`google-services.json`/`GoogleService-Info.plist`; do **not** commit production values). Until then the apps run with Firebase disabled (analytics/crash/push are safe no-ops). For iOS push upload an APNs key to Firebase and enable the Push Notifications capability. Crashlytics collection is disabled in debug builds. Build with `--dart-define=API_BASE_URL=https://api.example.com --dart-define=APP_ENV=production` (production requires https). Sign releases with keys held outside the repository.

## 5. Monitoring

`GET /api/v1/admin/ops/health` (needs `report.read`) returns the numbers to alert on:

| Signal | Alert when | First action |
|---|---|---|
| `outbox.dead` | > 0 | §6.5 |
| `outbox.oldestPendingAgeSeconds` | > 300 | is the worker running? |
| `payments.unknown`, `payments.stuckLive` | > 0 for 15+ min | §6.2 |
| `refunds.failed` | > 0 | admin console → Refunds → Retry |
| `reservations.expiredActive` | > 0 for 5+ min | worker down; stock is being held |

Logs are JSON on stdout with `requestId`; every error response returns the same `requestId` so support can find the trace. Logs never contain tokens, passwords, OTPs, addresses or provider payloads (allow-list logger).

## 6. Incident runbooks

### 6.1 Payment provider outage or timeouts
Checkout still creates the order; the payment shows `failed` (provider unreachable → safe to retry) or `unknown` (timed out → **not** safe). Customers see "Please don't pay again". Do nothing destructive. When the provider recovers the reconciler resolves `unknown` attempts by merchant reference; or use Admin → Payment exceptions → *Reconcile*.

### 6.2 Payment shows `unknown` / stuck
1. Admin → Payment exceptions → *Reconcile* (asks the provider server-side).
2. If it stays `unknown`, look the transaction up in the provider's merchant dashboard by the merchant reference (`<ORDER>-<n>`).
3. Paid there but not here: reconcile again after the provider's status API reflects it. Never create a manual "paid" state — there is none by design.
4. Not found at the provider after the reservation window: the reconciler closes the attempt as `failed`.
5. An amount/currency mismatch parks the payment (`failureReason=amount_mismatch`, audit entry `payment.amount_mismatch`): contact the provider; do not release goods.

### 6.3 Duplicate or late payment
Handled automatically: money for a cancelled/expired/already-paid order creates a system refund (visible in Admin → Refunds, labelled *auto*). If its execution is `failed`, press *Retry*.

### 6.4 Stuck inventory reservations
`reservations.expiredActive > 0` means the worker is not running `expireUnpaidOrders`. Start it. Reservations are released exactly once (status compare-and-set), so running it late is safe.

### 6.5 Outbox dead letters
`db.outboxEvents.find({state:"dead"})` shows `type`, `lastErrorCode`, `attempts`. Fix the cause (credentials, provider), then re-queue: `db.outboxEvents.updateMany({state:"dead", _id:{$in:[…]}}, {$set:{state:"pending", attempts:0, nextAttemptAt:new Date()}})`. Handlers are idempotent (notifications dedupe on `dedupeKey`, refunds on their id).

### 6.6 Suspected account or credential compromise
User: Admin → Users → *Suspend* (revokes every session immediately). Secrets: rotate `JWT_ACCESS_SECRET` (invalidates all access tokens), `REFRESH_TOKEN_PEPPER` (invalidates all refresh tokens — everyone signs in again), provider keys, SMTP/FCM/Cloudinary keys; then restart. Review `auditLogs` for the actor.

### 6.7 Bad deploy
Roll back the code first; database changes are additive so the previous version keeps working. If a new index build is the problem, drop only that index by name.

### 6.8 Seller or product report
Admin → Sellers → *Suspend* hides the catalogue immediately and blocks accepting/shipping (cancelling stays possible so customers get refunds). Admin → Product review rejects with a reason the seller sees. Everything is audited.

## 7. Backups and restore drill (must be performed before launch)

Use point-in-time backups (Atlas continuous backup or `mongodump` with oplog on a schedule). Drill: restore into a scratch cluster, point a staging build at it, then verify (a) order totals equal the sum of their seller orders, (b) for every vendor the ledger sum equals available + pending + paid out, (c) no payment is `succeeded` without a confirmed order or an auto-refund. Record the time taken; it is your recovery-time objective.

Daily reconciliation (once real money flows): provider settlement report vs `payments.status=succeeded` totals vs ledger `sale_gross`.

## 8. Store submissions (not yet done)

Prepare: privacy policy and data-safety/App Privacy answers (data collected: account email/name/phone/addresses, order history, device push token, crash and usage analytics without PII), notification permission copy, signing keys, staged rollout, and a rollback plan. Test on real devices (foreground/background/terminated notification taps, token expiry, offline, step-up prompt) — this has not been done.
