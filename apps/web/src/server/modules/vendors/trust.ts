import type { ObjectId } from "mongodb";
import { getCollections } from "@/server/db/collections";
import { AppError } from "@/server/shared/errors";
import { ratingSummaryForVendor } from "@/server/modules/reviews/service";

/** Fewer samples than this and a percentage or average would mislead, so the figure is left out. */
const MIN_RETURN_SAMPLE = 10;
const MIN_SHIP_SAMPLE = 5;

/**
 * What a shopper can check about a store, computed from real records only (never typed in by the seller):
 * how long it has been approved, how many orders it has completed, review ratings, how quickly it ships and how often
 * delivered orders come back. Anything without enough data is returned as null so the UI says so instead of guessing.
 */
export async function vendorTrust(slug: string) {
  const c = await getCollections();
  const v = await c.vendors.findOne({ slug, status: "active" });
  if (!v) throw new AppError("NOT_FOUND");
  const id: ObjectId = v._id;

  const [productCount, byStatus, shipped, ratings] = await Promise.all([
    c.products.countDocuments({ vendorId: id, status: "published" }),
    c.vendorOrders.aggregate<{ _id: string; n: number }>([{ $match: { vendorId: id, fulfillmentStatus: { $in: ["delivered", "return_requested", "returned"] } } }, { $group: { _id: "$fulfillmentStatus", n: { $sum: 1 } } }]).toArray(),
    c.vendorOrders.find({ vendorId: id, "shipment.shippedAt": { $exists: true } }, { projection: { createdAt: 1, "shipment.shippedAt": 1 } }).sort({ _id: -1 }).limit(200).toArray(),
    ratingSummaryForVendor(id),
  ]);

  const completed = byStatus.reduce((a, r) => a + r.n, 0);
  const returned = byStatus.filter((r) => r._id !== "delivered").reduce((a, r) => a + r.n, 0);
  const shipDays = shipped.map((o) => ((o.shipment?.shippedAt.getTime() ?? 0) - o.createdAt.getTime()) / 86_400_000).filter((d) => d >= 0).sort((a, b) => a - b);
  const median = shipDays.length >= MIN_SHIP_SAMPLE ? shipDays[Math.floor(shipDays.length / 2)]! : null;

  return {
    memberSince: v.createdAt.toISOString(),
    productCount,
    completedOrders: completed,
    returnRatePercent: completed >= MIN_RETURN_SAMPLE ? Math.round((returned / completed) * 100) : null,
    typicalShipDays: median === null ? null : Math.max(1, Math.round(median)),
    shipping: { flatFeeMinor: v.shipping.flatFeeMinor, freeOverMinor: v.shipping.freeOverMinor ?? null },
    rating: ratings,
  };
}
