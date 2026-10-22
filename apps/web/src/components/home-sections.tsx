import Link from "next/link";
import { Suspense } from "react";
import { getCategories, getProducts, getStores } from "@/lib/server-data";
import { CATEGORY_BANNER, siteImage } from "@/lib/site";
import { FlashDealsTimer } from "./flash-timer";
import { HeroCarousel, type Slide } from "./hero";
import { IconCard, IconCheck, IconReturn, IconShieldLock, IconTruck } from "./icons";
import { ProductCard, ProductCardSkeleton } from "./product-card";
import { ProductRail, RailSkeleton } from "./product-rail";
import { SmartImage } from "./smart-image";

export function Hero() {
  const img = (n: Parameters<typeof siteImage>[0]) => siteImage(n, { w: 1600, h: 640 });
  const slides: Slide[] = [
    { id: "fashion", eyebrow: "New Season 2026", title: "Fresh styles from independent sellers", text: "Tees, denim, sneakers and ethnic wear — straight from Dhaka's finest artisan shops.", cta: "Shop Fashion", href: "/category/fashion", image: img("hero-fashion"), tone: "amber" },
    { id: "tech", eyebrow: "Audio & Gadgets", title: "Gear up with verified electronics", text: "Headphones, smartwatches, chargers and accessories with authentic seller warranty.", cta: "Shop Electronics", href: "/category/electronics", image: img("hero-tech"), tone: "indigo" },
    { id: "home", eyebrow: "Home & Living", title: "Make your space feel like home", text: "Handwoven rugs, cozy bedding, planters and decor crafted for every room.", cta: "Shop Home", href: "/category/home-living", image: img("hero-home"), tone: "teal" },
    { id: "grocery", eyebrow: "Grocery & Pantry", title: "Pantry staples, fresh & authentic", text: "Premium mustard oil, aromatic rice, spices and organic goods from local growers.", cta: "Shop Grocery", href: "/category/grocery", image: img("hero-grocery"), tone: "green" },
  ];
  return (
    <section className="hero-grid" aria-label="Featured">
      <HeroCarousel slides={slides} />
      <div className="hero-side">
        <Link href="/become-a-seller" className="promo promo-sell">
          <SmartImage src={siteImage("store-front", { w: 700, h: 320 })} alt="" width={700} height={320} />
          <div className="promo-overlay" />
          <div className="promo-copy">
            <span className="promo-pill">⚡ 0% Setup Fee</span>
            <strong>Open your shop in minutes</strong>
            <small>Sell to shoppers across Bangladesh →</small>
          </div>
        </Link>
        <Link href="#deals" className="promo promo-deals">
          <SmartImage src={siteImage("hero-sale", { w: 700, h: 320 })} alt="" width={700} height={320} />
          <div className="promo-overlay" />
          <div className="promo-copy">
            <span className="promo-pill promo-pill-hot">🔥 Daily Flash Sales</span>
            <strong>Up to 50% off top picks</strong>
            <small>Limited-time prices updated daily →</small>
          </div>
        </Link>
      </div>
    </section>
  );
}

export function DepartmentNav() {
  const departments = [
    { label: "⚡ Flash Deals", href: "#deals", highlight: true },
    { label: "👗 Fashion", href: "/category/fashion" },
    { label: "🎧 Electronics", href: "/category/electronics" },
    { label: "🛋️ Home & Living", href: "/category/home-living" },
    { label: "🛒 Grocery & Pantry", href: "/category/grocery" },
    { label: "🏪 Verified Stores", href: "#stores" },
    { label: "✨ Fresh Arrivals", href: "#new" },
  ];

  return (
    <nav className="dept-nav" aria-label="Quick Departments">
      <div className="dept-track">
        {departments.map((d) => (
          <Link key={d.label} href={d.href} className={`dept-pill ${d.highlight ? "dept-pill-highlight" : ""}`}>
            {d.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

export function TrustBar() {
  const items = [
    { icon: <IconTruck />, t: "Nationwide Delivery", d: "Tracked shipping via REDX & couriers across 64 districts", tone: "teal" },
    { icon: <IconCard />, t: "Cash on Delivery", d: "Inspect at your doorstep or pay with bKash, Nagad & Cards", tone: "amber" },
    { icon: <IconShieldLock />, t: "100% Buyer Protection", d: "Authentic items from screened, verified local merchants", tone: "blue" },
    { icon: <IconReturn />, t: "7-Day Easy Returns", d: "Hassle-free return requests with guaranteed prompt refunds", tone: "purple" },
  ];
  return (
    <div className="trust-grid" role="region" aria-label="Buyer benefits & guarantees">
      {items.map((i) => (
        <div key={i.t} className={`trust-card tone-${i.tone}`}>
          <div className="trust-icon-box">{i.icon}</div>
          <div className="trust-text">
            <strong>{i.t}</strong>
            <p>{i.d}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export async function CategoryTiles() {
  const cats = await getCategories();
  if (!cats.ok || cats.value.length === 0) return null;
  return (
    <section aria-labelledby="cat-h" className="stack-sm">
      <div className="rail-head">
        <div>
          <h2 id="cat-h">Shop by Category</h2>
          <p className="muted small">Handpicked selections from verified Bangladesh vendors</p>
        </div>
      </div>
      <div className="cat-tiles">
        {cats.value.map((c) => {
          const banner = CATEGORY_BANNER[c.slug];
          return (
            <Link key={c.id} href={`/category/${c.slug}`} className="cat-tile" aria-label={`Browse ${c.name}`}>
              <SmartImage src={banner ? siteImage(banner, { w: 480, h: 360 }) : undefined} alt="" width={480} height={360} />
              <div className="cat-tile-content">
                <span className="cat-tile-badge">Verified Department</span>
                <span className="cat-tile-title">{c.name}</span>
                <span className="cat-tile-cta">Explore collection →</span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export function CategoryTilesSkeleton() {
  return <div className="cat-tiles" aria-busy="true">{Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton cat-tile-skel" />)}</div>;
}

/** Items that are genuinely discounted (compare-at above price), biggest discount first. */
export async function DealsRail() {
  const r = await getProducts({ sort: "newest", limit: 48 });
  if (!r.ok) return null;
  const deals = r.value.items.filter((p) => p.discountPercent).sort((a, b) => (b.discountPercent ?? 0) - (a.discountPercent ?? 0)).slice(0, 14);
  const top = deals[0]?.discountPercent;
  return (
    <div id="deals">
      <ProductRail
        accent
        title="Today's Flash Deals"
        subtitle={top ? `Up to ${top}% off from independent sellers · Refreshes daily` : "Limited time promotional prices"}
        headerExtra={<FlashDealsTimer />}
        href="/search?sort=price_asc"
        items={deals}
      />
    </div>
  );
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
    <section id="stores" aria-labelledby="stores-h" className="stack-sm">
      <div className="rail-head">
        <div>
          <h2 id="stores-h">Featured Verified Stores</h2>
          <p className="muted small">Direct from vetted independent creators & merchants</p>
        </div>
        <Link href="/become-a-seller" className="rail-all">Sell on BazarFlow →</Link>
      </div>
      <div className="stores">
        {s.value.map((v) => (
          <Link key={v.id} href={`/vendors/${v.slug}`} className="store-card">
            <span className="store-logo" aria-hidden="true">{v.name.slice(0, 2).toUpperCase()}</span>
            <div className="store-card-info">
              <div className="store-card-title-row">
                <strong>{v.name}</strong>
                <span className="store-verified-icon" title="Verified Seller"><IconCheck width={12} height={12} /></span>
              </div>
              {v.description && <small className="muted">{v.description}</small>}
              <div className="store-card-tags">
                <span className="store-tag">★ 4.9 Seller</span>
                <span className="store-tag">Verified Shop</span>
              </div>
            </div>
            <span className="store-card-action" aria-hidden="true">Visit →</span>
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
    <section id="new" aria-labelledby="new-h" className="stack-sm">
      <div className="rail-head">
        <div>
          <h2 id="new-h">Fresh Arrivals</h2>
          <p className="muted small">Newly listed products from across Bangladesh</p>
        </div>
        <Link href="/search?sort=newest" className="rail-all">Browse all →</Link>
      </div>
      <div className="grid grid-products">{r.value.items.map((p) => <ProductCard key={p.id} p={p} />)}</div>
    </section>
  );
}
export const NewArrivalsSkeleton = () => <div className="grid grid-products" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <ProductCardSkeleton key={i} />)}</div>;
export const StoresSkeleton = () => <div className="stores" aria-busy="true">{Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton store-card-skel" />)}</div>;
export { RailSkeleton };

export function SellerBanner() {
  return (
    <section className="seller-banner" aria-labelledby="sell-h">
      <div className="seller-banner-content">
        <span className="seller-banner-badge">Merchant Marketplace Hub</span>
        <h2 id="sell-h">Grow Your Business on BazarFlow</h2>
        <p>Reach millions of shoppers nationwide. We provide integrated REDX logistics, guaranteed online & COD payments, and next-day merchant payouts.</p>
        <div className="seller-banner-perks">
          <span><IconCheck width={15} height={15} /> 0% Setup Fees</span>
          <span><IconCheck width={15} height={15} /> Automated Doorstep Pickup</span>
          <span><IconCheck width={15} height={15} /> Dedicated Seller Dashboard</span>
        </div>
      </div>
      <div className="seller-banner-action">
        <Link href="/become-a-seller" className="btn btn-hero">Open Your Shop Free →</Link>
      </div>
    </section>
  );
}
