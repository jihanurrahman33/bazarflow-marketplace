import { MongoServerError, ObjectId } from "mongodb";
import { getCollections } from "@/server/db/collections";
import { AppError } from "@/server/shared/errors";
import { enqueue } from "@/server/modules/outbox/outbox";
import { toCards } from "@/server/modules/catalog/public";

export const MAX_WISHLIST = 200;
const ALERT_FANOUT = 1000; // most people notified for one change

/** Saved items for a signed-in customer. A product can be saved once; saving it again is a no-op. */
export async function addToWishlist(userId: ObjectId, productId: ObjectId) {
  const c = await getCollections();
  const product = await c.products.findOne({ _id: productId, status: "published", vendorActive: true }, { projection: { minPriceMinor: 1 } });
  if (!product) throw new AppError("NOT_FOUND");
  if ((await c.wishlistItems.countDocuments({ userId })) >= MAX_WISHLIST) {
    throw new AppError("BUSINESS_RULE_VIOLATION", { message: `You can save up to ${MAX_WISHLIST} items. Remove some to add more.` });
  }
  try {
    await c.wishlistItems.insertOne({ _id: new ObjectId(), userId, productId, priceMinorWhenSaved: product.minPriceMinor, createdAt: new Date() });
  } catch (e) {
    if (!(e instanceof MongoServerError && e.code === 11000)) throw e;
  }
}

export async function removeFromWishlist(userId: ObjectId, productId: ObjectId) {
  const c = await getCollections();
  await c.wishlistItems.deleteOne({ userId, productId });
}

export async function wishlistIds(userId: ObjectId): Promise<string[]> {
  const c = await getCollections();
  return (await c.wishlistItems.find({ userId }, { projection: { productId: 1 } }).sort({ _id: -1 }).limit(MAX_WISHLIST).toArray()).map((w) => w.productId.toHexString());
}

/** Saved products, newest first, each with whether the price has dropped since it was saved. Items that are no longer for sale are left out. */
export async function listWishlist(userId: ObjectId) {
  const c = await getCollections();
  const saved = await c.wishlistItems.find({ userId }).sort({ _id: -1 }).limit(MAX_WISHLIST).toArray();
  if (saved.length === 0) return [];
  const rows = await c.products.find({ _id: { $in: saved.map((s) => s.productId) }, status: "published", vendorActive: true }).toArray();
  const byId = new Map(rows.map((p) => [p._id.toHexString(), p]));
  const ordered = saved.map((s) => byId.get(s.productId.toHexString())).filter((p): p is NonNullable<typeof p> => !!p);
  const cards = await toCards(ordered);
  const was = new Map(saved.map((s) => [s.productId.toHexString(), s.priceMinorWhenSaved]));
  return cards.map((card) => {
    const before = was.get(card.id);
    return { ...card, savedPriceMinor: before, priceDropped: before !== undefined && card.minPriceMinor < before };
  });
}

/**
 * Called when a seller lowers a price or restocks an item: queues one alert, which the worker fans out to everyone who saved the
 * product. Dedupe keys make a retried request harmless.
 */
export async function queueWishlistAlert(kind: "price_drop" | "restock", productId: ObjectId, detail: { priceMinor?: number; previousMinor?: number; token: string }) {
  await enqueue({ type: "wishlist.alert", aggregateType: "product", aggregateId: productId.toHexString(), payload: { kind, productId: productId.toHexString(), ...detail }, dedupeKey: `wishlist:${kind}:${productId.toHexString()}:${detail.token}` });
}

/** Outbox handler: turn one product change into an inbox/push notification per person who saved it. */
export async function fanOutWishlistAlert(event: { payload: Record<string, unknown>; dedupeKey: string }) {
  const c = await getCollections();
  const p = event.payload as { kind: "price_drop" | "restock"; productId: string; priceMinor?: number; previousMinor?: number };
  const product = await c.products.findOne({ _id: new ObjectId(p.productId), status: "published", vendorActive: true }, { projection: { title: 1, slug: 1, currency: 1 } });
  if (!product) return;
  const watchers = await c.wishlistItems.find({ productId: product._id }, { projection: { userId: 1 } }).limit(ALERT_FANOUT).toArray();
  const taka = (minor: number) => `৳${(minor / 100).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
  for (const w of watchers) {
    await enqueue({
      type: "notify.user", aggregateType: "user", aggregateId: w.userId.toHexString(),
      dedupeKey: `${event.dedupeKey}:${w.userId.toHexString()}`,
      payload: {
        userId: w.userId.toHexString(),
        eventType: p.kind === "price_drop" ? "wishlist.price_drop" : "wishlist.restock",
        title: p.kind === "price_drop" ? "Price dropped on an item you saved" : "Back in stock",
        body: p.kind === "price_drop" && p.priceMinor !== undefined ? `${product.title} is now ${taka(p.priceMinor)}${p.previousMinor ? ` (was ${taka(p.previousMinor)})` : ""}.` : `${product.title} is available again.`,
        deepLink: `/products/${product.slug}`,
      },
    });
  }
}
