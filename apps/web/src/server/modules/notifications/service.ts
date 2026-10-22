import { MongoServerError, ObjectId } from "mongodb";
import { getCollections } from "@/server/db/collections";
import type { DeviceDoc, NotificationDoc, OutboxEventDoc } from "@/server/db/schema";
import { AppError } from "@/server/shared/errors";
import { newId } from "@/server/shared/ids";
import { decodeCursor, encodeCursor, slicePage } from "@/server/shared/pagination";
import { getPushProvider } from "./push";

export interface NotifyPayload {
  userId: string;
  eventType: string;
  title: string;
  body: string;
  deepLink?: string;
}

const toDto = (n: NotificationDoc) => ({
  id: n._id.toHexString(),
  eventType: n.eventType,
  title: n.title,
  body: n.body,
  deepLink: n.deepLink,
  read: !!n.readAt,
  createdAt: n.createdAt.toISOString(),
});

/**
 * Outbox handler for `notify.user`. Idempotent: the inbox row is keyed by dedupeKey, so a redelivered event
 * never produces a second notification, and push is attempted only when the inbox row is first created.
 */
export async function deliverNotification(event: OutboxEventDoc): Promise<void> {
  const p = event.payload as unknown as NotifyPayload;
  const c = await getCollections();
  const userId = new ObjectId(p.userId);
  let firstDelivery = true;
  try {
    await c.notifications.insertOne({
      _id: newId(), userId, channel: "inbox", eventType: p.eventType, title: p.title, body: p.body, deepLink: p.deepLink,
      dedupeKey: event.dedupeKey, deliveryState: "sent", createdAt: new Date(),
    });
  } catch (e) {
    if (e instanceof MongoServerError && e.code === 11000) firstDelivery = false;
    else throw e;
  }
  if (!firstDelivery) return;

  const devices = await c.devices.find({ userId, active: true }).toArray();
  for (const d of devices) {
    try {
      const result = await getPushProvider().send({
        token: d.pushToken, title: p.title, body: p.body,
        data: { eventType: p.eventType, ...(p.deepLink ? { deepLink: p.deepLink } : {}) },
      });
      if (result === "invalid_token") await c.devices.updateOne({ _id: d._id }, { $set: { active: false, updatedAt: new Date() } });
    } catch {
      // Push is best-effort; the inbox row is the durable record. Never fail the whole event over one device.
    }
  }
}

export async function listNotifications(userId: ObjectId, q: { limit: number; cursor?: string; unreadOnly?: boolean }) {
  const c = await getCollections();
  const cur = decodeCursor<{ id: string }>(q.cursor);
  const filter: Record<string, unknown> = { userId, channel: "inbox" };
  if (q.unreadOnly) filter.readAt = { $exists: false };
  if (cur) filter._id = { $lt: new ObjectId(cur.id) };
  const rows = await c.notifications.find(filter).sort({ _id: -1 }).limit(q.limit + 1).toArray();
  const { items, hasMore } = slicePage(rows, q.limit);
  const last = items[items.length - 1];
  return { items: items.map(toDto), nextCursor: hasMore && last ? encodeCursor({ id: last._id.toHexString() }) : null };
}

export async function markRead(userId: ObjectId, id: ObjectId) {
  const c = await getCollections();
  // Ownership is part of the filter: another user's id simply is not found.
  const n = await c.notifications.findOneAndUpdate({ _id: id, userId }, { $set: { readAt: new Date() } }, { returnDocument: "after" });
  if (!n) throw new AppError("NOT_FOUND");
  return toDto(n);
}

export async function unreadCount(userId: ObjectId): Promise<number> {
  const c = await getCollections();
  return c.notifications.countDocuments({ userId, channel: "inbox", readAt: { $exists: false } });
}

export async function registerDevice(userId: ObjectId, input: { installationId: string; platform: DeviceDoc["platform"]; appId: string; pushToken: string }) {
  const c = await getCollections();
  const now = new Date();
  // A push token belongs to one user at a time: deactivate it for anyone else (device handed over / account switch).
  await c.devices.updateMany({ pushToken: input.pushToken, userId: { $ne: userId } }, { $set: { active: false, updatedAt: now } });
  await c.devices.updateOne(
    { userId, installationId: input.installationId },
    { $set: { platform: input.platform, appId: input.appId, pushToken: input.pushToken, active: true, updatedAt: now }, $setOnInsert: { _id: newId(), createdAt: now } },
    { upsert: true },
  );
}

export async function unregisterDevice(userId: ObjectId, installationId: string) {
  const c = await getCollections();
  const res = await c.devices.updateOne({ userId, installationId }, { $set: { active: false, updatedAt: new Date() } });
  if (res.matchedCount === 0) throw new AppError("NOT_FOUND");
}
