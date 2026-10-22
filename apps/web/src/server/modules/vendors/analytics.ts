import type { ObjectId } from "mongodb";
import { getCollections } from "@/server/db/collections";
import { ratingSummaryForVendor } from "@/server/modules/reviews/service";

const SOLD = ["new", "accepted", "shipped", "delivered", "return_requested", "returned"];
const LOW_STOCK = 5;

/**
 * A store's own numbers, from real orders, reviews and (for views) anonymous storefront events. Sales are net of the platform
 * commission, which is what the seller actually earns. Views only count shoppers whose browsers allow tracking, so they are a floor.
 */
export async function vendorSalesAnalytics(vendorId: ObjectId, days: number) {
  const c = await getCollections();
  const since = new Date(Date.now() - days * 86_400_000);
  const base = { vendorId, createdAt: { $gte: since }, fulfillmentStatus: { $in: SOLD } };

  const [perDay, totals, perProduct, products, rating, lowStock] = await Promise.all([
    c.vendorOrders.aggregate<{ _id: string; orders: number; grossMinor: number; netMinor: number }>([
      { $match: base },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Dhaka" } }, orders: { $sum: 1 }, grossMinor: { $sum: "$totals.totalMinor" }, netMinor: { $sum: "$commission.vendorNetMinor" } } },
      { $sort: { _id: 1 } },
    ]).toArray(),
    c.vendorOrders.aggregate<{ _id: null; orders: number; units: number; grossMinor: number; netMinor: number; returned: number }>([
      { $match: base },
      { $group: { _id: null, orders: { $sum: 1 }, grossMinor: { $sum: "$totals.totalMinor" }, netMinor: { $sum: "$commission.vendorNetMinor" }, units: { $sum: { $sum: "$items.quantity" } }, returned: { $sum: { $cond: [{ $in: ["$fulfillmentStatus", ["return_requested", "returned"]] }, 1, 0] } } } },
    ]).toArray(),
    c.vendorOrders.aggregate<{ _id: ObjectId; units: number; revenueMinor: number }>([
      { $match: base }, { $unwind: "$items" },
      { $group: { _id: "$items.productId", units: { $sum: "$items.quantity" }, revenueMinor: { $sum: "$items.lineTotalMinor" } } },
      { $sort: { revenueMinor: -1 } }, { $limit: 8 },
    ]).toArray(),
    c.products.find({ vendorId, status: "published" }, { projection: { title: 1, slug: 1 } }).toArray(),
    ratingSummaryForVendor(vendorId),
    c.inventoryItems.countDocuments({ vendorId, $expr: { $lte: [{ $subtract: ["$onHand", "$reserved"] }, LOW_STOCK] } }),
  ]);

  const mine = new Map(products.map((p) => [p._id.toHexString(), p]));
  const events = products.length
    ? await c.analyticsEvents.aggregate<{ _id: { p: ObjectId; t: string }; n: number }>([
        { $match: { at: { $gte: since }, type: { $in: ["view_product", "add_to_cart"] }, productId: { $in: products.map((p) => p._id) } } },
        { $group: { _id: { p: "$productId", t: "$type" }, n: { $sum: 1 } } },
      ]).toArray()
    : [];
  const views = new Map<string, { views: number; carts: number }>();
  for (const e of events) {
    const k = e._id.p.toHexString();
    const slot = views.get(k) ?? { views: 0, carts: 0 };
    if (e._id.t === "view_product") slot.views = e.n; else slot.carts = e.n;
    views.set(k, slot);
  }
  const sold = new Map(perProduct.map((p) => [p._id.toHexString(), p]));
  const mostViewed = [...views.entries()].sort((a, b) => b[1].views - a[1].views).slice(0, 8).map(([id, v]) => ({
    title: mine.get(id)?.title ?? "Product", slug: mine.get(id)?.slug, views: v.views, addedToCart: v.carts, unitsSold: sold.get(id)?.units ?? 0,
  }));

  const t = totals[0];
  return {
    days,
    summary: { orders: t?.orders ?? 0, units: t?.units ?? 0, grossMinor: t?.grossMinor ?? 0, netMinor: t?.netMinor ?? 0, returnedOrders: t?.returned ?? 0, lowStockItems: lowStock },
    perDay: perDay.map((d) => ({ day: d._id, orders: d.orders, grossMinor: d.grossMinor, netMinor: d.netMinor })),
    topProducts: perProduct.map((p) => ({ title: mine.get(p._id.toHexString())?.title ?? "Product", slug: mine.get(p._id.toHexString())?.slug, units: p.units, revenueMinor: p.revenueMinor })),
    mostViewed,
    rating,
  };
}
