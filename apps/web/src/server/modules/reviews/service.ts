import { MongoServerError, ObjectId, type Filter, type Sort } from "mongodb";
import { getCollections } from "@/server/db/collections";
import type { ReviewDoc } from "@/server/db/schema";
import { AppError } from "@/server/shared/errors";
import { newId } from "@/server/shared/ids";
import { decodeCursor, encodeCursor, slicePage } from "@/server/shared/pagination";
import { writeAudit } from "@/server/modules/audit/audit";
import type { Actor } from "@/server/modules/authorization/actor";
import { invalidateCatalog } from "@/server/modules/catalog/cache";
import { enqueue } from "@/server/modules/outbox/outbox";

const toDto = (r: ReviewDoc, authorName?: string) => ({
  id: r._id.toHexString(), rating: r.rating, title: r.title, body: r.body, author: authorName ?? "Customer", verifiedPurchase: true, createdAt: r.createdAt.toISOString(),
  ...(r.reply ? { reply: { body: r.reply.body, at: r.reply.at.toISOString() } } : {}),
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

export type ReviewSort = "newest" | "highest" | "lowest";

/**
 * One page of a product's published reviews. `rating` filters to a single star count; `sort` is newest (default), highest or lowest.
 * The cursor is a keyset on (rating, _id) so pages stay stable while new reviews arrive, and ties on rating never skip or repeat a review.
 */
export async function listProductReviews(slug: string, q: { limit: number; cursor?: string; rating?: number; sort?: ReviewSort }) {
  const c = await getCollections();
  const product = await c.products.findOne({ slug, status: "published", vendorActive: true }, { projection: { _id: 1 } });
  if (!product) throw new AppError("NOT_FOUND");
  const sort = q.sort ?? "newest";
  const cur = decodeCursor<{ id: string; r?: number }>(q.cursor);
  if (q.cursor && (!cur || !/^[0-9a-f]{24}$/i.test(cur.id))) throw new AppError("VALIDATION_FAILED", { details: [{ field: "cursor", code: "INVALID" }] });
  const filter: Filter<ReviewDoc> = { productId: product._id, status: "published", ...(q.rating ? { rating: q.rating } : {}) };
  if (cur) {
    const id = new ObjectId(cur.id);
    if (sort === "newest" || cur.r === undefined) filter._id = { $lt: id };
    else filter.$or = [{ rating: sort === "highest" ? { $lt: cur.r } : { $gt: cur.r } }, { rating: cur.r, _id: { $lt: id } }];
  }
  const order = sort === "highest" ? { rating: -1, _id: -1 } : sort === "lowest" ? { rating: 1, _id: -1 } : { _id: -1 };
  const rows = await c.reviews.find(filter).sort(order as Sort).limit(q.limit + 1).toArray();
  const { items, hasMore } = slicePage(rows, q.limit);
  const users = await c.users.find({ _id: { $in: items.map((r) => r.userId) } }, { projection: { name: 1 } }).toArray();
  // Show first name + initial only: reviewers' full names are not public.
  const nameOf = new Map(users.map((u) => [u._id.toHexString(), u.name.split(" ").map((p, i) => (i === 0 ? p : `${p[0]}.`)).join(" ")]));
  const summary = await ratingSummary(product._id);
  const last = items[items.length - 1];
  return { items: items.map((r) => toDto(r, nameOf.get(r.userId.toHexString()))), summary, nextCursor: hasMore && last ? encodeCursor({ id: last._id.toHexString(), r: last.rating }) : null };
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

/** Rating summary across every published review of a store's products. */
export async function ratingSummaryForVendor(vendorId: ObjectId) {
  const c = await getCollections();
  const agg = await c.reviews.aggregate<{ _id: number; n: number }>([{ $match: { vendorId, status: "published" } }, { $group: { _id: "$rating", n: { $sum: 1 } } }]).toArray();
  const count = agg.reduce((a, r) => a + r.n, 0);
  const total = agg.reduce((a, r) => a + r._id * r.n, 0);
  const positive = agg.filter((r) => r._id >= 4).reduce((a, r) => a + r.n, 0);
  return {
    count, average: count ? Math.round((total / count) * 10) / 10 : null, positivePercent: count ? Math.round((positive / count) * 100) : null,
    distribution: Object.fromEntries([1, 2, 3, 4, 5].map((s) => [s, agg.find((r) => r._id === s)?.n ?? 0])) as Record<string, number>,
  };
}

/** Latest reviews across a store's products, each with the product it is about. Reviewer names are first name + initial only. */
export async function listVendorReviews(vendorId: ObjectId, limit: number) {
  const c = await getCollections();
  const rows = await c.reviews.find({ vendorId, status: "published" }).sort({ _id: -1 }).limit(limit).toArray();
  const [users, prods] = await Promise.all([
    c.users.find({ _id: { $in: rows.map((r) => r.userId) } }, { projection: { name: 1 } }).toArray(),
    c.products.find({ _id: { $in: rows.map((r) => r.productId) } }, { projection: { title: 1, slug: 1 } }).toArray(),
  ]);
  const nameOf = new Map(users.map((u) => [u._id.toHexString(), u.name.split(" ").map((p, i) => (i === 0 ? p : `${p[0]}.`)).join(" ")]));
  const prodOf = new Map(prods.map((p) => [p._id.toHexString(), p]));
  return rows.map((r) => ({ ...toDto(r, nameOf.get(r.userId.toHexString())), product: { title: prodOf.get(r.productId.toHexString())?.title ?? "Product", slug: prodOf.get(r.productId.toHexString())?.slug } }));
}

/** The store answers a review of one of its products, publicly. One reply per review; sending again edits it. */
export async function replyToReview(vendorId: ObjectId, reviewId: ObjectId, body: string) {
  const c = await getCollections();
  const r = await c.reviews.findOneAndUpdate({ _id: reviewId, vendorId, status: "published" }, { $set: { reply: { body, at: new Date() } } }, { returnDocument: "after" });
  if (!r) throw new AppError("NOT_FOUND");
  const p = await c.products.findOne({ _id: r.productId }, { projection: { slug: 1, title: 1 } });
  if (p) {
    await enqueue({
      type: "notify.user", aggregateType: "review", aggregateId: reviewId.toHexString(), dedupeKey: `review-reply:${reviewId.toHexString()}:${r.reply!.at.getTime()}`,
      payload: { userId: r.userId.toHexString(), eventType: "review.reply", title: "The seller replied to your review", body: `${p.title}: ${body.slice(0, 120)}`, deepLink: `/products/${p.slug}#reviews` },
    });
    await invalidateCatalog(p.slug);
  }
  return toDto(r);
}

/** The seller's view of reviews on their products, newest first; `unanswered` shows only those without a reply. */
export async function listReviewsForSeller(vendorId: ObjectId, q: { limit: number; cursor?: string; unanswered?: boolean }) {
  const c = await getCollections();
  const cur = decodeCursor<{ id: string }>(q.cursor);
  const rows = await c.reviews.find({ vendorId, status: "published", ...(q.unanswered ? { reply: { $exists: false } } : {}), ...(cur ? { _id: { $lt: new ObjectId(cur.id) } } : {}) }).sort({ _id: -1 }).limit(q.limit + 1).toArray();
  const { items, hasMore } = slicePage(rows, q.limit);
  const [users, prods] = await Promise.all([
    c.users.find({ _id: { $in: items.map((r) => r.userId) } }, { projection: { name: 1 } }).toArray(),
    c.products.find({ _id: { $in: items.map((r) => r.productId) } }, { projection: { title: 1, slug: 1 } }).toArray(),
  ]);
  const nameOf = new Map(users.map((u) => [u._id.toHexString(), u.name.split(" ").map((p, i) => (i === 0 ? p : `${p[0]}.`)).join(" ")]));
  const prodOf = new Map(prods.map((p) => [p._id.toHexString(), p]));
  const last = items[items.length - 1];
  return {
    items: items.map((r) => ({ ...toDto(r, nameOf.get(r.userId.toHexString())), product: { title: prodOf.get(r.productId.toHexString())?.title ?? "Product", slug: prodOf.get(r.productId.toHexString())?.slug } })),
    nextCursor: hasMore && last ? encodeCursor({ id: last._id.toHexString() }) : null,
  };
}
