"use client";
import { useEffect } from "react";
import { recordView } from "@/lib/recently-viewed";

/** Remembers, in this browser only, that the shopper looked at this product. Renders nothing. */
export function TrackView({ productId }: { productId: string }) {
  useEffect(() => { recordView(productId); }, [productId]);
  return null;
}
