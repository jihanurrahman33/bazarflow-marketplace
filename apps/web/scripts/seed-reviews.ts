/**
 * Customer reviews for vendor products, produced the honest way: each demo customer places a real order,
 * pays it through the mock payment provider, the seller ships it and marks it delivered, and only then the customer reviews.
 * That makes every review a genuine "verified purchase" row in demo data.
 * Idempotent: a customer is never given a second review (or duplicate order) for a product they already reviewed.
 * Demo/staging only: delete these accounts and orders before real shoppers arrive.
 *
 * Env options:
 *   VENDOR_EMAIL / VENDOR_PASSWORD (optional: target one specific seller; if omitted, targets all active sellers with published products)
 *   CUSTOMER_EMAIL / CUSTOMER_PASSWORD (optional: specific customer account to include)
 *   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (optional admin for fallback order fulfillment)
 *   DEMO_PASSWORD (defaults to "Demo-Pass-2026!")
 */
import { loadDotEnv } from "./_env";
loadDotEnv();

const { ObjectId } = await import("mongodb");
const { getCollections } = await import("../src/server/db/collections");
const { closeClient } = await import("../src/server/db/client");
const { registerUser, login, authenticateAccessToken } = await import("../src/server/modules/identity/service");
const { createAddress, listAddresses } = await import("../src/server/modules/addresses/service");
const { addItem, clearCart, getCart } = await import("../src/server/modules/cart/service");
const { placeOrder } = await import("../src/server/modules/checkout/service");
const { getAdapterForWebhook } = await import("../src/server/modules/payments/registry");
const { applyVerifiedEvent, initiatePayment } = await import("../src/server/modules/payments/service");
const { mockGateway } = await import("../src/server/modules/payments/mock");
const { transitionVendorOrder } = await import("../src/server/modules/orders/fulfillment");
const { createReview } = await import("../src/server/modules/reviews/service");

const device = { platform: "seed" };
const c = await getCollections();
const demoPw = process.env.DEMO_PASSWORD || "Demo-Pass-2026!";

const asActor = async (email: string, password: string) => {
  const token = (await login({ email, password, device })).tokens.accessToken;
  return authenticateAccessToken(token);
};

async function ensureCustomer(email: string, password: string, name: string, phone = "+8801711000099") {
  const existing = await c.users.findOne({ emailNormalized: email.toLowerCase() });
  if (existing) return existing;
  await registerUser({ email, password, name, phone, device });
  await c.users.updateOne({ emailNormalized: email.toLowerCase() }, { $set: { emailVerifiedAt: new Date() } });
  return (await c.users.findOne({ emailNormalized: email.toLowerCase() }))!;
}

// Find published products across target sellers
const vendorEmail = process.env.VENDOR_EMAIL || process.env.NEW_VENDOR_EMAIL;
const vendorPassword = process.env.VENDOR_PASSWORD || process.env.NEW_VENDOR_PASSWORD || demoPw;

const sellerScopes: Map<string, { kind: "vendor"; userId: InstanceType<typeof ObjectId>; vendorId: InstanceType<typeof ObjectId> }> = new Map();

if (vendorEmail) {
  const seller = await asActor(vendorEmail, vendorPassword);
  if (!seller.vendorId) throw new Error(`Account ${vendorEmail} has no approved store.`);
  sellerScopes.set(seller.vendorId.toHexString(), { kind: "vendor", userId: seller.userId, vendorId: seller.vendorId });
  console.log(`Targeting single seller: ${vendorEmail}`);
} else {
  const vendors = await c.vendors.find({ status: "active" }).toArray();
  for (const v of vendors) {
    sellerScopes.set(v._id.toHexString(), { kind: "vendor", userId: v.ownerUserId, vendorId: v._id });
  }
  console.log(`Targeting all active sellers (${sellerScopes.size} stores)`);
}

const targetVendorIds = Array.from(sellerScopes.keys()).map((id) => new ObjectId(id));
const products = await c.products.find({ vendorId: { $in: targetVendorIds }, status: "published" }).toArray();
const byTitle = (title: string) => products.find((p) => p.title.toLowerCase() === title.toLowerCase());

type R = { rating: number; title?: string; body: string };

const plan: { email: string; password: string; name: string; reviews: [string, R][] }[] = [
  {
    email: "demo.rahim.uddin@example.com",
    password: demoPw,
    name: "Rahim Uddin",
    reviews: [
      ["Everyday Laptop Backpack", { rating: 4, title: "Solid everyday bag", body: "Good build and plenty of pockets. The straps are comfortable even when it is full. Delivery was on time." }],
      ["Black Performance Trainers", { rating: 5, title: "Light and grippy", body: "True to size and very comfortable from day one. I use them at the gym and for short runs." }],
      ["Minimal Black Daypack", { rating: 4, body: "Simple, sturdy daypack. Exactly what I wanted for the daily commute." }],
      ["Classic White Cotton T-Shirt", { rating: 5, title: "Soft and breathable", body: "Very comfortable cotton fabric. Fits nicely and didn't shrink after wash." }],
      ["20W USB-C Fast Charger", { rating: 5, title: "Super fast charging", body: "Charges my phone from 20% to 80% in about 30 minutes. Solid build quality." }],
      ["Cold-Pressed Cooking Oil (1 L)", { rating: 5, title: "Pure and fragrant", body: "Rich aroma and great taste. Clean packaging with no leaks during transit." }],
    ],
  },
  {
    email: "demo.nusrat.jahan@example.com",
    password: demoPw,
    name: "Nusrat Jahan",
    reviews: [
      ["Rose Gold Leather Strap Watch", { rating: 5, title: "Looks even better in person", body: "Elegant and light on the wrist. The strap is soft and the colour matches the photos. Got lots of compliments." }],
      ["Makeup Brush and Palette Set", { rating: 4, title: "Lovely gift set", body: "Brushes are soft and the palette blends well. A great value set; the packaging was neat." }],
      ["Minimal Black Daypack", { rating: 5, title: "Perfect size", body: "Lightweight but strong, and fits my tablet and lunch box. Very happy with it." }],
      ["True Wireless Earbuds with Charging Case", { rating: 4, title: "Great sound and battery", body: "Sound quality is surprisingly clear with punchy bass. The charging case is lightweight." }],
      ["Mint Ceramic Planter with Succulent", { rating: 5, title: "Cute desk plant", body: "Arrived in perfect condition, carefully packed. Looks lovely on my study table." }],
      ["Cotton Bed Linen Set", { rating: 5, title: "Soft sheets", body: "Fabric is breathable and soft. Pillow covers fit standard pillows nicely." }],
    ],
  },
  {
    email: "demo.tanvir.hasan@example.com",
    password: demoPw,
    name: "Tanvir Hasan",
    reviews: [
      ["Teal Suede Derby Shoes", { rating: 4, title: "Great colour, needs breaking in", body: "The teal suede looks sharp and the finish is neat. A little stiff for the first few days, then very comfortable." }],
      ["Wireless Optical Mouse", { rating: 3, title: "Does the job", body: "Works fine for office use. The click is a bit loud and it feels light, but fair for the price." }],
      ["Everyday Laptop Backpack", { rating: 5, body: "Excellent backpack. Survived a rainy week in Dhaka with no leaks." }],
      ["10000mAh Slim Power Bank", { rating: 5, title: "Pocket-friendly backup", body: "Slim profile and charges my phone twice over. Very convenient for travel." }],
      ["Premium Long-Grain Basmati Rice", { rating: 5, title: "Aromatic and long grains", body: "Cooks wonderfully, nice natural aroma and each grain stays separate." }],
    ],
  },
  {
    email: "demo.sadia.islam@example.com",
    password: demoPw,
    name: "Sadia Islam",
    reviews: [
      ["Makeup Brush and Palette Set", { rating: 5, title: "Beautiful set", body: "The brushes are soft and do not shed. The shades suit medium skin tones really well." }],
      ["Rose Gold Leather Strap Watch", { rating: 4, title: "Pretty and comfortable", body: "Minimal design that goes with everything. Keeps good time. I would have liked a second strap." }],
      ["Handwoven Patterned Area Rug", { rating: 4, title: "Warm and cozy", body: "Soft underfoot and neat border stitching. Easy to vacuum and spot clean." }],
      ["Everyday Black Crew T-Shirt", { rating: 5, body: "Great basic black tee. High quality fabric and very comfortable." }],
    ],
  },
  {
    email: "demo.imran.khan@example.com",
    password: demoPw,
    name: "Imran Khan",
    reviews: [
      ["Black Performance Trainers", { rating: 4, title: "Comfortable for long days", body: "Light and cushioned. The grip is good on wet floors too. Runs very slightly small, so size up if in between." }],
      ["Slim Wireless Keyboard", { rating: 4, title: "Nice typing feel", body: "Slim and sturdy with a pleasant key feel. Battery lasts a long time between charges." }],
      ["Teal Suede Derby Shoes", { rating: 5, title: "Stylish and well made", body: "Excellent stitching and the sole is comfortable. Looks great with chinos." }],
      ["Slim Fit Denim Jeans", { rating: 4, title: "Good stretch", body: "Quality denim with the right amount of stretch. Color matches the pictures well." }],
      ["Wireless Over-Ear Headphones", { rating: 5, title: "Deep bass and comfortable", body: "Ear cups are very soft and the battery lasts for days of casual listening." }],
    ],
  },
  {
    email: "demo.farhana.akter@example.com",
    password: demoPw,
    name: "Farhana Akter",
    reviews: [
      ["Minimal Black Daypack", { rating: 3, title: "Good, but the zip is stiff", body: "Nice shape and size. The main zip was stiff at first but it has loosened up. Fine for the price." }],
      ["Makeup Brush and Palette Set", { rating: 5, body: "Bought it as a gift and it was a hit. Pretty packaging and quality products." }],
      ["Rose Gold Leather Strap Watch", { rating: 5, title: "Gorgeous", body: "Delicate and classy. Arrived quickly and well wrapped." }],
      ["Fresh Vegetable Box (Weekly)", { rating: 5, title: "Fresh and crisp", body: "All vegetables were very fresh and crisp. Great variety and neatly boxed." }],
    ],
  },
];

const customCustomerEmail = process.env.CUSTOMER_EMAIL || process.env.NEW_CUSTOMER_EMAIL;
if (customCustomerEmail) {
  plan.unshift({
    email: customCustomerEmail,
    password: process.env.CUSTOMER_PASSWORD || process.env.NEW_CUSTOMER_PASSWORD || demoPw,
    name: "Demo Customer",
    reviews: [
      ["Everyday Laptop Backpack", { rating: 5, title: "Fits my 15-inch laptop perfectly", body: "Roomy, light and the padded sleeve keeps my laptop snug. The zips feel solid and it was packed well." }],
      ["Wireless Optical Mouse", { rating: 4, title: "Good mouse for the price", body: "Connects instantly and tracks smoothly. Wish it came with a spare battery, but no complaints otherwise." }],
      ["Slim Wireless Keyboard", { rating: 5, title: "Quiet and comfortable", body: "Very slim and the keys are quiet, which is great for working late. Pairs over Bluetooth without any fuss." }],
    ],
  });
}

const addr = { label: "Home", phone: "+8801712345678", line1: "House 5, Road 3, Dhanmondi", city: "Dhaka", district: "Dhaka", postalCode: "1205" };

let totalNewReviews = 0;

for (const who of plan) {
  const user = await ensureCustomer(who.email, who.password, who.name);
  const actor = await asActor(who.email, who.password);

  const done = new Set((await c.reviews.find({ userId: user._id }).toArray()).map((r) => r.productId.toHexString()));
  const todo = who.reviews.map(([t, r]) => ({ p: byTitle(t), r, t })).filter((x) => x.p && !done.has(x.p._id.toHexString()));

  if (todo.length === 0) {
    console.log(`  nothing to review: ${who.email}`);
    continue;
  }

  const addressId = (await listAddresses(user._id))[0]?.id ?? (await createAddress(user._id, { ...addr, recipient: who.name })).id;
  await clearCart(user._id);

  for (const { p } of todo) {
    const activeVariant = p!.variants.find((v) => v.active) ?? p!.variants[0];
    if (activeVariant) {
      await addItem(user._id, { productId: p!._id, variantId: activeVariant.variantId, quantity: 1 });
    }
  }

  const cart = await getCart(user._id);
  if (cart.itemCount === 0) continue;

  const total = cart.totals.totalMinor;
  const order = await placeOrder(actor, { addressId: new ObjectId(addressId), paymentMethod: "online", expectedTotalMinor: total });

  // Pay it via simulated webhook
  await initiatePayment(user._id, new ObjectId(order.id));
  const payment = await c.payments.findOne({ orderId: new ObjectId(order.id) });
  if (!payment) throw new Error(`Payment missing for order ${order.id}`);

  const adapter = getAdapterForWebhook("mock");
  const signed = mockGateway.signedEvent(payment.merchantReference, "succeeded");
  const event = await adapter.parseAndVerifyWebhook({ rawBody: signed.body, headers: new Headers(signed.headers), contentType: "application/json" });
  const outcome = await applyVerifiedEvent(adapter, event);
  if (outcome !== "applied") throw new Error(`Payment not applied: ${outcome}`);

  // Fulfill per vendor order
  const vos = await c.vendorOrders.find({ parentOrderId: new ObjectId(order.id) }).toArray();
  for (const vo of vos) {
    const scope = sellerScopes.get(vo.vendorId.toHexString());
    if (!scope) continue;
    await transitionVendorOrder(scope, vo._id, { to: "accepted" });
    await transitionVendorOrder(scope, vo._id, {
      to: "shipped",
      shipment: { carrier: "Pathao", trackingNumber: `PTH${Math.floor(Math.random() * 9e7 + 1e7)}` },
    });
    await transitionVendorOrder(scope, vo._id, { to: "delivered" });
  }

  for (const { p, r, t } of todo) {
    try {
      await createReview(actor, p!.slug, r);
      console.log(`  reviewed (${r.rating}★): ${who.name} -> ${t}`);
      totalNewReviews++;
    } catch (e: unknown) {
      console.warn(`  could not review ${t}: ${(e as Error).message}`);
    }
  }
}

const stats = await c.reviews.aggregate<{ _id: unknown; n: number; avg: number }>([
  { $match: { vendorId: { $in: targetVendorIds }, status: "published" } },
  { $group: { _id: "$productId", n: { $sum: 1 }, avg: { $avg: "$rating" } } },
]).toArray();

console.log(`\nDone! Added ${totalNewReviews} new reviews.`);
console.log(`${stats.length} products now have reviews; ${stats.reduce((a, r) => a + r.n, 0)} total reviews across target stores.`);
await closeClient();
