import type { Metadata } from "next";
import { Listing, toParams } from "@/components/listing";

type SP = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const p = toParams(await searchParams);
  return { title: p.q ? `Search: ${p.q}` : "Browse products", robots: p.cursor || p.q ? { index: false } : undefined };
}

export default async function SearchPage({ searchParams }: { searchParams: SP }) {
  const params = toParams(await searchParams);
  return (
    <div className="container page stack">
      <h1>{params.q ? `Results for “${params.q}”` : "All products"}</h1>
      <Listing base="/search" params={params} />
    </div>
  );
}
