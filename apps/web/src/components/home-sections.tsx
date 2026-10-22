import Link from "next/link";
import { Suspense } from "react";
import { getCategories, getProducts, getStores, getTopRated, getTrending } from "@/lib/server-data";
import { CATEGORY_BANNER, siteImage } from "@/lib/site";
import { HeroCarousel, type Slide } from "./hero";
import { IconChevronRight, IconGrid, IconReturn, IconShield, IconTruck, IconHeadset } from "./icons";
import { ProductCard, ProductCardSkeleton } from "./product-card";
import { LazyRails } from "./lazy-rails";
import { ProductRail, RailSkeleton } from "./product-rail";
import { SmartImage } from "./smart-image";

export function Hero() {
  const img = (n: Parameters<typeof siteImage>[0]) => siteImage(n, { w: 1800, h: 720 });
  const slides: Slide[] = [
    { id: "fashion", title: "Everyday style from local sellers", cta: "Shop fashion", href: "/category/fashion", image: img("hero-fashion") },
    { id: "tech", title: "Audio and gadgets, sorted", cta: "Shop electronics", href: "/category/electronics", image: img("hero-tech") },
    { id: "home", title: "Make your space feel like home", cta: "Shop home", href: "/category/home-living", image: img("hero-home") },
    { id: "grocery", title: "Fresh pantry essentials", cta: "Shop grocery", href: "/category/grocery", image: img("hero-grocery") },
  ];
  return <HeroCarousel slides={slides} />;
}

/** One quiet line of reassurance instead of a block of marketing copy. */
export function ValueStrip() {
  const items = [
    { icon: <IconShield width={18} height={18} />, label: "Secure payments" },
    { icon: <IconTruck width={18} height={18} />, label: "Tracked delivery" },
    { icon: <IconReturn width={18} height={18} />, label: "Easy returns" },
    { icon: <IconHeadset width={18} height={18} />, label: "Help centre" },
  ];
  return <ul className="value-strip" aria-label="Why shop here">{items.map((i) => <li key={i.label}>{i.icon}{i.label}</li>)}</ul>;
}

/** Cover photo for a category: the curated banner if there is one, otherwise the newest product's photo. Undefined when the category is empty. */
export async function categoryImage(slug: string): Promise<string | undefined> {
  const banner = CATEGORY_BANNER[slug];
  if (banner) return siteImage(banner, { w: 240, h: 240 });
  const r = await getProducts({ sort: "newest", limit: 1, category: slug });
  return r.ok ? r.value.items[0]?.image : undefined;
}

export function CategoryChip({ slug, name, image }: { slug: string; name: string; image?: string }) {
  return (
    <Link href={`/category/${slug}`} className="cat-chip">
      <span className="cat-chip-img"><SmartImage src={image} alt="" width={120} height={120} /></span>
      <span>{name}</span>
    </Link>
  );
}

const STRIP_MAX = 12;

export async function CategoryStrip() {
  const cats = await getCategories();
  if (!cats.ok || cats.value.length === 0) return null;
  const withImages = await Promise.all(cats.value.map(async (c) => ({ c, image: await categoryImage(c.slug) })));
  const shown = withImages.filter((x) => x.image).slice(0, STRIP_MAX);
  if (shown.length === 0) return null;
  return (
    <nav className="cat-strip" aria-label="Shop by category">
      {shown.map(({ c, image }) => <CategoryChip key={c.id} slug={c.slug} name={c.name} image={image} />)}
      {cats.value.length > shown.length && (
        <Link href="/categories" className="cat-chip">
          <span className="cat-chip-img cat-chip-all"><IconGrid width={28} height={28} /></span>
          <span>All categories</span>
        </Link>
      )}
    </nav>
  );
}
export const CategoryStripSkeleton = () => <div className="cat-strip" aria-busy="true">{Array.from({ length: 4 }, (_, i) => <div key={i} className="cat-chip"><span className="cat-chip-img skeleton" /><span className="skeleton" style={{ width: 56, height: 12 }} /></div>)}</div>;

/** Items that are genuinely discounted (compare-at above price), biggest discount first. */
export async function DealsRail() {
  const r = await getProducts({ sort: "newest", limit: 48 });
  if (!r.ok) return null;
  const deals = r.value.items.filter((p) => p.discountPercent).sort((a, b) => (b.discountPercent ?? 0) - (a.discountPercent ?? 0)).slice(0, 14);
  return <div id="deals"><ProductRail title="Deals" subtitle={deals[0]?.discountPercent ? `Up to ${deals[0].discountPercent}% off` : undefined} href="/search?sort=price_asc" items={deals} source="deals" /></div>;
}

export async function CategoryRail({ slug }: { slug: string }) {
  const [cats, r] = await Promise.all([getCategories(), getProducts({ sort: "newest", limit: 12, category: slug })]);
  if (!r.ok) return null;
  const name = cats.ok ? cats.value.find((c) => c.slug === slug)?.name ?? slug : slug;
  return <ProductRail title={name} href={`/category/${slug}`} items={r.value.items} source="category_row" />;
}

/** Everything after the first `skip` categories: loaded client-side as the shopper scrolls, so a long category list costs nothing up front. */
export async function MoreCategoryRails({ skip = 3 }: { skip?: number }) {
  const cats = await getCategories();
  if (!cats.ok || cats.value.length <= skip) return null;
  return <LazyRails categories={cats.value.slice(skip).map((c) => ({ slug: c.slug, name: c.name }))} />;
}

export async function CategoryRails({ limit = 3 }: { limit?: number }) {
  const cats = await getCategories();
  if (!cats.ok) return null;
  return <>{cats.value.slice(0, limit).map((c) => <Suspense key={c.id} fallback={<RailSkeleton title={c.name} />}><CategoryRail slug={c.slug} /></Suspense>)}</>;
}

export async function StoresStrip() {
  const s = await getStores();
  if (!s.ok || s.value.length === 0) return null;
  return (
    <section id="stores" aria-labelledby="stores-h">
      <header className="section-head"><div><h2 id="stores-h">Stores</h2></div><Link href="/vendors" className="see-all">All stores <IconChevronRight width={16} height={16} /></Link></header>
      <div className="store-row">
        {s.value.map((v) => (
          <Link key={v.id} href={`/vendors/${v.slug}`} className="store-chip">
            <span className="store-logo" aria-hidden="true">{v.name.slice(0, 1).toUpperCase()}</span>
            <span>{v.name}</span>
            <IconChevronRight width={16} height={16} />
          </Link>
        ))}
      </div>
    </section>
  );
}
export const StoresSkeleton = () => <div className="store-row" aria-busy="true">{Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton store-chip-skel" />)}</div>;

export async function NewArrivals() {
  const r = await getProducts({ sort: "newest", limit: 12 });
  if (!r.ok) return <div className="alert alert-danger" role="alert">We couldn&apos;t load products right now. Please refresh in a moment.</div>;
  if (r.value.items.length === 0) return null;
  return (
    <section id="new" aria-labelledby="new-h">
      <header className="section-head"><div><h2 id="new-h">Just in</h2></div><Link href="/search?sort=newest" className="see-all">Browse all <IconChevronRight width={16} height={16} /></Link></header>
      <div className="grid grid-products">{r.value.items.map((p) => <ProductCard key={p.id} p={p} source="new_arrivals" />)}</div>
    </section>
  );
}
export const NewArrivalsSkeleton = () => <div className="grid grid-products" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <ProductCardSkeleton key={i} />)}</div>;
export { RailSkeleton };

export function SellerBanner() {
  return (
    <section className="sell-band" aria-labelledby="sell-h">
      <h2 id="sell-h">Have something to sell?</h2>
      <Link href="/become-a-seller" className="btn btn-primary">Open a store</Link>
    </section>
  );
}


/** What shoppers are buying and rating right now (real orders and reviews). Hidden while there is too little data to say anything. */
export async function TrendingRail() {
  const r = await getTrending(12);
  if (!r.ok || r.value.length < 4) return null;
  return <ProductRail title="Trending now" subtitle="Popular with shoppers this month" items={r.value} source="trending" />;
}

export async function TopRatedRail() {
  const r = await getTopRated(12);
  if (!r.ok || r.value.length < 4) return null;
  return <ProductRail title="Top rated" subtitle="Best reviewed by verified buyers" items={r.value} source="top_rated" />;
}
