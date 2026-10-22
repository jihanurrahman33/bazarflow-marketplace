import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { setupTestDb, teardownTestDb } from "./helpers/db";
import { call } from "./helpers/http";
import { installFakeMedia, makeAdmin, makeCategory, makeCustomer, makeProduct, makeVendor } from "./helpers/factory";
import { reviewFlagsHandler } from "@/server/api/handlers/commerce-ops";
import { getCollections } from "@/server/db/collections";
import type { ReviewDoc } from "@/server/db/schema";

let admin: Awaited<ReturnType<typeof makeAdmin>>;
let vendor: Awaited<ReturnType<typeof makeVendor>>;
let cat: { id: string };

beforeAll(async () => {
  await setupTestDb();
  installFakeMedia();
  admin = await makeAdmin();
  cat = await makeCategory(admin);
  vendor = await makeVendor();
});
afterAll(teardownTestDb);

const review = (productId: string, userId: ObjectId, rating: number, when: Date): ReviewDoc => ({
  _id: new ObjectId(), productId: new ObjectId(productId), vendorId: vendor.vendorId, userId, vendorOrderId: new ObjectId(), rating, body: "Nice product, would buy again.", status: "published", createdAt: when,
});
const flags = async () => (await call(reviewFlagsHandler, { token: admin.token })).data as { kind: string; product?: { id: string }; reviews: unknown[] }[];

describe("review checks", () => {
  it("flags a burst of reviews from brand-new accounts, but not ordinary reviews from established ones", async () => {
    const c = await getCollections();
    const hot = await makeProduct(vendor, { categoryId: cat.id, publish: true, admin });
    const calm = await makeProduct(vendor, { categoryId: cat.id, publish: true, admin });
    const fresh = await Promise.all(Array.from({ length: 6 }, () => makeCustomer()));
    await c.reviews.insertMany(fresh.map((u) => review(hot.id, u.id, 5, new Date())));
    const old = await Promise.all(Array.from({ length: 3 }, () => makeCustomer()));
    await c.users.updateMany({ _id: { $in: old.map((u) => u.id) } }, { $set: { createdAt: new Date(Date.now() - 90 * 86_400_000) } });
    await c.reviews.insertMany(old.map((u, i) => review(calm.id, u.id, [5, 4, 3][i]!, new Date())));

    const found = await flags();
    const burst = found.find((f) => f.kind === "burst_from_new_accounts" && f.product?.id === hot.id);
    expect(burst).toBeTruthy();
    expect(burst!.reviews).toHaveLength(6);
    expect(found.some((f) => f.product?.id === calm.id)).toBe(false);
  });

  it("flags one account posting many reviews in a day", async () => {
    const c = await getCollections();
    const u = await makeCustomer();
    await c.reviews.insertMany(Array.from({ length: 8 }, () => review(new ObjectId().toHexString(), u.id, 5, new Date())));
    const found = await flags();
    expect(found.some((f) => f.kind === "one_account_many_reviews" && f.reviews.length === 8)).toBe(true);
  });

  it("flags a product whose recent praise is nearly all 5-star from new accounts", async () => {
    const c = await getCollections();
    const p = await makeProduct(vendor, { categoryId: cat.id, publish: true, admin });
    const users = await Promise.all(Array.from({ length: 10 }, () => makeCustomer()));
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
    await c.users.updateMany({ _id: { $in: users.slice(7).map((x) => x.id) } }, { $set: { createdAt: new Date(Date.now() - 200 * 86_400_000) } });
    await c.reviews.insertMany(users.map((x) => review(p.id, x.id, 5, threeDaysAgo)));
    const found = await flags();
    expect(found.some((f) => f.kind === "new_account_praise" && f.product?.id === p.id)).toBe(true);
    expect(found.some((f) => f.kind === "burst_from_new_accounts" && f.product?.id === p.id)).toBe(false); // spread over days, not a 24-hour burst
  });

  it("is for staff with moderation rights only", async () => {
    const shopper = await makeCustomer();
    expect((await call(reviewFlagsHandler, { token: shopper.token })).status).toBe(403);
    expect((await call(reviewFlagsHandler, { token: vendor.user.token })).status).toBe(403);
    expect((await call(reviewFlagsHandler, {})).status).toBe(401);
  });
});
