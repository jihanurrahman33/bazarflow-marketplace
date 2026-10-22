import { MongoServerError, ObjectId, type Filter } from "mongodb";
import { getEnv } from "@/server/config/env";
import { getCollections } from "@/server/db/collections";
import { withTransaction } from "@/server/db/transaction";
import type { VendorApplicationDoc, VendorApplicationStatus, VendorDoc } from "@/server/db/schema";
import { AppError } from "@/server/shared/errors";
import { newId } from "@/server/shared/ids";
import { decodeCursor, encodeCursor, slicePage } from "@/server/shared/pagination";
import { defineStateMachine } from "@/server/shared/state-machine";
import { writeAudit } from "@/server/modules/audit/audit";
import { enqueue } from "@/server/modules/outbox/outbox";
import { requireRole, requireVerifiedEmail, type Actor } from "@/server/modules/authorization/actor";
import { revokeAllSessionsForUser } from "@/server/modules/identity/service";

export const applicationMachine = defineStateMachine({
  submitted: ["approved", "rejected", "more_info_required"],
  more_info_required: ["submitted", "rejected"],
  approved: [],
  rejected: [],
} as const);

export interface ApplicationInput {
  business: { name: string; slug: string; phone: string; address: string; tradeLicenseNo?: string; description?: string };
  documents: { publicId: string; kind: string }[];
}

export const toApplicationDto = (a: VendorApplicationDoc) => ({
  id: a._id.toHexString(),
  applicantUserId: a.applicantUserId.toHexString(),
  business: a.business,
  documents: a.documents,
  status: a.status,
  reviewReason: a.reviewReason,
  createdAt: a.createdAt.toISOString(),
  updatedAt: a.updatedAt.toISOString(),
});

export const toVendorDto = (v: VendorDoc) => ({
  id: v._id.toHexString(),
  slug: v.slug,
  name: v.name,
  description: v.description,
  logo: v.logo,
  status: v.status,
  commissionBps: v.commissionBps,
  shipping: v.shipping,
  payoutDestination: v.payoutDestination ? { method: v.payoutDestination.method, accountName: v.payoutDestination.accountName, accountRef: `${"*".repeat(Math.max(0, v.payoutDestination.accountRef.length - 4))}${v.payoutDestination.accountRef.slice(-4)}` } : undefined,
  createdAt: v.createdAt.toISOString(),
});

/** Public projection: never exposes commission or ownership details. */
export const toPublicVendorDto = (v: VendorDoc) => ({
  id: v._id.toHexString(),
  slug: v.slug,
  name: v.name,
  description: v.description,
  logo: v.logo,
});

export async function applyAsVendor(actor: Actor, input: ApplicationInput) {
  requireRole(actor, "customer");
  requireVerifiedEmail(actor);
  const c = await getCollections();
  if (await c.vendors.findOne({ slug: input.business.slug }, { projection: { _id: 1 } })) {
    throw new AppError("CONFLICT", { message: "That store URL is already taken.", details: [{ field: "business.slug", code: "TAKEN" }] });
  }
  const now = new Date();
  const doc: VendorApplicationDoc = {
    _id: newId(), applicantUserId: actor.userId, business: input.business, documents: input.documents,
    status: "submitted", version: 1, createdAt: now, updatedAt: now,
  };
  try {
    await c.vendorApplications.insertOne(doc);
  } catch (e) {
    if (e instanceof MongoServerError && e.code === 11000) {
      throw new AppError("CONFLICT", { message: "You already have an application in review." });
    }
    throw e;
  }
  await writeAudit({ actorId: actor.userId, actorRole: actor.role, action: "vendor_application.submit", resourceType: "vendor_application", resourceId: doc._id.toHexString() });
  return toApplicationDto(doc);
}

/** The applicant's latest application (any status). */
export async function getMyApplication(actor: Actor) {
  const c = await getCollections();
  const a = await c.vendorApplications.find({ applicantUserId: actor.userId }).sort({ createdAt: -1 }).limit(1).next();
  if (!a) throw new AppError("NOT_FOUND");
  return toApplicationDto(a);
}

export async function resubmitApplication(actor: Actor, input: ApplicationInput) {
  const c = await getCollections();
  const current = await c.vendorApplications.find({ applicantUserId: actor.userId }).sort({ createdAt: -1 }).limit(1).next();
  if (!current) throw new AppError("NOT_FOUND");
  applicationMachine.assert(current.status, "submitted");
  const res = await c.vendorApplications.findOneAndUpdate(
    { _id: current._id, applicantUserId: actor.userId, status: "more_info_required", version: current.version },
    { $set: { business: input.business, documents: input.documents, status: "submitted", updatedAt: new Date() }, $inc: { version: 1 }, $unset: { reviewReason: "" } },
    { returnDocument: "after" },
  );
  if (!res) throw new AppError("CONFLICT");
  return toApplicationDto(res);
}

export interface ListApplicationsQuery {
  status?: VendorApplicationStatus;
  limit: number;
  cursor?: string;
}

export async function listApplications(q: ListApplicationsQuery) {
  const c = await getCollections();
  const cur = decodeCursor<{ id: string }>(q.cursor);
  const filter: Filter<VendorApplicationDoc> = {};
  if (q.status) filter.status = q.status;
  if (cur) filter._id = { $gt: new ObjectId(cur.id) };
  const rows = await c.vendorApplications.find(filter).sort({ _id: 1 }).limit(q.limit + 1).toArray();
  const { items, hasMore } = slicePage(rows, q.limit);
  const last = items[items.length - 1];
  return { items: items.map(toApplicationDto), nextCursor: hasMore && last ? encodeCursor({ id: last._id.toHexString() }) : null };
}

async function loadReviewable(id: ObjectId): Promise<VendorApplicationDoc> {
  const c = await getCollections();
  const app = await c.vendorApplications.findOne({ _id: id });
  if (!app) throw new AppError("NOT_FOUND");
  return app;
}

export async function approveApplication(admin: Actor, id: ObjectId, requestId?: string) {
  const app = await loadReviewable(id);
  applicationMachine.assert(app.status, "approved");
  const c = await getCollections();
  const env = getEnv();
  const now = new Date();
  const vendor: VendorDoc = {
    _id: newId(), ownerUserId: app.applicantUserId, slug: app.business.slug, name: app.business.name,
    description: app.business.description, status: "active", commissionBps: env.DEFAULT_COMMISSION_BPS,
    commissionRuleVersion: 1, shipping: { flatFeeMinor: 0 }, createdAt: now, updatedAt: now,
  };
  try {
    await withTransaction(async (session) => {
      // Compare-and-set so two reviewers cannot both approve.
      const res = await c.vendorApplications.updateOne(
        { _id: id, status: { $in: applicationMachine.predecessors("approved") }, version: app.version },
        { $set: { status: "approved", reviewerId: admin.userId, updatedAt: now }, $inc: { version: 1 } },
        { session },
      );
      if (res.modifiedCount !== 1) throw new AppError("INVALID_STATE_TRANSITION");
      await c.vendors.insertOne(vendor, { session });
      const upd = await c.users.updateOne(
        { _id: app.applicantUserId, role: "customer" },
        { $set: { role: "vendor", vendorId: vendor._id, updatedAt: now } },
        { session },
      );
      if (upd.modifiedCount !== 1) throw new AppError("CONFLICT", { message: "Applicant is not an eligible customer." });
      await writeAudit(
        { actorId: admin.userId, actorRole: admin.role, action: "vendor_application.approve", resourceType: "vendor_application", resourceId: id.toHexString(), after: { vendorId: vendor._id.toHexString() }, requestId },
        session,
      );
      await enqueue(
        { type: "notify.user", aggregateType: "vendor_application", aggregateId: id.toHexString(), dedupeKey: `vendor-approved:${id.toHexString()}`,
          payload: { userId: app.applicantUserId.toHexString(), eventType: "vendor.approved", title: "Your store was approved", body: "You can now add products.", deepLink: "/vendor" } },
        session,
      );
    });
  } catch (e) {
    if (e instanceof MongoServerError && e.code === 11000) {
      throw new AppError("CONFLICT", { message: "The requested store URL is no longer available." });
    }
    throw e;
  }
  // Role changed: force a fresh sign-in so tokens carry the new role.
  await revokeAllSessionsForUser(app.applicantUserId, "admin");
  return toVendorDto(vendor);
}

export async function decideApplication(admin: Actor, id: ObjectId, decision: "rejected" | "more_info_required", reason: string, requestId?: string) {
  const app = await loadReviewable(id);
  applicationMachine.assert(app.status, decision);
  const c = await getCollections();
  const now = new Date();
  const res = await c.vendorApplications.findOneAndUpdate(
    { _id: id, status: { $in: applicationMachine.predecessors(decision) }, version: app.version },
    { $set: { status: decision, reviewerId: admin.userId, reviewReason: reason, updatedAt: now }, $inc: { version: 1 } },
    { returnDocument: "after" },
  );
  if (!res) throw new AppError("INVALID_STATE_TRANSITION");
  await writeAudit({ actorId: admin.userId, actorRole: admin.role, action: `vendor_application.${decision}`, resourceType: "vendor_application", resourceId: id.toHexString(), reason, requestId });
  await enqueue({
    type: "notify.user", aggregateType: "vendor_application", aggregateId: id.toHexString(), dedupeKey: `vendor-${decision}:${id.toHexString()}:${res.version}`,
    payload: { userId: app.applicantUserId.toHexString(), eventType: `vendor.${decision}`, title: decision === "rejected" ? "Application rejected" : "More information needed", body: reason, deepLink: "/vendor/application" },
  });
  return toApplicationDto(res);
}

export async function getVendorForActor(vendorId: ObjectId): Promise<VendorDoc> {
  const c = await getCollections();
  const v = await c.vendors.findOne({ _id: vendorId });
  if (!v) throw new AppError("NOT_FOUND");
  return v;
}

/** Guard for vendor operations that must not run while suspended (publishing, fulfilling). */
export async function requireActiveVendor(vendorId: ObjectId): Promise<VendorDoc> {
  const v = await getVendorForActor(vendorId);
  if (v.status !== "active") throw new AppError("VENDOR_NOT_ACTIVE");
  return v;
}

export interface VendorProfilePatch {
  name?: string;
  description?: string | null;
  logo?: { publicId: string; url: string } | null;
  payoutDestination?: { method: "bank" | "bkash" | "nagad"; accountName: string; accountRef: string } | null;
  shipping?: { flatFeeMinor: number; freeOverMinor?: number | null };
}

export async function updateVendorProfile(vendorId: ObjectId, patch: VendorProfilePatch) {
  const c = await getCollections();
  const $set: Record<string, unknown> = { updatedAt: new Date() };
  const $unset: Record<string, ""> = {};
  if (patch.name !== undefined) $set.name = patch.name.trim();
  if (patch.description === null) $unset.description = "";
  else if (patch.description !== undefined) $set.description = patch.description;
  if (patch.logo === null) $unset.logo = "";
  else if (patch.logo !== undefined) $set.logo = patch.logo;
  if (patch.payoutDestination === null) $unset.payoutDestination = "";
  else if (patch.payoutDestination !== undefined) $set.payoutDestination = patch.payoutDestination;
  if (patch.shipping) {
    $set["shipping.flatFeeMinor"] = patch.shipping.flatFeeMinor;
    if (patch.shipping.freeOverMinor === null) $unset["shipping.freeOverMinor"] = "";
    else if (patch.shipping.freeOverMinor !== undefined) $set["shipping.freeOverMinor"] = patch.shipping.freeOverMinor;
  }
  const v = await c.vendors.findOneAndUpdate({ _id: vendorId }, Object.keys($unset).length ? { $set, $unset } : { $set }, { returnDocument: "after" });
  if (!v) throw new AppError("NOT_FOUND");
  return toVendorDto(v);
}

export async function listVendors(q: { status?: "active" | "suspended"; limit: number; cursor?: string }) {
  const c = await getCollections();
  const cur = decodeCursor<{ id: string }>(q.cursor);
  const filter: Filter<VendorDoc> = {};
  if (q.status) filter.status = q.status;
  if (cur) filter._id = { $gt: new ObjectId(cur.id) };
  const rows = await c.vendors.find(filter).sort({ _id: 1 }).limit(q.limit + 1).toArray();
  const { items, hasMore } = slicePage(rows, q.limit);
  const last = items[items.length - 1];
  return { items: items.map(toVendorDto), nextCursor: hasMore && last ? encodeCursor({ id: last._id.toHexString() }) : null };
}

export async function setVendorStatus(admin: Actor, vendorId: ObjectId, status: "active" | "suspended", reason: string, requestId?: string) {
  const c = await getCollections();
  const before = await c.vendors.findOne({ _id: vendorId });
  if (!before) throw new AppError("NOT_FOUND");
  if (before.status === status) throw new AppError("INVALID_STATE_TRANSITION", { message: `Vendor is already ${status}.` });
  const now = new Date();
  const updated = await withTransaction(async (session) => {
    const v = await c.vendors.findOneAndUpdate(
      { _id: vendorId, status: before.status },
      { $set: { status, updatedAt: now } },
      { returnDocument: "after", session },
    );
    if (!v) throw new AppError("INVALID_STATE_TRANSITION");
    // Hide/show the catalogue immediately.
    await c.products.updateMany({ vendorId }, { $set: { vendorActive: status === "active" } }, { session });
    await writeAudit(
      { actorId: admin.userId, actorRole: admin.role, action: status === "suspended" ? "vendor.suspend" : "vendor.reinstate", resourceType: "vendor", resourceId: vendorId.toHexString(), reason, before: { status: before.status }, after: { status }, requestId },
      session,
    );
    return v;
  });
  return toVendorDto(updated);
}

/** Commission changes are versioned so historical orders keep the rate they were sold under. */
export async function setVendorCommission(admin: Actor, vendorId: ObjectId, bps: number, reason: string, requestId?: string) {
  const c = await getCollections();
  const before = await c.vendors.findOne({ _id: vendorId });
  if (!before) throw new AppError("NOT_FOUND");
  const v = await c.vendors.findOneAndUpdate(
    { _id: vendorId },
    { $set: { commissionBps: bps, updatedAt: new Date() }, $inc: { commissionRuleVersion: 1 } },
    { returnDocument: "after" },
  );
  if (!v) throw new AppError("NOT_FOUND");
  await writeAudit({ actorId: admin.userId, actorRole: admin.role, action: "vendor.commission_change", resourceType: "vendor", resourceId: vendorId.toHexString(), reason, before: { bps: before.commissionBps }, after: { bps }, requestId });
  return toVendorDto(v);
}

export async function getPublicVendorBySlug(slug: string) {
  const c = await getCollections();
  const v = await c.vendors.findOne({ slug, status: "active" });
  if (!v) throw new AppError("NOT_FOUND");
  return toPublicVendorDto(v);
}
