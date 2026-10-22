"use client";
import { assignVariant, EXPERIMENTS } from "./experiments";

/**
 * First-party, anonymous behaviour tracking: a random browser id (no name, email or account), a short list of event types,
 * batched to /api/v1/events. Honours the browser's Do Not Track and Global Privacy Control settings by doing nothing.
 * Events expire server-side after 90 days.
 */
const KEY = "bf.aid";
export type TrackEvent = {
  type: "view_product" | "view_category" | "search" | "add_to_cart" | "begin_checkout" | "purchase" | "exposure";
  productId?: string; orderId?: string; query?: string; results?: number; source?: string; experiment?: { key: string; variant: string };
};

function optedOut(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === "1" || nav.globalPrivacyControl === true;
}

/** The random id for this browser, or null when tracking is off or storage is unavailable. */
export function anonId(): string | null {
  if (typeof window === "undefined" || optedOut()) return null;
  try {
    let id = localStorage.getItem(KEY);
    if (!id || !/^[a-z0-9-]{16,40}$/.test(id)) { id = crypto.randomUUID(); localStorage.setItem(KEY, id); }
    return id;
  } catch { return null; }
}

let queue: TrackEvent[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

function flush() {
  timer = undefined;
  const id = anonId();
  if (!id || queue.length === 0) { queue = []; return; }
  const events = queue.splice(0, 20);
  void fetch("/api/v1/events", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ anonId: id, events }) }).catch(() => undefined);
  if (queue.length) timer = setTimeout(flush, 500);
}

export function track(event: TrackEvent): void {
  if (typeof window === "undefined" || !anonId()) return;
  queue.push(event);
  if (!timer) timer = setTimeout(flush, 1500);
}
if (typeof window !== "undefined") window.addEventListener("pagehide", () => { if (timer) { clearTimeout(timer); flush(); } });

/** This shopper's variant of an experiment (control when tracking is off). Logs one exposure per browser session. */
export function variantOf(key: string): string {
  const id = anonId();
  if (!id) return "control";
  const variant = assignVariant(key, id);
  try {
    const seen = `bf.exp.${key}`;
    if (!sessionStorage.getItem(seen)) { sessionStorage.setItem(seen, "1"); track({ type: "exposure", experiment: { key, variant } }); }
  } catch { /* exposure logging is best effort */ }
  return variant;
}
export const knownExperiment = (key: string) => EXPERIMENTS.some((e) => e.key === key);
