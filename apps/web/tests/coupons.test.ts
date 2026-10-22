import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { setupTestDb, teardownTestDb } from "./helpers/db";
import { call } from "./helpers/http";
import { installFakeMedia, makeAdmin, makeCategory, makeProduct, makeVendor, uniq } from "./helpers/factory";
import { idemKey, makeShopper } from "./helpers/shop";
import { addCartItemHandler, applyCouponHandler, cancelOrderHandler, checkoutHandler, getCartHandler, removeCouponHandler } from "@/server/api/handlers/shopping";
import { createCouponHandler, listCouponsHandler, patchCouponHandler } from "@/server/api/handlers/vendor-catalog";
import { getCollections } from "@/server/db/collections";

let admin: Awaited<ReturnType<typeof makeAdmin>>;
let cat: { id: string };
type Vendor = Awaited<ReturnType<typeof makeVendor>>;

beforeAll(async () => {
  await setupTestDb();
  installFakeMedia();
  admin = await makeAdmin();
  cat = await makeCategory(admin);
});
afterAll(teardownTestDb);

const shop = async (price = 100000, qty = 2) => {
  const vendor = await makeVendor();
  const product = await makeProduct(vendor, { categoryId: cat.id, priceMinor: price, stock: 50, publish: true, admin });
  return { vendor, product, qty };
};
const toCart = (token: string, s: { product: { id: string; variants: { variantId: string }[] }; qty: number }) =>
  call(addCartItemHandler, { method: "POST", token, body: { productId: s.product.id, variantId: s.product.variants[0]!.variantId, quantity: s.qty } });
const mkCoupon = (v: Vendor, over: Record<string, unknown> = {}) =>
  call(createCouponHandler, { method: "POST", token: v.user.token, body: { code: uniq("SAVE").toUpperCase(), kind: "percent", value: 10, perUserLimit: 1, ...over } });
const apply = (token: string, code: string) => call(applyCouponHandler, { method: "PUT", token, body: { code } });
const buy = async (buyer: Awaited<ReturnType<typeof makeShopper>>, method: "cod" | "online" = "cod") => {
  const cart = (await call(getCartHandler, { token: buyer.token })).data;
  return call(checkoutHandler, { method: "POST", token: buyer.token, headers: { "idempotency-key": idemKey() }, body: { addressId: buyer.addressId, paymentMethod: method, expectedTotalMinor: cart.totals.totalMinor } });
};

describe("coupons: money", () => {
  it("takes a percentage off one seller's items, charges the discounted total, and takes commission on it", async () => {
    const s = await shop(100000, 2);
    const buyer = await makeShopper();
    await toCart(buyer.token, s);
    const code = (await mkCoupon(s.vendor, { value: 10, minSubtotalMinor: 100000 })).data.code as string;
    const before = (await call(getCartHandler, { token: buyer.token })).data;
    const applied = await apply(buyer.token, code.toLowerCase()); // codes are case-insensitive
    expect(applied.status).toBe(200);
    const q = applied.data;
    expect(q.totals).toMatchObject({ subtotalMinor: 200000, discountMinor: 20000 });
    expect(q.totals.totalMinor).toBe(before.totals.totalMinor - 20000);
    expect(q.groups[0].discountMinor).toBe(20000);
    expect(q.coupon).toMatchObject({ code, label: "10% off" });

    const order = await buy(buyer);
    expect(order.status, JSON.stringify(order.json)).toBe(201);
    expect(order.data.totals).toMatchObject({ discountMinor: 20000, totalMinor: q.totals.totalMinor });
    const c = await getCollections();
    const vo = (await c.vendorOrders.findOne({ parentOrderId: new ObjectId(order.data.id) }))!;
    expect(vo.totals).toMatchObject({ subtotalMinor: 200000, discountMinor: 20000 });
    expect(vo.totals.totalMinor).toBe(200000 - 20000 + vo.totals.shippingMinor);
    expect(vo.commission.amountMinor).toBe(Math.round(((200000 - 20000) * vo.commission.bps) / 10000)); // on the discounted items
    expect(vo.commission.vendorNetMinor).toBe(vo.totals.totalMinor - vo.commission.amountMinor);
    expect((await c.coupons.findOne({ code }))?.usedCount).toBe(1);
    expect((await c.carts.findOne({ userId: buyer.id }))?.couponCode).toBeUndefined(); // used up with the order
  });

  it("charges an online payment exactly the discounted amount", async () => {
    const s = await shop(150000, 1);
    const buyer = await makeShopper();
    await toCart(buyer.token, s);
    const code = (await mkCoupon(s.vendor, { kind: "fixed", value: 25000 })).data.code as string;
    expect((await apply(buyer.token, code)).data.totals.discountMinor).toBe(25000);
    const order = await buy(buyer, "online");
    expect(order.status).toBe(201);
    const c = await getCollections();
    const payment = (await c.payments.findOne({ orderId: new ObjectId(order.data.id) }))!;
    expect(payment.amountMinor).toBe(order.data.totals.totalMinor);
    expect(order.data.totals.discountMinor).toBe(25000);
  });

  it("caps percentage discounts, never takes an item below ৳1, and leaves other sellers and shipping alone", async () => {
    const a = await shop(100000, 1), b = await shop(50000, 1);
    const buyer = await makeShopper();
    await toCart(buyer.token, a);
    await toCart(buyer.token, b);
    const capped = (await mkCoupon(a.vendor, { value: 50, maxDiscountMinor: 10000 })).data.code as string;
    const r = await apply(buyer.token, capped);
    expect(r.data.totals.discountMinor).toBe(10000);
    expect(r.data.groups.find((g: { vendorId: string }) => g.vendorId === r.data.coupon.vendorId).discountMinor).toBe(10000);
    expect(r.data.groups.filter((g: { discountMinor: number }) => g.discountMinor === 0)).toHaveLength(1); // the other seller's items are untouched
    const huge = (await mkCoupon(b.vendor, { kind: "fixed", value: 99_000_000 })).data.code as string;
    const h = await apply(buyer.token, huge);
    expect(h.status).toBe(200);
    expect(h.data.totals.discountMinor).toBe(50000 - 100); // leaves ৳1
  });
});

describe("coupons: rules", () => {
  it("explains why a code does not apply", async () => {
    const s = await shop(100000, 1), other = await shop();
    const buyer = await makeShopper();
    await toCart(buyer.token, s);
    const reason = async (code: string) => (await apply(buyer.token, code)).error?.details[0]?.code;
    expect(await reason("NOSUCHCODE")).toBe("NOT_FOUND");
    const elsewhere = (await mkCoupon(other.vendor)).data.code as string;
    expect(await reason(elsewhere)).toBe("NOT_IN_CART");
    const minimum = (await mkCoupon(s.vendor, { minSubtotalMinor: 500000 })).data.code as string;
    expect(await reason(minimum)).toBe("MIN_SUBTOTAL");
    const future = (await mkCoupon(s.vendor, { startsAt: new Date(Date.now() + 86_400_000).toISOString() })).data.code as string;
    expect(await reason(future)).toBe("NOT_STARTED");
    const past = (await mkCoupon(s.vendor, { startsAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), expiresAt: new Date(Date.now() - 86_400_000).toISOString() })).data;
    expect(await reason(past.code)).toBe("EXPIRED");
    const off = (await mkCoupon(s.vendor)).data;
    await call(patchCouponHandler, { method: "PATCH", token: s.vendor.user.token, params: { id: off.id }, body: { active: false } });
    expect(await reason(off.code)).toBe("INACTIVE");
    expect((await call(getCartHandler, { token: buyer.token })).data.coupon).toBeUndefined(); // nothing stuck to the cart
  });

  it("limits uses per shopper and in total, and gives a use back when an order is cancelled", async () => {
    const s = await shop(100000, 1);
    const one = (await mkCoupon(s.vendor, { maxRedemptions: 1 })).data;
    const first = await makeShopper(), second = await makeShopper();
    await toCart(first.token, s);
    await toCart(second.token, s);
    const seen = await apply(second.token, one.code); // both can see it applies...
    expect(seen.status).toBe(200);
    expect((await apply(first.token, one.code)).status).toBe(200);
    const o1 = await buy(first);
    expect(o1.status).toBe(201);
    // ...but only one gets the last use. A page still showing the discounted total is told the price changed...
    const stale = await call(checkoutHandler, { method: "POST", token: second.token, headers: { "idempotency-key": idemKey() }, body: { addressId: second.addressId, paymentMethod: "cod", expectedTotalMinor: seen.data.totals.totalMinor } });
    expect(stale.error?.code).toBe("PRICE_CHANGED");
    expect((await apply(second.token, one.code)).error?.details[0]?.code).toBe("USED_UP");
    const c0 = await getCollections();
    expect((await c0.coupons.findOne({ _id: new ObjectId(one.id) }))?.usedCount).toBe(1); // never over-redeemed

    // cancelling returns the use
    expect((await call(cancelOrderHandler, { method: "POST", token: first.token, params: { id: o1.data.id }, body: { reason: "changed my mind" } })).status).toBe(200);
    const c = await getCollections();
    expect((await c.coupons.findOne({ _id: new ObjectId(one.id) }))?.usedCount).toBe(0);
    await call(removeCouponHandler, { method: "DELETE", token: second.token });
    expect((await apply(second.token, one.code)).status).toBe(200);

    // once per shopper by default
    const once = (await mkCoupon(s.vendor)).data;
    await toCart(first.token, s);
    expect((await apply(first.token, once.code)).status).toBe(200);
    expect((await buy(first)).status).toBe(201);
    await toCart(first.token, s);
    expect((await apply(first.token, once.code)).error?.details[0]?.code).toBe("ALREADY_USED");
  });

  it("is managed only by the seller who owns it", async () => {
    const mine = await shop(), theirs = await shop();
    const coupon = (await mkCoupon(mine.vendor)).data;
    expect((await mkCoupon(mine.vendor, { code: coupon.code })).status).toBe(409); // codes are unique across the marketplace
    expect((await mkCoupon(mine.vendor, { code: "no spaces!" })).status).toBe(400);
    expect((await mkCoupon(mine.vendor, { value: 95 })).status).toBe(400);
    expect((await mkCoupon(mine.vendor, { kind: "fixed", value: 50 })).status).toBe(400);
    expect((await call(patchCouponHandler, { method: "PATCH", token: theirs.vendor.user.token, params: { id: coupon.id }, body: { active: false } })).status).toBe(404);
    expect((await call(listCouponsHandler, { token: theirs.vendor.user.token })).data.some((x: { id: string }) => x.id === coupon.id)).toBe(false);
    const shopper = await makeShopper();
    expect((await call(listCouponsHandler, { token: shopper.token })).status).toBe(403);
    expect((await call(applyCouponHandler, { method: "PUT", token: mine.vendor.user.token, body: { code: coupon.code } })).status).toBe(403);
  });
});
