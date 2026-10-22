import { AppError } from "@/server/shared/errors";
import type { OrderDoc } from "@/server/db/schema";
import type { Actor } from "@/server/modules/authorization/actor";

/** Replaced by the full implementation in the payments phase. */
export async function cancelPaidOrderWithRefund(_actor: Actor, _order: OrderDoc, _reason: string): Promise<void> {
  throw new AppError("CAPABILITY_UNSUPPORTED", { message: "Cancelling a paid order is not available yet." });
}
