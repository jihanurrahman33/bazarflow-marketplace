import { deliverNotification } from "@/server/modules/notifications/service";
import { ObjectId } from "mongodb";
import { executeRefund } from "@/server/modules/payments/refunds";
import { fanOutWishlistAlert } from "@/server/modules/wishlist/service";
import type { OutboxHandler } from "./outbox";

/** Registry of outbox event handlers. Later phases add their own entries here. */
export const outboxHandlers: Record<string, OutboxHandler> = {
  "notify.user": deliverNotification,
  "wishlist.alert": fanOutWishlistAlert,
  // Re-runs are safe: execution is a compare-and-set claim and the provider call is idempotent by refund id.
  "refund.execute": async (event) => {
    await executeRefund(new ObjectId(String(event.payload.refundId)));
  },
};
