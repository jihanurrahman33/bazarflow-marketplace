import Link from "next/link";
import { Suspense } from "react";
import { getCategories, getProducts, getStores } from "@/lib/server-data";
import { CATEGORY_BANNER, siteImage } from "@/lib/site";
import { HeroCarousel, type Slide } from "./hero";
import { IconHeadset, IconReturn, IconShield, IconStore, IconTruck } from "./icons";
import { ProductCard, ProductCardSkeleton } from "./product-card";
import { ProductRail, RailSkeleton } from "./product-rail";
import { SmartImage } from "./smart-image";

export function Hero() {
  const img = (n: Parameters<typeof siteImage>[0]) => siteImage(n, { w: 1600, h: 640 });
  const slides: Slide[] = [
    { id: "fashion", eyebrow: "New season", title: "Fresh styles from independent sellers", text: "Tees, denim, sneakers and more — straight from Dhaka's growing shops.", cta: "Shop fashion", href: "/category/fashion", image: img("hero-fashion"), tone: "amber" },
    { id: "tech", eyebrow: "Audio & gadgets", title: "Gear up for less", text: "Headphones, earbuds, chargers and smart watches with seller warranty.", cta: "Shop electronics", href: "/category/electronics", image: img("hero-tech"), tone: "indigo" },
    { id: "home", eyebrow: "Home & living", title: "Make your space feel like home", text: "Rugs, bedding and green touches for every room.", cta: "Shop home", href: "/category/home-living", image: img("hero-home"), tone: "teal" },
    { id: "grocery", eyebrow: "Grocery & food", title: "Pantry staples, picked fresh", text: "Cooking oil, rice and seasonal produce from local producers.", cta: "Shop grocery", href: "/category/grocery", image: img("hero-grocery"), tone: "green" },
  ];
  return (
    <section className="hero-grid" aria-label="Featured">
      <HeroCarousel slides={slides} />
      <div className="hero-side">
        <Link href="/become-a-seller" className="promo promo-sell">
          <SmartImage src={siteImage("store-front", { w: 700, h: 320 })} alt="" width={700} height={320} />
          <span className="promo-copy"><small>Sell on BazarFlow</small><strong>Open your shop in minutes</strong></span>
        </Link>
        <Link href="#deals" className="promo promo-deals">
          <SmartImage src={siteImage("hero-sale", { w: 700, h: 320 })} alt="" width={700} height={320} />
          <span className="promo-copy"><small>Limited-time prices</small><strong>Shop today&apos;s deals</strong></span>
        </Link>
      </div>
    </section>
  );
}

export function TrustBar() {
  const items = [
    { icon: <IconShield />, t: "Secure payments", d: "Confirmed before we ship" },
    { icon: <IconTruck />, t: "Tracked delivery", d: "Per-seller shipment updates" },
    { icon: <IconReturn />, t: "Easy returns", d: "Request from your order page" },
    { icon: <IconHeadset />, t: "Help centre", d: "Quick answers, any time" },
  ];
  return (
    <ul className="trust" aria-label="Why shop with us">
      {items.map((i) => <li key={i.t}>{i.icon}<span><strong>{i.t}</strong><small>{i.d}</small></span></li>)}
    </ul>
  );
}

export async function CategoryTiles() {
  const cats = await getCategories();
  if (!cats.ok || cats.value.length === 0) return null;
  return (
    <section aria-labelledby="cat-h" className="stack-sm">
      <h2 id="cat-h">Shop by category</h2>
      <div className="cat-tiles">
        {cats.value.map((c) => {
          const banner = CATEGORY_BANNER[c.slug];
          return (
            <Link key={c.id} href={`/category/${c.slug}`} className="cat-tile">
              <SmartImage src={banner ? siteImage(banner, { w: 480, h: 360 }) : undefined} alt="" width={480} height={360} />
              <span>{c.name}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export function CategoryTilesSkeleton() {
  return <div className="cat-tiles" aria-busy="true">{Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton" style={{ aspectRatio: "4 / 3", borderRadius: "var(--radius-lg)" }} />)}</div>;
}

/** Items that are genuinely discounted (compare-at above price), biggest discount first. */
export async function DealsRail() {
  const r = await getProducts({ sort: "newest", limit: 48 });
  if (!r.ok) return null;
  const deals = r.value.items.filter((p) => p.discountPercent).sort((a, b) => (b.discountPercent ?? 0) - (a.discountPercent ?? 0)).slice(0, 14);
  const top = deals[0]?.discountPercent;
  return <div id="deals"><ProductRail accent title="Today's deals" subtitle={top ? `Up to ${top}% off from independent sellers` : undefined} href="/search?sort=price_asc" items={deals} /></div>;
}

export async function CategoryRail({ slug }: { slug: string }) {
  const [cats, r] = await Promise.all([getCategories(), getProducts({ sort: "newest", limit: 12, category: slug })]);
  if (!r.ok) return null;
  const name = cats.ok ? cats.value.find((c) => c.slug === slug)?.name ?? slug : slug;
  return <ProductRail title={name} href={`/category/${slug}`} items={r.value.items} />;
}

export async function CategoryRails({ limit = 4 }: { limit?: number }) {
  const cats = await getCategories();
  if (!cats.ok) return null;
  return <>{cats.value.slice(0, limit).map((c) => <Suspense key={c.id} fallback={<RailSkeleton title={c.name} />}><CategoryRail slug={c.slug} /></Suspense>)}</>;
}

export async function StoresStrip() {
  const s = await getStores();
  if (!s.ok || s.value.length === 0) return null;
  return (
    <section aria-labelledby="stores-h" className="stack-sm">
      <h2 id="stores-h">Popular stores</h2>
      <div className="stores">
        {s.value.map((v) => (
          <Link key={v.id} href={`/vendors/${v.slug}`} className="store-card">
            <span className="store-logo" aria-hidden="true"><IconStore /></span>
            <span><strong>{v.name}</strong>{v.description && <small>{v.description}</small>}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export async function NewArrivals() {
  const r = await getProducts({ sort: "newest", limit: 12 });
  if (!r.ok) return <div className="alert alert-danger" role="alert">We couldn&apos;t load products right now. Please refresh in a moment.</div>;
  if (r.value.items.length === 0) return null;
  return (
    <section aria-labelledby="new-h" className="stack-sm">
      <div className="rail-head"><h2 id="new-h">Just in</h2><Link href="/search?sort=newest" className="rail-all">Browse all</Link></div>
      <div className="grid grid-products">{r.value.items.map((p) => <ProductCard key={p.id} p={p} />)}</div>
    </section>
  );
}
export const NewArrivalsSkeleton = () => <div className="grid grid-products" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <ProductCardSkeleton key={i} />)}</div>;
export const StoresSkeleton = () => <div className="stores" aria-busy="true">{Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton" style={{ height: 72, borderRadius: "var(--radius-lg)" }} />)}</div>;
export { RailSkeleton };

export function SellerBanner() {
  return (
    <section className="seller-banner" aria-labelledby="sell-h">
      <div><h2 id="sell-h">Sell your products on BazarFlow</h2><p>Reach shoppers across Bangladesh. We handle payments and order tracking — you focus on your products.</p></div>
      <Link href="/become-a-seller" className="btn btn-hero">Start selling</Link>
    </section>
  );
}
