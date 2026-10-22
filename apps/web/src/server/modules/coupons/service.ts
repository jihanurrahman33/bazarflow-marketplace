import { MongoServerError, ObjectId, type ClientSession } from "mongodb";
import { getCollections } from "@/server/db/collections";
import type { CouponDoc } from "@/server/db/schema";
import { AppError } from "@/server/shared/errors";

/**
 * Seller-funded coupons. A coupon belongs to one seller and discounts only that seller's items in the cart; the discount comes out
 * of that seller's order total, and commission is taken on what the shopper actually pays for items. Nothing here touches other
 * sellers' lines, shipping, or the platform's own revenue.
 */
export const CODE_RE = /^[A-Z0-9][A-Z0-9-]{2,19}$/;
export const normaliseCode = (raw: string): string => raw.trim().toUpperCase();
const MIN_PAYABLE_MINOR = 100; // a discount never takes an item subtotal below ৳1

export type CouponIssueReason = "not_found" | "inactive" | "not_started" | "expired" | "not_in_cart" | "min_subtotal" | "used_up" | "already_used";

export const ISSUE_MESSAGE: Record<CouponIssueReason, string> = {
  not_found: "That code isn't valid.",
  inactive: "That code is no longer active.",
  not_started: "That code isn't active yet.",
  expired: "That code has expired.",
  not_in_cart: "That code is for a store that isn't in your cart.",
  min_subtotal: "Your items from that store don't reach the minimum for this code.",
  used_up: "That code has been fully used.",
  already_used: "You've already used that code the maximum number of times.",
};

export interface AppliedCoupon { id: string; code: string; vendorId: string; discountMinor: number; label: string }
export type CouponCheck = { ok: true; coupon: AppliedCoupon } | { ok: false; reason: CouponIssueReason };

const labelOf = (c: Pick<CouponDoc, "kind" | "value">) => (c.kind === "percent" ? `${c.value}% off` : `৳${(c.value / 100).toLocaleString("en-BD")} off`);

export function discountFor(coupon: Pick<CouponDoc, "kind" | "value" | "maxDiscountMinor">, subtotalMinor: number): number {
  const raw = coupon.kind === "percent" ? Math.floor((subtotalMinor * coupon.value) / 100) : coupon.value;
  const capped = coupon.maxDiscountMinor ? Math.min(raw, coupon.maxDiscountMinor) : raw;
  return Math.max(0, Math.min(capped, subtotalMinor - MIN_PAYABLE_MINOR));
}

/** Would this code apply to this cart right now, and for how much? Advisory: the redemption in checkout is the authoritative check. */
export async function checkCoupon(rawCode: string, userId: ObjectId | undefined, groups: { vendorId: string; subtotalMinor: number }[], now = new Date()): Promise<CouponCheck> {
  const c = await getCollections();
  const coupon = await c.coupons.findOne({ code: normaliseCode(rawCode) });
  if (!coupon) return { ok: false, reason: "not_found" };
  if (!coupon.active) return { ok: false, reason: "inactive" };
  if (coupon.startsAt && coupon.startsAt > now) return { ok: false, reason: "not_started" };
  if (coupon.expiresAt && coupon.expiresAt <= now) return { ok: false, reason: "expired" };
  const vendor = await c.vendors.findOne({ _id: coupon.vendorId, status: "active" }, { projection: { _id: 1 } });
  if (!vendor) return { ok: false, reason: "inactive" };
  const group = groups.find((g) => g.vendorId === coupon.vendorId.toHexString());
  if (!group) return { ok: false, reason: "not_in_cart" };
  if (coupon.minSubtotalMinor && group.subtotalMinor < coupon.minSubtotalMinor) return { ok: false, reason: "min_subtotal" };
  if (coupon.maxRedemptions != null && coupon.usedCount >= coupon.maxRedemptions) return { ok: false, reason: "used_up" };
  if (userId && (await c.couponRedemptions.countDocuments({ couponId: coupon._id, userId, released: false })) >= coupon.perUserLimit) return { ok: false, reason: "already_used" };
  const discountMinor = discountFor(coupon, group.subtotalMinor);
  if (discountMinor <= 0) return { ok: false, reason: "min_subtotal" };
  return { ok: true, coupon: { id: coupon._id.toHexString(), code: coupon.code, vendorId: group.vendorId, discountMinor, label: labelOf(coupon) } };
}

/**
 * Use the coupon for an order, inside the order's transaction. The conditional increment is what stops two shoppers taking the
 * last redemption together: only one update can match.
 */
export async function redeemCoupon(session: ClientSession, applied: AppliedCoupon, userId: ObjectId, orderId: ObjectId): Promise<void> {
  const c = await getCollections();
  const couponId = new ObjectId(applied.id);
  const res = await c.coupons.findOneAndUpdate(
    { _id: couponId, active: true, $expr: { $or: [{ $eq: ["$maxRedemptions", null] }, { $not: ["$maxRedemptions"] }, { $lt: ["$usedCount", "$maxRedemptions"] }] } },
    { $inc: { usedCount: 1 } },
    { session, returnDocument: "after" },
  );
  if (!res) throw new AppError("BUSINESS_RULE_VIOLATION", { message: ISSUE_MESSAGE.used_up, details: [{ field: "couponCode", code: "USED_UP" }] });
  if ((await c.couponRedemptions.countDocuments({ couponId, userId, released: false }, { session })) >= res.perUserLimit) {
    throw new AppError("BUSINESS_RULE_VIOLATION", { message: ISSUE_MESSAGE.already_used, details: [{ field: "couponCode", code: "ALREADY_USED" }] });
  }
  await c.couponRedemptions.insertOne({ _id: new ObjectId(), couponId, userId, orderId, discountMinor: applied.discountMinor, released: false, createdAt: new Date() }, { session });
}

/** An order that used a coupon was cancelled: give the use back. Safe to call for any order. */
export async function releaseCouponForOrder(session: ClientSession, orderId: ObjectId): Promise<void> {
  const c = await getCollections();
  const r = await c.couponRedemptions.findOneAndUpdate({ orderId, released: false }, { $set: { released: true } }, { session });
  if (r) await c.coupons.updateOne({ _id: r.couponId }, { $inc: { usedCount: -1 } }, { session });
}

// ---------- seller management ----------
export interface CouponInput {
  code: string;
  kind: "percent" | "fixed";
  value: number;
  minSubtotalMinor?: number;
  maxDiscountMinor?: number;
  startsAt?: Date;
  expiresAt?: Date;
  maxRedemptions?: number;
  perUserLimit: number;
}

const toDto = (c: CouponDoc) => ({
  id: c._id.toHexString(), code: c.code, kind: c.kind, value: c.value, label: labelOf(c), minSubtotalMinor: c.minSubtotalMinor, maxDiscountMinor: c.maxDiscountMinor,
  startsAt: c.startsAt?.toISOString(), expiresAt: c.expiresAt?.toISOString(), maxRedemptions: c.maxRedemptions, perUserLimit: c.perUserLimit, usedCount: c.usedCount, active: c.active, createdAt: c.createdAt.toISOString(),
});

export async function createCoupon(vendorId: ObjectId, input: CouponInput) {
  const code = normaliseCode(input.code);
  if (!CODE_RE.test(code)) throw new AppError("VALIDATION_FAILED", { details: [{ field: "code", code: "INVALID_FORMAT" }] });
  if (input.kind === "percent" && (input.value < 1 || input.value > 90)) throw new AppError("VALIDATION_FAILED", { details: [{ field: "value", code: "OUT_OF_RANGE" }] });
  if (input.kind === "fixed" && input.value < MIN_PAYABLE_MINOR) throw new AppError("VALIDATION_FAILED", { details: [{ field: "value", code: "OUT_OF_RANGE" }] });
  if (input.startsAt && input.expiresAt && input.expiresAt <= input.startsAt) throw new AppError("VALIDATION_FAILED", { details: [{ field: "expiresAt", code: "BEFORE_START" }] });
  const c = await getCollections();
  const doc: CouponDoc = { _id: new ObjectId(), vendorId, ...input, code, usedCount: 0, active: true, createdAt: new Date() };
  try {
    await c.coupons.insertOne(doc);
  } catch (e) {
    if (e instanceof MongoServerError && e.code === 11000) throw new AppError("CONFLICT", { message: "That code is already taken.", details: [{ field: "code", code: "DUPLICATE" }] });
    throw e;
  }
  return toDto(doc);
}

export async function listCoupons(vendorId: ObjectId) {
  const c = await getCollections();
  return (await c.coupons.find({ vendorId }).sort({ _id: -1 }).limit(200).toArray()).map(toDto);
}

export async function updateCoupon(vendorId: ObjectId, id: ObjectId, patch: { active?: boolean; expiresAt?: Date | null; maxRedemptions?: number | null }) {
  const c = await getCollections();
  const set: Record<string, unknown> = {};
  const unset: Record<string, ""> = {};
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.expiresAt === null) unset.expiresAt = ""; else if (patch.expiresAt) set.expiresAt = patch.expiresAt;
  if (patch.maxRedemptions === null) unset.maxRedemptions = ""; else if (patch.maxRedemptions !== undefined) set.maxRedemptions = patch.maxRedemptions;
  const update: Record<string, unknown> = {};
  if (Object.keys(set).length) update.$set = set;
  if (Object.keys(unset).length) update.$unset = unset;
  if (Object.keys(update).length === 0) throw new AppError("VALIDATION_FAILED", { details: [{ field: "body", code: "EMPTY" }] });
  const res = await c.coupons.findOneAndUpdate({ _id: id, vendorId }, update, { returnDocument: "after" });
  if (!res) throw new AppError("NOT_FOUND");
  return toDto(res);
}
