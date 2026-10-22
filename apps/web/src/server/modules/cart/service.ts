import { ObjectId } from "mongodb";
import { getCollections } from "@/server/db/collections";
import type { CartDoc } from "@/server/db/schema";
import { AppError } from "@/server/shared/errors";
import { newId } from "@/server/shared/ids";
import { buildQuote, type Quote } from "@/server/modules/checkout/quote";
import { ISSUE_MESSAGE, normaliseCode } from "@/server/modules/coupons/service";

export const MAX_QTY_PER_LINE = 20;
export const MAX_CART_LINES = 50;

export const lineId = (productId: ObjectId | string, variantId: string): string => `${String(productId)}.${variantId}`;

export function parseLineId(id: string): { productId: ObjectId; variantId: string } {
  const [pid, vid, ...rest] = id.split(".");
  if (!pid || !vid || rest.length || !ObjectId.isValid(pid) || pid.length !== 24) {
    throw new AppError("VALIDATION_FAILED", { details: [{ field: "itemId", code: "INVALID_ID" }] });
  }
  return { productId: new ObjectId(pid), variantId: vid };
}

async function getOrCreate(userId: ObjectId): Promise<CartDoc> {
  const c = await getCollections();
  const cart = await c.carts.findOneAndUpdate(
    { userId },
    { $setOnInsert: { _id: newId(), userId, lines: [], updatedAt: new Date() } },
    { upsert: true, returnDocument: "after" },
  );
  return cart!;
}

/** The cart returns advisory prices only: every read recomputes them from the live catalogue. */
export async function getCart(userId: ObjectId): Promise<Quote> {
  const cart = await getOrCreate(userId);
  return buildQuote(cart.lines, undefined, { couponCode: cart.couponCode, userId });
}

/** Attach a coupon to the cart. A code that does not apply is rejected with the reason; the cart is left as it was. */
export async function applyCouponToCart(userId: ObjectId, rawCode: string) {
  const cart = await getOrCreate(userId);
  const code = normaliseCode(rawCode);
  const quote = await buildQuote(cart.lines, undefined, { couponCode: code, userId });
  if (!quote.coupon) throw new AppError("VALIDATION_FAILED", { message: quote.couponIssue?.message ?? ISSUE_MESSAGE.not_found, details: [{ field: "code", code: (quote.couponIssue?.reason ?? "not_found").toUpperCase() }] });
  const c = await getCollections();
  await c.carts.updateOne({ userId }, { $set: { couponCode: code, updatedAt: new Date() } });
  return quote;
}

export async function removeCouponFromCart(userId: ObjectId) {
  const c = await getCollections();
  await c.carts.updateOne({ userId }, { $unset: { couponCode: "" }, $set: { updatedAt: new Date() } });
  return getCart(userId);
}

export async function addItem(userId: ObjectId, input: { productId: ObjectId; variantId: string; quantity: number }) {
  const c = await getCollections();
  const product = await c.products.findOne({ _id: input.productId, status: "published", vendorActive: true });
  const variant = product?.variants.find((v) => v.variantId === input.variantId && v.active);
  if (!product || !variant) throw new AppError("PRODUCT_UNAVAILABLE");
  await getOrCreate(userId);
  const cart = await c.carts.findOne({ userId });
  const existing = cart!.lines.find((l) => l.productId.equals(input.productId) && l.variantId === input.variantId);
  const total = (existing?.quantity ?? 0) + input.quantity;
  if (total > MAX_QTY_PER_LINE) {
    throw new AppError("BUSINESS_RULE_VIOLATION", { message: `You can buy up to ${MAX_QTY_PER_LINE} of an item at a time.`, details: [{ field: "quantity", code: "MAX_EXCEEDED" }] });
  }
  if (existing) {
    await c.carts.updateOne({ userId, "lines.productId": input.productId, "lines.variantId": input.variantId }, { $set: { "lines.$.quantity": total, updatedAt: new Date() } });
  } else {
    if (cart!.lines.length >= MAX_CART_LINES) throw new AppError("BUSINESS_RULE_VIOLATION", { message: "Your cart is full." });
    await c.carts.updateOne({ userId, "lines.50": { $exists: false } }, { $push: { lines: { productId: input.productId, variantId: input.variantId, quantity: input.quantity, addedAt: new Date() } }, $set: { updatedAt: new Date() } });
  }
  return getCart(userId);
}

export async function setQuantity(userId: ObjectId, id: string, quantity: number) {
  const { productId, variantId } = parseLineId(id);
  const c = await getCollections();
  const res = await c.carts.updateOne({ userId, "lines.productId": productId, "lines.variantId": variantId }, { $set: { "lines.$.quantity": quantity, updatedAt: new Date() } });
  if (res.matchedCount === 0) throw new AppError("NOT_FOUND");
  return getCart(userId);
}

export async function removeItem(userId: ObjectId, id: string) {
  const { productId, variantId } = parseLineId(id);
  const c = await getCollections();
  const res = await c.carts.updateOne({ userId }, { $pull: { lines: { productId, variantId } }, $set: { updatedAt: new Date() } });
  if (res.matchedCount === 0) throw new AppError("NOT_FOUND");
  return getCart(userId);
}

export async function clearCart(userId: ObjectId) {
  const c = await getCollections();
  await c.carts.updateOne({ userId }, { $set: { lines: [], updatedAt: new Date() }, $unset: { couponCode: "" } });
}
