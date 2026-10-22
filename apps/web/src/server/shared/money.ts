import { AppError } from "./errors";

/** Currency precision metadata. Never assume two minor digits. */
export const CURRENCIES = { BDT: { minorDigits: 2 } } as const;
export type CurrencyCode = keyof typeof CURRENCIES;
export const DEFAULT_CURRENCY: CurrencyCode = "BDT";

export interface Money {
  amountMinor: number;
  currency: CurrencyCode;
}

export const isCurrency = (v: string): v is CurrencyCode => v in CURRENCIES;

export function money(amountMinor: number, currency: CurrencyCode = DEFAULT_CURRENCY): Money {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new AppError("BUSINESS_RULE_VIOLATION", { message: "Money must be an integer in minor units." });
  }
  return { amountMinor, currency };
}

function same(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new AppError("BUSINESS_RULE_VIOLATION", { message: "Currency mismatch." });
}

export const add = (a: Money, b: Money): Money => (same(a, b), money(a.amountMinor + b.amountMinor, a.currency));
export const subtract = (a: Money, b: Money): Money => (same(a, b), money(a.amountMinor - b.amountMinor, a.currency));
export const times = (a: Money, qty: number): Money => {
  if (!Number.isSafeInteger(qty)) throw new AppError("BUSINESS_RULE_VIOLATION", { message: "Quantity must be an integer." });
  return money(a.amountMinor * qty, a.currency);
};
export const sum = (items: Money[], currency: CurrencyCode = DEFAULT_CURRENCY): Money =>
  items.reduce((acc, m) => add(acc, m), money(0, currency));

/**
 * Apply a rate in basis points (1 bp = 0.01%), rounding half away from zero.
 * Integer-only arithmetic; amounts stay far below 2^53 / 10000 for realistic orders.
 */
export function percentBps(a: Money, bps: number): Money {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new AppError("BUSINESS_RULE_VIOLATION", { message: "Basis points must be an integer 0..10000." });
  }
  const scaled = Math.abs(a.amountMinor) * bps;
  const q = Math.floor(scaled / 10_000);
  const r = scaled % 10_000;
  const rounded = r * 2 >= 10_000 ? q + 1 : q;
  return money(a.amountMinor < 0 ? -rounded : rounded, a.currency);
}

/** Format for provider APIs that expect a decimal string, e.g. "125.00". */
export function toDecimalString(a: Money): string {
  const digits = CURRENCIES[a.currency].minorDigits;
  const sign = a.amountMinor < 0 ? "-" : "";
  const abs = Math.abs(a.amountMinor).toString().padStart(digits + 1, "0");
  return `${sign}${abs.slice(0, -digits)}.${abs.slice(-digits)}`;
}

export function fromDecimalString(s: string, currency: CurrencyCode = DEFAULT_CURRENCY): Money {
  const digits = CURRENCIES[currency].minorDigits;
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s.trim());
  if (!m) throw new AppError("VALIDATION_FAILED", { message: "Invalid decimal amount." });
  const frac = (m[3] ?? "").padEnd(digits, "0");
  if (frac.length > digits && /[1-9]/.test(frac.slice(digits))) {
    throw new AppError("VALIDATION_FAILED", { message: "Too many decimal places." });
  }
  const minor = Number(`${m[2]}${frac.slice(0, digits)}`);
  return money(m[1] === "-" ? -minor : minor, currency);
}
