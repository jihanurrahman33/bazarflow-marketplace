import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { setupTestDb, teardownTestDb } from "./helpers/db";
import { parseEnv } from "@/server/config/env";
import { TEST_ENV_SOURCE } from "./helpers/env";
import { add, fromDecimalString, percentBps, toDecimalString, money } from "@/server/shared/money";
import { defineStateMachine } from "@/server/shared/state-machine";
import { AppError } from "@/server/shared/errors";
import { withTransaction } from "@/server/db/transaction";
import { getCollections } from "@/server/db/collections";
import { newId } from "@/server/shared/ids";

describe("env", () => {
  it("rejects short secrets and mock-in-live", () => {
    expect(() => parseEnv({ ...TEST_ENV_SOURCE, JWT_ACCESS_SECRET: "short" })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => parseEnv({ ...TEST_ENV_SOURCE, PAYMENT_MODE: "live" })).toThrow(/mock provider/);
  });
  it("requires sslcommerz credentials", () => {
    expect(() => parseEnv({ ...TEST_ENV_SOURCE, PAYMENT_PROVIDER: "sslcommerz" })).toThrow(/SSLCOMMERZ/);
  });
});

describe("money", () => {
  it("uses integer minor units and rejects floats", () => {
    expect(() => money(10.5)).toThrow(AppError);
    expect(add(money(100), money(250)).amountMinor).toBe(350);
  });
  it("rounds commission half away from zero", () => {
    expect(percentBps(money(1005), 1000).amountMinor).toBe(101); // 100.5 -> 101
    expect(percentBps(money(1004), 1000).amountMinor).toBe(100);
    expect(percentBps(money(-1005), 1000).amountMinor).toBe(-101);
  });
  it("round-trips decimal strings", () => {
    expect(toDecimalString(money(12500))).toBe("125.00");
    expect(toDecimalString(money(5))).toBe("0.05");
    expect(fromDecimalString("125.5").amountMinor).toBe(12550);
    expect(() => fromDecimalString("1.234")).toThrow(AppError);
  });
});

describe("state machine", () => {
  const sm = defineStateMachine({ a: ["b"], b: ["c"], c: [] } as const);
  it("allows listed transitions only", () => {
    expect(sm.can("a", "b")).toBe(true);
    expect(sm.can("a", "c")).toBe(false);
    expect(() => sm.assert("c", "a")).toThrow(/Cannot move/);
    expect(sm.predecessors("c")).toEqual(["b"]);
    expect(sm.isTerminal("c")).toBe(true);
  });
});

describe("database", () => {
  beforeAll(async () => {
    await setupTestDb();
  });
  afterAll(teardownTestDb);

  it("enforces unique email index", async () => {
    const c = await getCollections();
    const base = {
      email: "a@x.com", emailNormalized: "a@x.com", passwordHash: "h", name: "A", role: "customer" as const,
      permissions: [], status: "active" as const, failedLoginCount: 0, createdAt: new Date(), updatedAt: new Date(),
    };
    await c.users.insertOne({ _id: newId(), ...base });
    await expect(c.users.insertOne({ _id: newId(), ...base })).rejects.toThrow(/duplicate key/);
  });

  it("supports multi-document transactions and rolls back on error", async () => {
    const c = await getCollections();
    const id = newId();
    await expect(
      withTransaction(async (session) => {
        await c.carts.insertOne({ _id: id, userId: newId(), lines: [], updatedAt: new Date() }, { session });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await c.carts.findOne({ _id: id })).toBeNull();
  });
});
