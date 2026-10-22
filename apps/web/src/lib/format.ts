/** Money is integer minor units + ISO currency. Locale formatting happens only here, at the edge. */
export function formatMoney(amountMinor: number, currency = "BDT", locale = "en-BD"): string {
  const major = amountMinor / 100;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "narrowSymbol", minimumFractionDigits: 2 }).format(major);
  } catch {
    return `${currency} ${major.toFixed(2)}`;
  }
}

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }, locale = "en-BD"): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat(locale, opts).format(d);
}

/** "pending_payment" -> "Pending payment". Display only: never branch on the result. */
export function humanize(code: string): string {
  const s = code.replace(/[_.]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Convert a decimal string typed by a user (e.g. "125.50") to minor units without floating point. */
export function parseMoneyInput(input: string): number | null {
  const m = /^\s*(\d{1,9})(?:\.(\d{1,2}))?\s*$/.exec(input);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}
