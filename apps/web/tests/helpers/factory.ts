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

// ---------- catalog helpers ----------
import { call } from "./http";
import { createCategoryHandler, approveProductHandler } from "@/server/api/handlers/catalog";
import { createProductHandler, patchProductHandler, submitReviewHandler } from "@/server/api/handlers/vendor-catalog";
import { FakeMediaProvider, setMediaProvider, vendorMediaFolder } from "@/server/modules/media/cloudinary";

export const media = new FakeMediaProvider();

export function useFakeMedia() {
  setMediaProvider(media);
}

export async function makeCategory(admin: { token: string }, name = uniq("Cat"), parentId?: string) {
  const r = await call(createCategoryHandler, { method: "POST", token: admin.token, body: { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), parentId } });
  if (r.status !== 201) throw new Error("category failed: " + JSON.stringify(r.json));
  return r.data as { id: string; slug: string; name: string };
}

export interface ProductSpec {
  title?: string;
  priceMinor?: number;
  stock?: number;
  categoryId: string;
  variants?: { sku: string; optionValues?: Record<string, string>; priceMinor: number; initialStock: number }[];
  options?: { name: string; values: string[] }[];
  publish?: boolean;
  admin?: { token: string };
}

/** Creates a product through the real API; optionally runs the whole review -> publish flow. */
export async function makeProduct(vendor: { user: { token: string }; vendorId: ObjectId }, spec: ProductSpec) {
  const sku = uniq("SKU").toUpperCase();
  const r = await call(createProductHandler, {
    method: "POST", token: vendor.user.token,
    body: {
      title: spec.title ?? "Cotton T-Shirt " + sku, description: "A comfortable everyday cotton t-shirt.", categoryIds: [spec.categoryId],
      options: spec.options ?? [],
      variants: spec.variants ?? [{ sku, optionValues: {}, priceMinor: spec.priceMinor ?? 150000, initialStock: spec.stock ?? 10 }],
    },
  });
  if (r.status !== 201) throw new Error("product create failed: " + JSON.stringify(r.json));
  const product = r.data;
  if (spec.publish) {
    const publicId = `${vendorMediaFolder(vendor.vendorId.toHexString())}/${uniq("img")}`;
    media.assets.add(publicId);
    const p = await call(patchProductHandler, { method: "PATCH", token: vendor.user.token, params: { id: product.id }, body: { media: [{ publicId }] } });
    if (p.status !== 200) throw new Error("media failed: " + JSON.stringify(p.json));
    const s = await call(submitReviewHandler, { method: "POST", token: vendor.user.token, params: { id: product.id } });
    if (s.status !== 200) throw new Error("submit failed: " + JSON.stringify(s.json));
    const admin = spec.admin ?? (await makeAdmin());
    const a = await call(approveProductHandler, { method: "POST", token: admin.token, params: { id: product.id } });
    if (a.status !== 200) throw new Error("approve failed: " + JSON.stringify(a.json));
    return a.data as typeof product;
  }
  return product;
}
