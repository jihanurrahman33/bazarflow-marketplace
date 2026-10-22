# 11 — Roadmap and Feature-by-Feature Development Plan

Use vertical slices: database + domain + API + web/mobile behaviour + tests + observability for one useful journey. Do not build every model first and leave all integration until the end.

## Phase 0 — discovery and foundations

**Features/tasks:**
1. Confirm target market/legal entity, platform domain, product categories, shipping model, return/refund policy, commission formula, seller KYC/settlement workflow and provider candidates.
2. Validate payment provider sandbox and obtain official docs/credentials through merchant onboarding channels. Get written confirmation that the intended marketplace model is allowed before live payments.
3. Finalize API response/error conventions, auth/session model, order/payment state machines and the money/commission policy.
4. Create repository layout, formatting/lint/test commands, environment schema, CI, branch protection and developer setup.
5. Create MongoDB connection lifecycle, index/migration scripts, local replica-set setup and safe seed data.
6. Define web and Flutter design tokens/component primitives and page shell/navigation.

**Exit criteria:** architecture decisions recorded; every secret comes from typed env config; CI is green; local developer setup reproducible; no production payment integration assumptions left undocumented.

## Phase 1 — identity and authorization

1. User registration/login, contact verification and recovery.
2. Session/refresh rotation, device/session listing and logout/revocation.
3. Central permission catalogue, ownership policies and admin role/permission setup.
4. Vendor application + admin review workflow with audit trail.
5. App shells for customer/vendor/admin, token refresh and error handling.

**Tests:** wrong-role/resource tests for all sample endpoints; refresh reuse and concurrent refresh; unapproved vendor blocked from vendor operations.

## Phase 2 — catalog and inventory vertical slice

1. Category read APIs and admin management.
2. Vendor product create/edit/draft/submit-for-review.
3. Cloudinary signed uploads and asset-to-product ownership binding.
4. Admin product review and publication workflow.
5. SKU/variant and inventory movement/reservation model with conditional updates.
6. Public home/category/product/vendor pages with SEO/cache policy.
7. Customer app product search/detail and vendor app catalog/stock screens.

**Tests:** forbidden product fields, cross-vendor isolation, media ownership, SKU unique rules, unpublished item hidden from public queries, stock race test.

## Phase 3 — cart and checkout

1. Cart add/update/remove and server-side price refresh.
2. Address book and shipping quote interface.
3. Checkout preview that explains item subtotal, discount, shipping, taxes/fees (if applicable) and total.
4. Idempotent checkout/order creation and order snapshots.
5. Split into parent order + vendor order records.
6. Inventory reservation/expiry/release worker or scheduled job.
7. Customer web/app order confirmation/status views.

**Tests:** changed price, changed stock, two vendors, duplicate checkout, reservation expiry, partial failure during transaction, no client-supplied price accepted.

## Phase 4 — one payment provider end-to-end

1. Implement payment adapter interface and provider registry.
2. Implement one selected Bangladesh provider from the official current docs.
3. Implement callback/webhook signature/status verification and durable deduplication.
4. Add payment status polling, unknown/pending reconciliation and admin exception queue.
5. Define ledger entries and vendor payable statements; do not call payables “paid” before actual settlement.
6. Implement cancellation/refund policies supported by the provider.
7. Add provider sandbox contract tests and run a documented end-to-end test plan.

**Exit gate:** duplicate/late notifications and provider timeout tests pass; finance totals reconcile; written live-provider/model approval is tracked separately from test completion.

## Phase 5 — fulfillment and daily operations

1. Vendor order queue, accept/reject where allowed, packing/shipping/tracking, mark delivered with policy checks.
2. Customer order tracking and notifications.
3. Admin order lookup, payment reconciliation, seller/product suspension safeguards and audit views.
4. Returns/refunds if business policy is finalized; separate approval from execution when appropriate.
5. FCM device registration, message delivery retries and deep links.

**Tests:** per-vendor fulfillment isolation, duplicate notifications, state-transition race, unauthorized refund/payout endpoints.

## Phase 6 — production readiness and rollout

1. Rate limits, request limits, abuse controls, security headers, secret manager and TLS.
2. Load-test browsing/search/checkout/reconciliation; benchmark database indexes and public cache invalidation.
3. Set up crash reporting, structured logs, metrics, alerts, dashboards and on-call procedures.
4. Backups + restore drill, rollback plan, data retention and deletion policy.
5. App-store privacy disclosures, notification permissions, release signing and staged rollout.
6. Reconcile test/prod config and run a limited pilot with feature flags, daily financial reconciliation and documented rollback.

## Phase 7 — AI and expansion

1. Curate/version policy FAQ knowledge base and retrieval metadata.
2. Implement a read-only cited support assistant and access filtering.
3. Evaluate cross-tenant privacy, prompt injection, citations, latency, cost and escalation.
4. Consider second payment providers only through the adapter contract.
5. Add promotions, advanced search, reviews, international methods or wholesale features only after their policy/domain design is approved.

## Feature plan template

For every GitHub issue, fill in:
- **Goal / non-goals**
- **Actors and permissions**
- **Domain entities / state transitions**
- **API endpoints + request/response/error codes**
- **Database writes/queries/indexes/transaction boundary**
- **UI screens and all states**
- **Security/abuse cases**
- **Observability/events (privacy-safe)**
- **Unit/integration/widget/e2e tests**
- **Acceptance criteria**
- **Migration/deployment/rollback notes**
- **Dependencies and open business questions**
