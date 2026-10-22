import { ObjectId } from "mongodb";
import { getCollections } from "@/server/db/collections";
import type { QuestionDoc } from "@/server/db/schema";
import { AppError } from "@/server/shared/errors";
import { decodeCursor, encodeCursor, slicePage } from "@/server/shared/pagination";
import { writeAudit } from "@/server/modules/audit/audit";
import type { Actor } from "@/server/modules/authorization/actor";
import { enqueue } from "@/server/modules/outbox/outbox";
import { invalidateCatalog } from "@/server/modules/catalog/cache";

/** Shoppers ask, the selling store answers. Questions are public and tied to one product; only that store can answer. */

const shortName = (full: string) => full.split(" ").map((p, i) => (i === 0 ? p : `${p[0]}.`)).join(" ");

const toDto = (q: QuestionDoc, askerName?: string, storeName?: string) => ({
  id: q._id.toHexString(), body: q.body, createdAt: q.createdAt.toISOString(), asker: askerName ?? "Customer",
  ...(q.answer ? { answer: { body: q.answer.body, at: q.answer.at.toISOString(), by: storeName ?? "Seller" } } : {}),
});

export async function askQuestion(actor: Actor, productSlug: string, body: string) {
  const c = await getCollections();
  const product = await c.products.findOne({ slug: productSlug, status: "published", vendorActive: true }, { projection: { _id: 1, vendorId: 1, title: 1, slug: 1 } });
  if (!product) throw new AppError("NOT_FOUND");
  const doc: QuestionDoc = { _id: new ObjectId(), productId: product._id, vendorId: product.vendorId, userId: actor.userId, body, status: "published", answered: false, createdAt: new Date() };
  await c.questions.insertOne(doc);
  const vendor = await c.vendors.findOne({ _id: product.vendorId }, { projection: { ownerUserId: 1 } });
  if (vendor) {
    await enqueue({
      type: "notify.user", aggregateType: "question", aggregateId: doc._id.toHexString(), dedupeKey: `question-asked:${doc._id.toHexString()}`,
      payload: { userId: vendor.ownerUserId.toHexString(), eventType: "question.asked", title: "A shopper asked about your product", body: `${product.title}: ${body.slice(0, 120)}`, deepLink: "/vendor/questions" },
    });
  }
  await invalidateCatalog(product.slug);
  return toDto(doc);
}

/** A product's questions, newest first, with the store's answer when there is one. */
export async function listQuestions(productSlug: string, q: { limit: number; cursor?: string }) {
  const c = await getCollections();
  const product = await c.products.findOne({ slug: productSlug, status: "published", vendorActive: true }, { projection: { _id: 1, vendorId: 1 } });
  if (!product) throw new AppError("NOT_FOUND");
  const cur = decodeCursor<{ id: string }>(q.cursor);
  if (q.cursor && (!cur || !/^[0-9a-f]{24}$/i.test(cur.id))) throw new AppError("VALIDATION_FAILED", { details: [{ field: "cursor", code: "INVALID" }] });
  const rows = await c.questions.find({ productId: product._id, status: "published", ...(cur ? { _id: { $lt: new ObjectId(cur.id) } } : {}) }).sort({ _id: -1 }).limit(q.limit + 1).toArray();
  const { items, hasMore } = slicePage(rows, q.limit);
  const [users, vendor] = await Promise.all([
    c.users.find({ _id: { $in: items.map((x) => x.userId) } }, { projection: { name: 1 } }).toArray(),
    c.vendors.findOne({ _id: product.vendorId }, { projection: { name: 1 } }),
  ]);
  const names = new Map(users.map((u) => [u._id.toHexString(), shortName(u.name)]));
  const last = items[items.length - 1];
  return { items: items.map((x) => toDto(x, names.get(x.userId.toHexString()), vendor?.name)), nextCursor: hasMore && last ? encodeCursor({ id: last._id.toHexString() }) : null };
}

export async function listVendorQuestions(vendorId: ObjectId, q: { limit: number; cursor?: string; answered?: boolean }) {
  const c = await getCollections();
  const cur = decodeCursor<{ id: string }>(q.cursor);
  const rows = await c.questions.find({ vendorId, status: "published", ...(q.answered !== undefined ? { answered: q.answered } : {}), ...(cur ? { _id: { $lt: new ObjectId(cur.id) } } : {}) }).sort({ _id: -1 }).limit(q.limit + 1).toArray();
  const { items, hasMore } = slicePage(rows, q.limit);
  const [users, prods] = await Promise.all([
    c.users.find({ _id: { $in: items.map((x) => x.userId) } }, { projection: { name: 1 } }).toArray(),
    c.products.find({ _id: { $in: items.map((x) => x.productId) } }, { projection: { title: 1, slug: 1 } }).toArray(),
  ]);
  const names = new Map(users.map((u) => [u._id.toHexString(), shortName(u.name)]));
  const prodOf = new Map(prods.map((p) => [p._id.toHexString(), p]));
  const last = items[items.length - 1];
  return {
    items: items.map((x) => ({ ...toDto(x, names.get(x.userId.toHexString())), product: { title: prodOf.get(x.productId.toHexString())?.title ?? "Product", slug: prodOf.get(x.productId.toHexString())?.slug } })),
    nextCursor: hasMore && last ? encodeCursor({ id: last._id.toHexString() }) : null,
  };
}

/** The selling store answers (or edits its answer). Only the store that sells the product can. */
export async function answerQuestion(vendorId: ObjectId, id: ObjectId, body: string) {
  const c = await getCollections();
  const q = await c.questions.findOneAndUpdate({ _id: id, vendorId, status: "published" }, { $set: { answer: { body, at: new Date() }, answered: true } }, { returnDocument: "after" });
  if (!q) throw new AppError("NOT_FOUND");
  const product = await c.products.findOne({ _id: q.productId }, { projection: { title: 1, slug: 1 } });
  if (product) {
    await enqueue({
      type: "notify.user", aggregateType: "question", aggregateId: id.toHexString(), dedupeKey: `question-answered:${id.toHexString()}:${q.answer!.at.getTime()}`,
      payload: { userId: q.userId.toHexString(), eventType: "question.answered", title: "Your question was answered", body: `${product.title}: ${body.slice(0, 120)}`, deepLink: `/products/${product.slug}#questions` },
    });
    await invalidateCatalog(product.slug);
  }
  return toDto(q);
}

export async function hideQuestion(admin: Actor, id: ObjectId, reason: string, requestId?: string) {
  const c = await getCollections();
  const q = await c.questions.findOneAndUpdate({ _id: id }, { $set: { status: "hidden" } }, { returnDocument: "after" });
  if (!q) throw new AppError("NOT_FOUND");
  await writeAudit({ actorId: admin.userId, actorRole: admin.role, action: "question.hide", resourceType: "question", resourceId: id.toHexString(), reason, requestId });
  const p = await c.products.findOne({ _id: q.productId }, { projection: { slug: 1 } });
  if (p) await invalidateCatalog(p.slug);
  return toDto(q);
}
