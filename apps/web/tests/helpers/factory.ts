import { getCollections } from "@/server/db/collections";
import { hashPassword } from "@/server/modules/identity/password";
import { login } from "@/server/modules/identity/service";
import { newId } from "@/server/shared/ids";
import { ObjectId } from "mongodb";
import { applyAsVendor, approveApplication } from "@/server/modules/vendors/service";
import { authenticateAccessToken } from "@/server/modules/identity/service";
import { PERMISSIONS } from "@/server/modules/authorization/permissions";
import type { Role } from "@/server/db/schema";

export const PASSWORD = "correct-horse-battery";
let seq = 0;
export const uniq = (p = "u") => `${p}${Date.now().toString(36)}${++seq}`;

export interface TestUser {
  id: ObjectId;
  email: string;
  token: string;
  refreshToken: string;
}

export async function makeUser(opts: { role?: Role; permissions?: readonly string[]; verified?: boolean; vendorId?: ObjectId } = {}): Promise<TestUser> {
  const c = await getCollections();
  const now = new Date();
  const email = `${uniq()}@example.com`;
  const _id = newId();
  await c.users.insertOne({
    _id, email, emailNormalized: email, passwordHash: await hashPassword(PASSWORD), name: "Test " + (opts.role ?? "customer"),
    role: opts.role ?? "customer", permissions: [...(opts.permissions ?? [])], status: "active", failedLoginCount: 0,
    emailVerifiedAt: opts.verified === false ? undefined : now, vendorId: opts.vendorId, createdAt: now, updatedAt: now,
  });
  const { tokens } = await login({ email, password: PASSWORD, device: { platform: "android" } });
  return { id: _id, email, token: tokens.accessToken, refreshToken: tokens.refreshToken };
}

export const makeCustomer = (verified = true) => makeUser({ role: "customer", verified });
export const makeAdmin = (permissions: readonly string[] = PERMISSIONS) => makeUser({ role: "admin", permissions });

/** Customer -> application -> admin approval -> fresh login as vendor. */
export async function makeVendor(opts: { name?: string; slug?: string } = {}) {
  const customer = await makeCustomer();
  const admin = await makeAdmin();
  const slug = opts.slug ?? uniq("shop").toLowerCase();
  const customerActor = await authenticateAccessToken(customer.token);
  const app = await applyAsVendor(customerActor, {
    business: { name: opts.name ?? "Shop " + slug, slug, phone: "+8801700000000", address: "House 1, Road 2, Dhaka" },
    documents: [],
  });
  const adminActor = await authenticateAccessToken(admin.token);
  const vendor = await approveApplication(adminActor, new ObjectId(app.id));
  const c = await getCollections();
  const user = await c.users.findOne({ _id: customer.id });
  const { tokens } = await login({ email: user!.email, password: PASSWORD, device: { platform: "android" } });
  return { user: { ...customer, token: tokens.accessToken }, vendorId: new ObjectId(vendor.id), slug, vendor };
}
