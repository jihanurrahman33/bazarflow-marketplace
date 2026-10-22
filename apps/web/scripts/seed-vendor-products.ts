/**
 * Adds published demo products with real photos (Unsplash, copied into Cloudinary) to ONE seller's store.
 * Idempotent by product title. Goes through the same services the API uses.
 * Env: VENDOR_EMAIL, VENDOR_PASSWORD (the seller), SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD (an admin who approves the listings).
 */
import { loadDotEnv } from "./_env";
loadDotEnv();

const { ObjectId } = await import("mongodb");
const { getCollections } = await import("../src/server/db/collections");
const { closeClient } = await import("../src/server/db/client");
const { login, authenticateAccessToken } = await import("../src/server/modules/identity/service");
const { createProduct, updateProduct, submitForReview, moderateProduct } = await import("../src/server/modules/catalog/products");
const { getMediaProvider, vendorMediaFolder } = await import("../src/server/modules/media/cloudinary");

const need = (k: string): string => {
  const v = process.env[k];
  if (!v) {
    console.error(`Missing ${k}`);
    process.exit(1);
  }
  return v;
};
const device = { platform: "seed" };
const c = await getCollections();
const admin = await authenticateAccessToken((await login({ email: need("SEED_ADMIN_EMAIL"), password: need("SEED_ADMIN_PASSWORD"), device })).tokens.accessToken);
const seller = await authenticateAccessToken((await login({ email: need("VENDOR_EMAIL"), password: need("VENDOR_PASSWORD"), device })).tokens.accessToken);
if (!seller.vendorId) throw new Error("That account has no approved store.");
const vActor = { ...seller, vendorId: seller.vendorId };

const cat = async (slug: string) => {
  const x = await c.categories.findOne({ slug });
  if (!x) throw new Error(`category ${slug} missing`);
  return x._id;
};
const unsplash = (id: string) => `https://images.unsplash.com/photo-${id}?w=1200&h=1200&fit=crop&q=80&auto=format`;

type P = { title: string; description: string; cat: string; photo: string; price: number; compareAt?: number; options?: { name: string; values: string[] }[]; stock: number };
const products: P[] = [
  { title: "Everyday Laptop Backpack", description: "Water-resistant polyester backpack with a padded laptop sleeve, front zip pocket and comfortable shoulder straps. Fits up to 15-inch laptops.", cat: "fashion", photo: "1553062407-98eeb64c6a62", price: 189900, compareAt: 239900, stock: 30 },
  { title: "Minimal Black Daypack", description: "Clean, lightweight daypack with a zip front pocket and a roomy main compartment, made for commutes and weekend trips.", cat: "fashion", photo: "1581605405669-fcdf81165afa", price: 149900, stock: 25 },
  { title: "Rose Gold Leather Strap Watch", description: "Slim analogue watch with a rose-gold case, white dial and soft leather strap. Quartz movement, everyday water resistance.", cat: "fashion", photo: "1524592094714-0f0654e20314", price: 249900, compareAt: 329900, stock: 18 },
  { title: "Teal Suede Derby Shoes", description: "Hand-finished suede derby shoes with a stacked sole and cushioned insole. Smart enough for the office, relaxed enough for the weekend.", cat: "fashion", photo: "1560343090-f0409e92791a", price: 459900, compareAt: 559900, options: [{ name: "Size", values: ["40", "41", "42", "43"] }], stock: 10 },
  { title: "Black Performance Trainers", description: "Lightweight trainers with a breathable upper and a flexible, grippy outsole for the gym or the road.", cat: "fashion", photo: "1491553895911-0055eca6402d", price: 349900, options: [{ name: "Size", values: ["40", "41", "42", "43"] }], stock: 14 },
  { title: "Makeup Brush and Palette Set", description: "Everyday makeup set with soft brushes, a bronzer palette, lip colour and a scrunchie — a ready-made gift.", cat: "fashion", photo: "1596462502278-27bfdc403348", price: 129900, compareAt: 169900, stock: 35 },
  { title: "Slim Wireless Keyboard", description: "Low-profile wireless keyboard with quiet keys and a rechargeable battery. Pairs over Bluetooth with laptops, tablets and phones.", cat: "electronics", photo: "1587829741301-dc798b83add3", price: 219900, stock: 22 },
  { title: "Wireless Optical Mouse", description: "Comfortable ergonomic wireless mouse with a precise optical sensor and long battery life.", cat: "electronics", photo: "1527864550417-7fd91fc51a46", price: 69900, compareAt: 89900, stock: 50 },
];

const media = getMediaProvider();
async function uploadImage(vendorId: string, photo: string): Promise<string> {
  const auth = media.authorizeUpload(vendorMediaFolder(vendorId));
  const form = new FormData();
  form.set("file", unsplash(photo));
  form.set("api_key", auth.apiKey);
  form.set("timestamp", String(auth.timestamp));
  form.set("signature", auth.signature);
  form.set("folder", auth.folder);
  form.set("allowed_formats", auth.allowedFormats);
  const res = await fetch(auth.uploadUrl, { method: "POST", body: form });
  const body = (await res.json()) as { public_id?: string; error?: { message: string } };
  if (!res.ok || !body.public_id) throw new Error(`upload failed: ${body.error?.message ?? res.status}`);
  return body.public_id;
}

const have = new Set((await c.products.find({ vendorId: vActor.vendorId }, { projection: { title: 1 } }).toArray()).map((p) => p.title));
for (const [i, p] of products.entries()) {
  if (have.has(p.title)) continue;
  const options = p.options ?? [];
  const combos = options.length ? options[0]!.values.map((val) => ({ [options[0]!.name]: val })) : [{}];
  const product = await createProduct(vActor, {
    title: p.title, description: p.description, categoryIds: [await cat(p.cat)], options,
    variants: combos.map((optionValues, k) => ({ sku: `BDS-${i + 1}${options.length ? `-${k + 1}` : ""}`, optionValues, priceMinor: p.price, compareAtMinor: p.compareAt, initialStock: p.stock })),
  });
  const publicId = await uploadImage(vActor.vendorId.toHexString(), p.photo);
  await updateProduct(vActor, new ObjectId(product.id), { media: [{ publicId }] });
  await submitForReview(vActor, new ObjectId(product.id));
  await moderateProduct(admin, new ObjectId(product.id), "published", undefined);
  console.log(`  published: ${p.title}`);
}
console.log(`done. store now has ${await c.products.countDocuments({ vendorId: vActor.vendorId, status: "published" })} published products`);
await closeClient();
