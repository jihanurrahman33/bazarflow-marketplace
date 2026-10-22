"use client";
import { useEffect, useState, type ReactNode } from "react";
import { variantOf } from "@/lib/track";

/** Experiment "home_order": some shoppers see Trending before Deals. Both rows are rendered on the server; only their order changes. */
export function HomeOrder({ deals, trending }: { deals: ReactNode; trending: ReactNode }) {
  const [variant, setVariant] = useState("control");
  useEffect(() => { setVariant(variantOf("home_order")); }, []);
  return variant === "trending_first" ? <>{trending}{deals}</> : <>{deals}{trending}</>;
}
