import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { IconReturn, IconShield, IconTruck } from "@/components/icons";
import { ListingBodySkeleton } from "@/components/skeletons";
import { Listing, toParams } from "@/components/listing";
import { Stars } from "@/components/ui";
import { formatDate, formatMoneyShort } from "@/lib/format";
import { getVendor, getVendorReviews, getVendorTrust } from "@/lib/server-data";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
type Trust = NonNullable<Awaited<ReturnType<typeof getVendorTrust>> extends infer R ? (R extends { ok: true; value: infer V } ? V : never) : never>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const v = await getVendor((await params).slug);
  return v.ok ? { title: v.value.name, description: v.value.description?.slice(0, 160) } : {};
}

const TABS = [["products", "Products"], ["reviews", "Reviews"], ["about", "About"]] as const;
const nf = new Intl.NumberFormat("en-BD");

export default async function VendorPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const [v, t] = await Promise.all([getVendor(slug), getVendorTrust(slug)]);
  if (!v.ok) {
    if (v.notFound) notFound();
    return <div className="container page"><div className="alert alert-danger" role="alert">This store could not be loaded. Please try again.</div></div>;
  }
  const trust = t.ok ? t.value : null;
  const tab = (TABS.find(([k]) => k === sp.tab)?.[0] ?? "products") as (typeof TABS)[number][0];
  const tabHref = (k: string) => `/vendors/${slug}${k === "products" ? "" : `?tab=${k}`}`;

  return (
    <div className="container page stack">
      <header className="store-hero">
        <span className="store-logo store-logo-lg" aria-hidden="true">{v.value.name.slice(0, 1)}</span>
        <div className="store-hero-main">
          <h1>{v.value.name}</h1>
          <p className="store-badge"><IconShield width={16} height={16} /> Reviewed and approved by BazarFlow</p>
          {v.value.description && <p className="store-desc">{v.value.description}</p>}
        </div>
      </header>

      {trust && <StoreFacts trust={trust} />}

      <nav className="store-tabs" aria-label="Store sections">
        {TABS.map(([k, label]) => <Link key={k} href={tabHref(k)} aria-current={tab === k ? "page" : undefined} scroll={false}>{label}{k === "reviews" && trust && trust.rating.count > 0 ? <span className="store-tab-n">{nf.format(trust.rating.count)}</span> : null}</Link>)}
      </nav>

      {tab === "products" && <Suspense key={JSON.stringify(sp)} fallback={<ListingBodySkeleton />}><Listing base={`/vendors/${slug}`} params={{ ...toParams(sp), vendor: slug }} /></Suspense>}
      {tab === "reviews" && <Suspense fallback={<ListingBodySkeleton />}><StoreReviews slug={slug} trust={trust} /></Suspense>}
      {tab === "about" && <StoreAbout name={v.value.name} description={v.value.description} trust={trust} />}
    </div>
  );
}

function StoreFacts({ trust }: { trust: Trust }) {
  const r = trust.rating;
  const isNew = trust.completedOrders === 0 && r.count === 0;
  const facts: { value: string; label: string; sub?: string }[] = [
    ...(r.average !== null ? [{ value: `★ ${r.average.toFixed(1)}`, label: `${nf.format(r.count)} ${r.count === 1 ? "review" : "reviews"}`, sub: r.positivePercent !== null ? `${r.positivePercent}% positive` : undefined }] : []),
    ...(trust.completedOrders > 0 ? [{ value: nf.format(trust.completedOrders), label: "orders completed" }] : []),
    ...(trust.typicalShipDays !== null ? [{ value: `~${trust.typicalShipDays} day${trust.typicalShipDays === 1 ? "" : "s"}`, label: "typical time to ship" }] : []),
    ...(trust.returnRatePercent !== null ? [{ value: `${trust.returnRatePercent}%`, label: "orders returned" }] : []),
    { value: formatDate(trust.memberSince, { month: "short", year: "numeric" }), label: "on BazarFlow since" },
    { value: nf.format(trust.productCount), label: trust.productCount === 1 ? "product" : "products" },
  ];
  return (
    <section aria-label="Store facts" className="store-facts-wrap">
      <dl className="store-facts">
        {facts.map((f) => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}{f.sub && <small>{f.sub}</small>}</dd></div>)}
      </dl>
      {isNew && <p className="store-new">New seller: no completed orders or reviews yet. Your payment is only confirmed once the payment provider verifies it, and returns are covered like any other order.</p>}
    </section>
  );
}

async function StoreReviews({ slug, trust }: { slug: string; trust: Trust | null }) {
  const rv = await getVendorReviews(slug, 20);
  const r = trust?.rating;
  if (!rv.ok || rv.value.length === 0 || !r) return <p className="muted">No reviews yet. Only customers whose order was delivered can review a product.</p>;
  const max = Math.max(...Object.values(r.distribution), 1);
  return (
    <div className="store-reviews">
      <aside className="store-dist" aria-label="Rating breakdown">
        <div className="store-dist-score"><strong>{r.average?.toFixed(1)}</strong><Stars value={r.average} /><span className="muted small">{nf.format(r.count)} reviews</span></div>
        {[5, 4, 3, 2, 1].map((s) => (
          <div key={s} className="dist-row"><span>{s}★</span><span className="dist-bar"><i style={{ width: `${((r.distribution[s] ?? 0) / max) * 100}%` }} /></span><span className="muted small">{nf.format(r.distribution[s] ?? 0)}</span></div>
        ))}
      </aside>
      <div className="stack">
        {rv.value.map((x) => (
          <article key={x.id} className="store-review">
            <div className="row-between"><span><Stars value={x.rating} />{x.title && <strong> {x.title}</strong>}</span><span className="muted small">{formatDate(x.createdAt, { dateStyle: "medium" })}</span></div>
            <p>{x.body}</p>
            {x.reply && <div className="seller-reply"><strong className="small">Seller response</strong><p>{x.reply.body}</p></div>}
            <p className="muted small">{x.author} · <span className="badge badge-success">Verified purchase</span> · on {x.product.slug ? <Link href={`/products/${x.product.slug}`}>{x.product.title}</Link> : x.product.title}</p>
          </article>
        ))}
        {r.count > rv.value.length && <p className="muted small">Showing the latest {rv.value.length} of {nf.format(r.count)} reviews. Every review is also on its product page.</p>}
      </div>
    </div>
  );
}

function StoreAbout({ name, description, trust }: { name: string; description?: string; trust: Trust | null }) {
  return (
    <div className="store-about">
      <section><h2>About {name}</h2><p>{description ?? "This seller has not added a description yet."}</p></section>
      {trust && (
        <section>
          <h2>Delivery</h2>
          <p><IconTruck width={16} height={16} /> {trust.shipping.flatFeeMinor === 0 ? "Free shipping on every order." : `Shipping ${formatMoneyShort(trust.shipping.flatFeeMinor)} per order${trust.shipping.freeOverMinor ? `, free over ${formatMoneyShort(trust.shipping.freeOverMinor)}` : ""}.`} Tracking appears on your order page once the seller ships.</p>
        </section>
      )}
      <section>
        <h2>Buying from this store</h2>
        <ul className="store-promises">
          <li><IconShield width={18} height={18} /><span><strong>Approved seller.</strong> BazarFlow reviews every store application before it can sell.</span></li>
          <li><IconShield width={18} height={18} /><span><strong>Payment is verified.</strong> Orders are confirmed only after the payment provider confirms your payment.</span></li>
          <li><IconReturn width={18} height={18} /><span><strong>Returns.</strong> Request a return from your order page within 7 days of delivery. Approved refunds go back to your original payment method.</span></li>
          <li><IconShield width={18} height={18} /><span><strong>Honest reviews.</strong> Only customers whose order was delivered can review a product.</span></li>
        </ul>
      </section>
    </div>
  );
}
