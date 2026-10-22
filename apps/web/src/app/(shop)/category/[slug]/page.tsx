import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { ListingBodySkeleton } from "@/components/skeletons";
import { Listing, toParams } from "@/components/listing";
import { getCategories } from "@/lib/server-data";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

async function find(slug: string) {
  const cats = await getCategories();
  if (!cats.ok) return undefined;
  for (const c of cats.value) {
    if (c.slug === slug) return { cat: c, parent: undefined };
    const child = c.children.find((x) => x.slug === slug);
    if (child) return { cat: { ...child, children: [] }, parent: c };
  }
  return null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await find((await params).slug);
  return found ? { title: found.cat.name, description: `Shop ${found.cat.name} from independent sellers on BazarFlow.` } : {};
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const found = await find(slug);
  if (found === null) notFound();
  const p = { ...toParams(await searchParams), category: slug };
  return (
    <div className="container page stack">
      <nav className="breadcrumbs" aria-label="Breadcrumb"><Link href="/">Home</Link> / {found?.parent && <><Link href={`/category/${found.parent.slug}`}>{found.parent.name}</Link> / </>}{found?.cat.name ?? slug}</nav>
      <h1>{found?.cat.name ?? slug}</h1>
      {found && found.cat.children.length > 0 && <div className="row">{found.cat.children.map((c) => <Link key={c.id} href={`/category/${c.slug}`} className="btn btn-sm">{c.name}</Link>)}</div>}
      <Suspense key={JSON.stringify(p)} fallback={<ListingBodySkeleton />}><Listing base={`/category/${slug}`} params={p} heading={found?.cat.name} /></Suspense>
    </div>
  );
}
