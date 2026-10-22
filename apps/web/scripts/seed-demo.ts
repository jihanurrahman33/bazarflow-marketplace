/**
 * Demo data: categories, customers, three approved vendors and published products with real Cloudinary images.
 * Goes through the same services the API uses, so everything is valid. Idempotent: re-running skips what exists.
 * Needs the usual env (MONGODB_URI, secrets, CLOUDINARY_*) plus SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
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
const { getMediaProvider, vendorMediaFolder } = await import("../src/server/modules/media/cloudinary");

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

// ---------- vendors and products ----------
type P = { title: string; description: string; cat: string; img: string; price: number; compareAt?: number; options?: { name: string; values: string[] }[]; stock: number };
const vendors: { local: string; owner: string; name: string; slug: string; phone: string; address: string; description: string; products: P[] }[] = [
  {
    local: "urban.threads", owner: "Mahmud Hossain", name: "Urban Threads", slug: "urban-threads", phone: "+8801722000001",
    address: "House 12, Road 5, Dhanmondi, Dhaka", description: "Everyday clothing in breathable cotton, cut for Dhaka summers.",
    products: [
      { title: "Classic Cotton T-Shirt", description: "Soft combed-cotton crew neck t-shirt. Pre-shrunk and machine washable.", cat: "fashion", img: "Cotton+T-Shirt", price: 59900, compareAt: 79900, options: [{ name: "Size", values: ["M", "L", "XL"] }], stock: 25 },
      { title: "Slim Fit Denim Jeans", description: "Stretch denim with a slim, tapered leg. Five-pocket styling.", cat: "fashion", img: "Denim+Jeans", price: 189900, options: [{ name: "Size", values: ["30", "32", "34"] }], stock: 15 },
      { title: "Printed Panjabi", description: "Lightweight cotton panjabi with a subtle block print. Ideal for Eid and weddings.", cat: "fashion", img: "Printed+Panjabi", price: 249900, compareAt: 299900, options: [{ name: "Size", values: ["M", "L", "XL"] }], stock: 12 },
      { title: "Canvas Tote Bag", description: "Sturdy 12 oz canvas tote with an inner zip pocket.", cat: "fashion", img: "Canvas+Tote", price: 79900, stock: 40 },
      { title: "Hooded Sweatshirt", description: "Fleece-lined pullover hoodie, ribbed cuffs, kangaroo pocket.", cat: "fashion", img: "Hoodie", price: 229900, options: [{ name: "Size", values: ["M", "L"] }], stock: 18 },
    ],
  },
  {
    local: "tech.bazar", owner: "Sabbir Ahmed", name: "Tech Bazar BD", slug: "tech-bazar-bd", phone: "+8801733000002",
    address: "Level 3, Bashundhara City, Panthapath, Dhaka", description: "Phone accessories and small electronics with a 6-month seller warranty.",
    products: [
      { title: "20W USB-C Fast Charger", description: "Compact GaN wall charger with USB-C Power Delivery. Includes a 1 m cable.", cat: "electronics", img: "20W+Charger", price: 129900, compareAt: 159900, stock: 60 },
      { title: "Wireless Earbuds", description: "Bluetooth 5.3 earbuds with a charging case and up to 20 hours of total playtime.", cat: "electronics", img: "Earbuds", price: 349900, options: [{ name: "Colour", values: ["Black", "White"] }], stock: 30 },
      { title: "10000mAh Power Bank", description: "Slim power bank with dual output and LED level indicator.", cat: "electronics", img: "Power+Bank", price: 219900, stock: 35 },
      { title: "Braided Charging Cable (2 m)", description: "Tangle-free nylon braided USB-C cable rated for fast charging.", cat: "electronics", img: "USB-C+Cable", price: 39900, options: [{ name: "Colour", values: ["Black", "Grey", "Red"] }], stock: 80 },
      { title: "Adjustable Phone Stand", description: "Aluminium desk stand with adjustable angle. Fits phones and small tablets.", cat: "electronics", img: "Phone+Stand", price: 69900, stock: 45 },
    ],
  },
  {
    local: "desher.ghor", owner: "Rokeya Begum", name: "Desher Ghor", slug: "desher-ghor", phone: "+8801744000003",
    address: "Plot 7, Zindabazar, Sylhet", description: "Home essentials and pantry staples sourced directly from local producers.",
    products: [
      { title: "Pure Mustard Oil (1 L)", description: "Cold-pressed kachi ghani mustard oil. Strong aroma, ideal for cooking and bhorta.", cat: "grocery", img: "Mustard+Oil", price: 52000, stock: 70 },
      { title: "Premium Basmati Rice", description: "Aged long-grain basmati rice.", cat: "grocery", img: "Basmati+Rice", price: 69000, options: [{ name: "Pack", values: ["1 kg", "5 kg"] }], stock: 50 },
      { title: "Handwoven Jute Rug", description: "Natural jute rug, handwoven by artisans in Bogura. Durable and easy to clean.", cat: "home-living", img: "Jute+Rug", price: 189000, options: [{ name: "Size", values: ["2x3 ft", "4x6 ft"] }], stock: 14 },
      { title: "Terracotta Planter Set", description: "Set of three hand-finished terracotta planters with drainage holes.", cat: "home-living", img: "Planter+Set", price: 99000, compareAt: 129000, stock: 22 },
      { title: "Cotton Bed Sheet Set", description: "Double bed sheet with two pillow covers in 180-thread-count cotton.", cat: "home-living", img: "Bed+Sheet", price: 159000, options: [{ name: "Colour", values: ["Blue", "Beige"] }], stock: 20 },
    ],
  },
];

const media = getMediaProvider();
async function uploadImage(vendorId: string, text: string): Promise<string> {
  const auth = media.authorizeUpload(vendorMediaFolder(vendorId));
  const form = new FormData();
  form.set("file", `https://placehold.co/900x900/png?text=${text}`);
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
    const publicId = await uploadImage(vendorId.toHexString(), p.img);
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
