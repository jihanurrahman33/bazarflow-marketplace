import type { Filter } from "mongodb";
import { getCollections } from "@/server/db/collections";
import type { ProductDoc } from "@/server/db/schema";

/**
 * Query understanding on top of MongoDB text search: shoppers misspell, type half a word, or search in Bangla.
 * Order of attempts (each is a cheap probe), most precise first: the shopper's exact words -> synonyms -> word prefixes -> spelling correction.
 */

/** Common shopping words in Bangla and English alternates, mapped to the English terms products are listed with. */
const SYNONYMS: Record<string, string[]> = {
  জুতা: ["shoes", "sneakers", "footwear"], জুতো: ["shoes", "sneakers", "footwear"], স্যান্ডেল: ["sandals"], স্নিকার: ["sneakers"],
  শার্ট: ["shirt"], "টি-শার্ট": ["t-shirt", "tee"], টিশার্ট: ["t-shirt", "tee"], প্যান্ট: ["pants", "trousers", "chinos"], জিন্স: ["jeans", "denim"],
  শাড়ি: ["saree"], কুর্তি: ["kurti"], পাঞ্জাবি: ["panjabi"], জামা: ["shirt", "dress"], জ্যাকেট: ["jacket"], হুডি: ["hoodie"],
  ফোন: ["phone", "smartphone", "mobile"], মোবাইল: ["mobile", "smartphone", "phone"], ল্যাপটপ: ["laptop"], কম্পিউটার: ["computer", "laptop"],
  হেডফোন: ["headphones", "earbuds"], ইয়ারফোন: ["earphones", "earbuds"], চার্জার: ["charger"], পাওয়ারব্যাংক: ["power bank"], ক্যামেরা: ["camera"],
  ঘড়ি: ["watch"], ব্যাগ: ["bag", "backpack"], ব্যাকপ্যাক: ["backpack"], মানিব্যাগ: ["wallet"], চশমা: ["sunglasses", "glasses"],
  চাল: ["rice"], তেল: ["oil"], সবজি: ["vegetable"], বিছানা: ["bedding", "bed"], চাদর: ["sheet", "bedding"], বালিশ: ["pillow"], তোয়ালে: ["towel"],
  ফ্যান: ["fan"], পাখা: ["fan"], বাতি: ["light", "lamp"], লাইট: ["light", "lamp"], টেবিল: ["table", "desk"], চেয়ার: ["chair"], সোফা: ["sofa"],
  খেলনা: ["toy", "toys"], বই: ["book", "notebook"], খাতা: ["notebook"], কলম: ["pen"], সাইকেল: ["bike", "bicycle", "cycle"], হেলমেট: ["helmet"],
  // English alternates
  tee: ["t-shirt", "tshirt"], tshirt: ["t-shirt", "tee"], mobile: ["phone", "smartphone"], phone: ["smartphone", "mobile"], cellphone: ["phone", "smartphone"],
  sneaker: ["sneakers", "shoes"], sneakers: ["shoes", "trainers"], trainers: ["sneakers", "shoes"], shoe: ["shoes", "footwear"], pant: ["pants", "trousers"],
  trousers: ["pants"], earphone: ["earphones", "earbuds"], earbud: ["earbuds"], cycle: ["bicycle", "bike"], tv: ["television"], sofaset: ["sofa"],
};

const tokenize = (q: string): string[] => q.toLowerCase().normalize("NFC").split(/[^\p{L}\p{M}\p{N}-]+/u).filter(Boolean);

/** The shopper's words only, normalised for MongoDB text search. */
export const plainTerms = (q: string): string => tokenize(q).join(" ");

/** The shopper's words plus synonyms. Only used when the exact words found nothing, so "sneakers" never drags in every kind of shoe. */
export function expandTerms(q: string): string {
  const words = tokenize(q);
  const extra = words.flatMap((w) => SYNONYMS[w] ?? []);
  return [...new Set([...words, ...extra])].join(" ");
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every typed word must start a word in the title ("sneak run" finds "Running Sneakers"). Words under 2 letters are ignored. */
export function prefixFilter(q: string): Filter<ProductDoc> | null {
  const words = tokenize(q).filter((w) => w.length >= 2).slice(0, 6);
  if (words.length === 0) return null;
  return { $and: words.map((w) => ({ title: { $regex: `(^|[^\\p{L}\\p{M}\\p{N}])${escapeRe(w)}`, $options: "i" } })) } as Filter<ProductDoc>;
}

/** Optimal string alignment distance: insertions, deletions, substitutions and adjacent swaps each cost 1. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
  }
  return d[a.length]![b.length]!;
}

let vocab: { at: number; words: Map<string, number> } | null = null;
const VOCAB_TTL_MS = 5 * 60_000;
export function clearSearchCache() { vocab = null; }

/** Words that appear in product titles and category names, with how often they appear (more common wins a tie). */
async function vocabulary(): Promise<Map<string, number>> {
  if (vocab && Date.now() - vocab.at < VOCAB_TTL_MS) return vocab.words;
  const c = await getCollections();
  const [titles, cats] = await Promise.all([
    c.products.find({ status: "published", vendorActive: true }, { projection: { title: 1 } }).limit(5000).toArray(),
    c.categories.find({ visible: true }, { projection: { name: 1 } }).toArray(),
  ]);
  const words = new Map<string, number>();
  for (const text of [...titles.map((t) => t.title), ...cats.map((x) => x.name)]) for (const w of tokenize(text)) if (w.length >= 3) words.set(w, (words.get(w) ?? 0) + 1);
  vocab = { at: Date.now(), words };
  return words;
}

/** "sneekers" -> "sneakers". Null when nothing needed fixing or nothing is close enough. */
export async function correctQuery(q: string): Promise<string | null> {
  const known = await vocabulary();
  let changed = false;
  const fixed = tokenize(q).map((w) => {
    if (w.length < 3 || known.has(w) || SYNONYMS[w]) return w;
    const limit = w.length <= 5 ? 1 : 2;
    let best: { word: string; dist: number; freq: number } | undefined;
    for (const [word, freq] of known) {
      if (Math.abs(word.length - w.length) > limit) continue;
      const dist = editDistance(w, word);
      if (dist > limit) continue;
      if (!best || dist < best.dist || (dist === best.dist && freq > best.freq)) best = { word, dist, freq };
    }
    if (best) { changed = true; return best.word; }
    return w;
  });
  return changed ? fixed.join(" ") : null;
}

export interface Match { filter: Filter<ProductDoc>; text?: string; corrected?: { from: string; to: string } }

/** Decide how a query will be matched: exact words (+synonyms), then word prefixes, then a spelling-corrected retry. Null when nothing matches. */
export async function resolveMatch(base: Filter<ProductDoc>, raw: string): Promise<Match | null> {
  const c = await getCollections();
  const has = async (f: Filter<ProductDoc>) => (await c.products.countDocuments(f, { limit: 1 })) > 0;
  const exact = plainTerms(raw);
  if (exact && (await has({ ...base, $text: { $search: exact } }))) return { filter: { ...base, $text: { $search: exact } }, text: exact };
  const text = expandTerms(raw);
  if (text !== exact && (await has({ ...base, $text: { $search: text } }))) return { filter: { ...base, $text: { $search: text } }, text };
  const prefix = prefixFilter(raw);
  if (prefix && (await has({ ...base, ...prefix }))) return { filter: { ...base, ...prefix } };
  const fixed = await correctQuery(raw);
  if (fixed) {
    for (const t of [plainTerms(fixed), expandTerms(fixed)]) {
      if (t && (await has({ ...base, $text: { $search: t } }))) return { filter: { ...base, $text: { $search: t } }, text: t, corrected: { from: raw.trim(), to: fixed } };
    }
    const p2 = prefixFilter(fixed);
    if (p2 && (await has({ ...base, ...p2 }))) return { filter: { ...base, ...p2 }, corrected: { from: raw.trim(), to: fixed } };
  }
  return null;
}

/** How many matching products are in each category, for the filter sidebar of a search. */
export async function searchCategoryFacets(base: Filter<ProductDoc>, raw: string) {
  const match = await resolveMatch(base, raw);
  if (!match) return [];
  const c = await getCollections();
  const counts = await c.products.aggregate<{ _id: import("mongodb").ObjectId; n: number }>([{ $match: match.filter }, { $unwind: "$categoryIds" }, { $group: { _id: "$categoryIds", n: { $sum: 1 } } }]).toArray();
  const cats = await c.categories.find({ _id: { $in: counts.map((x) => x._id) }, visible: true }, { projection: { name: 1, slug: 1 } }).toArray();
  const n = new Map(counts.map((x) => [x._id.toHexString(), x.n]));
  return cats.map((x) => ({ slug: x.slug, name: x.name, count: n.get(x._id.toHexString()) ?? 0 })).sort((a, b) => b.count - a.count);
}
