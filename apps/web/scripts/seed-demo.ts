/**
 * Demo data: categories, customers, three approved vendors, published products with real photos, and the storefront
 * banner images. Goes through the same services the API uses, so everything is valid. Idempotent: re-running skips what
 * exists (set RESET_DEMO_PRODUCTS=1 to delete the demo vendors' products and recreate them).
 * Needs the usual env (MONGODB_URI, secrets, CLOUDINARY_*) plus SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
 * Photos are from Unsplash (free to use, no attribution required); Cloudinary copies them, the site never hotlinks.
 * Demo accounts share DEMO_PASSWORD below and use @example.com addresses: never run this against a real storefront.
 */
import { loadDotEnv } from "./_env";
loadDotEnv();

const { ObjectId } = await import("mongodb");
const { getCollections } = await import("../src/server/db/collections");
const { closeClient } = await import("../src/server/db/client");
const { registerUser, login, authenticateAccessToken } = await import("../src/server/modules/identity/service");
const { applyAsVendor, approveApplication } = await import("../src/server/modules/vendors/service");
const { createCategory } = await import("../src/server/modules/catalog/categories");
const { createProduct, updateProduct, submitForReview, moderateProduct } = await import("../src/server/modules/catalog/products");
const { getMediaProvider, vendorMediaFolder, signParams } = await import("../src/server/modules/media/cloudinary");

const DEMO_PASSWORD = "Demo-Pass-2026!";
const device = { platform: "seed" };
const adminEmail = process.env.SEED_ADMIN_EMAIL;
const adminPassword = process.env.SEED_ADMIN_PASSWORD;
if (!adminEmail || !adminPassword) {
  console.error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (an existing admin) to run the demo seed.");
  process.exit(1);
}

const c = await getCollections();
const admin = await authenticateAccessToken((await login({ email: adminEmail, password: adminPassword, device })).tokens.accessToken);

async function ensureUser(email: string, name: string, phone: string) {
  if (!(await c.users.findOne({ emailNormalized: email }))) {
    await registerUser({ email, password: DEMO_PASSWORD, name, phone, device });
    await c.users.updateOne({ emailNormalized: email }, { $set: { emailVerifiedAt: new Date() } });
  }
}

// ---------- categories ----------
const categoryNames: Record<string, string> = {
  fashion: "Fashion", electronics: "Electronics", "home-living": "Home & Living", grocery: "Grocery & Food",
};
const category: Record<string, InstanceType<typeof ObjectId>> = {};
let sort = 0;
for (const [slug, name] of Object.entries(categoryNames)) {
  const existing = await c.categories.findOne({ slug });
  if (existing) category[slug] = existing._id;
  else category[slug] = new ObjectId((await createCategory(admin, { name, slug, sortOrder: sort }) as { id: string }).id);
  sort += 10;
}

// ---------- customers ----------
const customers = [
  ["rahim.uddin", "Rahim Uddin", "+8801711000001"], ["nusrat.jahan", "Nusrat Jahan", "+8801711000002"],
  ["tanvir.hasan", "Tanvir Hasan", "+8801711000003"], ["sadia.islam", "Sadia Islam", "+8801711000004"],
  ["imran.khan", "Imran Khan", "+8801711000005"], ["farhana.akter", "Farhana Akter", "+8801711000006"],
] as const;
for (const [local, name, phone] of customers) await ensureUser(`demo.${local}@example.com`, name, phone);

// ---------- storefront banner images (public ids are referenced from src/lib/site.ts) ----------
const mediaCfg = {
  cloud: process.env.CLOUDINARY_CLOUD_NAME!, key: process.env.CLOUDINARY_API_KEY!, secret: process.env.CLOUDINARY_API_SECRET!,
};
const unsplash = (id: string, w = 1200, h = 1200) => `https://images.unsplash.com/photo-${id}?w=${w}&h=${h}&fit=crop&q=80&auto=format`;

async function upload(file: string, fields: Record<string, string>): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const signed: Record<string, string | number> = { ...fields, timestamp };
  const form = new FormData();
  form.set("file", file);
  for (const [k, v] of Object.entries(signed)) form.set(k, String(v));
  form.set("api_key", mediaCfg.key);
  form.set("signature", signParams(signed, mediaCfg.secret));
  const res = await fetch(`https://api.cloudinary.com/v1_1/${mediaCfg.cloud}/image/upload`, { method: "POST", body: form });
  const body = (await res.json()) as { public_id?: string; error?: { message: string } };
  if (!res.ok || !body.public_id) throw new Error(`upload failed: ${body.error?.message ?? res.status}`);
  return body.public_id;
}

const siteAssets: Record<string, string> = {
  "hero-fashion": "1445205170230-053b83016050", "hero-tech": "1498049794561-7780e7231661", "hero-home": "1484101403633-562f891dc89a",
  "hero-grocery": "1542838132-92c53300491e", "hero-sale": "1607082348824-0a96f2a4b9da", "store-front": "1441986300917-64674bd600d8",
};
for (const [name, photo] of Object.entries(siteAssets)) {
  await upload(unsplash(photo, 2000, 1000), { public_id: `bazarflow/site/${name}`, overwrite: "true" });
  console.log(`  site asset: ${name}`);
}

// ---------- vendors and products ----------
type P = { title: string; description: string; cat: string; photo: string; price: number; compareAt?: number; options?: { name: string; values: string[] }[]; stock: number };
const vendors: { local: string; owner: string; name: string; slug: string; phone: string; address: string; description: string; products: P[] }[] = [
  {
    local: "urban.threads", owner: "Mahmud Hossain", name: "Urban Threads", slug: "urban-threads", phone: "+8801722000001",
    address: "House 12, Road 5, Dhanmondi, Dhaka", description: "Everyday clothing and footwear, cut for Dhaka summers.",
    products: [
      { title: "Classic White Cotton T-Shirt", description: "Soft combed-cotton crew neck t-shirt. Pre-shrunk, machine washable and made to be worn on repeat.", cat: "fashion", photo: "1521572163474-6864f9cf17ab", price: 59900, compareAt: 79900, options: [{ name: "Size", values: ["M", "L", "XL"] }], stock: 25 },
      { title: "Everyday Black Crew T-Shirt", description: "Midweight black t-shirt with a clean, relaxed fit. Colour-fast and breathable.", cat: "fashion", photo: "1583743814966-8936f5b7be1a", price: 64900, compareAt: 89900, options: [{ name: "Size", values: ["M", "L", "XL"] }], stock: 30 },
      { title: "Slim Fit Denim Jeans", description: "Stretch denim with a slim, tapered leg. Five-pocket styling in a washed finish.", cat: "fashion", photo: "1542272604-787c3835535d", price: 189900, compareAt: 239900, options: [{ name: "Size", values: ["30", "32", "34"] }], stock: 15 },
      { title: "Fleece Hooded Sweatshirt", description: "Heavy fleece-lined pullover hoodie with ribbed cuffs and a kangaroo pocket.", cat: "fashion", photo: "1556821840-3a63f95609a7", price: 229900, options: [{ name: "Size", values: ["M", "L"] }], stock: 18 },
      { title: "Red Mesh Running Sneakers", description: "Breathable knit upper, cushioned midsole and a grippy outsole for daily runs.", cat: "fashion", photo: "1542291026-7eec264c27ff", price: 389900, compareAt: 489900, options: [{ name: "Size", values: ["40", "41", "42", "43"] }], stock: 12 },
      { title: "Lightweight Street Sneakers", description: "Everyday sneakers with a soft cushioned sole and a clean two-tone design.", cat: "fashion", photo: "1600185365926-3a2ce3cdb9eb", price: 329900, options: [{ name: "Size", values: ["40", "41", "42"] }], stock: 14 },
      { title: "Polarised Aviator Sunglasses", description: "UV400 polarised lenses in a lightweight frame. Includes a protective case.", cat: "fashion", photo: "1572635196237-14b3f281503f", price: 129900, compareAt: 179900, stock: 40 },
      { title: "Natural Canvas Tote Bag", description: "Sturdy canvas tote with reinforced handles, roomy enough for groceries or a laptop.", cat: "fashion", photo: "1544816155-12df9643f363", price: 79900, stock: 40 },
    ],
  },
  {
    local: "tech.bazar", owner: "Sabbir Ahmed", name: "Tech Bazar BD", slug: "tech-bazar-bd", phone: "+8801733000002",
    address: "Level 3, Bashundhara City, Panthapath, Dhaka", description: "Audio, power and everyday gadgets with a 6-month seller warranty.",
    products: [
      { title: "20W USB-C Fast Charger", description: "Compact wall charger with USB-C Power Delivery for fast, safe charging.", cat: "electronics", photo: "1583863788434-e58a36330cf0", price: 129900, compareAt: 159900, stock: 60 },
      { title: "True Wireless Earbuds with Charging Case", description: "Bluetooth earbuds with a pocket charging case, clear calls and up to 20 hours of playtime.", cat: "electronics", photo: "1572569511254-d8f925fe2cbb", price: 349900, compareAt: 449900, options: [{ name: "Colour", values: ["White", "Black"] }], stock: 30 },
      { title: "10000mAh Slim Power Bank", description: "Pocket-friendly power bank with fast output and an LED level indicator.", cat: "electronics", photo: "1609091839311-d5365f9ff1c5", price: 219900, stock: 35 },
      { title: "Wireless Over-Ear Headphones", description: "Comfortable over-ear Bluetooth headphones with deep bass and 30-hour battery life.", cat: "electronics", photo: "1505740420928-5e560c06d30e", price: 259900, compareAt: 329900, stock: 25 },
      { title: "Studio Monitor Headphones", description: "Wired closed-back headphones with a detachable cable and foldable design.", cat: "electronics", photo: "1583394838336-acd977736f90", price: 179900, stock: 28 },
      { title: "Premium Noise-Cancelling Headphones", description: "Active noise cancellation, plush ear cushions and multi-device pairing.", cat: "electronics", photo: "1609081219090-a6d81d3085bf", price: 899900, compareAt: 1099900, stock: 10 },
      { title: "Minimalist Smart Watch", description: "Round-dial smart watch with a silicone strap, notifications and sleep tracking.", cat: "electronics", photo: "1523275335684-37898b6baf30", price: 459900, compareAt: 599900, stock: 20 },
    ],
  },
  {
    local: "desher.ghor", owner: "Rokeya Begum", name: "Desher Ghor", slug: "desher-ghor", phone: "+8801744000003",
    address: "Plot 7, Zindabazar, Sylhet", description: "Home essentials and pantry staples sourced directly from local producers.",
    products: [
      { title: "Cold-Pressed Cooking Oil (1 L)", description: "Cold-pressed oil with a rich aroma, ideal for everyday cooking and dressings.", cat: "grocery", photo: "1474979266404-7eaacbcd87c5", price: 52000, stock: 70 },
      { title: "Premium Long-Grain Basmati Rice", description: "Aged long-grain basmati rice that cooks fluffy and fragrant.", cat: "grocery", photo: "1586201375761-83865001e31c", price: 69000, options: [{ name: "Pack", values: ["1 kg", "5 kg"] }], stock: 50 },
      { title: "Fresh Vegetable Box (Weekly)", description: "A mixed box of seasonal vegetables picked fresh from local farms.", cat: "grocery", photo: "1542838132-92c53300491e", price: 89000, stock: 30 },
      { title: "Handwoven Patterned Area Rug", description: "Soft-pile rug with a classic border pattern. Easy to vacuum and spot-clean.", cat: "home-living", photo: "1600166898405-da9535204843", price: 189000, compareAt: 249000, options: [{ name: "Size", values: ["2x3 ft", "4x6 ft"] }], stock: 14 },
      { title: "Mint Ceramic Planter with Succulent", description: "Glazed ceramic planter with a hardy succulent included. Brightens any desk or shelf.", cat: "home-living", photo: "1485955900006-10f4d324d411", price: 49000, stock: 40 },
      { title: "Cotton Bed Linen Set", description: "Double bed sheet with two pillow covers in soft 180-thread-count cotton.", cat: "home-living", photo: "1522771739844-6a9f6d5f14af", price: 159000, compareAt: 199000, options: [{ name: "Colour", values: ["Navy", "Grey"] }], stock: 20 },
      { title: "Luxury King Bedding Set", description: "Layered bedding set with a quilted throw and decorative cushions for a hotel-style bedroom.", cat: "home-living", photo: "1505693416388-ac5ce068fe85", price: 549000, compareAt: 699000, stock: 8 },
    ],
  },
];

const media = getMediaProvider();
async function uploadProductImage(vendorId: string, photo: string): Promise<string> {
  const auth = media.authorizeUpload(vendorMediaFolder(vendorId));
  const form = new FormData();
  form.set("file", unsplash(photo, 1200, 1200));
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

for (const v of vendors) {
  const email = `demo.${v.local}@example.com`;
  await ensureUser(email, v.owner, v.phone);
  let user = await c.users.findOne({ emailNormalized: email });
  if (user?.role === "customer") {
    const customerActor = await authenticateAccessToken((await login({ email, password: DEMO_PASSWORD, device })).tokens.accessToken);
    const app = await applyAsVendor(customerActor, {
      business: { name: v.name, slug: v.slug, phone: v.phone, address: v.address, description: v.description }, documents: [],
    });
    await approveApplication(admin, new ObjectId(app.id));
    user = await c.users.findOne({ emailNormalized: email });
  }
  if (!user?.vendorId) throw new Error(`vendor missing for ${email}`);
  const vendorId = user.vendorId;
  const actor = await authenticateAccessToken((await login({ email, password: DEMO_PASSWORD, device })).tokens.accessToken);
  if (!actor.vendorId) throw new Error("actor has no vendor");
  const vActor = { ...actor, vendorId: actor.vendorId };

  if (process.env.RESET_DEMO_PRODUCTS === "1") {
    await c.inventoryMovements.deleteMany({ vendorId });
    await c.inventoryItems.deleteMany({ vendorId });
    await c.products.deleteMany({ vendorId });
  }
  const have = new Set((await c.products.find({ vendorId }, { projection: { title: 1 } }).toArray()).map((p) => p.title));
  for (const [i, p] of v.products.entries()) {
    if (have.has(p.title)) continue;
    const options = p.options ?? [];
    const combos = options.length ? options[0]!.values.map((val) => ({ [options[0]!.name]: val })) : [{}];
    const product = await createProduct(vActor, {
      title: p.title, description: p.description, categoryIds: [category[p.cat]!], options,
      variants: combos.map((optionValues, k) => ({
        sku: `${v.slug.toUpperCase().slice(0, 4)}-${i + 1}${options.length ? `-${k + 1}` : ""}`, optionValues,
        priceMinor: p.price, compareAtMinor: p.compareAt, initialStock: p.stock,
      })),
    });
    const publicId = await uploadProductImage(vendorId.toHexString(), p.photo);
    await updateProduct(vActor, new ObjectId(product.id), { media: [{ publicId }] });
    await submitForReview(vActor, new ObjectId(product.id));
    await moderateProduct(admin, new ObjectId(product.id), "published", undefined);
    console.log(`  published: ${v.name} / ${p.title}`);
  }
}

const [u, ven, prod] = await Promise.all([c.users.countDocuments(), c.vendors.countDocuments(), c.products.countDocuments({ status: "published" })]);
console.log(`done. users=${u} vendors=${ven} published products=${prod}`);
console.log(`demo accounts: demo.<name>@example.com / ${DEMO_PASSWORD}`);
await closeClient();
