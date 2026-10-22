/**
 * Demo reviews for ONE seller's products, produced the honest way: each demo customer places a real order, pays it
 * through the mock payment provider, the seller ships it and marks it delivered, and only then the customer reviews.
 * That makes every review a genuine "verified purchase" row in demo data. The accounts are @example.com demo users.
 * Idempotent: a customer is never given a second review (or order) for a product they already reviewed.
 * Demo/staging only: delete these accounts and orders before real shoppers arrive.
 * Env: VENDOR_EMAIL, VENDOR_PASSWORD, CUSTOMER_EMAIL, CUSTOMER_PASSWORD (extra demo customer), DEMO_PASSWORD (demo.* users).
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
const asActor = async (email: string, password: string) => authenticateAccessToken((await login({ email, password, device })).tokens.accessToken);

const seller = await asActor(need("VENDOR_EMAIL"), need("VENDOR_PASSWORD"));
if (!seller.vendorId) throw new Error("That account has no approved store.");
const scope = { kind: "vendor" as const, userId: seller.userId, vendorId: seller.vendorId };
const products = await c.products.find({ vendorId: seller.vendorId, status: "published" }).toArray();
const bySlugStart = (title: string) => products.find((p) => p.title === title);

type R = { rating: number; title?: string; body: string };
// customer -> [product title, review]
const demoPw = need("DEMO_PASSWORD");
const plan: { email: string; password: string; name: string; reviews: [string, R][] }[] = [
  { email: need("CUSTOMER_EMAIL"), password: need("CUSTOMER_PASSWORD"), name: "Demo Customer", reviews: [
    ["Everyday Laptop Backpack", { rating: 5, title: "Fits my 15-inch laptop perfectly", body: "Roomy, light and the padded sleeve keeps my laptop snug. The zips feel solid and it was packed well." }],
    ["Wireless Optical Mouse", { rating: 4, title: "Good mouse for the price", body: "Connects instantly and tracks smoothly. Wish it came with a spare battery, but no complaints otherwise." }],
    ["Slim Wireless Keyboard", { rating: 5, title: "Quiet and comfortable", body: "Very slim and the keys are quiet, which is great for working late. Pairs over Bluetooth without any fuss." }],
  ] },
  { email: "demo.rahim.uddin@example.com", password: demoPw, name: "Rahim Uddin", reviews: [
    ["Everyday Laptop Backpack", { rating: 4, title: "Solid everyday bag", body: "Good build and plenty of pockets. The straps are comfortable even when it is full. Delivery was on time." }],
    ["Black Performance Trainers", { rating: 5, title: "Light and grippy", body: "True to size and very comfortable from day one. I use them at the gym and for short runs." }],
    ["Minimal Black Daypack", { rating: 4, body: "Simple, sturdy daypack. Exactly what I wanted for the daily commute." }],
  ] },
  { email: "demo.nusrat.jahan@example.com", password: demoPw, name: "Nusrat Jahan", reviews: [
    ["Rose Gold Leather Strap Watch", { rating: 5, title: "Looks even better in person", body: "Elegant and light on the wrist. The strap is soft and the colour matches the photos. Got lots of compliments." }],
    ["Makeup Brush and Palette Set", { rating: 4, title: "Lovely gift set", body: "Brushes are soft and the palette blends well. A great value set; the packaging was neat." }],
    ["Minimal Black Daypack", { rating: 5, title: "Perfect size", body: "Lightweight but strong, and fits my tablet and lunch box. Very happy with it." }],
  ] },
  { email: "demo.tanvir.hasan@example.com", password: demoPw, name: "Tanvir Hasan", reviews: [
    ["Teal Suede Derby Shoes", { rating: 4, title: "Great colour, needs breaking in", body: "The teal suede looks sharp and the finish is neat. A little stiff for the first few days, then very comfortable." }],
    ["Wireless Optical Mouse", { rating: 3, title: "Does the job", body: "Works fine for office use. The click is a bit loud and it feels light, but fair for the price." }],
    ["Everyday Laptop Backpack", { rating: 5, body: "Excellent backpack. Survived a rainy week with no leaks." }],
  ] },
  { email: "demo.sadia.islam@example.com", password: demoPw, name: "Sadia Islam", reviews: [
    ["Makeup Brush and Palette Set", { rating: 5, title: "Beautiful set", body: "The brushes are soft and do not shed. The shades suit medium skin tones really well." }],
    ["Rose Gold Leather Strap Watch", { rating: 4, title: "Pretty and comfortable", body: "Minimal design that goes with everything. Keeps good time. I would have liked a second strap." }],
  ] },
  { email: "demo.imran.khan@example.com", password: demoPw, name: "Imran Khan", reviews: [
    ["Black Performance Trainers", { rating: 4, title: "Comfortable for long days", body: "Light and cushioned. The grip is good on wet floors too. Runs very slightly small, so size up if you are between sizes." }],
    ["Slim Wireless Keyboard", { rating: 4, title: "Nice typing feel", body: "Slim and sturdy with a pleasant key feel. Battery lasts a long time between charges." }],
    ["Teal Suede Derby Shoes", { rating: 5, title: "Stylish and well made", body: "Excellent stitching and the sole is comfortable. Looks great with chinos." }],
  ] },
  { email: "demo.farhana.akter@example.com", password: demoPw, name: "Farhana Akter", reviews: [
    ["Minimal Black Daypack", { rating: 3, title: "Good, but the zip is stiff", body: "Nice shape and size. The main zip was stiff at first but it has loosened up. Fine for the price." }],
    ["Makeup Brush and Palette Set", { rating: 5, body: "Bought it as a gift and it was a hit. Pretty packaging and quality products." }],
    ["Rose Gold Leather Strap Watch", { rating: 5, title: "Gorgeous", body: "Delicate and classy. Arrived quickly and well wrapped." }],
  ] },
];

const addr = { label: "Home", phone: "+8801712345678", line1: "House 5, Road 3, Dhanmondi", city: "Dhaka", district: "Dhaka", postalCode: "1205" };

for (const who of plan) {
  const user = await c.users.findOne({ emailNormalized: who.email.toLowerCase() });
  if (!user) {
    console.log(`  skip (no such user): ${who.email}`);
    continue;
  }
  const actor = await asActor(who.email, who.password);
  // Only what this customer has not reviewed yet.
  const done = new Set((await c.reviews.find({ userId: user._id }).toArray()).map((r) => r.productId.toHexString()));
  const todo = who.reviews.map(([t, r]) => ({ p: bySlugStart(t), r, t })).filter((x) => x.p && !done.has(x.p._id.toHexString()));
  if (todo.length === 0) {
    console.log(`  nothing to do: ${who.email}`);
    continue;
  }

  const addressId = (await listAddresses(user._id))[0]?.id ?? (await createAddress(user._id, { ...addr, recipient: who.name })).id;
  await clearCart(user._id);
  for (const { p } of todo) await addItem(user._id, { productId: p!._id, variantId: p!.variants.find((v) => v.active)!.variantId, quantity: 1 });
  const total = (await getCart(user._id)).totals.totalMinor;
  const order = await placeOrder(actor, { addressId: new ObjectId(addressId), paymentMethod: "online", expectedTotalMinor: total });

  // Pay it: a signed webhook, verified exactly as a real provider's would be.
  await initiatePayment(user._id, new ObjectId(order.id));
  const payment = await c.payments.findOne({ orderId: new ObjectId(order.id) });
  if (!payment) throw new Error("payment missing");
  const adapter = getAdapterForWebhook("mock");
  const signed = mockGateway.signedEvent(payment.merchantReference, "succeeded");
  const event = await adapter.parseAndVerifyWebhook({ rawBody: signed.body, headers: new Headers(signed.headers), contentType: "application/json" });
  const outcome = await applyVerifiedEvent(adapter, event);
  if (outcome !== "applied") throw new Error(`payment not applied: ${outcome}`);

  // The seller fulfils it.
  for (const vo of await c.vendorOrders.find({ parentOrderId: new ObjectId(order.id), vendorId: seller.vendorId }).toArray()) {
    await transitionVendorOrder(scope, vo._id, { to: "accepted" });
    await transitionVendorOrder(scope, vo._id, { to: "shipped", shipment: { carrier: "Pathao", trackingNumber: `PTH${Math.floor(Math.random() * 9e7 + 1e7)}` } });
    await transitionVendorOrder(scope, vo._id, { to: "delivered" });
  }

  for (const { p, r, t } of todo) {
    await createReview(actor, p!.slug, r);
    console.log(`  reviewed (${r.rating}★): ${who.name} -> ${t}`);
  }
}

const rows = await c.reviews.aggregate<{ _id: unknown; n: number; avg: number }>([
  { $match: { vendorId: seller.vendorId, status: "published" } }, { $group: { _id: "$productId", n: { $sum: 1 }, avg: { $avg: "$rating" } } },
]).toArray();
console.log(`done. ${rows.length} products have reviews; ${rows.reduce((a, r) => a + r.n, 0)} reviews in total`);
await closeClient();
