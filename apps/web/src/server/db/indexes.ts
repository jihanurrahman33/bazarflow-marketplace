import type { Db, IndexDescription } from "mongodb";
import { C } from "./collections";

type Spec = Record<string, IndexDescription[]>;

/** Index baseline (docs/03 §5). Safe to re-run: createIndexes is idempotent for identical specs. */
export const INDEXES: Spec = {
  [C.users]: [
    { key: { emailNormalized: 1 }, unique: true, name: "uq_users_email" },
    { key: { "identities.provider": 1, "identities.subject": 1 }, unique: true, name: "uq_users_identity", partialFilterExpression: { "identities.subject": { $exists: true } } },
    { key: { role: 1, status: 1, createdAt: -1 }, name: "ix_users_role_status" },
    { key: { vendorId: 1 }, name: "ix_users_vendor", partialFilterExpression: { vendorId: { $exists: true } } },
  ],
  [C.sessions]: [
    { key: { tokenHash: 1 }, unique: true, name: "uq_session_token_hash" },
    { key: { userId: 1, familyId: 1 }, name: "ix_sessions_user_family" },
    { key: { familyId: 1 }, name: "ix_sessions_family" },
    // Rows are kept briefly past expiry so reuse of a stale token is still detected.
    { key: { expiresAt: 1 }, expireAfterSeconds: 7 * 24 * 3600, name: "ttl_expired_sessions" },
  ],
  [C.oneTimeCodes]: [
    { key: { userId: 1, purpose: 1, createdAt: -1 }, name: "ix_otc_user_purpose" },
    { key: { expiresAt: 1 }, expireAfterSeconds: 0, name: "ttl_otc" },
  ],
  [C.vendorApplications]: [
    { key: { applicantUserId: 1, createdAt: -1 }, name: "ix_applications_user_created" },
    { key: { status: 1, createdAt: 1 }, name: "ix_applications_status" },
    {
      key: { applicantUserId: 1 }, unique: true, name: "uq_applications_one_open",
      partialFilterExpression: { status: { $in: ["submitted", "more_info_required"] } },
    },
  ],
  [C.vendors]: [
    { key: { slug: 1 }, unique: true, name: "uq_vendors_slug" },
    { key: { ownerUserId: 1 }, unique: true, name: "uq_vendors_owner" },
    { key: { status: 1 }, name: "ix_vendors_status" },
  ],
  [C.categories]: [
    { key: { slug: 1 }, unique: true, name: "uq_categories_slug" },
    { key: { parentId: 1, sortOrder: 1 }, name: "ix_categories_parent" },
  ],
  [C.products]: [
    { key: { slug: 1 }, unique: true, name: "uq_products_slug" },
    { key: { vendorId: 1, status: 1, updatedAt: -1 }, name: "ix_products_vendor_status_updated" },
    { key: { categoryIds: 1, status: 1, vendorActive: 1, publishedAt: -1 }, name: "ix_products_category_status_published" },
    { key: { status: 1, vendorActive: 1, minPriceMinor: 1, _id: 1 }, name: "ix_products_status_price" },
    { key: { status: 1, vendorActive: 1, publishedAt: -1, _id: -1 }, name: "ix_products_status_published" },
    { key: { "variants.sku": 1, vendorId: 1 }, unique: true, name: "uq_products_vendor_sku" },
    { key: { title: "text", description: "text" }, name: "tx_products_search", weights: { title: 5, description: 1 } },
  ],
  [C.inventoryItems]: [
    { key: { vendorId: 1, sku: 1 }, unique: true, name: "uq_inventory_vendor_sku" },
    { key: { productId: 1, variantId: 1 }, unique: true, name: "uq_inventory_product_variant" },
  ],
  [C.inventoryMovements]: [
    { key: { inventoryItemId: 1, createdAt: -1 }, name: "ix_movements_item_created" },
    { key: { orderId: 1 }, name: "ix_movements_order", partialFilterExpression: { orderId: { $exists: true } } },
  ],
  [C.stockReservations]: [
    { key: { orderId: 1 }, unique: true, name: "uq_reservations_order" },
    { key: { status: 1, expiresAt: 1 }, name: "ix_reservations_status_expiry" },
  ],
  [C.carts]: [{ key: { userId: 1 }, unique: true, name: "uq_carts_user" }],
  [C.addresses]: [{ key: { userId: 1, createdAt: -1 }, name: "ix_addresses_user" }],
  [C.orders]: [
    { key: { buyerId: 1, createdAt: -1 }, name: "ix_orders_buyer_created" },
    { key: { publicOrderNumber: 1 }, unique: true, name: "uq_orders_public_number" },
    { key: { status: 1, createdAt: -1 }, name: "ix_orders_status_created" },
    { key: { paymentStatus: 1, updatedAt: 1 }, name: "ix_orders_payment_status" },
  ],
  [C.vendorOrders]: [
    { key: { vendorId: 1, fulfillmentStatus: 1, createdAt: -1 }, name: "ix_vendor_orders_queue" },
    { key: { parentOrderId: 1 }, name: "ix_vendor_orders_parent" },
    { key: { buyerId: 1, createdAt: -1 }, name: "ix_vendor_orders_buyer" },
    { key: { "items.productId": 1, buyerId: 1, fulfillmentStatus: 1 }, name: "ix_vendor_orders_review_eligibility" },
  ],
  [C.payments]: [
    { key: { merchantReference: 1 }, unique: true, name: "uq_payment_merchant_ref" },
    {
      key: { provider: 1, providerTransactionId: 1 }, unique: true, name: "uq_payment_provider_tx",
      partialFilterExpression: { providerTransactionId: { $type: "string" } },
    },
    { key: { orderId: 1, createdAt: -1 }, name: "ix_payments_order" },
    { key: { status: 1, updatedAt: 1 }, name: "ix_payments_status_updated" },
  ],
  [C.paymentEvents]: [
    { key: { provider: 1, providerEventId: 1 }, unique: true, name: "uq_payment_event" },
    { key: { receivedAt: 1 }, expireAfterSeconds: 180 * 24 * 3600, name: "ttl_payment_events" },
  ],
  [C.refunds]: [
    { key: { orderId: 1, createdAt: -1 }, name: "ix_refunds_order" },
    { key: { status: 1, createdAt: 1 }, name: "ix_refunds_status" },
  ],
  [C.ledgerEntries]: [
    { key: { vendorId: 1, createdAt: -1 }, name: "ix_ledger_vendor_created" },
    { key: { idempotencyReference: 1 }, unique: true, name: "uq_ledger_idempotency" },
  ],
  [C.payouts]: [
    { key: { vendorId: 1, createdAt: -1 }, name: "ix_payouts_vendor" },
    { key: { status: 1, createdAt: 1 }, name: "ix_payouts_status" },
  ],
  [C.idempotencyKeys]: [
    { key: { actorScope: 1, key: 1 }, unique: true, name: "uq_idempotency_actor_key" },
    { key: { expiresAt: 1 }, expireAfterSeconds: 0, name: "ttl_idempotency" },
  ],
  [C.notifications]: [
    { key: { userId: 1, createdAt: -1 }, name: "ix_notifications_user_created" },
    { key: { dedupeKey: 1, channel: 1 }, unique: true, name: "uq_notifications_dedupe" },
  ],
  [C.devices]: [
    { key: { userId: 1, installationId: 1 }, unique: true, name: "uq_devices_user_install" },
    { key: { pushToken: 1 }, name: "ix_devices_token" },
  ],
  [C.auditLogs]: [
    { key: { createdAt: -1 }, name: "ix_audit_created" },
    { key: { resourceType: 1, resourceId: 1, createdAt: -1 }, name: "ix_audit_resource" },
    { key: { actorId: 1, createdAt: -1 }, name: "ix_audit_actor" },
  ],
  [C.outboxEvents]: [
    { key: { dedupeKey: 1 }, unique: true, name: "uq_outbox_dedupe" },
    { key: { state: 1, nextAttemptAt: 1 }, name: "ix_outbox_state_next" },
  ],
  [C.reviews]: [
    { key: { productId: 1, status: 1, createdAt: -1 }, name: "ix_reviews_product" },
    { key: { userId: 1, productId: 1 }, unique: true, name: "uq_reviews_user_product" },
  ],
  [C.knowledgeDocuments]: [
    { key: { sourceId: 1 }, unique: true, name: "uq_knowledge_source" },
    { key: { status: 1, visibility: 1 }, name: "ix_knowledge_status_visibility" },
    { key: { tokens: 1 }, name: "ix_knowledge_tokens" },
  ],
  [C.rateLimits]: [{ key: { expiresAt: 1 }, expireAfterSeconds: 0, name: "ttl_rate_limits" }],
};

export async function ensureIndexes(db: Db): Promise<void> {
  for (const [name, specs] of Object.entries(INDEXES)) {
    await db.collection(name).createIndexes(specs);
  }
}
