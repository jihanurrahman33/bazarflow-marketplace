"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getInflight, subscribeActivity } from "@/lib/activity";

export const NAV_START_EVENT = "bf:navigation-start";
/** Call before a programmatic router.push so the progress bar starts immediately. */
export const announceNavigation = (): void => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NAV_START_EVENT));
};

/**
 * One thin bar at the top of the page for every kind of waiting: route changes (link clicks, GET forms, router.push)
 * and any API request that takes longer than a moment. If things take unusually long it says so.
 */
export function TopProgress() {
  const path = usePathname();
  const search = useSearchParams().toString();
  const [navigating, setNavigating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const inflight = useSyncExternalStore(subscribeActivity, getInflight, () => 0);
  const startedFor = useRef("");

  // Route finished: the URL changed.
  useEffect(() => { setNavigating(false); }, [path, search]);

  // Start on link clicks / GET form submits / explicit announcements.
  useEffect(() => {
    const start = () => setNavigating(true);
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return; // hash-only or same page
      startedFor.current = url.pathname + url.search;
      start();
    };
    const onSubmit = (e: SubmitEvent) => {
      const f = e.target as HTMLFormElement | null;
      if (f && (f.method || "get").toLowerCase() === "get" && !e.defaultPrevented) start();
    };
    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    window.addEventListener(NAV_START_EVENT, start);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("submit", onSubmit);
      window.removeEventListener(NAV_START_EVENT, start);
    };
  }, []);

  // Never leave the bar stuck if a navigation is cancelled or fails.
  useEffect(() => {
    if (!navigating) return;
    const t = setTimeout(() => setNavigating(false), 20_000);
    return () => clearTimeout(t);
  }, [navigating]);

  // Requests: only show for ones that outlive 300 ms, so quick calls don't flicker.
  useEffect(() => {
    if (inflight === 0) { setBusy(false); return; }
    const t = setTimeout(() => setBusy(true), 300);
    return () => clearTimeout(t);
  }, [inflight]);

  const active = navigating || busy;
  useEffect(() => {
    if (!active) { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(t);
  }, [active]);

  return (
    <>
      <div className={`top-progress ${active ? "is-active" : ""}`} role="progressbar" aria-hidden={!active} aria-label="Loading" />
      {slow && <div className="slow-pill" role="status">Still loading… your connection looks slow.</div>}
    </>
  );
}
