import { getCollections } from "@/server/db/collections";
import type { KnowledgeDocumentDoc } from "@/server/db/schema";
import type { Actor } from "@/server/modules/authorization/actor";
import { queryGroups, splitSentences, tokenize } from "./text";

export type Visibility = KnowledgeDocumentDoc["visibility"];

/**
 * Who may see what. Decided from the AUTHENTICATED actor and applied inside the database query, before any ranking
 * and long before anything reaches a model. Never "retrieve then ask the model not to leak".
 */
export function visibleTo(actor: Actor | undefined): Visibility[] {
  if (!actor) return ["public"];
  if (actor.role === "admin") return actor.permissions.includes("knowledge.manage") ? ["public", "vendor", "admin"] : ["public"];
  if (actor.role === "vendor") return ["public", "vendor"];
  return ["public"];
}

export interface Hit {
  doc: KnowledgeDocumentDoc;
  score: number;
  /** How many of the question's distinct terms this document satisfies. */
  matched: number;
  /** Share of the question's information (idf-weighted) that this document covers, 0..1. */
  coverage: number;
  sentences: string[];
}

const K1 = 1.2;
const B = 0.75;
export const MIN_COVERAGE = 0.4;

/** BM25 over the approved, visible candidates that share at least one query term (or a listed synonym). */
export async function retrieve(question: string, actor: Actor | undefined, k = 3): Promise<{ hits: Hit[]; groups: string[][] }> {
  const groups = queryGroups(question);
  if (groups.length === 0) return { hits: [], groups };
  const all = [...new Set(groups.flat())];
  const c = await getCollections();
  const base = { status: "approved" as const, visibility: { $in: visibleTo(actor) } };
  const candidates = await c.knowledgeDocuments.find({ ...base, tokens: { $in: all } }).limit(100).toArray();
  if (candidates.length === 0) return { hits: [], groups };

  const n = await c.knowledgeDocuments.countDocuments(base);
  const df = new Map<string, number>();
  await Promise.all(all.map(async (t) => df.set(t, await c.knowledgeDocuments.countDocuments({ ...base, tokens: t }))));
  const idfOf = (t: string) => Math.log(1 + (n - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
  // A group is as informative as its rarest member's own term; unseen rare words ("fraud") weigh the most.
  const groupInfo = groups.map((g) => idfOf(g[0]!));
  const totalInfo = groupInfo.reduce((a, b) => a + b, 0) || 1;

  const docs = candidates.map((d) => ({ d, terms: tokenize(`${d.title} ${d.title} ${d.body}`) }));
  const avgLen = docs.reduce((a, x) => a + x.terms.length, 0) / docs.length || 1;

  const hits: Hit[] = docs.map(({ d, terms }) => {
    const tf = new Map<string, number>();
    for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    let matched = 0;
    let info = 0;
    const matchedTerms = new Set<string>();
    groups.forEach((g, i) => {
      // Best-matching member of the group stands in for the term.
      let best = 0;
      let bestTerm: string | undefined;
      for (const t of g) {
        const f = tf.get(t) ?? 0;
        if (!f) continue;
        const contribution = idfOf(t) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * terms.length) / avgLen)));
        if (contribution > best) {
          best = contribution;
          bestTerm = t;
        }
      }
      if (bestTerm) {
        matched++;
        info += groupInfo[i]!;
        score += best;
        matchedTerms.add(bestTerm);
      }
    });
    const coverage = info / totalInfo;
    // A help article's title is the best hint of what it answers: nudge ties toward the closest title.
    const titleTerms = new Set(tokenize(d.title));
    const primary = new Set(groups.map((g) => g[0]!));
    const shared = [...primary].filter((t) => titleTerms.has(t)).length;
    const titleSim = shared / (primary.size + titleTerms.size - shared || 1);
    score *= (0.5 + coverage) * (1 + titleSim);
    const sentences = splitSentences(d.body)
      .map((s) => ({ s, overlap: new Set(tokenize(s).filter((t) => matchedTerms.has(t) || all.includes(t))).size }))
      .sort((a, b) => b.overlap - a.overlap)
      .filter((x) => x.overlap > 0)
      .slice(0, 2)
      .map((x) => x.s);
    return { doc: d, score, matched, coverage, sentences };
  });
  hits.sort((a, b) => b.score - a.score);
  return { hits: hits.slice(0, k), groups };
}

/**
 * Evidence is "enough" only if the best document explains a meaningful share of the question.
 * Below this we say we cannot verify the answer instead of guessing.
 */
export function hasEvidence(hits: Hit[], groups: string[][]): boolean {
  const top = hits[0];
  if (!top) return false;
  const needed = Math.min(2, groups.length);
  return top.matched >= needed && top.coverage >= MIN_COVERAGE && top.sentences.length > 0;
}
