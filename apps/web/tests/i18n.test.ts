import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { BN } from "@/lib/i18n-bn";
import { makeT, translate } from "@/lib/i18n";

const src = path.resolve(import.meta.dirname, "../src");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = path.join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) && !/i18n-bn\.ts$/.test(f) ? [p] : [];
});
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

/** Every literal passed to t("…") in the app. */
const used = new Map<string, string>();
for (const file of walk(src)) {
  for (const m of readFileSync(file, "utf8").matchAll(/(?<![\w.])t\(\s*"((?:[^"\\\n]|\\.)*)"/g)) used.set(m[1]!.replace(/\\(.)/g, "$1"), path.relative(src, file));
}
/** Strings passed to t() through a variable (labels in tables), listed here so they are checked too. */
const dynamic = ["Newest", "Highest rated", "Lowest rated", "Price: low to high", "Price: high to low", "No longer available", "This option is no longer available", "This seller is not active", "Not enough stock", "Check this item", "{n} product", "{n} products", "{n} left"];

describe("Bangla interface text", () => {
  it("finds the translated strings in the code (guard against the scan silently matching nothing)", () => {
    expect(used.size).toBeGreaterThan(120);
  });

  it("has a Bangla entry for every string the app translates", () => {
    const missing = [...used.entries(), ...dynamic.map((d) => [d, "dynamic"] as const)].filter(([k]) => !BN[k]).map(([k, f]) => `${k}  (${f})`);
    expect(missing).toEqual([]);
  });

  it("keeps placeholders identical between English and Bangla, and never leaves an entry empty", () => {
    for (const [en, bn] of Object.entries(BN)) {
      expect(bn.trim(), en).not.toBe("");
      expect(placeholders(bn), en).toEqual(placeholders(en));
    }
  });

  it("falls back to English, fills placeholders, and leaves English alone", () => {
    expect(translate("bn", "Add to cart")).toBe(BN["Add to cart"]);
    expect(translate("bn", "A string nobody translated")).toBe("A string nobody translated");
    expect(translate("en", "Add to cart")).toBe("Add to cart");
    expect(makeT("bn")("Only {n} left", { n: 3 })).toBe("মাত্র 3টি বাকি");
    expect(makeT("en")("Only {n} left", { n: 3 })).toBe("Only 3 left");
  });
});
