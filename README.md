# BazarFlow

A multi-vendor marketplace: a Next.js web app and versioned REST API (storefront, seller console, admin console), three Flutter apps (customer, seller, admin), and a MongoDB data model, built phase by phase from the specification pack in [`docs/`](docs/README.md).

> **Status:** all roadmap phases are implemented and verified by automated tests (details and honest limits in [`docs/15-implementation-status.md`](docs/15-implementation-status.md)). It is **not production-ready until the launch blockers in that file are closed**: payment provider approval, a real sandbox run, email/Firebase/Cloudinary credentials, and a device/browser pass.

## What is in the repository

```text
apps/
  web/                  Next.js 16 (App Router, TypeScript strict): storefront, seller + admin consoles, REST API /api/v1
  mobile-customer/      Flutter customer app   (BLoC, go_router)
  mobile-vendor/        Flutter seller app     (orders, stock, prices, earnings)
  mobile-admin/         Flutter admin app      (queues, refunds, payouts; step-up auth)
mobile_packages/
  app_core/             API client, session (secure refresh token), cubits, deep links, push boundary
  design_system/        Material 3 themes + accessible state widgets, generated from the shared tokens
  observability/        analytics/Crashlytics/FCM behind redacting interfaces (no-op without Firebase)
packages/
  design-tokens/        tokens.json -> web CSS + Dart theme (node packages/design-tokens/build.mjs)
  contracts/            openapi.json, generated from the route handlers and checked for drift in CI
docs/                   specification pack (01–14) + implementation status (15) + runbook (16)
scripts/check-all.sh    every quality gate, locally
```

## Quick start (web + API)

Requirements: Node 22+, a MongoDB **replica set** (transactions are used; `docker run -d -p 27017:27017 mongo:8 --replSet rs0` then `rs.initiate()`), Flutter 3.4x for the mobile apps.

```bash
npm install
cp apps/web/.env.example apps/web/.env.local     # fill in the secrets (>= 32 chars each); see comments inside
npm run db:indexes -w @bazarflow/web             # idempotent
SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='a-long-password' npm run db:seed -w @bazarflow/web
npm run knowledge:seed -w @bazarflow/web         # optional: help-assistant content
npm run dev                                      # http://localhost:3000
npm run worker -w @bazarflow/web                 # outbox, payment reconciliation, order expiry, refund retries
```

Payments default to the **mock sandbox provider**: checkout redirects to a fake hosted page (`/mock-pay/...`) that delivers a *signed webhook* through the same code path a real provider uses. To use SSLCOMMERZ set `PAYMENT_PROVIDER=sslcommerz` plus its sandbox credentials.

Mobile apps: `cd apps/mobile-customer && flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000` (Android emulator). Firebase is optional until you run `flutterfire configure` (see [`docs/16`](docs/16-operations-runbook.md)).

## Quality gates

```bash
scripts/check-all.sh          # tokens in sync, typecheck, lint, 269 web tests, contract drift, production build,
                              # 57-check end-to-end smoke against the built server, then analyze+test of all 6 Flutter projects
```

CI runs the same checks (`.github/workflows/web.yml`, `mobile.yml`). The most important suites:

| Suite | What it proves |
|---|---|
| `tests/contract.test.ts` | every endpoint rejects guests, bad tokens, wrong roles, missing permissions and cross-origin cookie writes; contract has not drifted |
| `tests/payments.test.ts` | duplicate / out-of-order / forged webhooks, amount mismatch, timeouts, late and duplicate payments, concurrent refunds, ledger without drift |
| `tests/checkout.test.ts`, `catalog.test.ts` | no oversell under concurrency, idempotent checkout, multi-seller split with frozen commission |
| `tests/support.test.ts` | retrieval benchmark, access-controlled retrieval, prompt-injection and model-misbehaviour handling |
| `scripts/smoke.ts` | a full purchase over real HTTP against the production build |

## Where to read next

- [`docs/15-implementation-status.md`](docs/15-implementation-status.md) — what exists, decisions taken, known limits, launch blockers
- [`docs/16-operations-runbook.md`](docs/16-operations-runbook.md) — environments, deployment, incident runbooks, backups
- [`AGENTS.md`](AGENTS.md) — rules and conventions for anyone (human or agent) changing this code
- [`docs/README.md`](docs/README.md) — index of the specification pack
