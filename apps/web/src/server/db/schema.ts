import type { ObjectId } from "mongodb";
import type { CurrencyCode } from "../shared/money";

export type Role = "customer" | "vendor" | "admin";
export type AccountStatus = "active" | "suspended";

export interface UserDoc {
  _id: ObjectId;
  email: string;
  emailNormalized: string;
  passwordHash: string;
  name: string;
  phone?: string;
  role: Role;
  /** Admin capability grants. Empty for customers/vendors. */
  permissions: string[];
  status: AccountStatus;
  vendorId?: ObjectId;
  emailVerifiedAt?: Date;
  failedLoginCount: number;
  lockedUntil?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionDoc {
  _id: ObjectId;
  userId: ObjectId;
  /** Stable per login; identifies the session in access tokens and groups the rotation chain. */
  familyId: string;
  tokenHash: string;
  device: { platform: string; name?: string; appId?: string };
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date;
  rotatedAt?: Date;
  revokedAt?: Date;
  revokedReason?: "logout" | "logout_all" | "reuse_detected" | "password_reset" | "suspended" | "admin";
}

export type OneTimeCodePurpose = "verify_email" | "password_reset";
export interface OneTimeCodeDoc {
  _id: ObjectId;
  userId: ObjectId;
  purpose: OneTimeCodePurpose;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  consumedAt?: Date;
  createdAt: Date;
}

export type VendorApplicationStatus = "submitted" | "more_info_required" | "approved" | "rejected";
export interface VendorApplicationDoc {
  _id: ObjectId;
  applicantUserId: ObjectId;
  business: { name: string; slug: string; phone: string; address: string; tradeLicenseNo?: string; description?: string };
  documents: { publicId: string; kind: string }[];
  status: VendorApplicationStatus;
  reviewerId?: ObjectId;
  reviewReason?: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export type VendorStatus = "active" | "suspended";
export interface VendorDoc {
  _id: ObjectId;
  ownerUserId: ObjectId;
  slug: string;
  name: string;
  description?: string;
  logo?: { publicId: string; url: string };
  status: VendorStatus;
  /** Commission policy snapshot source; orders copy this value at purchase time. */
  commissionBps: number;
  commissionRuleVersion: number;
  shipping: { flatFeeMinor: number; freeOverMinor?: number };
  createdAt: Date;
  updatedAt: Date;
}

export interface CategoryDoc {
  _id: ObjectId;
  name: string;
  slug: string;
  parentId?: ObjectId;
  visible: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export type ProductStatus = "draft" | "pending_review" | "rejected" | "published" | "archived";
export interface VariantDef {
  variantId: string;
  sku: string;
  optionValues: Record<string, string>;
  priceMinor: number;
  compareAtMinor?: number;
  active: boolean;
}
export interface MediaRef {
  publicId: string;
  url: string;
  width?: number;
  height?: number;
  position: number;
}
export interface ProductDoc {
  _id: ObjectId;
  vendorId: ObjectId;
  categoryIds: ObjectId[];
  slug: string;
  title: string;
  description: string;
  status: ProductStatus;
  currency: CurrencyCode;
  options: { name: string; values: string[] }[];
  variants: VariantDef[];
  media: MediaRef[];
  /** Lowest active variant price, denormalised for listing/sort. */
  minPriceMinor: number;
  /** Denormalised from the owning vendor; false hides the product from public queries. */
  vendorActive: boolean;
  moderation?: { reviewerId: ObjectId; reason?: string; at: Date };
  publishedAt?: Date;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface InventoryItemDoc {
  _id: ObjectId;
  vendorId: ObjectId;
  productId: ObjectId;
  variantId: string;
  sku: string;
  onHand: number;
  reserved: number;
  version: number;
  updatedAt: Date;
}

export type InventoryMovementKind = "adjust" | "reserve" | "release" | "commit" | "restock";
export interface InventoryMovementDoc {
  _id: ObjectId;
  inventoryItemId: ObjectId;
  vendorId: ObjectId;
  sku: string;
  kind: InventoryMovementKind;
  deltaOnHand: number;
  deltaReserved: number;
  reason: string;
  actorId?: ObjectId;
  orderId?: ObjectId;
  createdAt: Date;
}

export type ReservationStatus = "active" | "committed" | "released";
export interface StockReservationDoc {
  _id: ObjectId;
  orderId: ObjectId;
  lines: { inventoryItemId: ObjectId; quantity: number }[];
  status: ReservationStatus;
  expiresAt: Date;
  createdAt: Date;
  settledAt?: Date;
}

export interface CartDoc {
  _id: ObjectId;
  userId: ObjectId;
  lines: { productId: ObjectId; variantId: string; quantity: number; addedAt: Date }[];
  updatedAt: Date;
}

export interface AddressDoc {
  _id: ObjectId;
  userId: ObjectId;
  label: string;
  recipient: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  district: string;
  postalCode: string;
  country: "BD";
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type PaymentMethod = "online" | "cod";
export type OrderStatus =
  | "pending_payment" | "confirmed" | "processing" | "partially_fulfilled" | "shipped"
  | "delivered" | "cancelled" | "closed";
export type PaymentSummaryStatus = "none" | "pending" | "paid" | "failed" | "refunded" | "partially_refunded" | "cod_pending";

export interface AddressSnapshot {
  recipient: string; phone: string; line1: string; line2?: string; city: string; district: string; postalCode: string; country: "BD";
}

export interface OrderTotals {
  subtotalMinor: number;
  shippingMinor: number;
  discountMinor: number;
  totalMinor: number;
}

export interface OrderDoc {
  _id: ObjectId;
  publicOrderNumber: string;
  buyerId: ObjectId;
  currency: CurrencyCode;
  totals: OrderTotals;
  vendorOrderIds: ObjectId[];
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentSummaryStatus;
  status: OrderStatus;
  shippingAddress: AddressSnapshot;
  reservationId?: ObjectId;
  cancellationReason?: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderItemSnapshot {
  productId: ObjectId;
  variantId: string;
  sku: string;
  title: string;
  variantLabel: string;
  imageUrl?: string;
  unitPriceMinor: number;
  quantity: number;
  lineTotalMinor: number;
}

export type FulfillmentStatus =
  | "awaiting_payment" | "new" | "accepted" | "shipped" | "delivered" | "cancelled" | "return_requested" | "returned";

export interface VendorOrderDoc {
  _id: ObjectId;
  parentOrderId: ObjectId;
  publicOrderNumber: string;
  vendorId: ObjectId;
  buyerId: ObjectId;
  vendorName: string;
  vendorSlug: string;
  currency: CurrencyCode;
  items: OrderItemSnapshot[];
  totals: { subtotalMinor: number; shippingMinor: number; totalMinor: number };
  commission: { bps: number; ruleVersion: number; amountMinor: number; vendorNetMinor: number };
  fulfillmentStatus: FulfillmentStatus;
  shipment?: { carrier: string; trackingNumber: string; shippedAt: Date };
  shippingAddress: AddressSnapshot;
  timeline: { status: FulfillmentStatus; at: Date; actorId?: ObjectId; note?: string }[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export type PaymentStatus =
  | "created" | "requires_action" | "pending" | "succeeded" | "failed" | "cancelled"
  | "unknown" | "refunding" | "partially_refunded" | "refunded";

export interface PaymentDoc {
  _id: ObjectId;
  orderId: ObjectId;
  provider: string;
  mode: "sandbox" | "live";
  merchantReference: string;
  providerTransactionId?: string;
  amountMinor: number;
  currency: CurrencyCode;
  refundedMinor: number;
  status: PaymentStatus;
  redirectUrl?: string;
  failureReason?: string;
  lastVerifiedAt?: Date;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentEventDoc {
  _id: ObjectId;
  provider: string;
  providerEventId: string;
  paymentId?: ObjectId;
  type: string;
  payloadHash: string;
  outcome: "applied" | "ignored_duplicate" | "ignored_stale" | "rejected";
  receivedAt: Date;
}

export type RefundStatus = "requested" | "approved" | "processing" | "succeeded" | "failed" | "rejected";
export interface RefundDoc {
  _id: ObjectId;
  orderId: ObjectId;
  paymentId: ObjectId;
  vendorOrderId?: ObjectId;
  /** Vendor whose ledger absorbs the debit (derived from vendorOrder). */
  vendorId?: ObjectId;
  amountMinor: number;
  currency: CurrencyCode;
  reason: string;
  /** false for refunds of money that never reached the ledger (late/duplicate payments on cancelled orders). */
  postLedger: boolean;
  /** Set when created by policy rather than a person (e.g. customer cancelled before fulfilment). */
  system?: boolean;
  failureReason?: string;
  status: RefundStatus;
  requestedBy: ObjectId;
  decidedBy?: ObjectId;
  decisionReason?: string;
  providerRefundId?: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export type LedgerEntryType =
  | "sale_gross" | "platform_commission" | "refund_debit" | "refund_commission_reversal"
  | "payout_debit" | "manual_adjustment" | "reversal";
export interface LedgerEntryDoc {
  _id: ObjectId;
  vendorId: ObjectId;
  type: LedgerEntryType;
  /** Signed minor units; positive increases what the platform owes the vendor. */
  amountMinor: number;
  currency: CurrencyCode;
  orderId?: ObjectId;
  vendorOrderId?: ObjectId;
  paymentId?: ObjectId;
  refundId?: ObjectId;
  payoutId?: ObjectId;
  idempotencyReference: string;
  ruleVersion?: number;
  source: "system" | "admin";
  actorId?: ObjectId;
  note?: string;
  /** Entries only become payable once the underlying sale is settled (delivered + payment succeeded). */
  availableAt?: Date;
  createdAt: Date;
}

export type PayoutStatus = "requested" | "under_review" | "approved" | "processing" | "paid" | "failed" | "cancelled";
export interface PayoutDoc {
  _id: ObjectId;
  vendorId: ObjectId;
  amountMinor: number;
  currency: CurrencyCode;
  destinationRef: string;
  status: PayoutStatus;
  requestedBy: ObjectId;
  approvedBy?: ObjectId;
  providerRef?: string;
  note?: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IdempotencyKeyDoc {
  _id: ObjectId;
  actorScope: string;
  key: string;
  operation: string;
  requestHash: string;
  state: "in_progress" | "completed";
  responseStatus?: number;
  responseBody?: unknown;
  resourceRef?: string;
  createdAt: Date;
  lockedUntil: Date;
  expiresAt: Date;
}

export type NotificationChannel = "inbox" | "push" | "email" | "sms";
export interface NotificationDoc {
  _id: ObjectId;
  userId: ObjectId;
  channel: NotificationChannel;
  eventType: string;
  title: string;
  body: string;
  deepLink?: string;
  /** Dedupes at-most-once intent per business transition. */
  dedupeKey: string;
  readAt?: Date;
  deliveryState: "pending" | "sent" | "failed" | "skipped";
  createdAt: Date;
}

export interface DeviceDoc {
  _id: ObjectId;
  userId: ObjectId;
  installationId: string;
  platform: "android" | "ios" | "web";
  appId: string;
  pushToken: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditLogDoc {
  _id: ObjectId;
  actorId?: ObjectId;
  actorRole?: Role | "system";
  action: string;
  resourceType: string;
  resourceId?: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
  requestId?: string;
  ip?: string;
  createdAt: Date;
}

export type OutboxState = "pending" | "processing" | "done" | "dead";
export interface OutboxEventDoc {
  _id: ObjectId;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
  state: OutboxState;
  attempts: number;
  nextAttemptAt: Date;
  lockedUntil?: Date;
  lastErrorCode?: string;
  createdAt: Date;
  processedAt?: Date;
}

export type ReviewStatus = "published" | "hidden";
export interface ReviewDoc {
  _id: ObjectId;
  productId: ObjectId;
  vendorId: ObjectId;
  userId: ObjectId;
  vendorOrderId: ObjectId;
  rating: number;
  title?: string;
  body: string;
  status: ReviewStatus;
  createdAt: Date;
}

export interface KnowledgeDocumentDoc {
  _id: ObjectId;
  sourceId: string;
  title: string;
  body: string;
  visibility: "public" | "vendor" | "admin";
  locale: string;
  version: number;
  contentHash: string;
  status: "approved" | "draft" | "retired";
  tokens: string[];
  effectiveAt: Date;
  updatedAt: Date;
}

export interface RateLimitDoc {
  _id: string;
  count: number;
  expiresAt: Date;
}
