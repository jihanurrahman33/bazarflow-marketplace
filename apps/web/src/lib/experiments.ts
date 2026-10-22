/**
 * A/B experiments. A shopper's variant is a pure function of (experiment key, anonymous id), so it is stable across visits
 * and needs no server state. The first variant is always the control. Exposures are logged as analytics events, and the admin
 * report compares purchase rates per variant.
 */
export interface Experiment { key: string; description: string; variants: [control: string, ...others: string[]] }

export const EXPERIMENTS: Experiment[] = [
  { key: "home_order", description: "Homepage: show Trending before Deals", variants: ["control", "trending_first"] },
];

const hash = (s: string) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

export function assignVariant(key: string, anonId: string): string {
  const exp = EXPERIMENTS.find((e) => e.key === key);
  if (!exp) return "control";
  return exp.variants[hash(`${key}:${anonId}`) % exp.variants.length]!;
}
