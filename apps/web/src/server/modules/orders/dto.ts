import type { OrderDoc, VendorOrderDoc } from "@/server/db/schema";

export const toVendorOrderCustomerDto = (v: VendorOrderDoc) => ({
  id: v._id.toHexString(),
  vendor: { name: v.vendorName, slug: v.vendorSlug },
  status: v.fulfillmentStatus,
  items: v.items.map((i) => ({
    productId: i.productId.toHexString(), productSlug: i.productSlug, variantId: i.variantId, sku: i.sku, title: i.title, variantLabel: i.variantLabel,
    imageUrl: i.imageUrl, unitPriceMinor: i.unitPriceMinor, quantity: i.quantity, lineTotalMinor: i.lineTotalMinor,
  })),
  totals: v.totals,
  shipment: v.shipment ? { carrier: v.shipment.carrier, trackingNumber: v.shipment.trackingNumber, shippedAt: v.shipment.shippedAt.toISOString() } : undefined,
  timeline: v.timeline.map((t) => ({ status: t.status, at: t.at.toISOString(), note: t.note })),
});

/** Customer view: never includes commission or any vendor-side accounting. */
export const toOrderDto = (o: OrderDoc, vendorOrders: VendorOrderDoc[] = []) => ({
  id: o._id.toHexString(),
  orderNumber: o.publicOrderNumber,
  status: o.status,
  paymentStatus: o.paymentStatus,
  paymentMethod: o.paymentMethod,
  currency: o.currency,
  totals: o.totals,
  shippingAddress: o.shippingAddress,
  cancellationReason: o.cancellationReason,
  vendorOrders: vendorOrders.map(toVendorOrderCustomerDto),
  createdAt: o.createdAt.toISOString(),
  updatedAt: o.updatedAt.toISOString(),
});
