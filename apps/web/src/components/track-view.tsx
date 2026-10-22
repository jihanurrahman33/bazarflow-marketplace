"use client";
import { useEffect } from "react";
import { recordView } from "@/lib/recently-viewed";
import { track } from "@/lib/track";

/** Remembers, in this browser only, that the shopper looked at this product, and logs an anonymous view (with the row they came from). */
export function TrackView({ productId }: { productId: string }) {
  useEffect(() => {
    recordView(productId);
    const ref = new URLSearchParams(window.location.search).get("ref") ?? undefined;
    track({ type: "view_product", productId, source: ref && /^[a-z0-9_-]{1,30}$/.test(ref) ? ref : undefined });
  }, [productId]);
  return null;
}

/** Logs a search and how many results it found, so searches that find nothing can be fixed. */
export function TrackSearch({ query, results }: { query: string; results: number }) {
  useEffect(() => { track({ type: "search", query, results }); }, [query, results]);
  return null;
}
