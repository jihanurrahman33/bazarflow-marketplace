import Link from "next/link";
import { formatMoneyShort } from "@/lib/format";
import { SmartImage } from "./smart-image";

export interface ProductCardData {
  id: string;
  slug: string;
  title: string;
  image?: string;
  minPriceMinor: number;
  compareAtMinor?: number;
  discountPercent?: number;
  rating?: { average: number; count: number };
  currency: string;
  inStock: boolean;
  vendor: { slug?: string; name?: string };
}

/** Image first, then name and price. Everything else (stock, seller, rating) appears only when it matters. */
export function ProductCard({ p, priority }: { p: ProductCardData; priority?: boolean }) {
  return (
    <Link href={`/products/${p.slug}`} className="pcard" aria-label={`${p.title}, ${formatMoneyShort(p.minPriceMinor, p.currency)}`}>
      <div className="pcard-media">
        <SmartImage src={p.image} alt="" width={480} height={480} priority={priority} />
        {p.discountPercent ? <span className="pcard-badge" aria-label={`${p.discountPercent} percent off`}>−{p.discountPercent}%</span> : null}
        {!p.inStock && <span className="pcard-oos">Out of stock</span>}
      </div>
      <div className="pcard-body">
        <h3 className="pcard-title">{p.title}</h3>
        <div className="pcard-price">
          <span className="now">{formatMoneyShort(p.minPriceMinor, p.currency)}</span>
          {p.compareAtMinor ? <s className="was">{formatMoneyShort(p.compareAtMinor, p.currency)}</s> : null}
        </div>
        {p.rating && p.rating.count > 0 && (
          <span className="pcard-rating" role="img" aria-label={`Rated ${p.rating.average} out of 5 from ${p.rating.count} reviews`}>
            <span className="star" aria-hidden="true">★</span>
            <span aria-hidden="true">{p.rating.average.toFixed(1)}</span>
            <span className="muted" aria-hidden="true">({p.rating.count})</span>
          </span>
        )}
      </div>
    </Link>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="pcard pcard-skel" aria-hidden="true">
      <div className="pcard-media skeleton" style={{ aspectRatio: "1 / 1" }} />
      <div className="pcard-body"><div className="skeleton" style={{ height: 14 }} /><div className="skeleton" style={{ height: 14, width: "55%" }} /><div className="skeleton" style={{ height: 18, width: "35%" }} /></div>
    </div>
  );
}
