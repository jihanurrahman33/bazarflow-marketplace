"use client";
import Link from "next/link";
import { RequireAuth } from "@/components/guard";
import { ProductCard, ProductCardSkeleton, type ProductCardData } from "@/components/product-card";
import { EmptyState, ErrorPanel } from "@/components/ui";
import { formatMoneyShort } from "@/lib/format";
import { useApi } from "@/lib/hooks";

type Saved = ProductCardData & { savedPriceMinor?: number; priceDropped: boolean };

function SavedItems() {
  const list = useApi<Saved[]>("/me/wishlist");
  if (list.loading) return <div className="grid grid-products">{Array.from({ length: 4 }, (_, i) => <ProductCardSkeleton key={i} />)}</div>;
  if (list.error) return <ErrorPanel error={list.error} onRetry={list.reload} />;
  const items = list.data ?? [];
  if (items.length === 0) return <EmptyState title="Nothing saved yet" action={<Link className="btn btn-primary" href="/">Browse products</Link>}>Tap the heart on any product to keep it here. We&apos;ll let you know if the price drops or it comes back in stock.</EmptyState>;
  return (
    <div className="grid grid-products">
      {items.map((p) => (
        <div key={p.id} className="saved-item">
          <ProductCard p={p} source="wishlist" />
          {p.priceDropped && p.savedPriceMinor !== undefined && <p className="saved-drop">Price dropped from {formatMoneyShort(p.savedPriceMinor, p.currency)}</p>}
        </div>
      ))}
    </div>
  );
}

export default function WishlistPage() {
  return <RequireAuth role="customer">{() => <div className="container page stack"><h1>Saved items</h1><SavedItems /></div>}</RequireAuth>;
}
