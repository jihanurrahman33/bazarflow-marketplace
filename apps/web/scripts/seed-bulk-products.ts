/**
 * Bulk demo catalogue: ~17 published products per category (30 categories => 510), each store selling its own category.
 * Photos come from the Pexels API (free licence, no attribution required) and are copied into Cloudinary; the site never hotlinks.
 * Needs the usual env + PEXELS_API_KEY + SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD. Run seed-bulk-structure.ts first.
 * Idempotent by (store, title). Demo data only: prices, stock and descriptions are placeholders, not real listings.
 */
import { loadDotEnv } from "./_env";
loadDotEnv();

const { ObjectId } = await import("mongodb");
const { getCollections } = await import("../src/server/db/collections");
const { closeClient } = await import("../src/server/db/client");
const { login, authenticateAccessToken } = await import("../src/server/modules/identity/service");
const { createProduct, updateProduct, submitForReview, moderateProduct } = await import("../src/server/modules/catalog/products");
const { getMediaProvider, vendorMediaFolder } = await import("../src/server/modules/media/cloudinary");
const { BULK_CATEGORIES } = await import("./bulk-data");
const { PRODUCT_TYPES, ADJECTIVES } = await import("./bulk-products-data");
const { writeFileSync, readFileSync, existsSync } = await import("node:fs");

const PASSWORD = "Demo-Pass-2026!";
const device = { platform: "seed" };
const pexelsKey = process.env.PEXELS_API_KEY;
if (!pexelsKey) { console.error("Set PEXELS_API_KEY (free at pexels.com/api)."); process.exit(1); }
const CACHE = process.env.PEXELS_CACHE ?? "/tmp/bazarflow-pexels-cache.json";
const cache: Record<string, string[]> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};

const c = await getCollections();
const admin = await authenticateAccessToken((await login({ email: process.env.SEED_ADMIN_EMAIL!, password: process.env.SEED_ADMIN_PASSWORD!, device })).tokens.accessToken);
const media = getMediaProvider();

async function photosFor(term: string): Promise<string[]> {
  if (cache[term]) return cache[term]!;
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(term)}&per_page=20&orientation=square&size=medium`, { headers: { Authorization: pexelsKey! } });
    if (r.status === 429) { await new Promise((res) => setTimeout(res, 20_000)); continue; }
    if (!r.ok) throw new Error(`pexels ${r.status} for "${term}"`);
    const body = (await r.json()) as { photos: { src: { large: string } }[] };
    cache[term] = body.photos.map((p) => p.src.large);
    writeFileSync(CACHE, JSON.stringify(cache));
    return cache[term]!;
  }
  throw new Error(`pexels rate limit for "${term}"`);
}

async function upload(vendorId: string, url: string): Promise<string> {
  const auth = media.authorizeUpload(vendorMediaFolder(vendorId));
  const form = new FormData();
  form.set("file", url);
  form.set("api_key", auth.apiKey); form.set("timestamp", String(auth.timestamp)); form.set("signature", auth.signature);
  form.set("folder", auth.folder); form.set("allowed_formats", auth.allowedFormats);
  const res = await fetch(auth.uploadUrl, { method: "POST", body: form });
  const body = (await res.json()) as { public_id?: string; error?: { message: string } };
  if (!res.ok || !body.public_id) throw new Error(`upload failed: ${body.error?.message ?? res.status}`);
  return body.public_id;
}

const hash = (s: string) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; };
const COUNTS = [3, 3, 3, 3, 3, 2];
const target = Number(process.env.ONLY_CATEGORY_LIMIT ?? 30);

async function seedCategory(ci: number) {
  const cat = BULK_CATEGORIES[ci]!;
  const types = PRODUCT_TYPES[cat.slug];
  if (!types) throw new Error(`no product types for ${cat.slug}`);
  const catDoc = await c.categories.findOne({ slug: cat.slug });
  const email = `demo.store.${cat.store.slug.replace(/-/g, ".")}@example.com`;
  const actor = await authenticateAccessToken((await login({ email, password: PASSWORD, device })).tokens.accessToken);
  if (!catDoc || !actor.vendorId) throw new Error(`category/store missing for ${cat.slug}`);
  const vActor = { ...actor, vendorId: actor.vendorId };
  const have = new Set((await c.products.find({ vendorId: actor.vendorId }, { projection: { title: 1 } }).toArray()).map((p) => p.title));
  const uploaded = new Map<string, string>();
  let made = 0, n = 0;
  for (const [ti, [noun, term, min, max, about]] of types.entries()) {
    const photos = await photosFor(term);
    if (photos.length === 0) { console.warn(`  no photos for "${term}", skipping`); continue; }
    for (let k = 0; k < COUNTS[ti]!; k++) {
      n++;
      const title = `${ADJECTIVES[(ci * 3 + ti * 5 + k * 4) % ADJECTIVES.length]} ${noun}`;
      if (have.has(title)) continue;
      const f = hash(`${cat.slug}|${title}`);
      let bdt = min + (max - min) * f;
      bdt = bdt < 1000 ? Math.max(Math.round(bdt / 10) * 10, 50) : Math.round(bdt / 50) * 50;
      const compareAt = k % 3 === 0 ? Math.round((bdt * (1.15 + hash(`${title}c`) * 0.2)) / 10) * 10 : undefined;
      const stock = 12 + Math.floor(hash(`${title}s`) * 70);
      const photo = photos[(k * 5 + ti) % photos.length]!;
      const product = await createProduct(vActor, {
        title, description: `${about}\n\nSold and shipped by ${cat.store.name}.`, categoryIds: [catDoc._id], options: [],
        variants: [{ sku: `${cat.store.slug.replace(/-/g, "").toUpperCase().slice(0, 6)}-${n}`, optionValues: {}, priceMinor: bdt * 100, compareAtMinor: compareAt ? compareAt * 100 : undefined, initialStock: stock }],
      });
      let publicId = uploaded.get(photo);
      if (!publicId) { publicId = await upload(actor.vendorId.toHexString(), photo); uploaded.set(photo, publicId); }
      await updateProduct(vActor, new ObjectId(product.id), { media: [{ publicId }] });
      await submitForReview(vActor, new ObjectId(product.id));
      await moderateProduct(admin, new ObjectId(product.id), "published", undefined);
      made++;
    }
  }
  console.log(`  ${cat.store.name} / ${cat.name}: +${made}`);
}

// Pexels is searched sequentially up front (rate limits), then stores are seeded a few at a time.
for (const t of Object.values(PRODUCT_TYPES).slice(0, target)) for (const [, term] of t) await photosFor(term);
const queue = BULK_CATEGORIES.map((_, i) => i).slice(0, target);
await Promise.all(Array.from({ length: 4 }, async () => { for (let i = queue.shift(); i !== undefined; i = queue.shift()) await seedCategory(i); }));

console.log(`done. published products=${await c.products.countDocuments({ status: "published" })}`);
await closeClient();
