"use client";
import { useCallback, useState } from "react";
import { api, messageFor } from "@/lib/api";
import { useInView } from "./in-view";
import { useT } from "./lang";
import { ProductCard, ProductCardSkeleton, type ProductCardData } from "./product-card";
import { Button } from "./ui";

/** Continues a product grid as the shopper scrolls: the first page is server-rendered, the rest arrives just before it is needed. */
export function InfiniteProducts({ query, initialCursor, source }: { query: string; initialCursor: string; source?: string }) {
  const t = useT();
  const [items, setItems] = useState<ProductCardData[]>([]);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const more = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const r = await api<ProductCardData[]>(`/products?${query}&cursor=${encodeURIComponent(cursor)}`);
      setItems((prev) => { const seen = new Set(prev.map((p) => p.id)); return [...prev, ...r.data.filter((p) => !seen.has(p.id))]; });
      setCursor((r.meta as { nextCursor?: string | null } | undefined)?.nextCursor ?? null);
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setLoading(false);
    }
  }, [cursor, loading, query]);

  const sentinel = useInView<HTMLDivElement>(() => void more(), cursor !== null && !error);

  return (
    <>
      {items.length > 0 && <div className="grid grid-products" aria-live="polite">{items.map((p) => <ProductCard key={p.id} p={p} source={source} />)}</div>}
      {loading && <div className="grid grid-products" aria-busy="true">{Array.from({ length: 4 }, (_, i) => <ProductCardSkeleton key={i} />)}</div>}
      {error && <div className="center stack"><p className="muted">{error}</p><Button onClick={() => void more()}>{t("Try again")}</Button></div>}
      {cursor === null && items.length > 0 && <p className="muted small center">{t("You've reached the end.")}</p>}
      <div ref={sentinel} aria-hidden="true" style={{ height: 1 }} />
    </>
  );
}
