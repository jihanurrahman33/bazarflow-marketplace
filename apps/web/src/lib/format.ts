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

/** Compact price for cards: no ".00" on whole amounts (৳599 rather than ৳599.00). */
export function formatMoneyShort(amountMinor: number, currency = "BDT", locale = "en-BD"): string {
  const major = amountMinor / 100;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "narrowSymbol", minimumFractionDigits: Number.isInteger(major) ? 0 : 2, maximumFractionDigits: 2 }).format(major);
  } catch {
    return `${currency} ${major}`;
  }
}

/** "5 min ago", "3 h ago", "2 d ago"; falls back to a date after a week. Display only. */
export function timeAgo(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  if (s < 7 * 86_400) return `${Math.round(s / 86_400)} d ago`;
  return formatDate(iso, { dateStyle: "medium" });
}
