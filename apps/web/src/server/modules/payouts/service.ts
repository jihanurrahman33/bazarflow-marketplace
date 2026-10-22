import { ObjectId, type Filter } from "mongodb";
import { getEnv } from "@/server/config/env";
import { getCollections } from "@/server/db/collections";
import { withTransaction } from "@/server/db/transaction";
import type { PayoutDoc, PayoutStatus } from "@/server/db/schema";
import { AppError } from "@/server/shared/errors";
import { newId } from "@/server/shared/ids";
import { decodeCursor, encodeCursor, slicePage } from "@/server/shared/pagination";
import { defineStateMachine } from "@/server/shared/state-machine";
import { writeAudit } from "@/server/modules/audit/audit";
import { enqueue } from "@/server/modules/outbox/outbox";
import { requireVerifiedEmail, type Actor } from "@/server/modules/authorization/actor";
import { getBalance, postEntry } from "@/server/modules/ledger/service";
import { requireActiveVendor } from "@/server/modules/vendors/service";

export const payoutMachine = defineStateMachine({
  requested: ["approved", "rejected", "cancelled"],
  approved: ["paid", "failed", "cancelled"],
  paid: [],
  failed: [],
  rejected: [],
  cancelled: [],
} as const);

const mask = (ref: string) => (ref.length <= 4 ? "****" : `${"*".repeat(Math.min(8, ref.length - 4))}${ref.slice(-4)}`);

export const toPayoutDto = (p: PayoutDoc, opts: { reveal?: boolean } = {}) => ({
  id: p._id.toHexString(), vendorId: p.vendorId.toHexString(), amountMinor: p.amountMinor, currency: p.currency, status: p.status,
  destination: { method: p.destination.method, accountName: p.destination.accountName, accountRef: opts.reveal ? p.destination.accountRef : mask(p.destination.accountRef) },
  providerRef: p.providerRef, note: p.note, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
});

/**
 * Funds are reserved the moment a payout is requested (a payout_debit lands in the ledger immediately) so the
 * same balance can never be requested twice. Rejection/cancel/failure post a reversal.
 */
export async function requestPayout(actor: Actor & { vendorId: ObjectId }, amountMinor: number, requestId?: string) {
  requireVerifiedEmail(actor);
  const vendor = await requireActiveVendor(actor.vendorId);
  if (!vendor.payoutDestination) throw new AppError("BUSINESS_RULE_VIOLATION", { message: "Add a payout destination first.", details: [{ field: "payoutDestination", code: "REQUIRED" }] });
  const env = getEnv();
  if (amountMinor < env.MIN_PAYOUT_MINOR) throw new AppError("BUSINESS_RULE_VIOLATION", { message: "The amount is below the minimum payout.", details: [{ field: "amountMinor", code: "BELOW_MINIMUM" }] });
  const c = await getCollections();
  const payoutId = newId();
  const now = new Date();
  const doc: PayoutDoc = { _id: payoutId, vendorId: actor.vendorId, amountMinor, currency: "BDT", destination: vendor.payoutDestination, status: "requested", requestedBy: actor.userId, version: 1, createdAt: now, updatedAt: now };
  await withTransaction(async (session) => {
    // Serialise payout requests per vendor by touching the vendor document, then check the balance inside the tx.
    await c.vendors.updateOne({ _id: actor.vendorId }, { $inc: { payoutSeq: 1 } }, { session });
    const balance = await getBalance(actor.vendorId, now);
    if (amountMinor > balance.availableMinor) {
      throw new AppError("BUSINESS_RULE_VIOLATION", { message: "The amount exceeds your available balance.", details: [{ field: "amountMinor", code: "EXCEEDS_AVAILABLE" }] });
    }
    await c.payouts.insertOne(doc, { session });
    await postEntry({ vendorId: actor.vendorId, currency: "BDT", payoutId, type: "payout_debit", amountMinor: -amountMinor, idempotencyReference: `payout:${payoutId.toHexString()}`, availableAt: now }, session);
    await writeAudit({ actorId: actor.userId, actorRole: actor.role, action: "payout.request", resourceType: "payout", resourceId: payoutId.toHexString(), after: { amountMinor }, requestId }, session);
  });
  return toPayoutDto(doc, { reveal: true });
}

export async function listPayouts(filter: { vendorId?: ObjectId; status?: PayoutStatus }, q: { limit: number; cursor?: string }, reveal: boolean) {
  const c = await getCollections();
  const cur = decodeCursor<{ id: string }>(q.cursor);
  const f: Filter<PayoutDoc> = { ...(filter.vendorId ? { vendorId: filter.vendorId } : {}), ...(filter.status ? { status: filter.status } : {}), ...(cur ? { _id: { $lt: new ObjectId(cur.id) } } : {}) };
  const rows = await c.payouts.find(f).sort({ _id: -1 }).limit(q.limit + 1).toArray();
  const { items, hasMore } = slicePage(rows, q.limit);
  const last = items[items.length - 1];
  return { items: items.map((p) => toPayoutDto(p, { reveal })), nextCursor: hasMore && last ? encodeCursor({ id: last._id.toHexString() }) : null };
}

async function release(session: Parameters<Parameters<typeof withTransaction>[0]>[0], p: PayoutDoc, why: string) {
  await postEntry({ vendorId: p.vendorId, currency: p.currency, payoutId: p._id, type: "reversal", amountMinor: p.amountMinor, idempotencyReference: `payout-reversal:${p._id.toHexString()}`, availableAt: new Date(), note: why }, session);
}

async function decide(admin: Actor, id: ObjectId, to: PayoutStatus, patch: Partial<PayoutDoc>, action: string, reason: string | undefined, requestId?: string) {
  const c = await getCollections();
  const p = await c.payouts.findOne({ _id: id });
  if (!p) throw new AppError("NOT_FOUND");
  payoutMachine.assert(p.status, to);
  return withTransaction(async (session) => {
    const u = await c.payouts.findOneAndUpdate(
      { _id: id, status: p.status, version: p.version },
      { $set: { status: to, updatedAt: new Date(), ...patch }, $inc: { version: 1 } },
      { session, returnDocument: "after" },
    );
    if (!u) throw new AppError("INVALID_STATE_TRANSITION");
    if (to === "rejected" || to === "cancelled" || to === "failed") await release(session, u, `${action}${reason ? `: ${reason}` : ""}`);
    await writeAudit({ actorId: admin.userId, actorRole: admin.role, action, resourceType: "payout", resourceId: id.toHexString(), reason, requestId }, session);
    const owner = await c.vendors.findOne({ _id: u.vendorId }, { session, projection: { ownerUserId: 1 } });
    if (owner) {
      await enqueue(
        {
          type: "notify.user", aggregateType: "payout", aggregateId: id.toHexString(), dedupeKey: `payout-${to}:${id.toHexString()}`,
          payload: { userId: owner.ownerUserId.toHexString(), eventType: `payout.${to}`, title: `Payout ${to}`, body: `৳${(u.amountMinor / 100).toFixed(2)}${reason ? ` — ${reason}` : ""}`, deepLink: "/vendor/payouts" },
        },
        session,
      );
    }
    return toPayoutDto(u, { reveal: true });
  });
}

export const approvePayout = (admin: Actor, id: ObjectId, requestId?: string) => decide(admin, id, "approved", { approvedBy: admin.userId }, "payout.approve", undefined, requestId);
export const rejectPayout = (admin: Actor, id: ObjectId, reason: string, requestId?: string) => decide(admin, id, "rejected", { note: reason }, "payout.reject", reason, requestId);

/** Mark the bank/MFS transfer as sent. Large payouts need someone other than the approver. */
export async function markPayoutPaid(admin: Actor, id: ObjectId, providerRef: string, requestId?: string) {
  const c = await getCollections();
  const p = await c.payouts.findOne({ _id: id });
  if (!p) throw new AppError("NOT_FOUND");
  const threshold = getEnv().PAYOUT_MAKER_CHECKER_MINOR;
  if (threshold > 0 && p.amountMinor >= threshold && p.approvedBy?.equals(admin.userId)) {
    throw new AppError("FORBIDDEN", { message: "A different administrator must confirm this payout.", details: [{ field: "approver", code: "MAKER_CHECKER" }] });
  }
  return decide(admin, id, "paid", { providerRef, paidBy: admin.userId }, "payout.paid", undefined, requestId);
}

export const markPayoutFailed = (admin: Actor, id: ObjectId, reason: string, requestId?: string) => decide(admin, id, "failed", { note: reason }, "payout.failed", reason, requestId);

export async function cancelPayout(actor: { userId: ObjectId; vendorId: ObjectId }, id: ObjectId) {
  const c = await getCollections();
  const p = await c.payouts.findOne({ _id: id, vendorId: actor.vendorId });
  if (!p) throw new AppError("NOT_FOUND");
  payoutMachine.assert(p.status, "cancelled");
  if (p.status !== "requested") throw new AppError("INVALID_STATE_TRANSITION", { message: "Only requested payouts can be cancelled." });
  return decide({ userId: actor.userId, role: "vendor", permissions: [], sessionId: "", emailVerified: true } as Actor, id, "cancelled", {}, "payout.cancel", undefined);
}
