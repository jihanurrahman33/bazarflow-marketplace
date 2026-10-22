"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useInView } from "./in-view";
import type { ProductCardData } from "./product-card";
import { ProductRail, RailSkeleton } from "./product-rail";

const BATCH = 3;

function LazyRail({ slug, name }: { slug: string; name: string }) {
  const [items, setItems] = useState<ProductCardData[] | null>(null);
  useEffect(() => {
    let live = true;
    api<ProductCardData[]>(`/products?category=${encodeURIComponent(slug)}&sort=newest&limit=12`)
      .then((r) => live && setItems(r.data))
      .catch(() => live && setItems([]));
    return () => { live = false; };
  }, [slug]);
  if (items === null) return <RailSkeleton title={name} />;
  return <ProductRail title={name} href={`/category/${slug}`} items={items} />;
}

/** Category rows below the fold: a few more appear each time the shopper nears the bottom, and each loads its products only then. */
export function LazyRails({ categories }: { categories: { slug: string; name: string }[] }) {
  const [shown, setShown] = useState(BATCH);
  const more = shown < categories.length;
  const sentinel = useInView<HTMLDivElement>(() => setShown((n) => n + BATCH), more, "500px");
  return (
    <>
      {categories.slice(0, shown).map((c) => <LazyRail key={c.slug} slug={c.slug} name={c.name} />)}
      {more && <div ref={sentinel} aria-hidden="true" style={{ height: 1 }} />}
    </>
  );
}
