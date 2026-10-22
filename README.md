# Multi-Vendor Commerce Platform — Agent Development Blueprint

**Status:** Architecture and product baseline, version 1.0  
**Date:** 22 October 2026  
**Target:** Web storefront + admin/vendor web consoles + three Flutter apps, backed by a versioned Next.js API and MongoDB.

This pack is intended to be the working source of truth for human developers and coding agents. Read it before implementation. Convert each roadmap item into a small GitHub issue with explicit acceptance criteria; implement one vertical slice at a time.

## Documents

1. [`01-product-requirements.md`](docs/01-product-requirements.md) — product boundaries, roles, MVP, user journeys and acceptance criteria.
2. [`02-system-architecture.md`](docs/02-system-architecture.md) — architecture, modules, render strategy, design patterns and dependency rules.
3. [`03-mongodb-domain-model.md`](docs/03-mongodb-domain-model.md) — collection design, indexes, transactions, money and inventory rules.
4. [`04-auth-security.md`](docs/04-auth-security.md) — authentication, authorization, token lifecycle and security baseline.
5. [`05-api-contract.md`](docs/05-api-contract.md) — API conventions, endpoint inventory and response contracts.
6. [`06-checkout-payments.md`](docs/06-checkout-payments.md) — provider adapters, order splitting, webhooks, refunds and vendor ledgers.
7. [`07-flutter-app-architecture.md`](docs/07-flutter-app-architecture.md) — BLoC, app separation, local persistence and app state handling.
8. [`08-design-system-and-ux.md`](docs/08-design-system-and-ux.md) — visual system, reusable UI and loading/error/pending states.
9. [`09-ai-and-knowledge-base.md`](docs/09-ai-and-knowledge-base.md) — secure AI support and retrieval-augmented generation (RAG).
10. [`10-testing-and-quality-gates.md`](docs/10-testing-and-quality-gates.md) — test strategy, CI quality gates and definition of done.
11. [`11-roadmap-and-feature-plans.md`](docs/11-roadmap-and-feature-plans.md) — dependency-ordered phases and feature-level implementation plans.
12. [`12-agent-operating-contract.md`](docs/12-agent-operating-contract.md) — master coding-agent instructions, task template and GitHub practices.
13. [`13-observability-and-deployment.md`](docs/13-observability-and-deployment.md) — logs, metrics, crash reports, analytics, FCM and deployment.
14. [`14-provider-and-source-research.md`](docs/14-provider-and-source-research.md) — current official provider/platform links and assumptions to revalidate.

## Recommended implementation baseline

- **Web and API:** Next.js App Router + TypeScript strict mode. Next.js Route Handlers expose the versioned REST API to Flutter apps. Keep route handlers thin; put business logic in application/domain modules.
- **Database:** MongoDB using the official Node.js driver, explicit indexes, validated schemas and replica-set transactions where a multi-document invariant needs them.
- **Mobile:** Three separately shipped Flutter apps (customer, vendor, admin) using BLoC. Share internal Dart packages for design tokens, networking, authentication primitives and observability where appropriate.
- **Media:** Cloudinary. Issue constrained signed upload parameters from the server; retain provider asset identifiers as well as delivery URLs.
- **Reliability:** Structured logs, request IDs, idempotency keys, webhook deduplication, an outbox/worker mechanism for async side effects, and tested recovery paths.
- **Payments:** A provider adapter boundary. Start with the first provider that grants the business a sandbox account and confirms a viable production/onboarding model. Do not assume every provider supports marketplace split settlement.
- **AI:** Deliver a bounded, source-cited support assistant only after the core commerce, permissions, audit and observability foundations are reliable.

## Non-negotiable engineering rules

1. Read the relevant docs before editing code. For every feature, write or update a short plan and acceptance criteria first.
2. No business logic in React components, page files or raw route handlers. No direct database access from UI code.
3. Never trust client-provided price, role, commission, inventory, payment status, vendor ownership or order totals. Recalculate and authorize on the server.
4. Never treat a browser redirect as proof of payment. Verify via the provider's server API/webhook rules.
5. Every mutation must have explicit authorization, input validation, state-transition checks, audit/logging expectations and tests.
6. All visible asynchronous flows must define loading, empty, success, error, pending, cancellation and retry behaviour where those states apply.
7. No secrets in Git, client bundles, mobile binaries, analytics events or logs. Environment variables are parsed and validated at startup.
8. Keep web and mobile API contracts compatible, versioned and documented. Breaking API changes require a versioning/migration plan.
9. Build a modular monolith first. Split services only when measured scaling, isolation or team-ownership requirements justify it.
10. Do not copy competitor trademarks, private APIs, proprietary assets, listing text or distinctive UI. Use marketplace capabilities as functional references, then create independent branding and UX.

## Decision status

This is a proposed baseline, not evidence that merchant accounts, provider contracts, payout permissions or cloud quotas have already been approved. Treat provider eligibility, data retention/legal obligations, app-store requirements and the final domain name as launch blockers to verify with the relevant parties.
