import type { Metadata } from "next";
import Link from "next/link";
import { getStores } from "@/lib/server-data";

export const metadata: Metadata = { title: "All stores", description: "Every seller on BazarFlow." };

export default async function AllStores() {
  const stores = await getStores(100);
  return (
    <div className="container page stack">
      <nav className="breadcrumbs" aria-label="Breadcrumb"><Link href="/">Home</Link> / All stores</nav>
      <h1>All stores</h1>
      {!stores.ok || stores.value.length === 0 ? <p className="muted">No stores yet.</p> : (
        <div className="store-grid">
          {stores.value.map((v) => (
            <Link key={v.id} href={`/vendors/${v.slug}`} className="store-card">
              <span className="store-logo" aria-hidden="true">{v.name.slice(0, 1).toUpperCase()}</span>
              <span className="store-card-text"><strong>{v.name}</strong>{v.description && <span className="muted small">{v.description}</span>}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
