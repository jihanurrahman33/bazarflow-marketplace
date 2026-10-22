/**
 * Bulk demo structure: 30 categories, 30 approved stores (one per category) and 40 demo customers, all created through the
 * real services. Idempotent. Needs the usual env + SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD. Demo/staging only (example.com accounts).
 */
import { loadDotEnv } from "./_env";
loadDotEnv();

const { ObjectId } = await import("mongodb");
const { getCollections } = await import("../src/server/db/collections");
const { closeClient } = await import("../src/server/db/client");
const { registerUser, login, authenticateAccessToken } = await import("../src/server/modules/identity/service");
const { applyAsVendor, approveApplication } = await import("../src/server/modules/vendors/service");
const { createCategory } = await import("../src/server/modules/catalog/categories");
const { BULK_CATEGORIES, BULK_CUSTOMERS } = await import("./bulk-data");

const PASSWORD = "Demo-Pass-2026!";
const device = { platform: "seed" };
const c = await getCollections();
const admin = await authenticateAccessToken((await login({ email: process.env.SEED_ADMIN_EMAIL!, password: process.env.SEED_ADMIN_PASSWORD!, device })).tokens.accessToken);
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");

async function ensureUser(email: string, name: string, phone: string) {
  if (await c.users.findOne({ emailNormalized: email })) return;
  await registerUser({ email, password: PASSWORD, name, phone, device });
  await c.users.updateOne({ emailNormalized: email }, { $set: { emailVerifiedAt: new Date() } });
}

const base = await c.categories.countDocuments();
for (const [i, cat] of BULK_CATEGORIES.entries()) {
  if (await c.categories.findOne({ slug: cat.slug })) continue;
  await createCategory(admin, { name: cat.name, slug: cat.slug, sortOrder: (base + i + 1) * 10 });
  console.log(`  category: ${cat.name}`);
}

for (const [i, cat] of BULK_CATEGORIES.entries()) {
  const s = cat.store;
  const email = `demo.store.${s.slug.replace(/-/g, ".")}@example.com`;
  await ensureUser(email, s.owner, `+88017${String(5000000 + i).padStart(8, "0")}`);
  const user = await c.users.findOne({ emailNormalized: email });
  if (user?.role === "customer") {
    const actor = await authenticateAccessToken((await login({ email, password: PASSWORD, device })).tokens.accessToken);
    const app = await applyAsVendor(actor, { business: { name: s.name, slug: s.slug, phone: `+88018${String(5000000 + i).padStart(8, "0")}`, address: `${s.city}, Bangladesh`, description: s.blurb }, documents: [] });
    await approveApplication(admin, new ObjectId(app.id));
    console.log(`  store: ${s.name}`);
  }
}

for (const [i, name] of BULK_CUSTOMERS.entries()) await ensureUser(`demo.customer.${slugify(name)}@example.com`, name, `+88016${String(1000000 + i).padStart(8, "0")}`);

const [cats, vendors, users] = await Promise.all([c.categories.countDocuments(), c.vendors.countDocuments({ status: "active" }), c.users.countDocuments()]);
console.log(`done. categories=${cats} active stores=${vendors} users=${users}`);
await closeClient();
