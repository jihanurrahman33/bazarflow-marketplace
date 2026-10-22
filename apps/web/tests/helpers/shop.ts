import { ObjectId } from "mongodb";
import { call } from "./http";
import { makeAdmin, makeCategory, makeCustomer, makeProduct, makeVendor, uniq } from "./factory";
import { addCartItemHandler, checkoutHandler, createAddressHandler } from "@/server/api/handlers/shopping";
import { getCollections } from "@/server/db/collections";
import { mockGateway } from "@/server/modules/payments/mock";
import { paymentWebhookHandler } from "@/server/api/handlers/payments";

export interface Shop {
  admin: Awaited<ReturnType<typeof makeAdmin>>;
  category: { id: string };
}

let idem = 0;
export const idemKey = () => `shop-key-${Date.now()}-${++idem}-abcdef`;

export async function makeShop(): Promise<Shop> {
  const admin = await makeAdmin();
  return { admin, category: await makeCategory(admin, "Shop " + uniq()) };
}

export async function makeShopper() {
  const u = await makeCustomer();
  const a = await call(createAddressHandler, { method: "POST", token: u.token, body: { label: "Home", recipient: "Rahim Uddin", phone: "+8801712345678", line1: "House 5, Road 3", city: "Dhaka", district: "Dhaka", postalCode: "1212" } });
  return { ...u, addressId: a.data.id as string };
}

export type OrderSetup = Awaited<ReturnType<typeof placeShopOrder>>;

/** Place one order across `prices.length` vendors (one product each). Optionally pay it (online) via a verified webhook. */
export async function placeShopOrder(shop: Shop, opts: { prices?: number[]; method?: "online" | "cod"; stock?: number; pay?: boolean; buyer?: Awaited<ReturnType<typeof makeShopper>> } = {}) {
  const prices = opts.prices ?? [100000];
  const method = opts.method ?? "cod";
  const buyer = opts.buyer ?? (await makeShopper());
  const vendors: Awaited<ReturnType<typeof makeVendor>>[] = [];
  const products: { id: string; slug: string; variantId: string }[] = [];
  for (const price of prices) {
    const v = await makeVendor();
    const p = await makeProduct(v, { categoryId: shop.category.id, priceMinor: price, stock: opts.stock ?? 10, publish: true, admin: shop.admin });
    await call(addCartItemHandler, { method: "POST", token: buyer.token, body: { productId: p.id, variantId: p.variants[0].variantId, quantity: 1 } });
    vendors.push(v);
    products.push({ id: p.id, slug: p.slug, variantId: p.variants[0].variantId });
  }
  const total = prices.reduce((a, b) => a + b, 0);
  const r = await call(checkoutHandler, { method: "POST", token: buyer.token, headers: { "idempotency-key": idemKey() }, body: { addressId: buyer.addressId, paymentMethod: method, expectedTotalMinor: total } });
  if (r.status !== 201) throw new Error("checkout failed " + JSON.stringify(r.json));
  const c = await getCollections();
  let ref: string | undefined;
  if (method === "online") {
    ref = (await c.payments.findOne({ orderId: new ObjectId(r.data.id) }))!.merchantReference;
    if (opts.pay) {
      const signed = mockGateway.signedEvent(ref, "succeeded");
      await call(paymentWebhookHandler, { method: "POST", rawBody: signed.body, headers: signed.headers, params: { provider: "mock" } });
    }
  }
  const vos = await c.vendorOrders.find({ parentOrderId: new ObjectId(r.data.id) }).toArray();
  // order vendor orders to match the vendors array
  const voFor = (i: number) => vos.find((v) => v.vendorId.equals(vendors[i]!.vendorId))!;
  return { buyer, vendors, products, orderId: r.data.id as string, order: r.data, ref, vos: vendors.map((_, i) => voFor(i)), total };
}
