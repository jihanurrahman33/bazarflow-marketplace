import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { setupTestDb, teardownTestDb } from "./helpers/db";
import { call } from "./helpers/http";
import { installFakeMedia, makeCustomer } from "./helpers/factory";
import { makeShop, placeShopOrder, type Shop } from "./helpers/shop";
import { experimentsReportHandler, funnelReportHandler, recordEventsHandler } from "@/server/api/handlers/analytics";
import { differs } from "@/server/modules/analytics/report";
import { assignVariant, EXPERIMENTS } from "@/lib/experiments";
import { getCollections } from "@/server/db/collections";

let shop: Shop;
const anon = (n: string) => `anon-${n}-0123456789abcdef`;
const send = (anonId: string, events: object[], token?: string) => call(recordEventsHandler, { method: "POST", token, body: { anonId, events } });

beforeAll(async () => {
  await setupTestDb();
  installFakeMedia();
  shop = await makeShop();
});
afterAll(teardownTestDb);

describe("analytics events", () => {
  it("accepts a small batch from anyone and rejects malformed input", async () => {
    const ok = await send(anon("a"), [{ type: "view_product", productId: new ObjectId().toHexString(), source: "trending" }, { type: "search", query: "  Shoes ", results: 0 }]);
    expect(ok.status).toBe(200);
    expect(ok.data.accepted).toBe(2);
    expect((await send(anon("a"), [{ type: "hack" }])).status).toBe(400);
    expect((await send("short", [{ type: "view_product" }])).status).toBe(400);
    expect((await send(anon("a"), Array.from({ length: 21 }, () => ({ type: "view_category" })))).status).toBe(400);
    expect((await send(anon("a"), [{ type: "view_product", extra: 1 }])).status).toBe(400);
    expect((await send(anon("a"), [{ type: "view_product", source: "Bad Source!" }])).status).toBe(400);
    const c = await getCollections();
    expect((await c.analyticsEvents.findOne({ type: "search" }))?.query).toBe("shoes"); // normalised
  });

  it("verifies purchases against the order and counts each order once", async () => {
    const paid = await placeShopOrder(shop, { method: "online", pay: true });
    const unpaid = await placeShopOrder(shop, { method: "online" });
    const stranger = await makeCustomer();
    const orderId = paid.order.id as string;
    expect((await send(anon("b"), [{ type: "purchase", orderId }])).data.accepted).toBe(0); // anonymous: nothing to verify against
    expect((await send(anon("b"), [{ type: "purchase", orderId }], stranger.token)).data.accepted).toBe(0); // not their order
    expect((await send(anon("b"), [{ type: "purchase", orderId: unpaid.order.id }], unpaid.buyer.token)).data.accepted).toBe(0); // not confirmed yet
    expect((await send(anon("b"), [{ type: "purchase", orderId }], paid.buyer.token)).data.accepted).toBe(1);
    expect((await send(anon("b"), [{ type: "purchase", orderId }], paid.buyer.token)).status).toBe(200); // repeat is harmless
    const c = await getCollections();
    const rows = await c.analyticsEvents.find({ type: "purchase" }).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.valueMinor).toBeGreaterThan(0); // taken from the order, not from the request
  });

  it("only logs exposures to experiments that exist", async () => {
    const exp = EXPERIMENTS[0]!;
    expect((await send(anon("c"), [{ type: "exposure", experiment: { key: exp.key, variant: exp.variants[1] } }, { type: "exposure", experiment: { key: "nope", variant: "x" } }, { type: "exposure", experiment: { key: exp.key, variant: "invented" } }])).data.accepted).toBe(1);
  });
});

describe("reports", () => {
  it("count visitors per funnel step, and are for staff only", async () => {
    const pid = new ObjectId().toHexString();
    await send(anon("f1"), [{ type: "view_product", productId: pid }, { type: "view_product", productId: pid }, { type: "add_to_cart", productId: pid }]);
    await send(anon("f2"), [{ type: "view_product", productId: pid }]);
    const res = await call(funnelReportHandler, { token: shop.admin.token, query: { days: 7 } });
    expect(res.status).toBe(200);
    const step = (t: string) => res.data.steps.find((s: { type: string }) => s.type === t);
    expect(step("view_product").visitors).toBeGreaterThanOrEqual(2);
    expect(step("view_product").events).toBeGreaterThanOrEqual(3);
    expect(step("add_to_cart").visitors).toBeGreaterThanOrEqual(1);
    expect(res.data.searchesWithNoResults).toEqual(expect.arrayContaining([{ query: "shoes", count: 1 }]));
    const shopper = await makeCustomer();
    expect((await call(funnelReportHandler, { token: shopper.token })).status).toBe(403);
    expect((await call(experimentsReportHandler, {})).status).toBe(401);
  });

  it("refuse to declare a winner without enough data", async () => {
    const res = await call(experimentsReportHandler, { token: shop.admin.token });
    expect(res.status).toBe(200);
    const home = res.data.find((e: { key: string }) => e.key === "home_order");
    expect(home.verdict).toBe("not_enough_data");
    expect(home.variants.map((v: { variant: string }) => v.variant)).toEqual(EXPERIMENTS[0]!.variants);
  });

  it("tell a real gap from noise (two-proportion test)", () => {
    expect(differs(1000, 100, 1000, 150)).toBe(true);
    expect(differs(1000, 100, 1000, 104)).toBe(false);
    expect(differs(0, 0, 100, 5)).toBe(false);
  });

  it("assign each shopper a stable variant, split roughly evenly", () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 2000; i++) { const v = assignVariant("home_order", `anon-${i}-xxxxxxxxxxxxxxxx`); counts[v] = (counts[v] ?? 0) + 1; }
    expect(assignVariant("home_order", "anon-stable-xxxxxxxxxxxx")).toBe(assignVariant("home_order", "anon-stable-xxxxxxxxxxxx"));
    for (const n of Object.values(counts)) expect(n).toBeGreaterThan(800);
    expect(assignVariant("missing", "x")).toBe("control");
  });
});
