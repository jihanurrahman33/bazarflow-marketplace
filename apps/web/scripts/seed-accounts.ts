/**
 * Creates one customer, one approved seller (with a store) and one full-permission admin from env credentials.
 * Idempotent. The 12-character password rule of seed.ts is enforced at sign-up by the API; this script is for
 * demo/staging only, so do not use weak passwords against a real storefront.
 * Env: SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD (an existing admin used to approve the seller),
 *      NEW_CUSTOMER_EMAIL/PASSWORD, NEW_VENDOR_EMAIL/PASSWORD, NEW_ADMIN_EMAIL/PASSWORD.
 */
import { loadDotEnv } from "./_env";
loadDotEnv();

const { ObjectId } = await import("mongodb");
const { getCollections } = await import("../src/server/db/collections");
const { closeClient } = await import("../src/server/db/client");
const { hashPassword } = await import("../src/server/modules/identity/password");
const { PERMISSIONS } = await import("../src/server/modules/authorization/permissions");
const { registerUser, login, authenticateAccessToken } = await import("../src/server/modules/identity/service");
const { applyAsVendor, approveApplication } = await import("../src/server/modules/vendors/service");
const { newId } = await import("../src/server/shared/ids");

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

async function ensureCustomer(email: string, password: string, name: string) {
  if (await c.users.findOne({ emailNormalized: email.toLowerCase() })) return false;
  await registerUser({ email, password, name, device });
  await c.users.updateOne({ emailNormalized: email.toLowerCase() }, { $set: { emailVerifiedAt: new Date() } });
  return true;
}

// customer
const customerEmail = need("NEW_CUSTOMER_EMAIL");
console.log((await ensureCustomer(customerEmail, need("NEW_CUSTOMER_PASSWORD"), "Demo Customer")) ? `customer created: ${customerEmail}` : `customer exists: ${customerEmail}`);

// seller: customer -> application -> approval by an existing admin
const vendorEmail = need("NEW_VENDOR_EMAIL");
const vendorPassword = need("NEW_VENDOR_PASSWORD");
await ensureCustomer(vendorEmail, vendorPassword, "Demo Seller");
const vendorUser = await c.users.findOne({ emailNormalized: vendorEmail.toLowerCase() });
if (vendorUser?.role === "customer") {
  const adminActor = await authenticateAccessToken((await login({ email: need("SEED_ADMIN_EMAIL"), password: need("SEED_ADMIN_PASSWORD"), device })).tokens.accessToken);
  const seller = await authenticateAccessToken((await login({ email: vendorEmail, password: vendorPassword, device })).tokens.accessToken);
  const app = await applyAsVendor(seller, {
    business: { name: "Bazar Demo Store", slug: "bazar-demo-store", phone: "+8801755000004", address: "House 3, Road 9, Gulshan, Dhaka", description: "Demo seller account for trying the seller console." },
    documents: [],
  });
  await approveApplication(adminActor, new ObjectId(app.id));
  console.log(`seller created and approved: ${vendorEmail}`);
} else console.log(`seller exists: ${vendorEmail} (${vendorUser?.role})`);

// admin: all permissions
const adminEmail = need("NEW_ADMIN_EMAIL");
const now = new Date();
const res = await c.users.updateOne(
  { emailNormalized: adminEmail.toLowerCase() },
  {
    $setOnInsert: {
      _id: newId(), email: adminEmail, emailNormalized: adminEmail.toLowerCase(), passwordHash: await hashPassword(need("NEW_ADMIN_PASSWORD")), name: "Admin",
      role: "admin", permissions: [...PERMISSIONS], status: "active", emailVerifiedAt: now, failedLoginCount: 0, createdAt: now, updatedAt: now,
    },
  },
  { upsert: true },
);
console.log(res.upsertedCount ? `admin created: ${adminEmail}` : `admin exists: ${adminEmail}`);
await closeClient();
