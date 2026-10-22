import { z } from "zod";
import { created, ok, page, route, type Ctx } from "@/server/api/route";
import { requirePermission, requireRole, requireVendor } from "@/server/modules/authorization/actor";
import { parseObjectId } from "@/server/shared/ids";
import { pageQuery } from "@/server/shared/pagination";
import { approveReturn, dispatchWithCourier, getShipmentTracking, getVendorOrder, listVendorOrders, rejectReturn, requestReturn, toVendorOrderDto, transitionVendorOrder } from "@/server/modules/orders/fulfillment";
import { getCollections } from "@/server/db/collections";

const vendorScope = <P>(ctx: Ctx<P>) => ({ kind: "vendor" as const, userId: ctx.actor.userId, vendorId: requireVendor(ctx.actor) });
const note = z.strictObject({ reason: z.string().trim().min(3).max(300) });

export const vendorOrdersHandler = route({ name: "vendor.orders.list" }, async (ctx) => {
  const q = ctx.query(pageQuery.extend({ status: z.enum(["new", "accepted", "shipped", "delivered", "cancelled", "return_requested", "returned"]).optional() }));
  const r = await listVendorOrders(requireVendor(ctx.actor), q);
  return page(r.items, r);
});

export const vendorOrderHandler = route<{ id: string }>({ name: "vendor.orders.get" }, async (ctx) =>
  ok(await getVendorOrder(requireVendor(ctx.actor), parseObjectId(ctx.params.id))),
);

async function respond(promise: ReturnType<typeof transitionVendorOrder>) {
  const vo = await promise;
  const c = await getCollections();
  const parent = await c.orders.findOne({ _id: vo.parentOrderId }, { projection: { paymentMethod: 1, paymentStatus: 1, buyerId: 1 } });
  return ok(toVendorOrderDto(vo, parent ?? undefined));
}

export const acceptOrderHandler = route<{ id: string }>({ name: "vendor.orders.accept" }, async (ctx) =>
  respond(transitionVendorOrder(vendorScope(ctx), parseObjectId(ctx.params.id), { to: "accepted" }, ctx.requestId)),
);

export const shipOrderHandler = route<{ id: string }>({ name: "vendor.orders.ship" }, async (ctx) => {
  vendorScope(ctx); // authorize before parsing the body
  const b = await ctx.body(z.strictObject({ carrier: z.string().trim().min(2).max(60), trackingNumber: z.string().trim().min(3).max(60).regex(/^[0-9A-Za-z\-_/ ]+$/) }));
  return respond(transitionVendorOrder(vendorScope(ctx), parseObjectId(ctx.params.id), { to: "shipped", shipment: b }, ctx.requestId));
});

export const dispatchOrderHandler = route<{ id: string }>({ name: "vendor.orders.dispatch" }, async (ctx) => {
  vendorScope(ctx); // authorize before parsing the body
  const b = (await ctx.body(z.strictObject({ carrier: z.string().trim().min(2).max(30).optional(), weightGrams: z.number().int().min(50).max(50000).optional() })).catch(() => ({}))) ?? {};
  return respond(dispatchWithCourier(vendorScope(ctx), parseObjectId(ctx.params.id), b, ctx.requestId));
});

export const trackShipmentHandler = route<{ carrier: string; trackingNumber: string }>({ name: "tracking.get", auth: false }, async (ctx) => {
  return ok(await getShipmentTracking(ctx.params.carrier, ctx.params.trackingNumber));
});

export const deliverOrderHandler = route<{ id: string }>({ name: "vendor.orders.deliver" }, async (ctx) =>
  respond(transitionVendorOrder(vendorScope(ctx), parseObjectId(ctx.params.id), { to: "delivered" }, ctx.requestId)),
);

/** Reject while `new`, or cancel after accepting (e.g. out of stock). Online payments are refunded automatically. */
export const cancelOrderVendorHandler = route<{ id: string }>({ name: "vendor.orders.cancel" }, async (ctx) => {
  vendorScope(ctx); // authorize before parsing the body
  const b = await ctx.body(note);
  return respond(transitionVendorOrder(vendorScope(ctx), parseObjectId(ctx.params.id), { to: "cancelled", note: b.reason }, ctx.requestId));
});

export const approveReturnHandler = route<{ id: string }>({ name: "vendor.orders.return.approve" }, async (ctx) => {
  const vo = await approveReturn(vendorScope(ctx), parseObjectId(ctx.params.id), ctx.requestId);
  return ok(toVendorOrderDto(vo));
});

export const rejectReturnHandler = route<{ id: string }>({ name: "vendor.orders.return.reject" }, async (ctx) => {
  vendorScope(ctx); // authorize before parsing the body
  const b = await ctx.body(note);
  return ok(toVendorOrderDto(await rejectReturn(vendorScope(ctx), parseObjectId(ctx.params.id), b.reason, ctx.requestId)));
});

// ----- customer returns -----
export const requestReturnHandler = route<{ id: string }>(
  { name: "vendor_orders.return_request", rateLimit: { rule: { name: "returns.request", limit: 10, windowSeconds: 3600 }, by: "actor" } },
  async (ctx) => {
    requireRole(ctx.actor, "customer");
    const b = await ctx.body(note);
    const vo = await requestReturn(ctx.actor.userId, parseObjectId(ctx.params.id), b.reason, ctx.requestId);
    return created({ id: vo._id.toHexString(), status: vo.fulfillmentStatus });
  },
);

// ----- admin -----
export const adminCancelVendorOrderHandler = route<{ id: string }>({ name: "admin.vendor_orders.cancel" }, async (ctx) => {
  requirePermission(ctx.actor, "order.manage");
  const b = await ctx.body(note);
  const vo = await transitionVendorOrder({ kind: "admin", actor: ctx.actor }, parseObjectId(ctx.params.id), { to: "cancelled", note: b.reason }, ctx.requestId);
  return ok(toVendorOrderDto(vo));
});
