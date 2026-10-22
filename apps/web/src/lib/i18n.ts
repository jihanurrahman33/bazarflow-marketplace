import { BN } from "./i18n-bn";

/**
 * Interface language. English text is the key: `t("Add to cart")` returns the Bangla entry when the language is Bangla and one
 * exists, and the English text otherwise, so anything not yet translated is still readable. Placeholders look like {name}.
 * Product titles, descriptions and reviews are written by sellers and customers and are not translated.
 */
export type Locale = "en" | "bn";
export const LANG_COOKIE = "bf.lang";
export const isLocale = (v: unknown): v is Locale => v === "en" || v === "bn";
export type T = (text: string, vars?: Record<string, string | number>) => string;

export function translate(locale: Locale, text: string, vars?: Record<string, string | number>): string {
  let out = locale === "bn" ? (BN[text] ?? text) : text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

export const makeT = (locale: Locale): T => (text, vars) => translate(locale, text, vars);
