/** Client-side shapes of API payloads (mirrors the server DTOs; see packages/contracts/openapi.json). */
export interface QuoteLine { itemId: string; productId: string; productSlug: string; variantId: string; sku: string; title: string; variantLabel: string; imageUrl?: string; unitPriceMinor: number; quantity: number; lineTotalMinor: number; available: number }
export interface QuoteGroup { vendorId: string; vendor: { name: string; slug: string }; lines: QuoteLine[]; subtotalMinor: number; shippingMinor: number; discountMinor: number; shippingPolicy: { flatFeeMinor: number; freeOverMinor: number | null }; totalMinor: number }
export interface AppliedCoupon { id: string; code: string; vendorId: string; discountMinor: number; label: string }
export interface QuoteIssue { itemId: string; code: string; availableQuantity?: number }
export interface Quote { currency: string; groups: QuoteGroup[]; issues: QuoteIssue[]; coupon?: AppliedCoupon; couponIssue?: { code: string; reason: string; message: string }; totals: { subtotalMinor: number; shippingMinor: number; discountMinor: number; totalMinor: number }; itemCount: number; paymentMethods?: string[]; codNotice?: string }
export interface Address { id: string; label: string; recipient: string; phone: string; line1: string; line2?: string; city: string; district: string; postalCode: string; isDefault: boolean }
export interface PaymentView { id: string; status: string; provider: string; amountMinor: number; currency: string; redirectUrl?: string; canRetry: boolean; message?: string }
export interface OrderItem { productId: string; productSlug: string; variantId: string; sku: string; title: string; variantLabel: string; imageUrl?: string; unitPriceMinor: number; quantity: number; lineTotalMinor: number }
export interface VendorOrderView {
  id: string; vendor: { name: string; slug: string }; status: string; items: OrderItem[]; totals: { subtotalMinor: number; shippingMinor: number; discountMinor?: number; totalMinor: number };
  shipment?: { carrier: string; trackingNumber: string; shippedAt: string }; timeline: { status: string; at: string; note?: string }[];
}
export interface OrderView {
  id: string; orderNumber: string; status: string; paymentStatus: string; paymentMethod: "online" | "cod"; currency: string;
  totals: { subtotalMinor: number; shippingMinor: number; discountMinor: number; totalMinor: number };
  shippingAddress: { recipient: string; phone: string; line1: string; line2?: string; city: string; district: string; postalCode: string };
  cancellationReason?: string; vendorOrders: VendorOrderView[]; createdAt: string; updatedAt: string; payment?: PaymentView | null;
}
