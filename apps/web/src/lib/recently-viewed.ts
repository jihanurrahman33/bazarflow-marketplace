/**
 * Products this shopper looked at, newest first. Kept only in their own browser (localStorage): nothing about browsing
 * history is stored on the server or tied to an account. The server receives these ids only to rank the "Picked for you" row.
 */
const KEY = "bf.viewed";
const MAX = 20;

export function readViewed(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string" && /^[0-9a-f]{24}$/i.test(x)).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function recordView(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([id, ...readViewed().filter((x) => x !== id)].slice(0, MAX)));
  } catch { /* storage unavailable (private mode): personalisation just stays off */ }
}
