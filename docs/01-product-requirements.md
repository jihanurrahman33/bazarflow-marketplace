# 01 — Product Requirements

## 1. Product vision

Build an independent, multi-vendor marketplace inspired by common capabilities in large commerce platforms: product discovery, vendor storefronts, variant/stock management, cart and checkout, split fulfillment, buyer protection/support, seller operations, moderation, analytics and a bounded AI help experience.

“Three roles” means three primary account roles — **Admin, Vendor and User/Customer** — not three security boundaries. Authorization must also check resource ownership, vendor approval, account status, action permissions and the target resource's state.

## 2. Product surfaces

| Surface | Audience | Purpose |
|---|---|---|
| Public storefront website | Guests and customers | SEO-first product/category pages, vendor stores, search, cart, checkout and account pages |
| Admin web console | Admin staff | Moderation, user/vendor management, catalog rules, order/payment/refund operations, reports and audit review |
| Vendor web console | Vendors | Store onboarding, catalog, SKUs, inventory, order fulfillment, returns and sales/settlement visibility |
| Customer Flutter app | Customers | Browse, search, cart, checkout, orders, reviews, notifications and support |
| Vendor Flutter app | Vendors | Manage products/stock, process orders, receive notifications and see reports |
| Admin Flutter app | Admin staff | Priority monitoring and limited operational actions; destructive/high-risk actions can require re-authentication or web-console confirmation |

The mobile apps are separate deliverables and application IDs, but can share maintained Dart packages. UI visibility does not grant permission; every API operation performs server-side authorization.

## 3. Roles and access model

### User/Customer
- Register, verify contact method, sign in/out, manage profile/address.
- Browse active products, variants, availability, seller profile and policies.
- Maintain cart and wishlist, apply eligible promotions, check out and select available delivery/payment methods.
- View customer order and per-vendor fulfillment status, request cancellation/return/refund within policy, review eligible purchases and contact support.

### Vendor
- Apply to sell and submit required business/identity details; application can be pending, approved, rejected, suspended or more-information-required.
- Manage only own vendor profile, eligible products, images, SKUs, inventory, prices and shipping settings.
- Review and fulfill own vendor orders; see only authorized customer/order details necessary to fulfill them.
- View calculated commission, ledger entries, payout history and settlement status, not edit ledger balances.
- Cannot approve own vendor application, change platform commission, publish disallowed categories, mark payment as paid, or alter another vendor's resources.

### Admin
- Admin permissions are split by capability, e.g. `vendor.review`, `catalog.moderate`, `order.read_all`, `refund.approve`, `payout.approve`, `user.suspend`, `settings.manage`, `audit.read`.
- Use least privilege. A support operator should not automatically have payment configuration or payout approval permissions.
- High-risk actions need a reason, audit record, step-up authentication and, for payout/refund thresholds, optional maker-checker approval.

### Important modelling rule
An account's role is not a replacement for resource-level checks. Example: a vendor may call `GET /api/v1/vendor/orders/:id` only when the order's vendor-order belongs to that vendor. The API must not rely on a vendor ID supplied in the request body.

## 4. Functional scope

### MVP — core commerce
1. Authentication, session revocation, contact verification and account lifecycle.
2. Vendor application, review and approval/suspension.
3. Categories, product moderation, products, variants/SKUs, media and inventory.
4. Storefront home/category/product/vendor pages with search, filtering, sorting and pagination.
5. Cart, addresses, shipping option/fee calculation, checkout and order confirmation.
6. A parent checkout/order linked to vendor-specific orders, with independent fulfillment status per vendor.
7. One approved sandbox payment adapter end-to-end, plus configurable cash-on-delivery if operationally available.
8. Payment webhook verification, idempotent order finalization, cancellation/refund handling and audit trails.
9. Vendor order processing, shipment/tracking fields, customer order history and status notifications.
10. Admin operations for vendor/product moderation, orders, payment exceptions and support lookup.
11. Cloudinary product media uploads using server-authorized signed parameters.
12. Customer, vendor and admin Flutter apps with core role-specific journeys.
13. BLoC tests, API/domain/database tests, CI, structured logs, Firebase Crashlytics, Analytics and FCM.

### Phase 2 — only after MVP is stable
- Coupons/promotions, richer merchandising, seller ratings and verified-buyer review moderation.
- Return merchandise authorization (RMA), dispute workflow and configurable refund policy.
- Seller settlement automation once legal, provider and bank-transfer capabilities are confirmed.
- AI support assistant backed by an approved knowledge base; admin product-copy assistance with review.
- Saved payment methods only where the provider explicitly supports compliant tokenization.
- Better search, facets, recommendations, multilingual catalog and richer analytics.

### Later / separate business decision
- Auctions/bidding, wholesale RFQs and Alibaba-style bulk pricing, international tax/VAT, cross-border logistics, escrow, multi-currency settlement, fulfillment warehouses, live commerce, advertising auctions and complex loyalty programs. These are not implied by a basic marketplace clone; each changes the domain and compliance requirements.

## 5. Key business rules

- Product prices and totals are computed by the server from current catalog/price rules. Use integer minor units (e.g. BDT paisa), never binary floating-point money.
- Stock is authoritative in the server database. Checkout revalidates price, status, variant and stock. A cart is not an inventory reservation.
- A parent order can produce one vendor order per seller. Each vendor order has its own fulfillment lifecycle; the parent order summarizes them.
- Payment state and fulfillment state are separate state machines.
- Payment success is based on verified provider evidence, not the frontend return URL.
- Product, order-item price, product title, chosen variant, seller identity, commission rate and shipping/tax amounts are snapshotted at purchase time. Later catalog edits must not rewrite history.
- Ledger entries are append-only. Correct mistakes with reversals/adjustments, not by editing historical entries.
- A request may be retried. Mutations that can create duplicate orders/charges/refunds require idempotency handling.
- User-facing messages must not leak stack traces, provider secrets, internal moderation notes or other vendors' data.

## 6. UX quality targets

- Calm, clean commerce UI: visual hierarchy, whitespace, readable type scale, short labels and progressive disclosure. Avoid dashboards filled with every metric and form field at once.
- Responsive website for mobile/desktop and accessible Flutter layouts.
- Every network-driven screen has deliberate initial/loading, loaded, empty, error, pending/retrying and stale/offline behaviour where relevant.
- Show meaningful skeletons only for expected content loading; use inline errors for recoverable form errors and page-level recovery for critical failures.
- Checkout must preserve safe user input where possible but never keep sensitive payment details.
- Explicit confirmations for irreversible actions, with useful cancel/retry recovery when possible.

## 7. Product-level acceptance criteria

MVP is not complete until a test can prove:
- a guest cannot invoke protected operations;
- a customer cannot read/alter another customer's order;
- a vendor cannot read/alter another vendor's products, stock, orders or ledger;
- unapproved/suspended vendors cannot publish or fulfill new orders where policy forbids it;
- concurrent checkouts cannot oversell stock under the chosen reservation strategy;
- a duplicate or out-of-order payment webhook does not duplicate order transitions, ledger entries or notifications;
- a failed/timed-out payment remains recoverable and does not silently become paid;
- vendor fulfillment updates do not overwrite payment status;
- all high-risk admin actions are permission-checked and audited;
- all three Flutter apps handle access-token expiry, offline/network failure and notification deep links correctly;
- the agreed provider sandbox has been tested end-to-end before enabling any live credentials.
