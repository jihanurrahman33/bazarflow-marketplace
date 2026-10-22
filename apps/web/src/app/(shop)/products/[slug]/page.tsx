import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Gallery } from "@/components/gallery";
import { ProductBuy } from "@/components/product-buy";
import { Suspense } from "react";
import { IconReturn, IconShield, IconTruck } from "@/components/icons";
import { ProductRail, RailSkeleton } from "@/components/product-rail";
import { ProductReviews } from "@/components/product-reviews";
import { TrackView } from "@/components/track-view";
import { Stars } from "@/components/ui";
import { getProduct, getProducts, getRelated, getReviews } from "@/lib/server-data";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await getProduct((await params).slug);
  if (!p.ok) return {};
  const v = p.value;
  return {
    title: v.title, description: v.description.slice(0, 160),
    alternates: { canonical: `/products/${v.slug}` },
    openGraph: { title: v.title, description: v.description.slice(0, 160), images: v.media[0] ? [v.media[0].url] : undefined, type: "website" },
  };
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const [p, reviews] = await Promise.all([getProduct(slug), getReviews(slug)]);
  if (!p.ok) {
    if (p.notFound) notFound();
    return <div className="container page"><div className="alert alert-danger" role="alert">This product could not be loaded. Please try again.</div></div>;
  }
  const v = p.value;
  const base = process.env.APP_ORIGIN ?? "http://localhost:3000";
  // Structured data for search engines (schema.org Product). Prices are decimal strings, not floats.
  const ld = {
    "@context": "https://schema.org", "@type": "Product", name: v.title, description: v.description, image: v.media.map((m) => m.url), url: `${base}/products/${v.slug}`,
    brand: v.vendor ? { "@type": "Brand", name: v.vendor.name } : undefined,
    offers: {
      "@type": v.variants.length > 1 ? "AggregateOffer" : "Offer", priceCurrency: v.currency,
      ...(v.variants.length > 1 ? { lowPrice: (Math.min(...v.variants.map((x) => x.priceMinor)) / 100).toFixed(2), highPrice: (Math.max(...v.variants.map((x) => x.priceMinor)) / 100).toFixed(2) } : { price: ((v.variants[0]?.priceMinor ?? v.minPriceMinor) / 100).toFixed(2) }),
      availability: v.variants.some((x) => x.inStock) ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
    ...(reviews.ok && reviews.value.summary.count > 0 ? { aggregateRating: { "@type": "AggregateRating", ratingValue: reviews.value.summary.average, reviewCount: reviews.value.summary.count } } : {}),
  };

  const maxOff = Math.max(0, ...v.variants.map((x) => (x.compareAtMinor && x.compareAtMinor > x.priceMinor ? Math.round(((x.compareAtMinor - x.priceMinor) / x.compareAtMinor) * 100) : 0)));
  return (
    <div className="container page stack">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/">Home</Link>{v.categories[0] && <> / <Link href={`/category/${v.categories[0].slug}`}>{v.categories[0].name}</Link></>} / {v.title}
      </nav>
      <div className="pdp">
        <div className="pdp-gallery"><Gallery media={v.media} title={v.title} /></div>
        <div className="pdp-info stack">
          {maxOff > 0 && <span className="badge badge-danger" style={{ alignSelf: "flex-start" }}>Up to {maxOff}% off</span>}
          <h1>{v.title}</h1>
          <div className="row">
            {reviews.ok && reviews.value.summary.count > 0 && <><Stars value={reviews.value.summary.average} /><a href="#reviews" className="muted small">({reviews.value.summary.count} reviews)</a></>}
            {v.vendor && <span className="muted">Sold by <Link href={`/vendors/${v.vendor.slug}`}>{v.vendor.name}</Link></span>}
          </div>
          <TrackView productId={v.id} />
          <ProductBuy productId={v.id} slug={v.slug} currency={v.currency} options={v.options} variants={v.variants} />
          <ul className="pdp-perks" aria-label="Delivery and returns">
            <li><IconTruck width={18} height={18} />Tracked delivery, shipping shown at checkout</li>
            <li><IconReturn width={18} height={18} />Easy returns from your order page</li>
            <li><IconShield width={18} height={18} />Order confirmed only after payment is verified</li>
          </ul>
          <section aria-labelledby="desc" className="pdp-desc"><h2 id="desc">About this item</h2><p style={{ whiteSpace: "pre-line" }}>{v.description}</p></section>
        </div>
      </div>
      <Suspense fallback={<RailSkeleton />}><MoreFrom id={v.id} vendor={v.vendor?.slug} category={v.categories[0]?.slug} /></Suspense>
      <ProductReviews
        productSlug={v.slug}
        productTitle={v.title}
        initialReviews={reviews.ok ? reviews.value.items : []}
        initialSummary={reviews.ok ? reviews.value.summary : { count: 0, average: null }}
        initialCursor={reviews.ok ? reviews.value.nextCursor : null}
      />
    </div>
  );
}

/** Rows under the product: what buyers of this item also bought (only when there is real repeat-purchase data), similar items ranked by popularity and price, then the rest of the store. */
async function MoreFrom({ id, vendor, category }: { id: string; vendor?: string; category?: string }) {
  const [related, fromStore] = await Promise.all([getRelated(id), vendor ? getProducts({ sort: "newest", limit: 10, vendor }) : Promise.resolve(undefined)]);
  const bought = related.ok ? related.value.alsoBought : [];
  const similar = related.ok ? related.value.similar : [];
  const shown = new Set([id, ...bought.map((p) => p.id), ...similar.map((p) => p.id)]);
  // Don't repeat the same products twice: the store row only lists what the rows above did not.
  const storeOnly = fromStore?.ok ? fromStore.value.items.filter((p) => !shown.has(p.id)) : [];
  return (
    <>
      {bought.length >= 3 && <ProductRail title="Customers also bought" items={bought} />}
      <ProductRail title="Similar items" href={category ? `/category/${category}` : undefined} items={similar} />
      <ProductRail title="More from this store" href={vendor ? `/vendors/${vendor}` : undefined} items={storeOnly} />
    </>
  );
}
