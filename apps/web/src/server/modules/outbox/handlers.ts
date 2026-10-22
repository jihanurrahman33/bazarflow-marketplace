import { deliverNotification } from "@/server/modules/notifications/service";
import type { OutboxHandler } from "./outbox";

/** Registry of outbox event handlers. Later phases add their own entries here. */
export const outboxHandlers: Record<string, OutboxHandler> = {
  "notify.user": deliverNotification,
};
