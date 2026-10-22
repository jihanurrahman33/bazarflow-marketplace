import { ObjectId } from "mongodb";
import { getCollections } from "@/server/db/collections";

/**
 * Patterns that often mean reviews were arranged rather than earned. These are leads for a person to look at, never automatic
 * actions: nothing is hidden or penalised by the system. Every review on this shop already needs a delivered order, which
 * makes fake reviews costly; this catches the cases that still slip through (for example a seller buying through many new accounts).
 */
const DAY = 86_400_000;
const NEW_ACCOUNT_DAYS = 14;

export type FlagKind = "burst_from_new_accounts" | "new_account_praise" | "one_account_many_reviews";
export interface ReviewFlag {
  kind: FlagKind;
  summary: string;
  product?: { id: string; title: string; slug: string };
  vendorName?: string;
  reviews: { id: string; rating: number; body: string; author: string; accountAgeDays: number; createdAt: string }[];
}

export async function reviewFlags(now = new Date()): Promise<ReviewFlag[]> {
  const c = await getCollections();
  const recent = await c.reviews.find({ status: "published", createdAt: { $gte: new Date(now.getTime() - 30 * DAY) } }).sort({ _id: -1 }).limit(3000).toArray();
  if (recent.length === 0) return [];
  const users = await c.users.find({ _id: { $in: [...new Set(recent.map((r) => r.userId.toHexString()))].map((x) => new ObjectId(x)) } }, { projection: { name: 1, createdAt: 1 } }).toArray();
  const userOf = new Map(users.map((u) => [u._id.toHexString(), u]));
  const ageDays = (r: (typeof recent)[number]) => Math.max(0, Math.floor((r.createdAt.getTime() - (userOf.get(r.userId.toHexString())?.createdAt.getTime() ?? r.createdAt.getTime())) / DAY));
  const row = (r: (typeof recent)[number]) => ({ id: r._id.toHexString(), rating: r.rating, body: r.body.slice(0, 160), author: (userOf.get(r.userId.toHexString())?.name ?? "Customer").split(" ").map((p, i) => (i === 0 ? p : `${p[0]}.`)).join(" "), accountAgeDays: ageDays(r), createdAt: r.createdAt.toISOString() });

  const byProduct = new Map<string, typeof recent>();
  const byUser = new Map<string, typeof recent>();
  for (const r of recent) {
    (byProduct.get(r.productId.toHexString()) ?? byProduct.set(r.productId.toHexString(), []).get(r.productId.toHexString())!).push(r);
    (byUser.get(r.userId.toHexString()) ?? byUser.set(r.userId.toHexString(), []).get(r.userId.toHexString())!).push(r);
  }
  const flags: Array<{ kind: FlagKind; summary: string; productId?: ObjectId; list: typeof recent }> = [];
  for (const [pid, list] of byProduct) {
    const day = list.filter((r) => now.getTime() - r.createdAt.getTime() <= DAY);
    const freshDay = day.filter((r) => ageDays(r) <= NEW_ACCOUNT_DAYS);
    if (freshDay.length >= 5) flags.push({ kind: "burst_from_new_accounts", summary: `${freshDay.length} reviews in 24 hours from accounts under ${NEW_ACCOUNT_DAYS} days old`, productId: new ObjectId(pid), list: freshDay });
    const fresh = list.filter((r) => ageDays(r) <= NEW_ACCOUNT_DAYS);
    const fiveStar = list.filter((r) => r.rating === 5);
    if (list.length >= 8 && fiveStar.length / list.length >= 0.9 && fresh.length / list.length >= 0.6) flags.push({ kind: "new_account_praise", summary: `${fiveStar.length} of ${list.length} recent reviews are 5-star, and ${fresh.length} come from accounts under ${NEW_ACCOUNT_DAYS} days old`, productId: new ObjectId(pid), list: fresh });
  }
  for (const list of byUser.values()) {
    const day = list.filter((r) => now.getTime() - r.createdAt.getTime() <= DAY);
    if (day.length >= 8) flags.push({ kind: "one_account_many_reviews", summary: `One account posted ${day.length} reviews in 24 hours`, list: day });
  }

  const products = await c.products.find({ _id: { $in: flags.flatMap((f) => (f.productId ? [f.productId] : [])) } }, { projection: { title: 1, slug: 1, vendorId: 1 } }).toArray();
  const vendors = await c.vendors.find({ _id: { $in: products.map((p) => p.vendorId) } }, { projection: { name: 1 } }).toArray();
  const pOf = new Map(products.map((p) => [p._id.toHexString(), p]));
  const vOf = new Map(vendors.map((v) => [v._id.toHexString(), v.name]));
  return flags.slice(0, 50).map((f) => {
    const p = f.productId ? pOf.get(f.productId.toHexString()) : undefined;
    return { kind: f.kind, summary: f.summary, ...(p ? { product: { id: p._id.toHexString(), title: p.title, slug: p.slug }, vendorName: vOf.get(p.vendorId.toHexString()) } : {}), reviews: f.list.slice(0, 12).map(row) };
  });
}
