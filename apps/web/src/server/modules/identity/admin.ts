import { ObjectId, type Filter } from "mongodb";
import { getCollections } from "@/server/db/collections";
import type { UserDoc } from "@/server/db/schema";
import { AppError } from "@/server/shared/errors";
import { decodeCursor, encodeCursor, slicePage } from "@/server/shared/pagination";
import { writeAudit } from "@/server/modules/audit/audit";
import type { Actor } from "@/server/modules/authorization/actor";
import { revokeAllSessionsForUser, toUserDto } from "./service";

export async function listUsers(q: { role?: UserDoc["role"]; status?: UserDoc["status"]; email?: string; limit: number; cursor?: string }) {
  const c = await getCollections();
  const cur = decodeCursor<{ id: string }>(q.cursor);
  const filter: Filter<UserDoc> = {};
  if (q.role) filter.role = q.role;
  if (q.status) filter.status = q.status;
  if (q.email) filter.emailNormalized = q.email.trim().toLowerCase(); // exact match only: no regex scans
  if (cur) filter._id = { $gt: new ObjectId(cur.id) };
  const rows = await c.users.find(filter).sort({ _id: 1 }).limit(q.limit + 1).toArray();
  const { items, hasMore } = slicePage(rows, q.limit);
  const last = items[items.length - 1];
  return { items: items.map(toUserDto), nextCursor: hasMore && last ? encodeCursor({ id: last._id.toHexString() }) : null };
}

export async function setUserStatus(admin: Actor, userId: ObjectId, status: UserDoc["status"], reason: string, requestId?: string) {
  if (userId.equals(admin.userId)) throw new AppError("BUSINESS_RULE_VIOLATION", { message: "You cannot change your own status." });
  const c = await getCollections();
  const before = await c.users.findOne({ _id: userId });
  if (!before) throw new AppError("NOT_FOUND");
  if (before.role === "admin") throw new AppError("FORBIDDEN", { message: "Admin accounts cannot be suspended here." });
  if (before.status === status) throw new AppError("INVALID_STATE_TRANSITION", { message: `User is already ${status}.` });
  const user = await c.users.findOneAndUpdate({ _id: userId, status: before.status }, { $set: { status, updatedAt: new Date() } }, { returnDocument: "after" });
  if (!user) throw new AppError("INVALID_STATE_TRANSITION");
  if (status === "suspended") await revokeAllSessionsForUser(userId, "suspended");
  await writeAudit({
    actorId: admin.userId, actorRole: admin.role, action: status === "suspended" ? "user.suspend" : "user.reinstate",
    resourceType: "user", resourceId: userId.toHexString(), reason, before: { status: before.status }, after: { status }, requestId,
  });
  return toUserDto(user);
}

export async function listAuditLogs(q: { resourceType?: string; resourceId?: string; action?: string; limit: number; cursor?: string }) {
  const c = await getCollections();
  const cur = decodeCursor<{ id: string }>(q.cursor);
  const filter: Record<string, unknown> = {};
  if (q.resourceType) filter.resourceType = q.resourceType;
  if (q.resourceId) filter.resourceId = q.resourceId;
  if (q.action) filter.action = q.action;
  if (cur) filter._id = { $lt: new ObjectId(cur.id) };
  const rows = await c.auditLogs.find(filter).sort({ _id: -1 }).limit(q.limit + 1).toArray();
  const { items, hasMore } = slicePage(rows, q.limit);
  const last = items[items.length - 1];
  return {
    items: items.map((a) => ({
      id: a._id.toHexString(), actorId: a.actorId?.toHexString(), actorRole: a.actorRole, action: a.action,
      resourceType: a.resourceType, resourceId: a.resourceId, reason: a.reason, before: a.before, after: a.after,
      requestId: a.requestId, createdAt: a.createdAt.toISOString(),
    })),
    nextCursor: hasMore && last ? encodeCursor({ id: last._id.toHexString() }) : null,
  };
}
