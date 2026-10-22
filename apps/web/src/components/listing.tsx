import Link from "next/link";
import { getCategories, getProducts } from "@/lib/server-data";
import type { ProductSort } from "@/server/modules/catalog/public";
import { IconFilter } from "./icons";
import { InfiniteProducts } from "./infinite-products";
import { TrackSearch } from "./track-view";
import { ProductCard } from "./product-card";
import { EmptyState } from "./ui";

export interface ListingParams {
  q?: string;
  category?: string;
  vendor?: string;
  sort?: string;
  minPrice?: string;
  maxPrice?: string;
  cursor?: string;
}

const SORTS: { value: ProductSort; label: string }[] = [
  { value: "newest", label: "Newest" }, { value: "price_asc", label: "Price: low to high" }, { value: "price_desc", label: "Price: high to low" },
];

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
export const toParams = (sp: Record<string, string | string[] | undefined>): ListingParams => ({
  q: first(sp.q), category: first(sp.category), vendor: first(sp.vendor), sort: first(sp.sort), minPrice: first(sp.minPrice), maxPrice: first(sp.maxPrice), cursor: first(sp.cursor),
});

function href(base: string, p: ListingParams, over: Partial<ListingParams>) {
  const merged = { ...p, ...over };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v && !(base !== "/search" && (k === "category" || k === "vendor"))) qs.set(k, v);
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}

const asInt = (v?: string) => (v && /^\d{1,9}$/.test(v) ? Number(v) * 100 : undefined);

/** Server-rendered result list with shareable URLs (filters live in the query string; "next" uses the keyset cursor). */
export async function Listing({ base, params, heading }: { base: string; params: ListingParams; heading?: string }) {
  const sort = (SORTS.some((s) => s.value === params.sort) ? params.sort : params.q ? "relevance" : "newest") as ProductSort;
  const [result, cats] = await Promise.all([
    getProducts({
      q: params.q && params.q.length >= 2 ? params.q : undefined, category: params.category, vendor: params.vendor, sort, limit: 24,
      cursor: params.cursor, minPriceMinor: asInt(params.minPrice), maxPriceMinor: asInt(params.maxPrice),
    }),
    getCategories(),
  ]);
  const apiQuery = new URLSearchParams(Object.entries({
    q: params.q && params.q.length >= 2 ? params.q : undefined, category: params.category ?? (base.startsWith("/category/") ? base.slice("/category/".length) : undefined),
    vendor: params.vendor ?? (base.startsWith("/vendors/") ? base.slice("/vendors/".length) : undefined), sort, limit: "24",
    minPrice: asInt(params.minPrice)?.toString(), maxPrice: asInt(params.maxPrice)?.toString(),
  }).filter((e): e is [string, string] => !!e[1])).toString();
  const source = base === "/search" ? "search" : base.startsWith("/vendors/") ? "store" : "category";
  const activeCategory = base.startsWith("/category/") ? base.slice("/category/".length) : params.category;
  const chips = [
    params.q && { label: `“${params.q}”`, to: href(base, params, { q: undefined, cursor: undefined }) },
    (params.minPrice || params.maxPrice) && { label: `৳${params.minPrice || 0} – ${params.maxPrice ? `৳${params.maxPrice}` : "any"}`, to: href(base, params, { minPrice: undefined, maxPrice: undefined, cursor: undefined }) },
  ].filter(Boolean) as { label: string; to: string }[];

  // Long lists collapse to the first few plus the one being viewed, so the filter column stays short.
  const FILTER_MAX = 8;
  const allCats = cats.ok ? cats.value : [];
  const visibleCats = allCats.filter((c, i) => i < FILTER_MAX || c.slug === activeCategory || c.children.some((x) => x.slug === activeCategory));
  const hiddenCount = allCats.length - visibleCats.length;
  const filters = (
    <div className="stack">
      {cats.ok && cats.value.length > 0 && (
        <nav aria-label="Categories" className="filter-block">
          <h2>Categories</h2>
          <ul className="filter-list">
            <li><Link href={href("/search", { ...params, category: undefined, cursor: undefined }, {})} aria-current={!activeCategory ? "true" : undefined}>All products</Link></li>
            {visibleCats.map((c) => (
              <li key={c.id}>
                <Link href={`/category/${c.slug}`} aria-current={activeCategory === c.slug ? "true" : undefined}>{c.name}</Link>
                {c.children.length > 0 && activeCategory && (activeCategory === c.slug || c.children.some((x) => x.slug === activeCategory)) && (
                  <ul>{c.children.map((ch) => <li key={ch.id}><Link href={`/category/${ch.slug}`} aria-current={activeCategory === ch.slug ? "true" : undefined}>{ch.name}</Link></li>)}</ul>
                )}
              </li>
            ))}
          </ul>
          {hiddenCount > 0 && <Link href="/categories" className="filter-more">Show all {cats.value.length} categories</Link>}
        </nav>
      )}
      <form method="get" action={base} className="filter-block" aria-label="Price filter">
        <h2>Price (৳)</h2>
        {params.q && <input type="hidden" name="q" value={params.q} />}
        {params.sort && <input type="hidden" name="sort" value={params.sort} />}
        {params.category && base === "/search" && <input type="hidden" name="category" value={params.category} />}
        <div className="price-range">
          <label className="sr-only" htmlFor="f-min">Minimum price</label><input id="f-min" name="minPrice" className="input" inputMode="numeric" pattern="[0-9]*" placeholder="Min" defaultValue={params.minPrice} />
          <span aria-hidden="true">–</span>
          <label className="sr-only" htmlFor="f-max">Maximum price</label><input id="f-max" name="maxPrice" className="input" inputMode="numeric" pattern="[0-9]*" placeholder="Max" defaultValue={params.maxPrice} />
        </div>
        <button className="btn btn-primary btn-block" type="submit">Apply</button>
      </form>
    </div>
  );

  return (
    <div className="listing">
      <aside className="listing-filters">
        <details className="filters-mobile"><summary><IconFilter /> Filters</summary>{filters}</details>
        <div className="filters-desktop">{filters}</div>
      </aside>

      <div className="stack listing-main">
        <div className="listing-toolbar">
          <div className="row">{result.ok && <span className="result-count">{result.value.items.length}{result.value.nextCursor ? "+" : ""} product{result.value.items.length === 1 ? "" : "s"}{params.cursor ? " on this page" : ""}</span>}{chips.map((c) => <Link key={c.label} href={c.to} className="chip" aria-label={`Remove filter ${c.label}`}>{c.label} <span aria-hidden="true">×</span></Link>)}</div>
          <form method="get" action={base} className="row" aria-label="Sort">
            {params.q && <input type="hidden" name="q" value={params.q} />}
            {params.minPrice && <input type="hidden" name="minPrice" value={params.minPrice} />}
            {params.maxPrice && <input type="hidden" name="maxPrice" value={params.maxPrice} />}
            {params.category && base === "/search" && <input type="hidden" name="category" value={params.category} />}
            <label htmlFor="f-sort" className="muted small">Sort by</label>
            <select id="f-sort" name="sort" className="input input-sm" defaultValue={sort}>{params.q && <option value="relevance">Relevance</option>}{SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
            <button className="btn btn-sm" type="submit">Sort</button>
          </form>
        </div>

        {!result.ok ? (
          <div className="alert alert-danger" role="alert">We couldn&apos;t load products right now. Please try again in a moment.</div>
        ) : result.value.items.length === 0 ? (
          <EmptyState title={params.q ? `No results for “${params.q}”` : heading ? `Nothing in ${heading} yet` : "No products yet"} action={<Link href={params.q || chips.length ? "/" : "/categories"} className="btn btn-primary">{params.q || chips.length ? "Back to home" : "Browse categories"}</Link>}>
            {params.q || chips.length ? "Try a different search or remove some filters." : "New products land here as sellers publish them. Browse other categories in the meantime."}
          </EmptyState>
        ) : (
          <>
            {params.q && !params.cursor && <TrackSearch query={params.q} results={result.value.items.length} />}
            <div className="grid grid-products">{result.value.items.map((p, i) => <ProductCard key={p.id} p={p} priority={i < 4} source={source} />)}</div>
            <nav className="row-between" aria-label="Pagination">
              {params.cursor ? <Link href={href(base, params, { cursor: undefined })} className="btn">← First page</Link> : <span />}
              {result.value.nextCursor ? <noscript><Link href={href(base, params, { cursor: result.value.nextCursor })} className="btn btn-primary" rel="next">Next page →</Link></noscript> : <span />}
            </nav>
            {result.value.nextCursor && <InfiniteProducts query={apiQuery} initialCursor={result.value.nextCursor} source={source} />}
          </>
        )}
      </div>
    </div>
  );
}
