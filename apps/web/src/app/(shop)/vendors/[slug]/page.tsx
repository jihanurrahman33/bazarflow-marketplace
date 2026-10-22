import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Listing, toParams } from "@/components/listing";
import { getVendor } from "@/lib/server-data";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const v = await getVendor((await params).slug);
  return v.ok ? { title: v.value.name, description: v.value.description?.slice(0, 160) } : {};
}

export default async function VendorPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const v = await getVendor(slug);
  if (!v.ok) {
    if (v.notFound) notFound();
    return <div className="container page"><div className="alert alert-danger" role="alert">This store could not be loaded. Please try again.</div></div>;
  }
  return (
    <div className="container page stack">
      <header className="card">
        <h1>{v.value.name}</h1>
        {v.value.description && <p className="muted">{v.value.description}</p>}
      </header>
      <Listing base={`/vendors/${slug}`} params={{ ...toParams(await searchParams), vendor: slug }} />
    </div>
  );
}
