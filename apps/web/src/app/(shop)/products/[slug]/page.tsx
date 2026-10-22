import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Gallery } from "@/components/gallery";
import { ProductBuy } from "@/components/product-buy";
import { Stars } from "@/components/ui";
import { getProduct, getReviews } from "@/lib/server-data";
import { formatDate } from "@/lib/format";

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

  return (
    <div className="container page stack">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/">Home</Link>{v.categories[0] && <> / <Link href={`/category/${v.categories[0].slug}`}>{v.categories[0].name}</Link></>} / {v.title}
      </nav>
      <div className="split">
        <Gallery media={v.media} title={v.title} />
        <div className="stack">
          <h1>{v.title}</h1>
          <div className="row">
            {reviews.ok && <><Stars value={reviews.value.summary.average} /><span className="muted small">({reviews.value.summary.count})</span></>}
            {v.vendor && <span className="muted">Sold by <Link href={`/vendors/${v.vendor.slug}`}>{v.vendor.name}</Link></span>}
          </div>
          <ProductBuy productId={v.id} slug={v.slug} currency={v.currency} options={v.options} variants={v.variants} />
          <section aria-labelledby="desc"><h2 id="desc">Description</h2><p style={{ whiteSpace: "pre-line" }}>{v.description}</p></section>
        </div>
      </div>
      <section aria-labelledby="reviews" className="stack">
        <h2 id="reviews">Customer reviews</h2>
        {!reviews.ok ? <p className="muted">Reviews are unavailable right now.</p>
          : reviews.value.items.length === 0 ? <p className="muted">No reviews yet. Only customers who received this product can review it.</p>
          : reviews.value.items.map((r) => (
            <article key={r.id} className="card">
              <div className="row-between"><span><Stars value={r.rating} /> {r.title && <strong>{r.title}</strong>}</span><span className="muted small">{formatDate(r.createdAt, { dateStyle: "medium" })}</span></div>
              <p style={{ whiteSpace: "pre-line", marginBottom: 4 }}>{r.body}</p>
              <span className="muted small">{r.author} · Verified purchase</span>
            </article>
          ))}
      </section>
    </div>
  );
}
