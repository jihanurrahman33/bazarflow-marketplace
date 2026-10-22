import { ObjectId } from "mongodb";
import { getCollections } from "@/server/db/collections";
import type { ProductDoc } from "@/server/db/schema";
import { discountPercentOf, toCards } from "./public";

/**
 * Product ranking for the storefront. Everything here is computed from real behaviour on the site (orders, reviews, what
 * this shopper viewed); nothing is invented, and shoppers with no history simply get the most popular items.
 *
 * Signals, each scaled to 0..1:
 *  - popularity: units sold in the last 30 days, Bayesian-smoothed rating (so one 5-star review cannot outrank 200 good ones) and review volume
 *  - affinity: how much the shopper's recent views (newest weigh most) point at a product's categories
 *  - price fit: closeness to the price level of what they looked at
 *  - discount: genuine compare-at discounts only
 *  - freshness: newly published items get a small boost that fades over ~30 days
 * A per-seller cap keeps one store from filling a whole row.
 */

const WINDOW_DAYS = 30;
const POP_TTL_MS = 5 * 60_000;
const BAYES_PRIOR = 3; // a product needs a few reviews before its own average outweighs the site-wide average
const MIN_SUPPORT = 2; // "bought together" needs at least this many separate orders
const PER_VENDOR_CAP = 3;
const MIN_SELLERS_FOR_CAP = 3;
const MAX_VIEWED = 20;
const RECENCY_DECAY = 0.85;

interface Pop { score: number; sales: number; reviews: number; bayes: number }
let popCache: { at: number; byId: Map<string, Pop>; mean: number } | null = null;

export function clearRecommendationCache() { popCache = null; }

async function popularity() {
  if (popCache && Date.now() - popCache.at < POP_TTL_MS) return popCache;
  const c = await getCollections();
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  const [sold, rated] = await Promise.all([
    c.vendorOrders.aggregate<{ _id: ObjectId; qty: number }>([
      { $match: { createdAt: { $gte: since }, fulfillmentStatus: { $in: ["new", "accepted", "shipped", "delivered"] } } },
      { $unwind: "$items" },
      { $group: { _id: "$items.productId", qty: { $sum: "$items.quantity" } } },
    ]).toArray(),
    c.reviews.aggregate<{ _id: ObjectId; n: number; avg: number }>([
      { $match: { status: "published" } },
      { $group: { _id: "$productId", n: { $sum: 1 }, avg: { $avg: "$rating" } } },
    ]).toArray(),
  ]);
  const totalN = rated.reduce((a, r) => a + r.n, 0);
  const mean = totalN ? rated.reduce((a, r) => a + r.avg * r.n, 0) / totalN : 4;
  const sales = new Map(sold.map((s) => [s._id.toHexString(), s.qty]));
  const reviews = new Map(rated.map((r) => [r._id.toHexString(), r]));
  const ids = new Set([...sales.keys(), ...reviews.keys()]);
  const maxSales = Math.max(1, ...sales.values());
  const maxReviews = Math.max(1, ...rated.map((r) => r.n));
  const byId = new Map<string, Pop>();
  for (const id of ids) {
    const r = reviews.get(id);
    const n = r?.n ?? 0;
    const bayes = (n * (r?.avg ?? mean) + BAYES_PRIOR * mean) / (n + BAYES_PRIOR);
    const s = sales.get(id) ?? 0;
    const score = 0.5 * (Math.log1p(s) / Math.log1p(maxSales)) + 0.3 * ((bayes - 1) / 4) + 0.2 * (Math.log1p(n) / Math.log1p(maxReviews));
    byId.set(id, { score, sales: s, reviews: n, bayes });
  }
  popCache = { at: Date.now(), byId, mean };
  return popCache;
}

const freshness = (p: ProductDoc) => Math.exp(-(Date.now() - (p.publishedAt ?? p.createdAt).getTime()) / (30 * 86_400_000));
const priceFit = (price: number, meanLogPrice: number) => Math.exp(-Math.abs(Math.log(Math.max(price, 1)) - meanLogPrice) / 0.9);

/** Highest score first, at most PER_VENDOR_CAP per seller, but only when there are other sellers to share the row with (a young catalogue should not be hidden by its own cap). */
function pick(rows: ProductDoc[], score: (p: ProductDoc) => number, limit: number): ProductDoc[] {
  const cap = new Set(rows.map((r) => r.vendorId.toHexString())).size >= MIN_SELLERS_FOR_CAP ? PER_VENDOR_CAP : Infinity;
  const perVendor = new Map<string, number>();
  const out: ProductDoc[] = [];
  for (const p of [...rows].sort((a, b) => score(b) - score(a) || b._id.getTimestamp().getTime() - a._id.getTimestamp().getTime())) {
    const v = p.vendorId.toHexString();
    if ((perVendor.get(v) ?? 0) >= cap) continue;
    perVendor.set(v, (perVendor.get(v) ?? 0) + 1);
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

const sellable = { status: "published" as const, vendorActive: true };

/** Cards for the picked rows, dropping anything that cannot be bought right now. */
async function cardsInStock(rows: ProductDoc[], limit: number) {
  return (await toCards(rows)).filter((p) => p.inStock).slice(0, limit);
}

/** Most popular right now across the whole store. With no sales or reviews yet it falls back to the newest products. */
export async function trendingProducts(limit: number) {
  const c = await getCollections();
  const { byId } = await popularity();
  const hot = [...byId.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 120).map(([id]) => new ObjectId(id));
  const pool = await c.products.find({ ...sellable, _id: { $in: hot } }).toArray();
  const fill = pool.length < limit * 2 ? await c.products.find(sellable).sort({ publishedAt: -1 }).limit(limit * 3).toArray() : [];
  const rows = [...new Map([...pool, ...fill].map((p) => [p._id.toHexString(), p])).values()];
  const score = (p: ProductDoc) => (byId.get(p._id.toHexString())?.score ?? 0) + 0.15 * freshness(p);
  return cardsInStock(pick(rows, score, limit * 2), limit);
}

/**
 * Best-reviewed products: smoothed average, so a single review cannot top the list. Wants 3+ reviews per product; while the
 * catalogue is young and fewer than MIN_ROW products qualify, 2+ reviews is accepted (the count stays visible on each card).
 */
const MIN_ROW = 4;
export async function topRatedProducts(limit: number, minReviews = 3) {
  const c = await getCollections();
  const { byId } = await popularity();
  const rank = (min: number) => [...byId.entries()].filter(([, p]) => p.reviews >= min).sort((a, b) => b[1].bayes - a[1].bayes || b[1].reviews - a[1].reviews).slice(0, 80);
  let ranked = rank(minReviews);
  if (ranked.length < MIN_ROW && minReviews > 2) ranked = rank(2);
  if (ranked.length === 0) return [];
  const rows = await c.products.find({ ...sellable, _id: { $in: ranked.map(([id]) => new ObjectId(id)) } }).toArray();
  const bayes = (p: ProductDoc) => byId.get(p._id.toHexString())?.bayes ?? 0;
  return cardsInStock(pick(rows, bayes, limit * 2), limit);
}

/** The products with these ids, in the order given; unknown or unavailable ones are skipped. */
export async function productsByIds(ids: ObjectId[]) {
  if (ids.length === 0) return [];
  const c = await getCollections();
  const rows = await c.products.find({ ...sellable, _id: { $in: ids } }).toArray();
  const byKey = new Map(rows.map((p) => [p._id.toHexString(), p]));
  return toCards(ids.map((i) => byKey.get(i.toHexString())).filter((p): p is ProductDoc => !!p));
}

/** "Picked for you": ranks products by how well they match what this shopper recently looked at (newest view first). */
export async function recommendForViewer(viewed: ObjectId[], exclude: ObjectId[], limit: number) {
  const recent = viewed.slice(0, MAX_VIEWED);
  const c = await getCollections();
  const seen = await c.products.find({ ...sellable, _id: { $in: recent } }).toArray();
  const seenById = new Map(seen.map((p) => [p._id.toHexString(), p]));
  const ordered = recent.map((i) => seenById.get(i.toHexString())).filter((p): p is ProductDoc => !!p);
  if (ordered.length === 0) return { because: null, items: await trendingProducts(limit) };

  const catWeight = new Map<string, number>();
  let totalW = 0, logPrice = 0;
  ordered.forEach((p, rank) => {
    const w = RECENCY_DECAY ** rank;
    totalW += w;
    logPrice += w * Math.log(Math.max(p.minPriceMinor, 1));
    for (const cid of p.categoryIds) catWeight.set(cid.toHexString(), (catWeight.get(cid.toHexString()) ?? 0) + w);
  });
  const maxCat = Math.max(...catWeight.values());
  const meanLogPrice = logPrice / totalW;
  const topCats = [...catWeight.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => new ObjectId(id));
  const skip = new Set([...recent, ...exclude].map((i) => i.toHexString()));

  const { byId } = await popularity();
  const hot = [...byId.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 40).map(([id]) => new ObjectId(id));
  const [inCats, popular] = await Promise.all([
    c.products.find({ ...sellable, categoryIds: { $in: topCats } }).sort({ publishedAt: -1 }).limit(250).toArray(),
    c.products.find({ ...sellable, _id: { $in: hot } }).toArray(),
  ]);
  const candidates = [...new Map([...inCats, ...popular].map((p) => [p._id.toHexString(), p])).values()].filter((p) => !skip.has(p._id.toHexString()));
  const score = (p: ProductDoc) => {
    const affinity = Math.max(0, ...p.categoryIds.map((cid) => (catWeight.get(cid.toHexString()) ?? 0) / maxCat));
    return 0.45 * affinity + 0.25 * (byId.get(p._id.toHexString())?.score ?? 0) + 0.15 * priceFit(p.minPriceMinor, meanLogPrice) + 0.1 * Math.min(discountPercentOf(p) / 50, 1) + 0.05 * freshness(p);
  };
  const items = await cardsInStock(pick(candidates, score, limit * 2), limit);
  const lead = ordered[0]!;
  return { because: { title: lead.title, slug: lead.slug }, items };
}

/** What other shoppers bought in the same orders as this product (needs real repeat purchases, else empty), and similar items. */
export async function relatedProducts(productId: ObjectId, limit: number) {
  const c = await getCollections();
  const self = await c.products.findOne({ _id: productId, ...sellable });
  if (!self) return { alsoBought: [], similar: [] };

  const parents = await c.vendorOrders.find({ "items.productId": productId, fulfillmentStatus: { $in: ["new", "accepted", "shipped", "delivered"] } }, { projection: { parentOrderId: 1 } }).limit(500).toArray();
  const siblings = parents.length ? await c.vendorOrders.find({ parentOrderId: { $in: parents.map((p) => p.parentOrderId) } }, { projection: { parentOrderId: 1, "items.productId": 1 } }).toArray() : [];
  const perOrder = new Map<string, Set<string>>();
  for (const vo of siblings) for (const it of vo.items) {
    const key = vo.parentOrderId.toHexString();
    (perOrder.get(key) ?? perOrder.set(key, new Set()).get(key)!).add(it.productId.toHexString());
  }
  const together = new Map<string, number>();
  for (const set of perOrder.values()) if (set.has(productId.toHexString())) for (const id of set) if (id !== productId.toHexString()) together.set(id, (together.get(id) ?? 0) + 1);
  const boughtIds = [...together.entries()].filter(([, n]) => n >= MIN_SUPPORT).sort((a, b) => b[1] - a[1]).slice(0, limit * 2).map(([id]) => new ObjectId(id));
  const boughtRows = boughtIds.length ? await c.products.find({ ...sellable, _id: { $in: boughtIds } }).toArray() : [];
  const boughtRank = new Map(boughtIds.map((id, i) => [id.toHexString(), i]));
  boughtRows.sort((a, b) => boughtRank.get(a._id.toHexString())! - boughtRank.get(b._id.toHexString())!);

  const { byId } = await popularity();
  const meanLog = Math.log(Math.max(self.minPriceMinor, 1));
  const peers = await c.products.find({ ...sellable, categoryIds: { $in: self.categoryIds }, _id: { $ne: productId } }).sort({ publishedAt: -1 }).limit(120).toArray();
  const taken = new Set(boughtRows.map((p) => p._id.toHexString()));
  const similarScore = (p: ProductDoc) => 0.5 * (byId.get(p._id.toHexString())?.score ?? 0) + 0.35 * priceFit(p.minPriceMinor, meanLog) + 0.1 * freshness(p) + 0.05 * Math.min(discountPercentOf(p) / 50, 1);
  const similar = pick(peers.filter((p) => !taken.has(p._id.toHexString())), similarScore, limit * 2);
  const [alsoBought, similarCards] = await Promise.all([cardsInStock(boughtRows, limit), cardsInStock(similar, limit)]);
  return { alsoBought, similar: similarCards };
}
