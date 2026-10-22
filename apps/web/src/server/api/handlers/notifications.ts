import { z } from "zod";
import { noContent, ok, page, route, created } from "@/server/api/route";
import { parseObjectId } from "@/server/shared/ids";
import { pageQuery } from "@/server/shared/pagination";
import { listNotifications, markRead, registerDevice, unreadCount, unregisterDevice } from "@/server/modules/notifications/service";

export const listNotificationsHandler = route({ name: "notifications.list" }, async (ctx) => {
  const q = ctx.query(pageQuery.extend({ unread: z.enum(["true", "false"]).optional() }));
  const r = await listNotifications(ctx.actor.userId, { limit: q.limit, cursor: q.cursor, unreadOnly: q.unread === "true" });
  return { ...page(r.items, r), meta: { nextCursor: r.nextCursor, hasMore: r.nextCursor !== null, unreadCount: await unreadCount(ctx.actor.userId) } };
});

export const markReadHandler = route<{ id: string }>({ name: "notifications.read" }, async (ctx) =>
  ok(await markRead(ctx.actor.userId, parseObjectId(ctx.params.id))),
);

export const registerDeviceHandler = route({ name: "devices.register" }, async (ctx) => {
  const b = await ctx.body(z.strictObject({
    installationId: z.string().min(8).max(128), platform: z.enum(["android", "ios", "web"]),
    appId: z.string().min(3).max(100), pushToken: z.string().min(10).max(4096),
  }));
  await registerDevice(ctx.actor.userId, b);
  return created({ registered: true });
});

export const unregisterDeviceHandler = route<{ installationId: string }>({ name: "devices.unregister" }, async (ctx) => {
  await unregisterDevice(ctx.actor.userId, ctx.params.installationId);
  return noContent();
});
