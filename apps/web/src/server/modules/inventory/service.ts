import { ObjectId, type ClientSession } from "mongodb";
import { withTransaction } from "@/server/db/transaction";
import { getCollections } from "@/server/db/collections";
import type { InventoryItemDoc, InventoryMovementKind } from "@/server/db/schema";
import { AppError } from "@/server/shared/errors";
import { newId } from "@/server/shared/ids";
import { decodeCursor, encodeCursor, slicePage } from "@/server/shared/pagination";

/**
 * Stock model (single formula, used everywhere): available = onHand - reserved.
 *  - reserve:  reserved += q            (only if available >= q)
 *  - release:  reserved -= q
 *  - commit:   onHand -= q, reserved -= q   (sale confirmed)
 *  - restock:  onHand += q              (cancelled shipment / return)
 */

export const availableOf = (i: Pick<InventoryItemDoc, "onHand" | "reserved">): number => i.onHand - i.reserved;

export interface ReserveLine {
  inventoryItemId: ObjectId;
  quantity: number;
}

async function movement(
  session: ClientSession | undefined,
  item: Pick<InventoryItemDoc, "_id" | "vendorId" | "sku">,
  kind: InventoryMovementKind,
  deltaOnHand: number,
  deltaReserved: number,
  reason: string,
  extra: { actorId?: ObjectId; orderId?: ObjectId } = {},
) {
  const c = await getCollections();
  await c.inventoryMovements.insertOne(
    { _id: newId(), inventoryItemId: item._id, vendorId: item.vendorId, sku: item.sku, kind, deltaOnHand, deltaReserved, reason, createdAt: new Date(), ...extra },
    { session },
  );
}

/**
 * Reserve stock with a conditional write. Must run inside the caller's transaction so a failure on line N
 * rolls back lines 1..N-1. Never read-then-write: the availability check is part of the update filter.
 */
export async function reserveLines(session: ClientSession, orderId: ObjectId, lines: ReserveLine[]): Promise<void> {
  const c = await getCollections();
  // Deterministic order avoids deadlock-ish write conflicts between concurrent checkouts.
  const ordered = [...lines].sort((a, b) => a.inventoryItemId.toHexString().localeCompare(b.inventoryItemId.toHexString()));
  for (const line of ordered) {
    const item = await c.inventoryItems.findOneAndUpdate(
      { _id: line.inventoryItemId, $expr: { $gte: [{ $subtract: ["$onHand", "$reserved"] }, line.quantity] } },
      { $inc: { reserved: line.quantity, version: 1 }, $set: { updatedAt: new Date() } },
      { session, returnDocument: "after" },
    );
    if (!item) throw new AppError("INVENTORY_UNAVAILABLE", { details: [{ field: line.inventoryItemId.toHexString(), code: "INSUFFICIENT_STOCK" }] });
    await movement(session, item, "reserve", 0, line.quantity, "checkout reservation", { orderId });
  }
}

type SettleKind = "release" | "commit";

/**
 * Settle an active reservation exactly once. The status compare-and-set makes duplicate calls (late webhook,
 * expiry job racing a payment) harmless: only the caller that flips active -> settled applies the stock change.
 * Returns false when the reservation was already settled.
 */
export async function settleReservation(session: ClientSession, orderId: ObjectId, kind: SettleKind): Promise<boolean> {
  const c = await getCollections();
  const reservation = await c.stockReservations.findOneAndUpdate(
    { orderId, status: "active" },
    { $set: { status: kind === "commit" ? "committed" : "released", settledAt: new Date() } },
    { session, returnDocument: "before" },
  );
  if (!reservation) return false;
  for (const line of reservation.lines) {
    const q = line.quantity;
    const item = await c.inventoryItems.findOneAndUpdate(
      { _id: line.inventoryItemId, reserved: { $gte: q }, ...(kind === "commit" ? { onHand: { $gte: q } } : {}) },
      { $inc: { reserved: -q, ...(kind === "commit" ? { onHand: -q } : {}), version: 1 }, $set: { updatedAt: new Date() } },
      { session, returnDocument: "after" },
    );
    if (!item) throw new AppError("INTERNAL", { message: "Reservation accounting mismatch." });
    await movement(session, item, kind, kind === "commit" ? -q : 0, -q, kind === "commit" ? "sale committed" : "reservation released", { orderId });
  }
  return true;
}

export async function restock(session: ClientSession | undefined, itemId: ObjectId, quantity: number, reason: string, orderId?: ObjectId) {
  const c = await getCollections();
  const item = await c.inventoryItems.findOneAndUpdate(
    { _id: itemId },
    { $inc: { onHand: quantity, version: 1 }, $set: { updatedAt: new Date() } },
    { session, returnDocument: "after" },
  );
  if (!item) throw new AppError("NOT_FOUND");
  await movement(session, item, "restock", quantity, 0, reason, { orderId });
}

const toDto = (i: InventoryItemDoc) => ({
  id: i._id.toHexString(), productId: i.productId.toHexString(), variantId: i.variantId, sku: i.sku,
  onHand: i.onHand, reserved: i.reserved, available: availableOf(i), updatedAt: i.updatedAt.toISOString(),
});

export async function listVendorInventory(vendorId: ObjectId, q: { limit: number; cursor?: string; lowStock?: number; productId?: ObjectId }) {
  const c = await getCollections();
  const cur = decodeCursor<{ id: string }>(q.cursor);
  const filter: Record<string, unknown> = { vendorId };
  if (q.productId) filter.productId = q.productId;
  if (cur) filter._id = { $gt: new ObjectId(cur.id) };
  if (q.lowStock !== undefined) filter.$expr = { $lte: [{ $subtract: ["$onHand", "$reserved"] }, q.lowStock] };
  const rows = await c.inventoryItems.find(filter).sort({ _id: 1 }).limit(q.limit + 1).toArray();
  const { items, hasMore } = slicePage(rows, q.limit);
  const products = await c.products.find({ _id: { $in: items.map((i) => i.productId) } }, { projection: { title: 1 } }).toArray();
  const titles = new Map(products.map((p) => [p._id.toHexString(), p.title]));
  const last = items[items.length - 1];
  return {
    items: items.map((i) => ({ ...toDto(i), productTitle: titles.get(i.productId.toHexString()) })),
    nextCursor: hasMore && last ? encodeCursor({ id: last._id.toHexString() }) : null,
  };
}

/**
 * Vendor stock correction. `onHand` is set absolutely, but only via a conditional write that keeps
 * onHand >= reserved, so a vendor can never strand customers' reservations. Ownership is part of the filter.
 */
export async function adjustStock(
  actor: { userId: ObjectId; vendorId: ObjectId },
  itemId: ObjectId,
  change: { set?: number; delta?: number },
  reason: string,
) {
  const c = await getCollections();
  const current = await c.inventoryItems.findOne({ _id: itemId, vendorId: actor.vendorId });
  if (!current) throw new AppError("NOT_FOUND");
  const target = change.set ?? current.onHand + (change.delta ?? 0);
  if (!Number.isSafeInteger(target) || target < 0 || target > 1_000_000) {
    throw new AppError("VALIDATION_FAILED", { details: [{ field: "onHand", code: "OUT_OF_RANGE" }] });
  }
  const delta = target - current.onHand;
  const updated = await c.inventoryItems.findOneAndUpdate(
    // compare-and-set on version AND keep reserved stock covered
    { _id: itemId, vendorId: actor.vendorId, version: current.version, reserved: { $lte: target } },
    { $set: { onHand: target, updatedAt: new Date() }, $inc: { version: 1 } },
    { returnDocument: "after" },
  );
  if (!updated) {
    throw new AppError("CONFLICT", { message: "Stock changed or is below reserved quantity. Reload and try again.", details: [{ field: "onHand", code: "BELOW_RESERVED" }] });
  }
  await movement(undefined, updated, "adjust", delta, 0, reason, { actorId: actor.userId });
  return toDto(updated);
}

export async function listMovements(vendorId: ObjectId, itemId: ObjectId, limit = 50) {
  const c = await getCollections();
  const item = await c.inventoryItems.findOne({ _id: itemId, vendorId }, { projection: { _id: 1 } });
  if (!item) throw new AppError("NOT_FOUND");
  const rows = await c.inventoryMovements.find({ inventoryItemId: itemId }).sort({ _id: -1 }).limit(limit).toArray();
  return rows.map((m) => ({ id: m._id.toHexString(), kind: m.kind, deltaOnHand: m.deltaOnHand, deltaReserved: m.deltaReserved, reason: m.reason, createdAt: m.createdAt.toISOString() }));
}

/** Release every reservation whose TTL has passed (scheduled job). */
export async function expireReservations(now = new Date(), batch = 100): Promise<number> {
  const c = await getCollections();
  const due = await c.stockReservations.find({ status: "active", expiresAt: { $lte: now } }).limit(batch).toArray();
  let released = 0;
  for (const r of due) {
    const done = await withTransaction((session) => settleReservation(session, r.orderId, "release"));
    if (done) released++;
  }
  return released;
}
