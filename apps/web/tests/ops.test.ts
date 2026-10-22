import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, teardownTestDb } from "./helpers/db";
import { call } from "./helpers/http";
import { makeAdmin, makeCustomer } from "./helpers/factory";
import { livenessHandler, opsHealthHandler, readinessHandler } from "@/server/api/handlers/ops";
import { getCollections } from "@/server/db/collections";
import { enqueue } from "@/server/modules/outbox/outbox";
import { newId } from "@/server/shared/ids";
import { parseEnv, setEnvForTests } from "@/server/config/env";
import { TEST_ENV_SOURCE } from "./helpers/env";

beforeAll(async () => {
  await setupTestDb();
});
afterAll(teardownTestDb);

describe("health endpoints", () => {
  it("liveness needs nothing; readiness checks config and database", async () => {
    expect((await call(livenessHandler)).data).toEqual({ status: "ok" });
    expect((await call(readinessHandler)).data).toEqual({ status: "ready" });
  });
  it("readiness fails when the database is unreachable", async () => {
    const { closeClient } = await import("@/server/db/client");
    const good = parseEnv({ ...TEST_ENV_SOURCE, MONGODB_URI: process.env.TEST_MONGODB_URI! });
    await closeClient();
    setEnvForTests({ ...good, MONGODB_URI: "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=300" });
    try {
      expect((await call(readinessHandler)).status).toBe(500);
    } finally {
      await closeClient();
      setEnvForTests(good);
    }
  });
});

describe("ops health summary", () => {
  it("reports queue depth, dead letters and stuck money movements to authorised admins only", async () => {
    const c = await getCollections();
    await enqueue({ type: "x", aggregateType: "t", aggregateId: "1", dedupeKey: "ops-1", payload: {} });
    await c.outboxEvents.insertOne({ _id: newId(), type: "x", aggregateType: "t", aggregateId: "2", payload: {}, dedupeKey: "ops-2", state: "dead", attempts: 8, nextAttemptAt: new Date(), createdAt: new Date() });
    const reporter = await makeAdmin(["report.read"]);
    const r = await call(opsHealthHandler, { token: reporter.token });
    expect(r.data.outbox).toMatchObject({ dead: 1 });
    expect(r.data.outbox.pending).toBeGreaterThanOrEqual(1);
    expect(r.data).toHaveProperty("payments.unknown");
    expect(r.data).toHaveProperty("refunds.failed");
    expect((await call(opsHealthHandler, { token: (await makeAdmin(["audit.read"])).token })).status).toBe(403);
    expect((await call(opsHealthHandler, { token: (await makeCustomer()).token })).status).toBe(403);
  });
});
