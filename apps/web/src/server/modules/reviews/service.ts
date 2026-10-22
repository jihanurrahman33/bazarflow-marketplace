import { MongoServerError, ObjectId } from "mongodb";
import { getCollections } from "@/server/db/collections";
import type { ReviewDoc } from "@/server/db/schema";
import { AppError } from "@/server/shared/errors";
import { newId } from "@/server/shared/ids";
import { decodeCursor, encodeCursor, slicePage } from "@/server/shared/pagination";
import { writeAudit } from "@/server/modules/audit/audit";
import type { Actor } from "@/server/modules/authorization/actor";
import { invalidateCatalog } from "@/server/modules/catalog/cache";

const toDto = (r: ReviewDoc, authorName?: string) => ({
  id: r._id.toHexString(), rating: r.rating, title: r.title, body: r.body, author: authorName ?? "Customer", verifiedPurchase: true, createdAt: r.createdAt.toISOString(),
});

/** Verified-buyer rule: the reviewer must have a delivered (not returned) vendor order that contains the product. */
export async function createReview(actor: Actor, productSlug: string, input: { rating: number; title?: string; body: string }) {
  const c = await getCollections();
  const product = await c.products.findOne({ slug: productSlug, status: "published" }, { projection: { _id: 1, vendorId: 1, slug: 1 } });
  if (!product) throw new AppError("NOT_FOUND");
  const productId = product._id;
  const vo = await c.vendorOrders.findOne({ buyerId: actor.userId, "items.productId": productId, fulfillmentStatus: "delivered" }, { projection: { _id: 1 } });
  if (!vo) throw new AppError("FORBIDDEN", { message: "Only customers who received this product can review it.", details: [{ field: "productId", code: "NOT_VERIFIED_PURCHASE" }] });
  const doc: ReviewDoc = { _id: newId(), productId, vendorId: product.vendorId, userId: actor.userId, vendorOrderId: vo._id, rating: input.rating, title: input.title, body: input.body, status: "published", createdAt: new Date() };
  try {
    await c.reviews.insertOne(doc);
  } catch (e) {
    if (e instanceof MongoServerError && e.code === 11000) throw new AppError("CONFLICT", { message: "You already reviewed this product." });
    throw e;
  }
  await invalidateCatalog(product.slug);
  return toDto(doc);
}

/** Lets the product page show the review form only to people who may actually use it. */
export async function reviewEligibility(actor: Actor, productSlug: string): Promise<{ canReview: boolean; reason?: "not_purchased" | "already_reviewed" }> {
  const c = await getCollections();
  const product = await c.products.findOne({ slug: productSlug, status: "published" }, { projection: { _id: 1 } });
  if (!product) throw new AppError("NOT_FOUND");
  if (await c.reviews.countDocuments({ productId: product._id, userId: actor.userId }, { limit: 1 })) return { canReview: false, reason: "already_reviewed" };
  const bought = await c.vendorOrders.countDocuments({ buyerId: actor.userId, "items.productId": product._id, fulfillmentStatus: "delivered" }, { limit: 1 });
  return bought ? { canReview: true } : { canReview: false, reason: "not_purchased" };
}

export async function listProductReviews(slug: string, q: { limit: number; cursor?: string }) {
  const c = await getCollections();
  const product = await c.products.findOne({ slug, status: "published", vendorActive: true }, { projection: { _id: 1 } });
  if (!product) throw new AppError("NOT_FOUND");
  const cur = decodeCursor<{ id: string }>(q.cursor);
  const rows = await c.reviews.find({ productId: product._id, status: "published", ...(cur ? { _id: { $lt: new ObjectId(cur.id) } } : {}) }).sort({ _id: -1 }).limit(q.limit + 1).toArray();
  const { items, hasMore } = slicePage(rows, q.limit);
  const users = await c.users.find({ _id: { $in: items.map((r) => r.userId) } }, { projection: { name: 1 } }).toArray();
  // Show first name + initial only: reviewers' full names are not public.
  const nameOf = new Map(users.map((u) => [u._id.toHexString(), u.name.split(" ").map((p, i) => (i === 0 ? p : `${p[0]}.`)).join(" ")]));
  const summary = await ratingSummary(product._id);
  const last = items[items.length - 1];
  return { items: items.map((r) => toDto(r, nameOf.get(r.userId.toHexString()))), summary, nextCursor: hasMore && last ? encodeCursor({ id: last._id.toHexString() }) : null };
}

export async function ratingSummary(productId: ObjectId) {
  const c = await getCollections();
  const agg = await c.reviews
    .aggregate<{ _id: number; n: number }>([{ $match: { productId, status: "published" } }, { $group: { _id: "$rating", n: { $sum: 1 } } }])
    .toArray();
  const count = agg.reduce((a, r) => a + r.n, 0);
  const total = agg.reduce((a, r) => a + r._id * r.n, 0);
  return { count, average: count ? Math.round((total / count) * 10) / 10 : null, distribution: Object.fromEntries([1, 2, 3, 4, 5].map((s) => [s, agg.find((r) => r._id === s)?.n ?? 0])) };
}

export async function setReviewStatus(admin: Actor, reviewId: ObjectId, status: "hidden" | "published", reason: string, requestId?: string) {
  const c = await getCollections();
  const r = await c.reviews.findOneAndUpdate({ _id: reviewId }, { $set: { status } }, { returnDocument: "after" });
  if (!r) throw new AppError("NOT_FOUND");
  await writeAudit({ actorId: admin.userId, actorRole: admin.role, action: status === "hidden" ? "review.hide" : "review.restore", resourceType: "review", resourceId: reviewId.toHexString(), reason, requestId });
  const p = await c.products.findOne({ _id: r.productId }, { projection: { slug: 1 } });
  if (p) await invalidateCatalog(p.slug);
  return toDto(r);
}
