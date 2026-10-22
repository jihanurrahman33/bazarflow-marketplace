import type { Collection, Db, Document } from "mongodb";
import { getDb } from "./client";
import type * as S from "./schema";

/** Collection names are centralised so scripts, tests and code never drift. */
export const C = {
  users: "users",
  sessions: "sessions",
  oneTimeCodes: "oneTimeCodes",
  vendorApplications: "vendorApplications",
  vendors: "vendors",
  categories: "categories",
  products: "products",
  inventoryItems: "inventoryItems",
  inventoryMovements: "inventoryMovements",
  stockReservations: "stockReservations",
  carts: "carts",
  addresses: "addresses",
  orders: "orders",
  vendorOrders: "vendorOrders",
  payments: "payments",
  paymentEvents: "paymentEvents",
  refunds: "refunds",
  ledgerEntries: "ledgerEntries",
  payouts: "payouts",
  idempotencyKeys: "idempotencyKeys",
  notifications: "notifications",
  devices: "devices",
  auditLogs: "auditLogs",
  outboxEvents: "outboxEvents",
  reviews: "reviews",
  knowledgeDocuments: "knowledgeDocuments",
  rateLimits: "rateLimits",
  analyticsEvents: "analyticsEvents",
  wishlistItems: "wishlistItems",
  coupons: "coupons",
  couponRedemptions: "couponRedemptions",
} as const;

export interface Collections {
  users: Collection<S.UserDoc>;
  sessions: Collection<S.SessionDoc>;
  oneTimeCodes: Collection<S.OneTimeCodeDoc>;
  vendorApplications: Collection<S.VendorApplicationDoc>;
  vendors: Collection<S.VendorDoc>;
  categories: Collection<S.CategoryDoc>;
  products: Collection<S.ProductDoc>;
  inventoryItems: Collection<S.InventoryItemDoc>;
  inventoryMovements: Collection<S.InventoryMovementDoc>;
  stockReservations: Collection<S.StockReservationDoc>;
  carts: Collection<S.CartDoc>;
  addresses: Collection<S.AddressDoc>;
  orders: Collection<S.OrderDoc>;
  vendorOrders: Collection<S.VendorOrderDoc>;
  payments: Collection<S.PaymentDoc>;
  paymentEvents: Collection<S.PaymentEventDoc>;
  refunds: Collection<S.RefundDoc>;
  ledgerEntries: Collection<S.LedgerEntryDoc>;
  payouts: Collection<S.PayoutDoc>;
  idempotencyKeys: Collection<S.IdempotencyKeyDoc>;
  notifications: Collection<S.NotificationDoc>;
  devices: Collection<S.DeviceDoc>;
  auditLogs: Collection<S.AuditLogDoc>;
  outboxEvents: Collection<S.OutboxEventDoc>;
  reviews: Collection<S.ReviewDoc>;
  knowledgeDocuments: Collection<S.KnowledgeDocumentDoc>;
  rateLimits: Collection<S.RateLimitDoc>;
  analyticsEvents: Collection<S.AnalyticsEventDoc>;
  wishlistItems: Collection<S.WishlistItemDoc>;
  coupons: Collection<S.CouponDoc>;
  couponRedemptions: Collection<S.CouponRedemptionDoc>;
}

export function collectionsFor(db: Db): Collections {
  const out: Record<string, Collection<Document>> = {};
  for (const [key, name] of Object.entries(C)) out[key] = db.collection(name);
  return out as unknown as Collections;
}

export async function getCollections(): Promise<Collections> {
  return collectionsFor(await getDb());
}
