import { z } from "zod";
import { created, noContent, ok, page, route } from "@/server/api/route";
import { requireRole } from "@/server/modules/authorization/actor";
import { parseObjectId } from "@/server/shared/ids";
import { pageQuery } from "@/server/shared/pagination";
import { createAddress, deleteAddress, listAddresses, updateAddress } from "@/server/modules/addresses/service";
import { addItem, getCart, MAX_QTY_PER_LINE, removeItem, setQuantity } from "@/server/modules/cart/service";
import { toQuoteDto } from "@/server/modules/checkout/quote";
import { placeOrder, quoteCheckout } from "@/server/modules/checkout/service";
import { requireIdempotencyKey, withIdempotency } from "@/server/modules/idempotency/idempotency";
import { cancelOrder, getOrder, listOrders } from "@/server/modules/orders/service";

const objectIdStr = z.string().regex(/^[0-9a-f]{24}$/i);
const qty = z.number().int().min(1).max(MAX_QTY_PER_LINE);

// ----- addresses -----
const phone = z.string().regex(/^\+?[0-9]{7,15}$/);
const addressBody = z.strictObject({
  label: z.string().trim().min(1).max(40), recipient: z.string().trim().min(2).max(80), phone,
  line1: z.string().trim().min(3).max(200), line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(2).max(80), district: z.string().trim().min(2).max(80),
  postalCode: z.string().trim().regex(/^[0-9]{4}$/), isDefault: z.boolean().optional(),
});

export const listAddressesHandler = route({ name: "addresses.list" }, async (ctx) => ok(await listAddresses(ctx.actor.userId)));
export const createAddressHandler = route({ name: "addresses.create" }, async (ctx) => created(await createAddress(ctx.actor.userId, await ctx.body(addressBody))));
export const updateAddressHandler = route<{ id: string }>({ name: "addresses.update" }, async (ctx) =>
  ok(await updateAddress(ctx.actor.userId, parseObjectId(ctx.params.id), await ctx.body(addressBody.partial()))),
);
export const deleteAddressHandler = route<{ id: string }>({ name: "addresses.delete" }, async (ctx) => {
  await deleteAddress(ctx.actor.userId, parseObjectId(ctx.params.id));
  return noContent();
});

// ----- cart -----
export const getCartHandler = route({ name: "cart.get" }, async (ctx) => {
  requireRole(ctx.actor, "customer");
  return ok(toQuoteDto(await getCart(ctx.actor.userId)));
});

export const addCartItemHandler = route({ name: "cart.add" }, async (ctx) => {
  requireRole(ctx.actor, "customer");
  const b = await ctx.body(z.strictObject({ productId: objectIdStr, variantId: z.string().min(1).max(40), quantity: qty }));
  return created(toQuoteDto(await addItem(ctx.actor.userId, { ...b, productId: parseObjectId(b.productId, "productId") })));
});

export const patchCartItemHandler = route<{ itemId: string }>({ name: "cart.patch" }, async (ctx) => {
  requireRole(ctx.actor, "customer");
  const b = await ctx.body(z.strictObject({ quantity: qty }));
  return ok(toQuoteDto(await setQuantity(ctx.actor.userId, ctx.params.itemId, b.quantity)));
});

export const deleteCartItemHandler = route<{ itemId: string }>({ name: "cart.delete" }, async (ctx) => {
  requireRole(ctx.actor, "customer");
  return ok(toQuoteDto(await removeItem(ctx.actor.userId, ctx.params.itemId)));
});

// ----- checkout -----
export const quoteHandler = route({ name: "checkout.quote", rateLimit: { rule: { name: "checkout.quote", limit: 60, windowSeconds: 60 }, by: "actor" } }, async (ctx) => {
  requireRole(ctx.actor, "customer");
  const b = await ctx.body(z.strictObject({ addressId: objectIdStr }));
  return ok(await quoteCheckout(ctx.actor, { addressId: parseObjectId(b.addressId, "addressId") }));
});

const checkoutBody = z.strictObject({ addressId: objectIdStr, paymentMethod: z.enum(["online", "cod"]), expectedTotalMinor: z.number().int().min(0) });

export const checkoutHandler = route(
  { name: "checkout.create", rateLimit: { rule: { name: "checkout.create", limit: 20, windowSeconds: 600 }, by: "actor" } },
  async (ctx) => {
    requireRole(ctx.actor, "customer");
    const key = requireIdempotencyKey(ctx.header("idempotency-key"));
    const b = await ctx.body(checkoutBody);
    const res = await withIdempotency({ actorScope: ctx.actor.userId.toHexString(), operation: "checkout", key, request: b }, async () => {
      const order = await placeOrder(ctx.actor, { addressId: parseObjectId(b.addressId, "addressId"), paymentMethod: b.paymentMethod, expectedTotalMinor: b.expectedTotalMinor });
      return { status: 201, body: order };
    });
    return { status: res.status, data: res.body, headers: res.replayed ? { "Idempotent-Replayed": "true" } : undefined };
  },
);

// ----- orders -----
export const listOrdersHandler = route({ name: "orders.list" }, async (ctx) => {
  requireRole(ctx.actor, "customer");
  const r = await listOrders(ctx.actor.userId, ctx.query(pageQuery));
  return page(r.items, r);
});

export const getOrderHandler = route<{ id: string }>({ name: "orders.get" }, async (ctx) => {
  requireRole(ctx.actor, "customer");
  return ok(await getOrder(ctx.actor.userId, parseObjectId(ctx.params.id)));
});

export const cancelOrderHandler = route<{ id: string }>({ name: "orders.cancel" }, async (ctx) => {
  requireRole(ctx.actor, "customer");
  const b = (await ctx.body(z.strictObject({ reason: z.string().trim().max(300).optional() }))) ?? {};
  return ok(await cancelOrder(ctx.actor, parseObjectId(ctx.params.id), b.reason ?? "customer request"));
});
