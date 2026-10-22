import Link from "next/link";
import { ProductCard } from "@/components/product-card";
import { EmptyState } from "@/components/ui";
import { getCategories, getProducts } from "@/lib/server-data";

export default async function Home() {
  const [cats, products] = await Promise.all([getCategories(), getProducts({ sort: "newest", limit: 12 })]);
  return (
    <div className="container page stack">
      <section className="card" style={{ background: "var(--color-primary-soft)", borderColor: "transparent" }}>
        <h1>Shop from trusted independent sellers</h1>
        <p className="muted">Pay securely, track each seller&apos;s shipment, and get refunds when something goes wrong.</p>
        <div className="row"><Link href="/search?sort=newest" className="btn btn-primary">Browse new arrivals</Link><Link href="/become-a-seller" className="btn">Start selling</Link></div>
      </section>
      {cats.ok && cats.value.length > 0 && (
        <section aria-labelledby="cats"><h2 id="cats">Shop by category</h2>
          <div className="row">{cats.value.map((c) => <Link key={c.id} href={`/category/${c.slug}`} className="btn">{c.name}</Link>)}</div>
        </section>
      )}
      <section aria-labelledby="new"><h2 id="new">New arrivals</h2>
        {!products.ok ? <div className="alert alert-danger" role="alert">We couldn&apos;t load products right now.</div>
          : products.value.items.length === 0 ? <EmptyState title="No products yet">Sellers are setting up their stores. Check back soon.</EmptyState>
          : <div className="grid grid-products">{products.value.items.map((p) => <ProductCard key={p.id} p={p} />)}</div>}
      </section>
    </div>
  );
}
