"use client";
import Link from "next/link";
import { useRef } from "react";
import { IconChevronLeft, IconChevronRight } from "./icons";
import { ProductCard, ProductCardSkeleton, type ProductCardData } from "./product-card";

/** A titled, horizontally scrolling row of products (scroll-snap; arrow buttons on hover). */
export function ProductRail({ title, subtitle, href, items }: { title: string; subtitle?: string; href?: string; items: ProductCardData[] }) {
  const track = useRef<HTMLDivElement>(null);
  const scroll = (dir: 1 | -1) => track.current?.scrollBy({ left: dir * (track.current.clientWidth * 0.85), behavior: "smooth" });
  if (items.length === 0) return null;
  return (
    <section className="rail" aria-label={title}>
      <header className="section-head">
        <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        {href && <Link href={href} className="see-all">See all <IconChevronRight width={16} height={16} /></Link>}
      </header>
      <div className="rail-wrap">
        <button type="button" className="rail-btn rail-prev" aria-label={`Scroll ${title} left`} onClick={() => scroll(-1)}><IconChevronLeft /></button>
        <div className="rail-track" ref={track} tabIndex={0} role="group" aria-label={`${title} products`}>
          {items.map((p, i) => <div key={p.id} className="rail-item"><ProductCard p={p} priority={i < 2} /></div>)}
        </div>
        <button type="button" className="rail-btn rail-next" aria-label={`Scroll ${title} right`} onClick={() => scroll(1)}><IconChevronRight /></button>
      </div>
    </section>
  );
}

export function RailSkeleton({ title }: { title?: string }) {
  return (
    <section className="rail" aria-busy="true" aria-label={title ? `Loading ${title}` : "Loading"}>
      <header className="section-head"><div className="skeleton" style={{ height: 24, width: 180 }} /></header>
      <div className="rail-track">{Array.from({ length: 6 }, (_, i) => <div key={i} className="rail-item"><ProductCardSkeleton /></div>)}</div>
    </section>
  );
}
