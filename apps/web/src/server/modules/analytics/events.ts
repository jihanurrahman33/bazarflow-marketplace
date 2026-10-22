import { ObjectId } from "mongodb";
import { getCollections } from "@/server/db/collections";
import type { AnalyticsEventDoc } from "@/server/db/schema";
import type { Actor } from "@/server/modules/authorization/actor";
import { EXPERIMENTS } from "@/lib/experiments";

export const EVENT_TYPES = ["view_product", "view_category", "search", "add_to_cart", "begin_checkout", "purchase", "exposure"] as const;
export type EventType = (typeof EVENT_TYPES)[number];
const RETENTION_DAYS = 90;

export interface IncomingEvent {
  type: EventType;
  productId?: string;
  orderId?: string;
  query?: string;
  results?: number;
  /** Which row or page led here (e.g. "because_viewed", "trending"), for click-through reporting. */
  source?: string;
  experiment?: { key: string; variant: string };
}

/**
 * Store a batch of anonymous behaviour events. Nothing here identifies a person: events carry a random browser id, and the
 * signed-in user id is attached only to purchases (so an order can be verified). Purchases are checked against the order
 * itself, and the value comes from the order, never from the client.
 */
export async function recordEvents(anonId: string, events: IncomingEvent[], actor?: Actor): Promise<number> {
  const c = await getCollections();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + RETENTION_DAYS * 86_400_000);
  const docs: AnalyticsEventDoc[] = [];
  for (const e of events) {
    const base: AnalyticsEventDoc = { _id: new ObjectId(), anonId, type: e.type, at: now, expiresAt };
    if (e.source) base.source = e.source;
    if (e.productId) base.productId = new ObjectId(e.productId);
    if (e.type === "search") { base.query = (e.query ?? "").trim().toLowerCase().slice(0, 100); base.results = e.results ?? 0; if (!base.query) continue; }
    if (e.type === "exposure") {
      const exp = EXPERIMENTS.find((x) => x.key === e.experiment?.key);
      if (!exp || !e.experiment || !(exp.variants as string[]).includes(e.experiment.variant)) continue;
      base.experiment = e.experiment;
    }
    if (e.type === "purchase") {
      if (!actor || !e.orderId) continue;
      const order = await c.orders.findOne({ _id: new ObjectId(e.orderId), buyerId: actor.userId }, { projection: { totals: 1, status: 1, paymentStatus: 1 } });
      if (!order || order.status === "pending_payment" || order.status === "cancelled") continue;
      base.orderId = order._id;
      base.userId = actor.userId;
      base.valueMinor = order.totals.totalMinor;
    }
    docs.push(base);
  }
  if (docs.length === 0) return 0;
  try {
    await c.analyticsEvents.insertMany(docs, { ordered: false });
  } catch (err) {
    // A purchase already recorded for this order is a duplicate-key error on the partial unique index: the rest still went in.
    if (!(err instanceof Error && /E11000|duplicate key/i.test(err.message))) throw err;
  }
  return docs.length;
}
