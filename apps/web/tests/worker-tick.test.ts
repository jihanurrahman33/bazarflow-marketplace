import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, teardownTestDb } from "./helpers/db";
import { getEnv, setEnvForTests } from "@/server/config/env";
import { workerTickHandler } from "@/server/api/worker-route";
import { enqueue } from "@/server/modules/outbox/outbox";
import { getCollections } from "@/server/db/collections";

const SECRET = "cron-secret-0123456789abcdef-0123456789";
const tick = (token?: string) => workerTickHandler(new Request("http://localhost:3000/api/internal/worker", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {} }));

beforeAll(async () => { await setupTestDb(); });
afterAll(teardownTestDb);

describe("scheduled worker endpoint", () => {
  it("does not exist unless CRON_SECRET is configured", async () => {
    expect(getEnv().CRON_SECRET).toBeUndefined();
    expect((await tick(SECRET)).status).toBe(404);
  });

  it("rejects missing or wrong secrets, and runs the background jobs for the right one", async () => {
    setEnvForTests({ ...getEnv(), CRON_SECRET: SECRET });
    expect((await tick()).status).toBe(401);
    expect((await tick("wrong-secret-0123456789abcdef-0123456789")).status).toBe(401);
    await enqueue({ type: "test.unknown", aggregateType: "test", aggregateId: "1", payload: {}, dedupeKey: "tick-test-1" });
    const res = await tick(SECRET);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, outboxProcessed: expect.any(Number), expiredOrders: expect.any(Number) });
    expect(body.outboxProcessed).toBeGreaterThanOrEqual(1);
    const c = await getCollections();
    expect((await c.outboxEvents.findOne({ dedupeKey: "tick-test-1" }))?.state).toBe("dead"); // no handler: parked, not retried forever
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
