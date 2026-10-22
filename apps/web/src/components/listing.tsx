import Link from "next/link";
import { getProducts } from "@/lib/server-data";
import type { ProductSort } from "@/server/modules/catalog/public";
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
  const result = await getProducts({
    q: params.q && params.q.length >= 2 ? params.q : undefined, category: params.category, vendor: params.vendor, sort, limit: 24,
    cursor: params.cursor, minPriceMinor: asInt(params.minPrice), maxPriceMinor: asInt(params.maxPrice),
  });

  return (
    <div className="stack">
      <form method="get" action={base} className="card row" aria-label="Filters">
        {params.q && <input type="hidden" name="q" value={params.q} />}
        {params.category && base === "/search" && <input type="hidden" name="category" value={params.category} />}
        <div className="field"><label htmlFor="f-sort">Sort by</label>
          <select id="f-sort" name="sort" className="input" defaultValue={sort}>{params.q && <option value="relevance">Relevance</option>}{SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
        </div>
        <div className="field"><label htmlFor="f-min">Min ৳</label><input id="f-min" name="minPrice" className="input" inputMode="numeric" pattern="[0-9]*" defaultValue={params.minPrice} style={{ width: 110 }} /></div>
        <div className="field"><label htmlFor="f-max">Max ৳</label><input id="f-max" name="maxPrice" className="input" inputMode="numeric" pattern="[0-9]*" defaultValue={params.maxPrice} style={{ width: 110 }} /></div>
        <button className="btn btn-primary" type="submit" style={{ alignSelf: "flex-end" }}>Apply</button>
      </form>

      {!result.ok ? (
        <div className="alert alert-danger" role="alert">We couldn&apos;t load products right now. Please try again in a moment.</div>
      ) : result.value.items.length === 0 ? (
        <EmptyState title={params.q ? `No results for “${params.q}”` : heading ? `Nothing in ${heading} yet` : "No products yet"} action={<Link href="/" className="btn btn-primary">Back to home</Link>}>
          Try a different search or remove some filters.
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-products">{result.value.items.map((p) => <ProductCard key={p.id} p={p} />)}</div>
          <nav className="row-between" aria-label="Pagination">
            {params.cursor ? <Link href={href(base, params, { cursor: undefined })} className="btn">← First page</Link> : <span />}
            {result.value.nextCursor ? <Link href={href(base, params, { cursor: result.value.nextCursor })} className="btn btn-primary" rel="next">Next page →</Link> : <span />}
          </nav>
        </>
      )}
    </div>
  );
}
