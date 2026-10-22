/**
 * Bulk demo reviews for the bulk catalogue, produced the honest way (see seed-reviews.ts): every review comes from a real order
 * that was paid through the mock provider, shipped and delivered. 2-4 reviews per product from distinct demo customers.
 * Idempotent: a customer is never given a second review for a product. Demo/staging only.
 * Env: SEED_ADMIN_* not needed. REVIEWS_CONCURRENCY (default 4), REVIEW_CUSTOMER_LIMIT (default all).
 */
import { loadDotEnv } from "./_env";
loadDotEnv();

const { ObjectId } = await import("mongodb");
const { getCollections } = await import("../src/server/db/collections");
const { closeClient } = await import("../src/server/db/client");
const { login, authenticateAccessToken } = await import("../src/server/modules/identity/service");
const { createAddress, listAddresses } = await import("../src/server/modules/addresses/service");
const { addItem, clearCart, getCart } = await import("../src/server/modules/cart/service");
const { placeOrder } = await import("../src/server/modules/checkout/service");
const { getAdapterForWebhook } = await import("../src/server/modules/payments/registry");
const { applyVerifiedEvent, initiatePayment } = await import("../src/server/modules/payments/service");
const { mockGateway } = await import("../src/server/modules/payments/mock");
const { transitionVendorOrder } = await import("../src/server/modules/orders/fulfillment");
const { createReview } = await import("../src/server/modules/reviews/service");
const { BULK_CUSTOMERS } = await import("./bulk-data");

const PASSWORD = "Demo-Pass-2026!";
const device = { platform: "seed" };
const c = await getCollections();
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
const hash = (s: string) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; };
const pick = <T,>(arr: T[], key: string): T => arr[Math.floor(hash(key) * arr.length) % arr.length]!;

// ---- review wording: assembled from parts so 1,500 reviews do not read as copies ----
const OPEN: Record<number, string[]> = {
  5: ["Really happy with this {n}.", "Exactly what I was hoping for.", "Great {n}, no complaints.", "Better than I expected.", "Very pleased with this purchase.", "Solid {n} for the price.", "Would happily buy this again."],
  4: ["Good {n} overall.", "Pretty happy with this {n}.", "Does what it should.", "A good buy for the price.", "Nice {n}, just a couple of small things.", "Happy with it so far."],
  3: ["It's an okay {n}.", "Decent, but not perfect.", "Average {n} for the price.", "Does the job, nothing special."],
  2: ["Not quite what I expected.", "The {n} is below what I hoped for.", "Disappointed with this {n}."],
  1: ["Not happy with this {n}.", "Would not recommend this {n}.", "This {n} did not work out for me."],
};
const MID: Record<number, string[]> = {
  5: ["The build feels sturdy and the finish is neat.", "It arrived well packed and exactly as pictured.", "Setup took no time and it has worked flawlessly.", "Quality is clearly better than similar ones I have tried.", "My whole family has been using it and everyone likes it.", "It feels like it will last a long time."],
  4: ["Build quality is good and it matches the photos.", "Works well and arrived on time.", "The finish could be a touch better but it performs well.", "It took a day or two to get used to, then it was fine."],
  3: ["Some parts feel a little cheap for the price.", "It works, but the finish is not as nice as the pictures.", "Delivery was fine; the product itself is just average."],
  2: ["The quality felt lower than the photos suggest.", "It works, but not as well as I had hoped."],
  1: ["It stopped working properly after a short while.", "The quality was far from what the listing suggested."],
};
const END: Record<number, string[]> = {
  5: ["Recommended.", "Delivery was quick too.", "Seller was responsive.", "Five stars from me.", "Packaging was careful.", ""],
  4: ["Would buy again.", "Good value.", "Delivery was prompt.", ""],
  3: ["Fair for the price.", "Might be fine for light use.", ""],
  2: ["Hope the next batch is better.", ""],
  1: ["Hoping for a better experience next time.", ""],
};
const HEAD: Record<number, string[]> = {
  5: ["Love it", "Excellent", "Worth it", "Great value", "Highly recommend", "Perfect"],
  4: ["Good buy", "Pretty good", "Happy with it", "Solid choice"],
  3: ["Okay for the price", "Decent", "Average"],
  2: ["Could be better", "Not great"],
  1: ["Disappointed", "Not good"],
};
function ratingFor(key: string): number {
  const f = hash(key);
  return f < 0.5 ? 5 : f < 0.8 ? 4 : f < 0.92 ? 3 : f < 0.97 ? 2 : 1;
}
function reviewFor(key: string, noun: string): { rating: number; title?: string; body: string } {
  const rating = ratingFor(key);
  const n = noun.toLowerCase();
  const body = [pick(OPEN[rating]!, key + "o"), pick(MID[rating]!, key + "m"), pick(END[rating]!, key + "e")].filter(Boolean).join(" ").replaceAll("{n}", n);
  return { rating, title: hash(key + "t") < 0.55 ? pick(HEAD[rating]!, key + "h") : undefined, body };
}

// ---- who reviews what ----
const customerEmails = BULK_CUSTOMERS.map((n) => `demo.customer.${slugify(n)}@example.com`);
const customerLimit = Number(process.env.REVIEW_CUSTOMER_LIMIT ?? customerEmails.length);
const stores = await c.users.find({ emailNormalized: /^demo\.store\./ }).toArray();
const vendorIds = stores.map((u) => u.vendorId).filter((v): v is NonNullable<typeof v> => !!v);
const vendors = await c.vendors.find({ _id: { $in: vendorIds }, status: "active" }).toArray();
const scopes = new Map(vendors.map((v) => [v._id.toHexString(), { kind: "vendor" as const, userId: v.ownerUserId, vendorId: v._id }]));
const products = await c.products.find({ vendorId: { $in: vendorIds }, status: "published" }).sort({ _id: 1 }).toArray();
console.log(`products=${products.length} stores=${vendors.length} customers=${customerLimit}`);

const plan = new Map<number, number[]>(); // customer index -> product indexes
products.forEach((_, p) => {
  const count = 2 + (p % 3); // 2-4 reviews each
  for (let k = 0; k < count; k++) { const ci = (p * 7 + k * 11) % customerEmails.length; if (ci < customerLimit) (plan.get(ci) ?? plan.set(ci, []).get(ci)!).push(p); }
});

const addr = { label: "Home", phone: "+8801712345678", line1: "House 5, Road 3, Dhanmondi", city: "Dhaka", district: "Dhaka", postalCode: "1205" };
const BATCH = 10;
let reviewed = 0, failed = 0;

async function shopFor(ci: number) {
  const email = customerEmails[ci]!;
  const user = await c.users.findOne({ emailNormalized: email });
  if (!user) { console.warn(`  missing customer ${email}`); return; }
  const actor = await authenticateAccessToken((await login({ email, password: PASSWORD, device })).tokens.accessToken);
  const done = new Set((await c.reviews.find({ userId: user._id }, { projection: { productId: 1 } }).toArray()).map((r) => r.productId.toHexString()));
  const todo = plan.get(ci)!.map((p) => products[p]!).filter((p) => !done.has(p._id.toHexString()));
  const addressId = (await listAddresses(user._id))[0]?.id ?? (await createAddress(user._id, { ...addr, recipient: user.name })).id;

  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    await clearCart(user._id);
    for (const p of batch) {
      const v = p.variants.find((x) => x.active) ?? p.variants[0];
      if (v) await addItem(user._id, { productId: p._id, variantId: v.variantId, quantity: 1 });
    }
    const cart = await getCart(user._id);
    if (cart.itemCount === 0) continue;
    const order = await placeOrder(actor, { addressId: new ObjectId(addressId), paymentMethod: "online", expectedTotalMinor: cart.totals.totalMinor });
    await initiatePayment(user._id, new ObjectId(order.id));
    const payment = await c.payments.findOne({ orderId: new ObjectId(order.id) });
    if (!payment) throw new Error(`payment missing for ${order.id}`);
    const adapter = getAdapterForWebhook("mock");
    const signed = mockGateway.signedEvent(payment.merchantReference, "succeeded");
    const event = await adapter.parseAndVerifyWebhook({ rawBody: signed.body, headers: new Headers(signed.headers), contentType: "application/json" });
    if ((await applyVerifiedEvent(adapter, event)) !== "applied") throw new Error("payment not applied");
    for (const vo of await c.vendorOrders.find({ parentOrderId: new ObjectId(order.id) }).toArray()) {
      const scope = scopes.get(vo.vendorId.toHexString());
      if (!scope) continue;
      await transitionVendorOrder(scope, vo._id, { to: "accepted" });
      await transitionVendorOrder(scope, vo._id, { to: "shipped", shipment: { carrier: "Pathao", trackingNumber: `PTH${Math.floor(hash(`${order.id}${vo._id}`) * 9e7 + 1e7)}` } });
      await transitionVendorOrder(scope, vo._id, { to: "delivered" });
    }
    for (const p of batch) {
      const noun = p.title.split(" ").slice(1).join(" ") || p.title;
      try { await createReview(actor, p.slug, reviewFor(`${email}|${p.slug}`, noun)); reviewed++; } catch (e) { failed++; console.warn(`  review failed: ${p.slug}: ${(e as Error).message}`); }
    }
  }
  console.log(`  ${user.name}: done (${reviewed} reviews so far)`);
}

const queue = [...plan.keys()];
await Promise.all(Array.from({ length: Number(process.env.REVIEWS_CONCURRENCY ?? 4) }, async () => {
  for (let ci = queue.shift(); ci !== undefined; ci = queue.shift()) {
    try { await shopFor(ci); } catch (e) { failed++; console.warn(`  customer ${ci} stopped: ${(e as Error).message}`); }
  }
}));

console.log(`done. new reviews=${reviewed} failed=${failed} total reviews=${await c.reviews.countDocuments({ status: "published" })}`);
await closeClient();
