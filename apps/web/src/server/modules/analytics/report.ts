import { getCollections } from "@/server/db/collections";
import { EXPERIMENTS } from "@/lib/experiments";

const STEPS = ["view_product", "add_to_cart", "begin_checkout", "purchase"] as const;
const MIN_PER_VARIANT = 100; // below this a difference between variants is noise, and the report says so

/** Visitors reaching each step of the buying funnel, plus purchases, revenue and what shoppers searched for. */
export async function funnelReport(days: number) {
  const c = await getCollections();
  const since = new Date(Date.now() - days * 86_400_000);
  const perStep = await c.analyticsEvents.aggregate<{ _id: string; visitors: number; events: number }>([
    { $match: { at: { $gte: since }, type: { $in: [...STEPS] } } },
    { $group: { _id: { type: "$type", anon: "$anonId" }, n: { $sum: 1 } } },
    { $group: { _id: "$_id.type", visitors: { $sum: 1 }, events: { $sum: "$n" } } },
  ]).toArray();
  const by = new Map(perStep.map((r) => [r._id, r]));
  const top = by.get("view_product")?.visitors ?? 0;
  const steps = STEPS.map((type) => {
    const visitors = by.get(type)?.visitors ?? 0;
    return { type, visitors, events: by.get(type)?.events ?? 0, ofViewers: top ? Math.round((visitors / top) * 1000) / 10 : null };
  });
  const [revenue, sources, searches, noResults] = await Promise.all([
    c.analyticsEvents.aggregate<{ _id: null; total: number; n: number }>([{ $match: { at: { $gte: since }, type: "purchase" } }, { $group: { _id: null, total: { $sum: "$valueMinor" }, n: { $sum: 1 } } }]).toArray(),
    c.analyticsEvents.aggregate<{ _id: string; views: number }>([{ $match: { at: { $gte: since }, type: "view_product", source: { $exists: true } } }, { $group: { _id: "$source", views: { $sum: 1 } } }, { $sort: { views: -1 } }, { $limit: 12 }]).toArray(),
    c.analyticsEvents.countDocuments({ at: { $gte: since }, type: "search" }),
    c.analyticsEvents.aggregate<{ _id: string; n: number }>([{ $match: { at: { $gte: since }, type: "search", results: 0 } }, { $group: { _id: "$query", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 15 }]).toArray(),
  ]);
  return {
    days, steps,
    purchases: revenue[0]?.n ?? 0, revenueMinor: revenue[0]?.total ?? 0,
    viewsBySource: sources.map((s) => ({ source: s._id, views: s.views })),
    searches, searchesWithNoResults: noResults.map((r) => ({ query: r._id, count: r.n })),
  };
}

const z95 = 1.96;
/** Two-proportion z test; true when the gap between two purchase rates is unlikely to be chance. */
export function differs(n1: number, x1: number, n2: number, x2: number): boolean {
  if (n1 === 0 || n2 === 0) return false;
  const p1 = x1 / n1, p2 = x2 / n2, p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  return se > 0 && Math.abs(p1 - p2) / se > z95;
}

/** Purchase rate per variant among shoppers who were shown the experiment. */
export async function experimentsReport(days: number) {
  const c = await getCollections();
  const since = new Date(Date.now() - days * 86_400_000);
  const out = [];
  for (const exp of EXPERIMENTS) {
    const exposed = await c.analyticsEvents.aggregate<{ _id: { v: string; a: string }; first: Date }>([
      { $match: { type: "exposure", at: { $gte: since }, "experiment.key": exp.key } },
      { $group: { _id: { v: "$experiment.variant", a: "$anonId" }, first: { $min: "$at" } } },
    ]).toArray();
    const buyers = new Set((await c.analyticsEvents.distinct("anonId", { type: "purchase", at: { $gte: since } })) as string[]);
    const rows = exp.variants.map((variant) => {
      const anons = exposed.filter((e) => e._id.v === variant);
      const purchased = anons.filter((e) => buyers.has(e._id.a)).length;
      return { variant, visitors: anons.length, purchasers: purchased, rate: anons.length ? Math.round((purchased / anons.length) * 1000) / 10 : null };
    });
    const [control, ...rest] = rows;
    out.push({
      key: exp.key, description: exp.description, variants: rows,
      verdict: rows.some((r) => r.visitors < MIN_PER_VARIANT) ? "not_enough_data" : rest.some((r) => differs(control!.visitors, control!.purchasers, r.visitors, r.purchasers)) ? "difference_likely" : "no_clear_difference",
      minPerVariant: MIN_PER_VARIANT,
    });
  }
  return out;
}
