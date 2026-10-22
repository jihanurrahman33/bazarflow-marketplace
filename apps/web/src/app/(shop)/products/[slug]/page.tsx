import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Gallery } from "@/components/gallery";
import { ProductBuy } from "@/components/product-buy";
import { Suspense } from "react";
import { IconReturn, IconShield, IconStore, IconTruck } from "@/components/icons";
import { ProductRail, RailSkeleton } from "@/components/product-rail";
import { ProductReviews } from "@/components/product-reviews";
import { Stars } from "@/components/ui";
import { getProduct, getProducts, getReviews } from "@/lib/server-data";

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
          <ProductBuy productId={v.id} slug={v.slug} currency={v.currency} options={v.options} variants={v.variants} />
        </div>
        <aside className="pdp-side stack" aria-label="Delivery and seller">
          <div className="card stack-sm perks-box">
            <div className="perk"><IconTruck /><span><strong>Tracked delivery</strong><small>Shipping is set by the seller and shown at checkout</small></span></div>
            <div className="perk"><IconReturn /><span><strong>Easy returns</strong><small>Request a return from your order page</small></span></div>
            <div className="perk"><IconShield /><span><strong>Secure payment</strong><small>Your order is confirmed only after payment is verified</small></span></div>
          </div>
          {v.vendor && (
            <Link href={`/vendors/${v.vendor.slug}`} className="card seller-box">
              <span className="store-logo" aria-hidden="true"><IconStore /></span>
              <span><small className="muted">Sold by</small><strong>{v.vendor.name}</strong><small className="muted">Visit store →</small></span>
            </Link>
          )}
        </aside>
      </div>
      <section aria-labelledby="desc" className="card"><h2 id="desc">Product details</h2><p style={{ whiteSpace: "pre-line", marginBottom: 0 }}>{v.description}</p></section>
      <Suspense fallback={<RailSkeleton />}><MoreFrom vendor={v.vendor?.slug} category={v.categories[0]?.slug} exclude={v.id} /></Suspense>
      <ProductReviews
        productSlug={v.slug}
        productTitle={v.title}
        initialReviews={reviews.ok ? reviews.value.items : []}
        initialSummary={reviews.ok ? reviews.value.summary : { count: 0, average: null }}
      />
    </div>
  );
}

async function MoreFrom({ vendor, category, exclude }: { vendor?: string; category?: string; exclude: string }) {
  const [fromStore, similar] = await Promise.all([
    vendor ? getProducts({ sort: "newest", limit: 10, vendor }) : Promise.resolve(undefined),
    category ? getProducts({ sort: "newest", limit: 10, category }) : Promise.resolve(undefined),
  ]);
  const strip = (r: typeof fromStore) => (r?.ok ? r.value.items.filter((p) => p.id !== exclude) : []);
  const alike = strip(similar);
  const shown = new Set(alike.map((p) => p.id));
  // Don't repeat the same products twice: the store rail only lists what the category rail did not.
  const storeOnly = strip(fromStore).filter((p) => !shown.has(p.id));
  return (
    <>
      <ProductRail title="You may also like" href={category ? `/category/${category}` : undefined} items={alike} />
      <ProductRail title="More from this store" href={vendor ? `/vendors/${vendor}` : undefined} items={storeOnly} />
    </>
  );
}
