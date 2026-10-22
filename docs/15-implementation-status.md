# 15 — Implementation Status, Decisions and Known Limits

*Last verified: 22 October 2026.* This file records what was built against docs 01–14, the decisions made where the specification left room, and — most importantly — what has **not** been proven. Update it whenever any of those change.

## 1. Verification summary

| Area | Result |
|---|---|
| Web typecheck (TS strict) / ESLint | clean |
| Web tests (Vitest, real MongoDB replica set) | **195 passing** in 13 files |
| API contract | 117 operations generated from the handlers; drift-checked; every endpoint negative-tested |
| End-to-end smoke (`scripts/smoke.ts`) | **57/57** against the production build over real HTTP |
| Flutter | `flutter analyze --fatal-infos` clean in all 6 projects; **124 tests** (app_core 39, design_system 15, observability 6, customer 41, seller 12, admin 11) |

## 2. Roadmap phases (docs/11)

| Phase | Status | Notes |
|---|---|---|
| 0 Foundations | done | env schema fails fast at boot, structured logs, CI, index/seed/worker scripts, design tokens |
| 1 Identity & authorization | done | rotating refresh tokens with reuse detection, cookie + bearer transports, RBAC + ownership, vendor application review |
| 2 Catalog & inventory | done | variants, moderation, Cloudinary signed uploads, conditional-write reservations, public search |
| 3 Cart & checkout | done | server-side quote, idempotent checkout, parent + per-seller orders, expiry worker |
| 4 One payment provider end-to-end | done (see §5) | adapter boundary, SSLCOMMERZ + mock sandbox, webhooks, reconciliation, refunds, append-only ledger |
| 5 Fulfilment & daily operations | done | guarded transitions, returns, reviews, payouts, admin support/reports, FCM + SMTP adapters |
| 6 Production readiness | partly done | health/ops endpoints, rate limits, CSP, security headers, runbook; **load test, backup/restore drill and store submissions are not done** |
| 7 AI & expansion | done (AI) | bounded, cited help assistant behind a feature flag; promotions/second provider/advanced search deliberately not built |

## 3. Decisions taken where the docs left room

- **Modular monolith**, one Next.js deployment; modules under `apps/web/src/server/modules/*`, route handlers are thin (`api/route.ts` wrapper → `api/handlers/*` → use cases).
- **Auth:** HS256 JWT access tokens (15 min, algorithm pinned, session-bound so logout/suspension is immediate), opaque refresh tokens stored only as keyed hashes. Web uses HttpOnly cookies with an Origin check for CSRF; mobile uses bearer tokens with the refresh token in the OS keystore.
- **Money:** integer minor units + currency everywhere. Commission is a basis-points rate applied to the **item subtotal only**, rounded half-up, frozen on every seller order with its rule version. The seller keeps shipping. Refund commission reversal uses cumulative rounding so a sequence of partial refunds never drifts.
- **Stock:** `available = onHand − reserved`. Reserve with a conditional write; settle (commit/release) with a status compare-and-set so payment, expiry and cancellation can race harmlessly.
- **Payments:** the attempt is persisted before any provider call and no provider call happens inside a DB transaction. A timeout is `unknown` and blocks a second attempt until verified. Webhook effects and the dedupe row commit in one transaction. A success for an expired/cancelled/already-paid order is **auto-refunded** with no ledger impact.
- **Ledger / payouts:** earnings are held until delivery + `PAYOUT_HOLD_DAYS`; a payout request immediately reserves funds with a `payout_debit` (so concurrent requests cannot overdraw) and rejection/cancel/failure post a reversal. COD sales never touch the platform's money, so the seller simply owes commission once delivered.
- **Step-up authentication** (not specified in detail by the docs): refund approve/retry, payout approve/paid/failed and commission changes need a password re-entry within the last 5 minutes (`STEP_UP_REQUIRED`). Maker-checker (a second admin) applies above configurable thresholds.
- **Guest carts are not supported** (carts belong to signed-in customers). A guest-cart merge flow was out of scope.
- **COD is opt-in** (`COD_ENABLED`, default off) because the docs say it only ships if operations can collect and reconcile cash. Cash refunds are manual by design.
- **Search** is a MongoDB text index with keyset pagination for browsing and a bounded offset (≤ 400) for text queries. Facets and recommendations are Phase-2 items and not built.
- **Mobile scope:** the seller app handles operations (orders, stock, price, earnings); creating products with photos stays in the web console. The admin app does monitoring and low-risk actions; recording payouts as paid and changing commission stay web-only.
- **AI assistant:** retrieval is deterministic (BM25 + idf-weighted coverage + title similarity + a short domain synonym table); an optional model may only rephrase retrieved text and its output is discarded unless it cites supplied sources and adds no foreign links. Default is **no model** (`AI_PROVIDER=none`).

## 4. Defects found by the test suites and fixed

Recorded because they show where the risk concentrates: `undefined` stored as `null` by the driver (broke a validation); duplicate-key errors aborting MongoDB transactions (webhook dedupe and ledger postings now avoid catching them inside a transaction); body parsed before the role check on 7 vendor endpoints; Bangla words split at combining marks by the tokenizer; auth responses cast without validation (a proxy returning `200 {}` left the app on its splash screen); text controllers disposed while a dialog was still animating out; scroll-triggered "load more" retrying a failing server forever; search empty-state copy using a stale query; order-polling timers outliving the screen.

## 5. Not proven — read before launch

1. **No real payment sandbox run.** The SSLCOMMERZ adapter was written against the current official documentation (reviewed 22 Oct 2026) and is tested against a deterministic stub; no sandbox credentials were available. A stub proves the mapping, **not** that the provider accepts the requests. Run the provider's own test matrix (docs/10 §3) before enabling it.
2. **No provider eligibility.** Whether the platform's legal entity may operate a marketplace with that provider, who holds customer funds, KYC, chargeback liability and payout rails are business/legal answers (docs/06 §2, docs/14 §4). Payout *execution* is intentionally a manual, audited step ("mark paid") — no automated disbursement exists.
3. **Web UI was verified by server-rendered HTTP checks, unit tests and a production build — it has not been exercised in a real browser** (no visual QA, no cross-browser or screen-reader pass). The Flutter apps were verified by analyzer + widget/BLoC tests; they have **not been run on an emulator or device**, and no store build or signing was attempted.
4. **External services were not exercised:** Cloudinary uploads/verification, SMTP delivery, FCM delivery (tested with stubbed transports), Firebase initialisation (needs `flutterfire configure`, which needs your Firebase projects).
5. **Phase-6 operational work not done:** load testing, a backup/restore drill, alert thresholds wired to a real monitor, on-call procedures, app-store privacy disclosures, staged rollout. The ops endpoint (`/api/v1/admin/ops/health`) exposes the signals; nothing consumes them yet.
6. **Single-instance assumptions:** the mock payment provider keeps its simulated gateway in process memory (sandbox only, refused in live mode). Rate limiting and idempotency are database-backed and multi-instance safe; the worker is safe to run more than once.
7. **Content is placeholder:** help articles in `apps/web/src/lib/faq.ts` encode assumptions (7-day return window, hold period, etc.) that must match real policy; Bangla UI copy is not provided (English only; the tokenizer and formatting are Bangla-safe).

## 6. Open business questions (docs/14 §4) — still open

Legal entity and registered category; marketplace/sub-merchant permission from the payment provider; custody of customer funds and chargeback liability; seller KYC and payout verification; commission formula edge cases (discount funding, tax, gateway-fee allocation — none are modelled because there are no discounts/tax yet); return and refund policy; data retention and privacy rules; hosting plan support for webhooks, workers and MongoDB transactions; final domain name.
