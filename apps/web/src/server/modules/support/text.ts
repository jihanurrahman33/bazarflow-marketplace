const STOP = new Set(
  ("a an the and or but if then else of to in on at by for with from as is are was were be been being do does did can could should would will may might " +
    "i me my we our you your it its this that these those there here what when where which who whom how why not no yes so than too very just about into over under " +
    "again also after before something anything any some get make take need want know tell please much many long soon like use am already back work placed own " +
    "via per").split(" "),
);

/**
 * Light, deterministic stemmer tuned for a small help corpus: strip common endings, drop a trailing "e", collapse a
 * doubled final consonant ("shipping" -> "ship"), then cap at 7 characters so "deliver/delivery/delivered" meet.
 */
export function stem(w: string): string {
  let s = w;
  if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith("ied")) s = `${s.slice(0, -3)}y`;
  else if (s.length > 4 && s.endsWith("ed")) s = s.slice(0, -2);
  else if (s.length > 4 && s.endsWith("ies")) s = `${s.slice(0, -3)}y`;
  else if (s.length > 4 && s.endsWith("es")) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  if (s.length > 4 && s.endsWith("e")) s = s.slice(0, -1);
  if (s.length > 3 && /([^aeiou\d])\1$/.test(s) && !/(ss|ll)$/.test(s)) s = s.slice(0, -1);
  return s.length > 7 ? s.slice(0, 7) : s;
}

/**
 * Lowercased, stop-word-free, stemmed terms. Unicode-aware: \p{M} keeps Bangla vowel signs and conjuncts attached to
 * their letters (without it, "ফেরত" is cut into fragments and Bangla questions barely match anything).
 */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
}

export function uniqueTokens(text: string): string[] {
  return [...new Set(tokenize(text))];
}

/**
 * Domain vocabulary bridge: how shoppers phrase things -> how our content phrases them. A query word is satisfied by
 * itself OR any listed alternative. Keep it short and curated; extend it when the benchmark shows a miss.
 */
const SYNONYM_SOURCE: Record<string, string[]> = {
  money: ["refund"], parcel: ["order", "shipping"], package: ["order", "shipping"], courier: ["shipping", "delivery"],
  buy: ["order", "pay"], purchase: ["order"], store: ["seller"], shop: ["seller"], vendor: ["seller"], merchant: ["seller"],
  sell: ["seller"], selling: ["seller"], paid: ["payout"], withdraw: ["payout"], cancellation: ["cancel"], exchange: ["return"],
  cod: ["cash", "delivery"], charged: ["pay"], charge: ["pay"], twice: ["again"],
};
const SYNONYMS: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const [k, v] of Object.entries(SYNONYM_SOURCE)) m.set(stem(k), v.map(stem));
  return m;
})();

/** One entry per distinct query term: [term, ...alternatives]. */
export function queryGroups(text: string): string[][] {
  return uniqueTokens(text).map((t) => [t, ...(SYNONYMS.get(t) ?? []).filter((s) => s !== t)]);
}

export function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z0-9“"'(])/).map((s) => s.trim()).filter(Boolean);
}

/** Strip control characters, collapse whitespace and cap length. User text is data, never instructions. */
export function cleanQuestion(raw: string, max = 500): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
