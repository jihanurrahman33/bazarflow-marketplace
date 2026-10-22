import Link from "next/link";
import { Money } from "./ui";

export interface ProductCardData {
  id: string;
  slug: string;
  title: string;
  image?: string;
  minPriceMinor: number;
  currency: string;
  inStock: boolean;
  vendor: { slug?: string; name?: string };
}

export function ProductCard({ p }: { p: ProductCardData }) {
  return (
    <Link href={`/products/${p.slug}`} className="product-card">
      <div className="thumb">{p.image ? <img src={p.image} alt="" loading="lazy" width={480} height={480} /> : null}</div>
      <div className="body">
        <span className="title">{p.title}</span>
        <span className="price"><Money minor={p.minPriceMinor} currency={p.currency} /></span>
        <span className="muted small">{p.vendor.name}</span>
        {!p.inStock && <span className="badge badge-neutral" style={{ alignSelf: "flex-start" }}>Out of stock</span>}
      </div>
    </Link>
  );
}
