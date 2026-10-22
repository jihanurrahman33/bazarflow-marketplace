"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { readViewed } from "@/lib/recently-viewed";
import type { ProductCardData } from "./product-card";
import { ProductRail, RailSkeleton } from "./product-rail";
import { useT } from "./lang";
import { useSession } from "./providers";

interface Recs { items: ProductCardData[]; because: { title: string; slug: string } | null }

/** Homepage rows that depend on this shopper: where they left off, a nudge about their cart, and picks ranked from what they viewed. */
export function PersonalRails() {
  const t = useT();
  const { cartCount, user } = useSession();
  const [ids, setIds] = useState<string[] | null>(null);
  const [recent, setRecent] = useState<ProductCardData[] | null>(null);
  const [recs, setRecs] = useState<Recs | null>(null);

  useEffect(() => { setIds(readViewed()); }, []);
  useEffect(() => {
    if (!ids || ids.length === 0) return;
    let live = true;
    const csv = ids.join(",");
    api<ProductCardData[]>(`/products/by-ids?ids=${csv}`).then((r) => live && setRecent(r.data)).catch(() => live && setRecent([]));
    api<ProductCardData[]>(`/products/recommendations?viewed=${csv}&limit=12`).then((r) => live && setRecs({ items: r.data, because: (r.meta as { because?: Recs["because"] }).because ?? null })).catch(() => live && setRecs({ items: [], because: null }));
    return () => { live = false; };
  }, [ids]);

  const shopper = !user || user.role === "customer";
  const hasHistory = (ids?.length ?? 0) > 0;
  if (!shopper || (!hasHistory && cartCount === 0)) return null;

  return (
    <>
      {cartCount > 0 && (
        <aside className="cart-nudge" aria-label={t("Your cart")}>
          <span><strong>{cartCount === 1 ? t("1 item waiting in your cart") : t("{n} items waiting in your cart", { n: cartCount })}</strong></span>
          <Link href="/cart" className="btn btn-primary btn-sm">{t("Go to cart")}</Link>
        </aside>
      )}
      {hasHistory && (recent === null ? <RailSkeleton title="recently viewed" /> : <ProductRail title={t("Recently viewed")} subtitle={t("Pick up where you left off")} items={recent} source="recently_viewed" />)}
      {hasHistory && recs !== null && recs.items.length > 0 && (
        <ProductRail title={recs.because ? t("Because you viewed {title}", { title: recs.because.title.length > 38 ? `${recs.because.title.slice(0, 36)}…` : recs.because.title }) : t("Picked for you")} items={recs.items} source="because_viewed" />
      )}
    </>
  );
}
