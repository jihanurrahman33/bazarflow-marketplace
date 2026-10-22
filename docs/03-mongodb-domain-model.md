# 03 — MongoDB Domain Model and Data Rules

## 1. Modelling principles

Design from real read/write workloads, not from a relational diagram copied into documents. Use embedding for bounded data that is commonly read and updated with a parent; use references for independently queried, high-growth or separately authorized entities. Add all needed indexes explicitly, review them against actual query plans and remove redundant ones only after measurement.

Use MongoDB's replica-set deployment in development/test when testing multi-document transactions. Production should use a managed, properly secured replica set/cluster with backups, point-in-time recovery where available, TLS, least-privilege database users and tested restoration.

## 2. Proposed collections

| Collection | Main fields / purpose |
|---|---|
| `users` | normalized unique email/phone where relevant, password hash, profile, account status, timestamps; never store raw passwords |
| `sessions` | user ID, device/app metadata, hash of opaque refresh token, family ID, expiry, revokedAt, lastUsedAt, reuse-detected metadata |
| `vendorApplications` | applicant user ID, business data, documents/media IDs, state, reviewer, review reason and audit references |
| `vendors` | owner user ID, slug, public profile, status, approved settings, commission policy reference, onboarding state; unique owner/slug constraints as appropriate |
| `categories` | name/slug, parent ID, listing visibility, attributes/filter config, sort order |
| `products` | vendor ID, category IDs, slug, title/description, status, attributes, bounded variant definitions, media asset refs, SEO metadata, timestamps |
| `inventoryItems` | vendor ID, product ID, variant/SKU ID, on-hand/reserved quantities, version, updatedAt; one authoritative record per SKU |
| `inventoryMovements` | append-only reasoned stock changes: SKU, delta, reason, actor, related order/adjustment, timestamp |
| `carts` | user or guest/session key, lines with product/variant references and requested quantity; prices are advisory only |
| `addresses` | owner user ID, normalized address fields, default flag; restricted to owner/admin support permissions |
| `checkouts` | idempotency key, buyer ID, order preview/expiry, pricing summary snapshot, status; avoid holding mutable authoritative price rules here |
| `orders` | buyer, public order number, currency, parent totals, linked vendor order IDs, payment summary, overall state, immutable pricing summary snapshot |
| `vendorOrders` | parent order ID, vendor ID, embedded bounded item snapshots, vendor totals, fulfillment state, shipping/tracking, return summary |
| `payments` | order ID, provider, provider transaction/reference IDs, amount/currency, attempt status, verification result, safe metadata only; no PAN/CVV |
| `paymentEvents` | provider event ID, payment ID, event type, processed state, payload hash/minimal redacted data; unique provider + event ID |
| `refunds` | order/payment/vendor-order scope, amount, reason, provider reference, status, approval/audit details |
| `ledgerEntries` | immutable signed amount in minor units, currency, vendor, entry type, related order/refund/payout, idempotency reference and timestamp |
| `payouts` | vendor, amount/currency, destination reference/token, status, approval, provider/bank reference, attempt metadata |
| `idempotencyKeys` | scoped actor + key, request hash, state, response/resource reference, expiry where appropriate |
| `notifications` | recipient, channel, template/event type, safe payload, delivery state, retries, related resource deep link |
| `auditLogs` | actor, action, resource type/ID, before/after diff where safe, reason, request ID, IP/user agent policy, time; append-only access |
| `outboxEvents` | event ID/type, aggregate, payload, state, attempts, nextAttemptAt, processedAt |
| `knowledgeDocuments` | curated source metadata, version, visibility, source URL/asset, status, ingestion state; AI only in phase 2 |

Some collections can be consolidated after workload review; the purpose of the table is to make ownership and invariants explicit before coding.

## 3. Important document decisions

- **Product variants:** embed only bounded option/variant descriptors in `products`; have one inventory record per actual sellable SKU. SKU uniqueness must be scoped deliberately (global vs per vendor).
- **Order snapshots:** embed the purchased line snapshots inside each vendor order. Snapshot product title, SKU, variant labels, unit price, quantity, currency, seller identity/slug, commission rate and computed breakdown. Do not depend on a live product record to render a historic order.
- **Order split:** keep a parent order for customer payment/overall summary and child vendor orders for separate seller fulfilment. Each child owns seller-specific operational status. Use transaction orchestration to persist parent + children + inventory reservations when needed.
- **Ledger:** use append-only `ledgerEntries`; derive balances by aggregation/materialized summary, or keep a separately maintained balance projection that can be rebuilt from the immutable ledger. Never let a vendor edit its balance.
- **Webhook events:** unique index on `(provider, providerEventId)` where the gateway exposes a stable event ID. If it does not, construct a carefully documented dedupe key from stable provider references plus event type/status and retain raw-event hashes for diagnostics.
- **Refresh tokens:** store a cryptographic hash, not the raw opaque refresh token. Use session family IDs to detect reuse and revoke the family after suspicious reuse.
- **AI source isolation:** every knowledge chunk is tagged with visibility/tenant/source/version. Retrieval authorization happens before content is inserted into model context.

## 4. Money, currency, and rounding

Represent amounts as integers in minor units. Example: `amountMinor: 12500, currency: "BDT"` represents ৳125.00 if the provider's expected currency precision is two decimal places. Currency rules must be metadata-backed; not every currency has two minor-unit digits. Do not use JavaScript `number` arithmetic for arbitrary decimal currency values. Validate positive/negative allowances by entry type and enforce amounts within provider limits.

Commission calculations must define rounding order, whether commission is applied to item subtotal vs shipping/discounts/tax, who funds discounts, treatment of refunds and who bears gateway fees. Keep a versioned commission/rules snapshot on order/ledger entries.

## 5. Index baseline (validate against query workload)

Examples to start from; names/field ordering should be tuned with representative queries:

```javascript
// Normalize email at write time; use a partial unique index if email is optional.
db.users.createIndex({ emailNormalized: 1 }, { unique: true, name: "uq_users_email" });
db.vendors.createIndex({ slug: 1 }, { unique: true, name: "uq_vendors_slug" });
db.vendorApplications.createIndex({ applicantUserId: 1, createdAt: -1 }, { name: "ix_applications_user_created" });
db.products.createIndex({ vendorId: 1, status: 1, updatedAt: -1 }, { name: "ix_products_vendor_status_updated" });
db.products.createIndex({ categoryIds: 1, status: 1, publishedAt: -1 }, { name: "ix_products_category_status_published" });
db.inventoryItems.createIndex({ vendorId: 1, sku: 1 }, { unique: true, name: "uq_inventory_vendor_sku" });
db.inventoryItems.createIndex({ productId: 1, variantId: 1 }, { unique: true, name: "uq_inventory_product_variant" });
db.orders.createIndex({ buyerId: 1, createdAt: -1 }, { name: "ix_orders_buyer_created" });
db.orders.createIndex({ publicOrderNumber: 1 }, { unique: true, name: "uq_orders_public_number" });
db.vendorOrders.createIndex({ vendorId: 1, fulfillmentStatus: 1, createdAt: -1 }, { name: "ix_vendor_orders_queue" });
db.vendorOrders.createIndex({ parentOrderId: 1 }, { name: "ix_vendor_orders_parent" });
db.payments.createIndex({ provider: 1, providerTransactionId: 1 }, { unique: true, sparse: true, name: "uq_payment_provider_tx" });
db.paymentEvents.createIndex({ provider: 1, providerEventId: 1 }, { unique: true, name: "uq_payment_event" });
db.ledgerEntries.createIndex({ vendorId: 1, createdAt: -1 }, { name: "ix_ledger_vendor_created" });
db.ledgerEntries.createIndex({ idempotencyReference: 1 }, { unique: true, sparse: true, name: "uq_ledger_idempotency" });
db.sessions.createIndex({ tokenHash: 1 }, { unique: true, name: "uq_session_token_hash" });
db.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "ttl_expired_sessions" });
db.idempotencyKeys.createIndex({ actorScope: 1, key: 1 }, { unique: true, name: "uq_idempotency_actor_key" });
```

Important: optional fields + unique indexes require careful handling. A non-sparse unique index treats missing/null keys as a collision; use a partial filter or required normalized value when appropriate. Never copy these indexes blindly without validating optional fields and query patterns.

## 6. Transactions, optimistic concurrency and state changes

- Use MongoDB transactions for invariants that span multiple documents: create parent/vendor orders + reserve inventory, finalize a successful payment + mark order payable/paid + write ledger/outbox records, or approve a refund + write refund/ledger records. Keep transactions short and do not call an external payment API inside an open database transaction.
- Before contacting a payment provider, persist a payment attempt and idempotency reference. Make the network call outside the DB transaction; then reconcile the response/webhook through a short transaction.
- Conditional stock decrement must require sufficient available quantity, e.g. update only when `onHand - reserved >= requestedQty`; check matched count. Never read stock then unconditionally write later.
- Use optimistic concurrency/version fields or compare-and-set filters on state transitions so two requests cannot perform incompatible transitions.
- A transaction retry must not repeat an external side effect. External work belongs outside the transaction or in an outbox job.
- TTL indexes are cleanup aids, not business-rule enforcement; application code must validate expiry too.

## 7. Inventory reservation workflow

1. Checkout re-reads active product/variant and current price from the database.
2. Validate shipping/service region, quantity limits, seller status and inventory availability.
3. Create an idempotent checkout/order record and reserve stock with conditional writes; record reservation expiry.
4. Initiate payment with a stable merchant reference. Persist provider response safely.
5. On verified success, convert reservation to committed sold stock and advance payment/order state once.
6. On verified failure or reservation expiry, release stock once and keep failed/cancelled order history according to policy.
7. On timeout/unknown provider state, keep the order pending/reconciliation-needed; verify status before releasing or recharging.

Decide whether to decrement on-hand immediately or maintain `onHand` and `reserved` separately; pick one consistent formula and test concurrency/race cases.

## 8. Data lifecycle and operational hygiene

- Add versioned migrations/index scripts and make them safe to re-run.
- Validate documents with application schemas and, for critical collections, MongoDB JSON Schema validators for required shape/types.
- Use projections to avoid fetching password hash, PII, giant media arrays or internal fields for public views.
- Paginate with stable cursor/sort keys for large lists. Avoid unbounded `$skip` on deep pages.
- Do not store third-party webhook payloads indefinitely without a retention reason; redact sensitive fields and apply retention/legal policy.
- Back up data, test restore, monitor slow queries/replication health and capacity before increasing traffic.
