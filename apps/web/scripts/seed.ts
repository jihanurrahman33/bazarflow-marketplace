import { loadDotEnv } from "./_env";
loadDotEnv();

const { getCollections } = await import("../src/server/db/collections");
const { closeClient } = await import("../src/server/db/client");
const { hashPassword } = await import("../src/server/modules/identity/password");
const { PERMISSIONS } = await import("../src/server/modules/authorization/permissions");
const { newId } = await import("../src/server/shared/ids");

const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;
if (!email || !password || password.length < 12) {
  console.error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (>= 12 chars) to create the first admin.");
  process.exit(1);
}

const c = await getCollections();
const now = new Date();
const res = await c.users.updateOne(
  { emailNormalized: email.toLowerCase() },
  {
    $setOnInsert: {
      _id: newId(), email, emailNormalized: email.toLowerCase(), passwordHash: await hashPassword(password), name: "Platform Admin",
      role: "admin", permissions: [...PERMISSIONS], status: "active", emailVerifiedAt: now, failedLoginCount: 0, createdAt: now, updatedAt: now,
    },
  },
  { upsert: true },
);
console.log(res.upsertedCount ? `admin created: ${email}` : `admin already exists: ${email}`);
await closeClient();
