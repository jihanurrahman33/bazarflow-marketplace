import { MongoServerError, ObjectId } from "mongodb";
import { getEnv } from "@/server/config/env";
import { getCollections } from "@/server/db/collections";
import { withTransaction } from "@/server/db/transaction";
import type { OrderDoc, PaymentMethod, VendorOrderDoc } from "@/server/db/schema";
import { AppError } from "@/server/shared/errors";
import { newId, publicOrderNumber } from "@/server/shared/ids";
import { percentBps, money } from "@/server/shared/money";
import { enqueue } from "@/server/modules/outbox/outbox";
import type { Actor } from "@/server/modules/authorization/actor";
import { getOwnedAddress } from "@/server/modules/addresses/service";
import { reserveLines, settleReservation } from "@/server/modules/inventory/service";
import { toOrderDto } from "@/server/modules/orders/dto";
import { getPaymentAdapter } from "@/server/modules/payments/registry";
import { buildQuote, toQuoteDto, type Quote } from "./quote";

export interface CheckoutInput {
  addressId: ObjectId;
  paymentMethod: PaymentMethod;
  /** What the shopper last saw. A mismatch with the recomputed total aborts with PRICE_CHANGED. */
  expectedTotalMinor: number;
}

function assertPaymentMethod(method: PaymentMethod) {
  if (method === "cod" && !getEnv().COD_ENABLED) {
    throw new AppError("BUSINESS_RULE_VIOLATION", { message: "Cash on delivery is not available.", details: [{ field: "paymentMethod", code: "UNAVAILABLE" }] });
  }
}

export async function quoteCheckout(actor: Actor, input: { addressId: ObjectId }) {
  const c = await getCollections();
  const address = await getOwnedAddress(actor.userId, input.addressId);
  const cart = await c.carts.findOne({ userId: actor.userId });
  const quote = await buildQuote(cart?.lines ?? [], address.district);
  return { ...toQuoteDto(quote), paymentMethods: ["online", ...(getEnv().COD_ENABLED ? ["cod"] : [])] };
}

function assertQuoteOrderable(quote: Quote) {
  if (quote.groups.length === 0 && quote.issues.length === 0) throw new AppError("CART_EMPTY");
  if (quote.issues.length > 0) {
    const stock = quote.issues.every((i) => i.code === "INSUFFICIENT_STOCK");
    throw new AppError(stock ? "INVENTORY_UNAVAILABLE" : "PRODUCT_UNAVAILABLE", { details: quote.issues.map((i) => ({ field: i.itemId, code: i.code })) });
  }
  if (quote.groups.length === 0) throw new AppError("CART_EMPTY");
}

/**
 * Create the parent order, one vendor order per seller, and reserve stock — atomically.
 * Online orders wait for payment (reservation expires); COD orders commit stock immediately.
 * Payment initiation happens AFTER this transaction commits (never inside it).
 */
export async function placeOrder(actor: Actor, input: CheckoutInput) {
  assertPaymentMethod(input.paymentMethod);
  const c = await getCollections();
  const address = await getOwnedAddress(actor.userId, input.addressId);
  const cart = await c.carts.findOne({ userId: actor.userId });
  const quote = await buildQuote(cart?.lines ?? [], address.district);
  assertQuoteOrderable(quote);
  if (input.paymentMethod === "online") {
    const caps = getPaymentAdapter().capabilities();
    if (quote.totals.totalMinor < caps.minAmountMinor || quote.totals.totalMinor > caps.maxAmountMinor) {
      throw new AppError("BUSINESS_RULE_VIOLATION", { message: "This order total cannot be paid online.", details: [{ field: "total", code: "AMOUNT_OUT_OF_RANGE" }] });
    }
  }
  if (quote.totals.totalMinor !== input.expectedTotalMinor) {
    throw new AppError("PRICE_CHANGED", { message: "Prices or shipping changed. Review your order.", details: [{ field: "expectedTotalMinor", code: "MISMATCH" }] });
  }

  const env = getEnv();
  const now = new Date();
  const cod = input.paymentMethod === "cod";
  const snapshot = {
    recipient: address.recipient, phone: address.phone, line1: address.line1, line2: address.line2,
    city: address.city, district: address.district, postalCode: address.postalCode, country: address.country,
  } as const;

  for (let attempt = 0; attempt < 5; attempt++) {
    const orderId = newId();
    const orderNumber = publicOrderNumber();
    const vendorOrders: VendorOrderDoc[] = quote.groups.map((g) => {
      const commissionMinor = percentBps(money(g.subtotalMinor), g.vendor.commissionBps).amountMinor;
      const status = cod ? "new" : "awaiting_payment";
      return {
        _id: newId(), parentOrderId: orderId, publicOrderNumber: orderNumber, vendorId: new ObjectId(g.vendorId), buyerId: actor.userId,
        vendorName: g.vendor.name, vendorSlug: g.vendor.slug, currency: quote.currency,
        items: g.lines.map((l) => ({
          productId: new ObjectId(l.productId), variantId: l.variantId, sku: l.sku, title: l.title, variantLabel: l.variantLabel,
          imageUrl: l.imageUrl, unitPriceMinor: l.unitPriceMinor, quantity: l.quantity, lineTotalMinor: l.lineTotalMinor,
        })),
        totals: { subtotalMinor: g.subtotalMinor, shippingMinor: g.shippingMinor, totalMinor: g.totalMinor },
        // Commission applies to the item subtotal only; the vendor keeps shipping. Rate + rule version are frozen here.
        commission: { bps: g.vendor.commissionBps, ruleVersion: g.vendor.commissionRuleVersion, amountMinor: commissionMinor, vendorNetMinor: g.totalMinor - commissionMinor },
        fulfillmentStatus: status, shippingAddress: snapshot, timeline: [{ status, at: now }], version: 1, createdAt: now, updatedAt: now,
      };
    });
    const order: OrderDoc = {
      _id: orderId, publicOrderNumber: orderNumber, buyerId: actor.userId, currency: quote.currency, totals: quote.totals,
      vendorOrderIds: vendorOrders.map((v) => v._id), paymentMethod: input.paymentMethod,
      paymentStatus: cod ? "cod_pending" : "pending", status: cod ? "confirmed" : "pending_payment",
      shippingAddress: snapshot, version: 1, createdAt: now, updatedAt: now,
    };

    try {
      await withTransaction(async (session) => {
        await c.orders.insertOne(order, { session });
        await c.vendorOrders.insertMany(vendorOrders, { session });
        const reserveInput = quote.groups.flatMap((g) => g.lines.map((l) => ({ inventoryItemId: l.inventoryItemId, quantity: l.quantity })));
        await reserveLines(session, orderId, reserveInput);
        await c.stockReservations.insertOne(
          { _id: newId(), orderId, lines: reserveInput, status: "active", expiresAt: new Date(now.getTime() + env.STOCK_RESERVATION_TTL_MINUTES * 60_000), createdAt: now },
          { session },
        );
        if (cod) await settleReservation(session, orderId, "commit");
        // Only the ordered lines leave the cart.
        await c.carts.updateOne({ userId: actor.userId }, { $set: { lines: [], updatedAt: now } }, { session });
        if (cod) await enqueueOrderConfirmed(order, vendorOrders, session);
      });
      return toOrderDto(order, vendorOrders);
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000 && String(e.message).includes("uq_orders_public_number")) continue;
      throw e;
    }
  }
  throw new AppError("INTERNAL", { message: "Could not allocate an order number." });
}

type Session = Parameters<Parameters<typeof withTransaction>[0]>[0];

/** Buyer receipt + one alert per vendor. Called when an order becomes payable-confirmed (COD at placement, online on payment). */
export async function enqueueOrderConfirmed(order: OrderDoc, vendorOrders: VendorOrderDoc[], session: Session): Promise<void> {
  const c = await getCollections();
  await enqueue(
    {
      type: "notify.user", aggregateType: "order", aggregateId: order._id.toHexString(), dedupeKey: `order-confirmed:${order._id.toHexString()}`,
      payload: { userId: order.buyerId.toHexString(), eventType: "order.confirmed", title: `Order ${order.publicOrderNumber} confirmed`, body: "The sellers have been notified.", deepLink: `/orders/${order._id.toHexString()}` },
    },
    session,
  );
  const vendors = await c.vendors.find({ _id: { $in: vendorOrders.map((v) => v.vendorId) } }, { session }).toArray();
  const owner = new Map(vendors.map((v) => [v._id.toHexString(), v.ownerUserId]));
  for (const vo of vendorOrders) {
    const ownerId = owner.get(vo.vendorId.toHexString());
    if (!ownerId) continue;
    await enqueue(
      {
        type: "notify.user", aggregateType: "vendor_order", aggregateId: vo._id.toHexString(), dedupeKey: `vendor-order-new:${vo._id.toHexString()}`,
        payload: { userId: ownerId.toHexString(), eventType: "vendor_order.new", title: "New order", body: `${vo.items.length} item(s) · ${vo.publicOrderNumber}`, deepLink: `/vendor/orders/${vo._id.toHexString()}` },
      },
      session,
    );
  }
}
