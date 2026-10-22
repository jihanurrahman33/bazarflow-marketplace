# 14 — Provider and Source Research (verify again before implementation/go-live)

**Research date:** 22 October 2026. Provider documentation, eligibility and APIs can change. Use the official current docs and merchant onboarding channels immediately before implementation and again before live activation. This inventory is a candidate list, not an assertion that any provider has approved this marketplace.

## 1. Bangladesh payment gateway candidates

| Candidate | Official developer entry point | Sandbox evidence / implementation notes |
|---|---|---|
| SSLCOMMERZ | https://developer.sslcommerz.com/ and https://developer.sslcommerz.com/docs.html | Official developer portal describes sandbox registration, session initiation, IPN and order validation. Validate every notification and confirm amount/currency/merchant reference server-side. |
| aamarPay | https://aamarpay.readme.io/reference/sandbox-credentials-1 | Public reference documents a sandbox environment and distinct live endpoint/credentials. Confirm current onboarding and supported marketplace use with provider. |
| shurjoPay | https://web2.shurjopay.com.bd/frontend-developers/integration-howto | Official docs describe replicated sandbox API endpoints and merchant-specific live credentials. Verify checkout, callback and status-validation requirements. |
| bKash PGW | https://merchantdemo.sandbox.bka.sh/ and https://www.bkash.com/en/page/tokenized_checkout | Official demo portal lists checkout/tokenized checkout/webhook concepts. Get current merchant API documentation and written approval for the platform model. |
| Nagorikpay | https://nagorikpay.com/developers/docs | Public developer docs describe sandbox/test API key and payment verification. Evaluate legal eligibility, production SLA, reconciliation, fees and market adoption before selection. |
| Nagad / other bank/MFS | Use the provider's official merchant/developer channel | Do not rely on unofficial repositories or assume a generally available sandbox. Request official current documentation, merchant credentials, signature rules and production onboarding confirmation. |

No payment credentials or live endpoints are hardcoded in the application. All candidate gateways still require a compatibility review for marketplace collection and seller settlement.

## 2. Global candidates and constraints

| Candidate | Official resources | Constraint to verify |
|---|---|---|
| PayPal | https://developer.paypal.com/sandbox-testing/overview/ | A working sandbox is not proof that a business registered in Bangladesh can receive, hold and withdraw live payments. Confirm current country/business capabilities and payout route. |
| Stripe | https://stripe.com/global and https://support.stripe.com/questions/requirements-to-open-a-stripe-account-in-another-country | Stripe supports merchants in a defined list of countries and requires genuine eligible business presence/banking for foreign-country accounts. Do not assume a Bangladesh-only entity can open a standard Stripe account; do not misrepresent entity location. |
| Adyen | https://docs.adyen.com/development-resources/testing and https://docs.adyen.com/marketplaces/onboard-users/ | Has test environment and marketplace capabilities, but supported platform/seller locations and commercial onboarding are restricted. Bangladesh is not listed in the linked hosted marketplace onboarding countries at the time reviewed; seek a current written eligibility answer. |
| Checkout.com | https://www.checkout.com/docs | Treat as an enterprise onboarding candidate; confirm legal-entity eligibility, contract, sandbox provisioning, payment methods and settlement availability. |
| Razorpay | https://razorpay.com/docs/ | Confirm merchant-country, business type and international payment/payout eligibility before investing in integration. A test mode alone does not establish live access. |

The goal is not to integrate “every gateway”. Build a stable adapter system, choose providers based on the marketplace's legal entity, user geography, method coverage, fees, transaction limits, refunds, settlement and provider support, then add more adapters as actual business needs justify them.

## 3. Framework, database and mobile sources

- Next.js Authentication Guide: https://nextjs.org/docs/app/guides/authentication — distinguishes authentication, session management and authorization; notes Server Actions and Route Handlers require access checks.
- Next.js Route Handlers: https://nextjs.org/docs/app/getting-started/route-handlers — current Route Handler model and supported methods.
- MongoDB schema design process: https://www.mongodb.com/docs/v8.0/data-modeling/schema-design-process/ — recommends workload-first modelling, relationship mapping, design patterns and indexes.
- MongoDB development checklist: https://www.mongodb.com/docs/manual/administration/production-checklist-development/ — covers schema/index planning and production readiness.
- MongoDB unique indexes: https://www.mongodb.com/docs/manual/core/index-unique/ — important optional-field and unique constraint behaviour.
- OWASP Top 10 2025: https://owasp.org/projects/top-ten?lang=en
- OWASP API Security Top 10: https://devguide.owasp.org/en/07-training-education/07-api-top-ten/ — object-level authorization, authentication, property-level authorization and resource consumption risks.
- Cloudinary client-side uploads: https://cloudinary.com/documentation/client_side_uploading — unsigned uploads have limited parameters; sensitive asset management requires authenticated server-side requests. The marketplace should generally use server-issued signed parameters for controlled vendor uploads.
- Flutter Secure Storage: https://pub.dev/packages/flutter_secure_storage — platform-backed secret storage; review exact current version and platform requirements.
- Firebase Crashlytics for Flutter: https://firebase.google.com/docs/crashlytics/flutter/get-started
- Firebase Analytics for Flutter: https://firebase.google.com/docs/analytics/flutter/get-started
- Firebase Cloud Messaging for Flutter: https://firebase.google.com/docs/cloud-messaging/flutter/get-started — includes iOS/APNs configuration and notification handling.
- Firebase App Check for Flutter: https://firebase.google.com/docs/app-check/flutter/default-providers — optional abuse protection for Firebase services, not a substitute for API authorization.
- PayPal Sandbox testing guide: https://developer.paypal.com/sandbox-testing/overview/ — describes isolated simulated transactions.
- Adyen testing: https://docs.adyen.com/development-resources/testing — advises testing client, server and webhook behaviour.

## 4. Verification questions before freezing the technology and providers

1. Is the platform's legal entity in Bangladesh, and what business category is registered?
2. Will customers pay one marketplace merchant account, or does the provider contract permit a marketplace/sub-merchant model?
3. Who legally holds customer funds and bears chargebacks/refunds?
4. Does each provider support your business country, vendor countries, currencies, methods, refund types and desired settlement timeframe?
5. Are vendor identity/KYC and payout destination verification required, and which party performs them?
6. Does the chosen hosting plan support durable webhook delivery/worker workloads and MongoDB replica-set transactions?
7. What retention/privacy, consumer-protection, tax, ecommerce and payment rules apply to the actual operating entity? Obtain qualified local advice; this engineering blueprint is not legal advice.

## 5. Research limitations

This document intentionally records candidate providers rather than claiming exhaustive coverage of all payment providers worldwide. Provider availability, contract terms, seller payout products and regulatory permissions change and may depend on private merchant onboarding. Recheck official documentation and get written approval before a live integration.
