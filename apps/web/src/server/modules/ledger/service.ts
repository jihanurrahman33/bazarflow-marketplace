import { ObjectId, type ClientSession } from "mongodb";
import { getEnv } from "@/server/config/env";
import { getCollections } from "@/server/db/collections";
import type { LedgerEntryDoc, LedgerEntryType, VendorOrderDoc } from "@/server/db/schema";
import { newId } from "@/server/shared/ids";
import { decodeCursor, encodeCursor, slicePage } from "@/server/shared/pagination";

/**
 * Append-only vendor ledger. Positive = the platform owes the vendor. Entries are never edited: mistakes are
 * corrected with reversals. Every entry has a unique idempotency reference so retries/duplicate events
 * can never post twice.
 */

type NewEntry = Omit<LedgerEntryDoc, "_id" | "createdAt" | "source"> & { source?: LedgerEntryDoc["source"] };

/**
 * Insert-if-absent keyed by the idempotency reference. Implemented as an upsert (not insert + catch) because a
 * duplicate-key error would abort the surrounding transaction. Returns false when the entry already existed.
 */
export async function postEntry(entry: NewEntry, session?: ClientSession): Promise<boolean> {
  const c = await getCollections();
  const res = await c.ledgerEntries.updateOne(
    { idempotencyReference: entry.idempotencyReference },
    { $setOnInsert: { _id: newId(), createdAt: new Date(), source: "system", ...entry } },
    { upsert: true, session },
  );
  return res.upsertedCount === 1;
}

/** Online sale confirmed by a verified payment: gross to the vendor, platform commission against it. */
export async function postOnlineSale(vo: VendorOrderDoc, paymentId: ObjectId, session: ClientSession): Promise<void> {
  const base = { vendorId: vo.vendorId, currency: vo.currency, orderId: vo.parentOrderId, vendorOrderId: vo._id, paymentId, ruleVersion: vo.commission.ruleVersion };
  await postEntry({ ...base, type: "sale_gross", amountMinor: vo.totals.totalMinor, idempotencyReference: `sale:${vo._id.toHexString()}` }, session);
  await postEntry({ ...base, type: "platform_commission", amountMinor: -vo.commission.amountMinor, idempotencyReference: `commission:${vo._id.toHexString()}` }, session);
}

/** Make a vendor order's sale entries payable after the hold period (called when it is delivered). */
export async function releaseSaleEntries(vendorOrderId: ObjectId, deliveredAt: Date, session: ClientSession): Promise<void> {
  const c = await getCollections();
  const availableAt = new Date(deliveredAt.getTime() + getEnv().PAYOUT_HOLD_DAYS * 86_400_000);
  // availableAt is set once; this is the single permitted "update" on a ledger row and only fills an empty field.
  await c.ledgerEntries.updateMany(
    { vendorOrderId, type: { $in: ["sale_gross", "platform_commission", "refund_debit", "refund_commission_reversal"] }, availableAt: { $exists: false } },
    { $set: { availableAt } },
    { session },
  );
}

/** COD: the platform never held the money, so the vendor simply owes the commission once delivered. */
export async function postCodCommission(vo: VendorOrderDoc, deliveredAt: Date, session: ClientSession): Promise<void> {
  await postEntry(
    {
      vendorId: vo.vendorId, currency: vo.currency, orderId: vo.parentOrderId, vendorOrderId: vo._id, type: "platform_commission",
      amountMinor: -vo.commission.amountMinor, idempotencyReference: `commission:${vo._id.toHexString()}`, ruleVersion: vo.commission.ruleVersion, availableAt: deliveredAt,
    },
    session,
  );
}

/**
 * Refund of part/all of a vendor order. Commission is returned proportionally using cumulative rounding so that
 * the sum of reversals over any sequence of partial refunds equals the exact commission once fully refunded.
 */
export async function postRefund(
  args: { refundId: ObjectId; vo: VendorOrderDoc; paymentId: ObjectId; amountMinor: number; refundedBeforeMinor: number },
  session: ClientSession,
): Promise<void> {
  const { vo, amountMinor, refundedBeforeMinor } = args;
  const total = vo.totals.totalMinor;
  const commission = vo.commission.amountMinor;
  const reversedBefore = Math.round((commission * refundedBeforeMinor) / total);
  const reversedAfter = Math.round((commission * (refundedBeforeMinor + amountMinor)) / total);
  // A refund nets against its sale: it becomes payable-affecting only when the sale does. If the sale is still held
  // (or not yet released) the refund is held with it; if the sale is already payable the refund applies now.
  const c = await getCollections();
  const sale = await c.ledgerEntries.findOne({ idempotencyReference: `sale:${vo._id.toHexString()}` }, { session });
  const now = new Date();
  const availableAt = sale?.availableAt ? (sale.availableAt > now ? sale.availableAt : now) : sale ? undefined : now;
  const base = { vendorId: vo.vendorId, currency: vo.currency, orderId: vo.parentOrderId, vendorOrderId: vo._id, paymentId: args.paymentId, refundId: args.refundId, ...(availableAt ? { availableAt } : {}) };
  await postEntry({ ...base, type: "refund_debit", amountMinor: -amountMinor, idempotencyReference: `refund:${args.refundId.toHexString()}` }, session);
  if (reversedAfter - reversedBefore !== 0) {
    await postEntry({ ...base, type: "refund_commission_reversal", amountMinor: reversedAfter - reversedBefore, idempotencyReference: `refund-commission:${args.refundId.toHexString()}` }, session);
  }
}

export interface Balance {
  currency: "BDT";
  /** Payable now: released entries (after hold) net of refunds and payouts. May be negative. */
  availableMinor: number;
  /** Earned but still held (not yet delivered / inside the hold period). */
  pendingMinor: number;
  lifetimeSalesMinor: number;
}

export async function getBalance(vendorId: ObjectId, now = new Date()): Promise<Balance> {
  const c = await getCollections();
  const rows = await c.ledgerEntries
    .aggregate<{ _id: "available" | "pending"; total: number }>([
      { $match: { vendorId } },
      { $group: { _id: { $cond: [{ $and: [{ $ne: [{ $type: "$availableAt" }, "missing"] }, { $lte: ["$availableAt", now] }] }, "available", "pending"] }, total: { $sum: "$amountMinor" } } },
    ])
    .toArray();
  const sum = (k: "available" | "pending") => rows.find((r) => r._id === k)?.total ?? 0;
  const sales = await c.ledgerEntries.aggregate<{ t: number }>([{ $match: { vendorId, type: "sale_gross" } }, { $group: { _id: null, t: { $sum: "$amountMinor" } } }]).toArray();
  return { currency: "BDT", availableMinor: sum("available"), pendingMinor: sum("pending"), lifetimeSalesMinor: sales[0]?.t ?? 0 };
}

export const toLedgerDto = (e: LedgerEntryDoc) => ({
  id: e._id.toHexString(), type: e.type as LedgerEntryType, amountMinor: e.amountMinor, currency: e.currency,
  orderId: e.orderId?.toHexString(), vendorOrderId: e.vendorOrderId?.toHexString(), note: e.note,
  availableAt: e.availableAt?.toISOString(), createdAt: e.createdAt.toISOString(),
});

export async function listLedger(vendorId: ObjectId, q: { limit: number; cursor?: string }) {
  const c = await getCollections();
  const cur = decodeCursor<{ id: string }>(q.cursor);
  const rows = await c.ledgerEntries
    .find({ vendorId, ...(cur ? { _id: { $lt: new ObjectId(cur.id) } } : {}) })
    .sort({ _id: -1 })
    .limit(q.limit + 1)
    .toArray();
  const { items, hasMore } = slicePage(rows, q.limit);
  const last = items[items.length - 1];
  return { items: items.map(toLedgerDto), nextCursor: hasMore && last ? encodeCursor({ id: last._id.toHexString() }) : null };
}
