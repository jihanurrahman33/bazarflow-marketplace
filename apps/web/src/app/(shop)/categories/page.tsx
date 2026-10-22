import type { Metadata } from "next";
import Link from "next/link";
import { categoryImage, CategoryChip } from "@/components/home-sections";
import { getCategories } from "@/lib/server-data";

export const metadata: Metadata = { title: "All categories", description: "Browse every category on BazarFlow." };

export default async function AllCategories() {
  const cats = await getCategories();
  const items = cats.ok ? await Promise.all(cats.value.map(async (c) => ({ c, image: await categoryImage(c.slug) }))) : [];
  return (
    <div className="container page stack">
      <nav className="breadcrumbs" aria-label="Breadcrumb"><Link href="/">Home</Link> / All categories</nav>
      <h1>All categories</h1>
      {items.length === 0 ? <p className="muted">No categories yet.</p> : (
        <div className="cat-grid">
          {items.map(({ c, image }) => <CategoryChip key={c.id} slug={c.slug} name={c.name} image={image} />)}
        </div>
      )}
    </div>
  );
}
