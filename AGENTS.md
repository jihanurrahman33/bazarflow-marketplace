# AGENTS.md — BazarFlow Multi-Vendor Marketplace

Instructions for coding agents and developers. This file is a condensed operating guide; the full specs live in [`docs/`](docs/) and win on any conflict. Read the relevant doc before editing code, and update it in the same PR when a decision changes.

> Status: all roadmap phases are implemented (see [`docs/15-implementation-status.md`](docs/15-implementation-status.md) for what is verified and what is not; [`docs/16-operations-runbook.md`](docs/16-operations-runbook.md) for operations). The specs in `docs/` still win on conflict. Do not invent unresolved business rules — record assumptions in the task/PR.

## Product at a glance

Independent multi-vendor marketplace (Bangladesh-first, BDT) with three account roles — **Customer, Vendor, Admin** — across six surfaces: public storefront, admin web console, vendor web console, and three separate Flutter apps (customer, vendor, admin). Details: [`docs/01-product-requirements.md`](docs/01-product-requirements.md).

## Stack

| Area | Choice |
|---|---|
| Web + API | Next.js App Router, TypeScript strict; Route Handlers expose versioned REST at `/api/v1` |
| Database | MongoDB (official Node driver), explicit indexes, replica set for transactions |
| Mobile | 3 Flutter apps, BLoC, feature-first Clean Architecture, shared internal Dart packages |
| Media | Cloudinary via server-issued signed uploads |
| Async | Outbox in MongoDB + worker (Redis/BullMQ optional) |
| Payments | Provider adapter boundary; one Bangladesh sandbox provider first |
| Mobile infra | Firebase Crashlytics, Analytics, FCM (App Check optional) |
| AI | Phase 2 only: bounded, cited, read-only support assistant (RAG) |

Architecture is a **modular monolith**. No microservices until measured need ([`02`](docs/02-system-architecture.md)).

## Repository layout

```text
apps/web/              # Next.js: storefront, admin, vendor, API
apps/mobile-customer/  apps/mobile-vendor/  apps/mobile-admin/   # Flutter
packages/contracts/    packages/design-tokens/
mobile_packages/app_core/  design_system/  observability/
docs/  scripts/  .github/workflows/
```

Server code: `apps/web/src/server/{config,shared,db,modules,api}`. Handlers live in `api/handlers/*.ts` and are wrapped by `route()` (auth, CSRF, rate limit, body limit, error envelope, OpenAPI metadata); files under `src/app/api/v1/**` are generated one-line re-exports (`genroutes.mjs`).

## Commands

```bash
scripts/check-all.sh                       # every gate (tokens, typecheck, lint, tests, contract, build, smoke, Flutter)
npm test -w @bazarflow/web                 # needs a MongoDB replica set
npm run contract -w @bazarflow/web      # regenerate packages/contracts/openapi.json after changing any route
node packages/design-tokens/build.mjs      # regenerate CSS + Dart tokens
(cd apps/mobile-customer && flutter analyze --fatal-infos && flutter test)   # likewise per Flutter project
```

## Lessons learned (keep these)

- A duplicate-key error inside a MongoDB transaction aborts it: pre-check, upsert, or catch code 11000 outside `withTransaction`.
- Authorize before parsing the body; every new endpoint must pass the negative-access sweep in `tests/contract.test.ts`.
- Money-moving admin actions need step-up (`requireStepUp`) and, above thresholds, a second approver.
- Flutter widget tests that touch Dio must use `tester.runAsync`; dispose controllers in State classes, not around dialogs; never auto-retry a failing list from a scroll listener.
- Do not claim something works unless a test or run proved it; update docs/15 when a limit changes.
- A `loading.tsx` (including a route-group one) makes Next commit HTTP 200 before data resolves, so routes that must return a real 404 (product, category, vendor) use in-page `<Suspense>` after the existence check instead. The smoke test "unknown product is a real 404" guards this.

Do not share TypeScript runtime logic with Dart; share contracts (OpenAPI) and keep native implementations aligned.

## Non-negotiable rules

1. **Server is the authority.** Never trust client-provided price, role, vendor ID, commission, inventory, payment status or totals. Recalculate and authorize server-side.
2. **Every mutation** needs: authentication, function-level permission, object-level ownership, property allow-list (no mass assignment), state-transition check, input validation, audit/logging and tests. Scope queries by owner (`{ _id, vendorId: actor.vendorId }`).
3. **No business logic** in React components, pages or raw route handlers. Route Handlers only: parse/validate → authenticate → authorize → call use case → map result. No DB access from UI.
4. **Payment truth** comes from verified provider evidence (signed webhook / server status API), never a browser redirect or return URL.
5. **Money** is integer minor units + ISO currency (`amountMinor`, `"BDT"`). No floats. Snapshot price, title, variant, seller, commission rate at purchase. Ledger entries are append-only; fix with reversals.
6. **Idempotency** (`Idempotency-Key`) is required for checkout, refunds, payouts and other money actions; enforce with unique index/atomic claim. Same key + same body → same result; different body → `409 IDEMPOTENCY_KEY_REUSED`.
7. **Never call a payment provider inside an open DB transaction.** Persist attempt first, call outside, reconcile via short transaction. A provider timeout is `unknown` → verify by merchant reference; never blindly re-charge.
8. **Stock** uses conditional decrements (`onHand - reserved >= qty`, check matched count). A cart is not a reservation.
9. **Separate state machines** for payment, order, vendor-order, refund, payout, vendor application — with enumerated states and transition functions (CAS/version fields). Payment state ≠ fulfillment state.
10. **No secrets** in Git, client bundles, mobile binaries, analytics or logs. Parse/validate env at startup, fail fast. `.env.example` with fake placeholders only. Payment mode is server-config, never request-driven.
11. **Keep API contracts versioned and compatible** between web and mobile; breaking change needs a versioning/migration plan.
12. Do not copy competitor trademarks, private APIs, assets, listing text or distinctive UI.

## Architecture conventions ([`02`](docs/02-system-architecture.md))

- Modules: `identity`, `authorization`, `vendors`, `catalog`, `pricing`, `inventory`, `cart`, `checkout`, `orders`, `payments`, `ledger`, `fulfillment`, `reviews`, `notifications`, `admin`, `support-ai`. Cross-module writes go through explicit application orchestration.
- Use patterns where they solve a real problem: Repository, Strategy, Adapter, Factory/Registry, State machines, Specification/Policy, Unit of Work, Outbox + idempotent consumer. SOLID, but no interface for every one-liner.
- Rendering: public catalog pages SSR/ISR with cache tags; cart, checkout, account, vendor/admin consoles are dynamic and never shared-cached. SSR/middleware is not authorization.
- Don't implement the same transaction in both a Server Action and a REST route.

## Data ([`03`](docs/03-mongodb-domain-model.md))

- Design from workloads; embed bounded data, reference high-growth/separately authorized data.
- Order split: parent `orders` + child `vendorOrders` (embedded item snapshots). One `inventoryItems` record per SKU plus append-only `inventoryMovements`.
- Unique `(provider, providerEventId)` for webhook dedupe; store refresh-token **hashes** only; session family IDs for reuse detection.
- Beware unique indexes on optional fields (use partial filters). Don't copy example indexes blindly; validate against query plans.
- Migrations and index scripts are versioned and safe to re-run. Paginate with cursors; use projections for public views (no password hash/PII).

## Auth & security ([`04`](docs/04-auth-security.md))

- Web: HttpOnly/Secure/SameSite session cookies, CSRF protection, never tokens in `localStorage`. Re-check authz in every Server Action and Route Handler.
- Mobile: short-lived signed JWT access token (5–15 min, in memory) + opaque rotating refresh token in `flutter_secure_storage`; single-flight refresh; reuse detection revokes the family.
- Passwords: Argon2id (maintained library). Non-enumerating login/reset responses. Step-up auth for high-risk admin actions.
- Central helpers: `requireAuthenticated`, `requirePermission`, `requireResourceOwner`, `requireVendorActive`, `assertTransitionAllowed`.
- Validate path/query/header/body with explicit schemas; reject unknown fields; rate-limit (strict for OTP, login, search, checkout, refunds, AI); never pass client Mongo operators; prevent SSRF; redact logs by allow-list.
- Cloudinary: server issues signed params restricted by folder, type, size, format, expiry; bind uploaded `public_id` to an authorized vendor/product.
- Follow OWASP Top 10 and API Security Top 10.

## API contract ([`05`](docs/05-api-contract.md))

- REST under `/api/v1`, plural resources, OpenAPI published and validated in CI.
- Envelopes: `{ data, meta: { requestId } }`, paged `meta: { nextCursor, hasMore }`, errors `{ error: { code, message, details[], requestId } }`. Stable machine-readable `code`; clients branch on code, not message. No stack traces or raw DB/provider payloads.
- Status codes: 200/201/202/204; 400, 401, 403, 404 (may conceal), 409, 422, 429, 5xx.
- Private responses `Cache-Control: no-store`; public catalog cached with explicit invalidation. Cursor pagination with bounded `limit`; allow-listed sort/filter fields.
- Timestamps ISO 8601 UTC; money as `amountMinor` + currency; central enum definitions that older clients tolerate.
- Webhooks: `POST /webhooks/payments/:provider` — provider signature auth, durable dedupe, size limit, not tied to a browser session.

## Checkout & payments ([`06`](docs/06-checkout-payments.md))

- Keep four concepts separate: checkout/order creation, payment collection, fulfillment, vendor settlement.
- **Do not assume** a gateway supports split payments, seller KYC, escrow or payouts. Confirm provider eligibility in writing before live. MVP settlement = immutable internal ledger + operations-controlled reconciled payouts, only if legally permitted.
- `PaymentProviderAdapter` (`createCheckout`, `getPaymentStatus`, `parseAndVerifyWebhook`, optional `refund`, `capabilities`) via a registry; missing capability disables the feature, never simulates it. Normalize errors; no provider fields leaking into domain code.
- Flow: revalidate → reserve stock → persist order + payment attempt → call provider outside transaction → webhook verified (signature + amount/currency/reference/state) → dedupe + CAS transition + ledger/outbox in one short transaction → client polls. Duplicate/out-of-order callbacks must not duplicate stock, ledger, notifications or refunds. Scheduled reconciliation for stuck `pending`/`unknown`.
- Refunds are first-class records with partial-refund-safe accounting and ledger reversals. Never label payables "paid" before actual settlement.
- Never store PAN/CVV; use hosted checkout/tokenization.

## Flutter ([`07`](docs/07-flutter-app-architecture.md), [`08`](docs/08-design-system-and-ux.md))

- Three apps, separate IDs and pipelines; shared Dart packages; no admin code reachable from user binaries.
- Feature-first: `features/<name>/{data,domain,presentation}`; presentation→domain, data→domain; domain has no Flutter/Dio/Firebase/Hive.
- BLoC: events = intents, states = explicit sealed phases (not boolean soup), repositories map DTOs/errors, widgets render only. `pending` ≠ `failure` — expose "check status", never tell users to pay again while an attempt is unknown.
- Networking: one configured client, correlation IDs, timeouts, typed errors, single-flight refresh, no auto-retry of non-idempotent mutations without an idempotency key.
- Storage: tokens/keys in `flutter_secure_storage`; Hive boxes AES-encrypted with a random key held in secure storage; never persist refresh tokens in Hive; wipe user-scoped data on logout.
- Firebase: redact PII/tokens in Crashlytics and Analytics; FCM payloads small, IDs/deep links only, fetch authorized data on open.
- Design system first: tokens (palette roles, type, spacing, radius), shared `ThemeData` and web CSS variables. No literal colours/sizes in feature screens. Inventory of reusable components in doc 08.
- Every async screen/mutation defines initial/loading, refreshing, loaded, empty, error+retry, pending, cancel/timeout, stale/offline. No generic "Something went wrong"; map error codes to clear copy. Accessibility, contrast, touch targets, Bangla/English and BDT formatting; don't encode meaning in colour alone.

## AI (Phase 2 only — [`09`](docs/09-ai-and-knowledge-base.md))

Do not build before core commerce, permissions, audit and observability are solid. Read-only, cited answers from approved sources; authorize and filter **before** retrieval; treat retrieved text and user input as untrusted (prompt-injection defence); no autonomous refunds/approvals/edits; generated content stays draft until a human publishes; clean fallback when the provider is down; evaluate with a benchmark and red-team set before launch.

## Testing & quality gates ([`10`](docs/10-testing-and-quality-gates.md))

- Pyramid: unit (domain, money, state machines, policies), integration (real Mongo replica set), API (authz/validation), provider contract (mock + sandbox), web, Flutter (repo, BLoC transitions, widget state matrix, e2e), operational (webhook replay, worker retry, rollback).
- Required negative tests per protected endpoint: unauthenticated, wrong role, right role/wrong object, wrong vendor, forbidden fields, disabled account, invalid transition, expired/revoked token, invalid/replayed webhook, rate limit, error redaction.
- Must-prove cases: no cross-customer/cross-vendor access, no oversell under concurrent checkout, duplicate/out-of-order webhooks are harmless, failed payments stay recoverable, fulfillment never overwrites payment status, admin high-risk actions are audited.
- CI per PR: format, lint, strict TS compile / `dart analyze`, tests, production build, dependency audit + secret scan, OpenAPI validation/drift, migration lint. Tests never use production secrets or live payment accounts. Prioritise money, authz and concurrency (~80%+ on critical code as a signal, not a goal).
- **Definition of done:** feature plan + acceptance criteria linked to tests; validation/auth/ownership done; all UI states; privacy-safe logging; accessibility/responsive checked; indexes/migrations/contracts/docs updated; no placeholder secrets or bypassed guards; PR summary with decisions, risk, tests run and screenshots/state matrix.

## Observability & deployment ([`13`](docs/13-observability-and-deployment.md))

- Structured JSON logs with request ID; redact by allow-list; return `requestId` in errors. Monitor payment pending/unknown age, webhook failures, reconciliation backlog, reservation expiry, outbox lag and dead letters.
- Outbox workers are idempotent, classify retryable vs terminal errors, use exponential backoff with jitter, dead-letter and re-drive; no fire-and-forget promises for critical side effects.
- Separate local / test / staging (sandbox) / production (live) config; `NEXT_PUBLIC_*` is never secret. Backward-compatible migrations (add → deploy → backfill → remove). Feature flags for payments, AI and payout automation. Staged rollout with rollback plan; backup restore drill before launch.

## Workflow

1. **Inspect first**: read affected code, conventions, package versions, tests.
2. **Plan first**: touched modules, data/state transitions, API contract, security checks, test plan, deployment risks.
3. **One vertical slice** per PR (DB + domain + API + UI + tests + observability). Follow the dependency-ordered phases in [`11`](docs/11-roadmap-and-feature-plans.md): foundations → identity/authz → catalog & inventory → cart/checkout → one payment provider → fulfillment/ops → production readiness → AI/expansion.
4. **Tests first** where practical, including permissions, invalid transitions, duplicates and failure states.
5. **Verify before reporting**: run format, lint, build, tests, contract checks. Report exactly what passed, failed and was not run. Never claim a test passed unless it ran.
6. **Avoid scope creep**: no new libraries, patterns or services without clear need; no unrelated refactors; keep pinned stable versions.
7. Centralise config, enums, permissions, theme tokens, API error codes and analytics event names — no scattered constants or hardcoded business percentages.

Feature issue template (Goal/non-goals, actors & permissions, entities/state transitions, API & error codes, DB writes/indexes/transaction boundary, UI states, security/abuse cases, observability, tests, acceptance criteria, migration/rollback, dependencies/open questions) is in doc 11; task prompt template in doc 12.

### Required completion report

Summary of behaviour; design decisions/assumptions; API/schema/UI changes; security checks added; tests/commands run with outcomes; known gaps/manual verification; deployment/config/migration needs.

### Stop conditions — do not ship if

An authorization check is missing; payment status can be spoofed from client input; secrets are exposed; duplicate callbacks can duplicate money/order/ledger effects; a migration risks data loss without recovery; tests show cross-vendor data access; or an API change breaks mobile clients without a versioning plan. Escalate with a minimal safe plan.

## Git & GitHub

- Short branches: `feat/…`, `fix/…`, `test/…`, `docs/…`; Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`).
- Protect `main`; CI required; reviewer required for sensitive changes; CODEOWNERS on auth, payment, ledger, env/secrets and infra.
- PR must include: objective, screenshots/state matrix, security/privacy notes, API/schema/migration changes, tests, config changes, rollback plan, linked issue.
- Never commit `.env`, service-account JSON, payment secrets, signing keys, DB dumps or customer data. Use GitHub Actions OIDC over long-lived cloud secrets. Dependency updates in separate reviewed PRs.

## Open business questions (launch blockers — do not assume answers)

Legal entity and registered business category; whether the provider contract allows a marketplace/sub-merchant model; who holds customer funds and bears chargebacks; provider eligibility, currencies, refund and payout support; vendor KYC and payout verification; commission formula and rounding; return/refund policy; data retention and privacy rules; hosting support for webhooks, workers and Mongo transactions; final domain name. Provider status is a candidate list only ([`14`](docs/14-provider-and-source-research.md)) — re-verify official docs before implementation and go-live. This pack is not legal advice.
