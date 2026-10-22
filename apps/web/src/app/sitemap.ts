import type { MetadataRoute } from "next";
import { getCollections } from "@/server/db/collections";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.APP_ORIGIN ?? "http://localhost:3000";
  const entries: MetadataRoute.Sitemap = [{ url: base, changeFrequency: "daily", priority: 1 }];
  try {
    const c = await getCollections();
    const [products, vendors, cats] = await Promise.all([
      c.products.find({ status: "published", vendorActive: true }, { projection: { slug: 1, updatedAt: 1 } }).sort({ _id: -1 }).limit(5000).toArray(),
      c.vendors.find({ status: "active" }, { projection: { slug: 1 } }).limit(1000).toArray(),
      c.categories.find({ visible: true }, { projection: { slug: 1 } }).limit(500).toArray(),
    ]);
    entries.push(...products.map((p) => ({ url: `${base}/products/${p.slug}`, lastModified: p.updatedAt, changeFrequency: "daily" as const, priority: 0.8 })));
    entries.push(...vendors.map((v) => ({ url: `${base}/vendors/${v.slug}`, changeFrequency: "weekly" as const, priority: 0.5 })));
    entries.push(...cats.map((x) => ({ url: `${base}/category/${x.slug}`, changeFrequency: "daily" as const, priority: 0.6 })));
  } catch {
    /* database unavailable: serve the minimal sitemap rather than failing the crawl */
  }
  return entries;
}
