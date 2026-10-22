import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, teardownTestDb } from "./helpers/db";
import { call } from "./helpers/http";
import { PASSWORD, makeUser } from "./helpers/factory";
import { PERMISSIONS } from "@/server/modules/authorization/permissions";
import { loginHandler, refreshHandler, stepUpHandler } from "@/server/api/handlers/auth";
import { adminApproveRefundHandler, adminRetryRefundHandler } from "@/server/api/handlers/payments";
import { approvePayoutHandler, markFailedHandler, markPaidHandler } from "@/server/api/handlers/commerce-ops";
import { commissionHandler } from "@/server/api/handlers/admin";
import { getCollections } from "@/server/db/collections";

beforeAll(async () => {
  await setupTestDb();
});
afterAll(teardownTestDb);

const zero = "0".repeat(24);
/** A fresh admin session: logged in, password NOT re-entered since. */
async function freshAdmin() {
  const a = await makeUser({ role: "admin", permissions: PERMISSIONS });
  const c = await getCollections();
  await c.sessions.updateMany({ userId: a.id }, { $unset: { stepUpAt: "" } });
  return a;
}
const risky = [
  ["refund approve", adminApproveRefundHandler, "POST", {}], ["refund retry", adminRetryRefundHandler, "POST", {}],
  ["payout approve", approvePayoutHandler, "POST", {}], ["payout paid", markPaidHandler, "POST", { providerRef: "TXN-0001" }],
  ["payout failed", markFailedHandler, "POST", { reason: "bank error" }], ["commission", commissionHandler, "PATCH", { commissionBps: 500, reason: "negotiated" }],
] as const;

describe("step-up authentication", () => {
  it("blocks every high-risk action until the password is re-entered", async () => {
    const a = await freshAdmin();
    for (const [name, handler, method, body] of risky) {
      const r = await call(handler, { method, token: a.token, params: { id: zero }, body });
      expect(r.status, name).toBe(403);
      expect(r.error?.code, name).toBe("STEP_UP_REQUIRED");
    }
  });

  it("verifies the password, then allows the actions (reaching the real not-found) for a limited window", async () => {
    const a = await freshAdmin();
    const wrong = await call(stepUpHandler, { method: "POST", token: a.token, body: { password: "not-my-password" } });
    expect(wrong.error?.code).toBe("INVALID_CREDENTIALS");
    expect((await call(adminApproveRefundHandler, { method: "POST", token: a.token, params: { id: zero }, body: {} })).error?.code).toBe("STEP_UP_REQUIRED");

    const ok = await call(stepUpHandler, { method: "POST", token: a.token, body: { password: PASSWORD } });
    expect(ok.data).toEqual({ expiresInSeconds: 300 });
    for (const [name, handler, method, body] of risky) {
      const r = await call(handler, { method, token: a.token, params: { id: zero }, body });
      expect(r.error?.code, name).not.toBe("STEP_UP_REQUIRED"); // passed the gate; a missing record is a 404
      expect(r.status, name).toBe(404);
    }
    const c = await getCollections();
    expect(await c.auditLogs.countDocuments({ action: "auth.step_up", actorId: a.id })).toBe(1);

    // five minutes later the privilege is gone again
    await c.sessions.updateMany({ userId: a.id }, { $set: { stepUpAt: new Date(Date.now() - 6 * 60_000) } });
    expect((await call(adminApproveRefundHandler, { method: "POST", token: a.token, params: { id: zero }, body: {} })).error?.code).toBe("STEP_UP_REQUIRED");
  });

  it("is per-session: a second device or a new login does not inherit it", async () => {
    const a = await freshAdmin();
    await call(stepUpHandler, { method: "POST", token: a.token, body: { password: PASSWORD } });
    const second = await call(loginHandler, { method: "POST", body: { email: a.email, password: PASSWORD } });
    const r = await call(adminApproveRefundHandler, { method: "POST", token: second.data.tokens.accessToken, params: { id: zero }, body: {} });
    expect(r.error?.code).toBe("STEP_UP_REQUIRED");
  });

  it("survives a normal token refresh only within its window", async () => {
    const a = await freshAdmin();
    await call(stepUpHandler, { method: "POST", token: a.token, body: { password: PASSWORD } });
    const refreshed = await call(refreshHandler, { method: "POST", body: { refreshToken: a.refreshToken } });
    expect((await call(adminApproveRefundHandler, { method: "POST", token: refreshed.data.accessToken, params: { id: zero }, body: {} })).status).toBe(404);
    const c = await getCollections();
    await c.sessions.updateMany({ userId: a.id }, { $set: { stepUpAt: new Date(Date.now() - 10 * 60_000) } });
    expect((await call(adminApproveRefundHandler, { method: "POST", token: refreshed.data.accessToken, params: { id: zero }, body: {} })).error?.code).toBe("STEP_UP_REQUIRED");
  });

  it("is rate-limited and only offered to signed-in users", async () => {
    const a = await freshAdmin();
    let last = 0;
    for (let i = 0; i < 7; i++) last = (await call(stepUpHandler, { method: "POST", token: a.token, body: { password: "wrong-password-x" } })).status;
    expect(last).toBe(429);
    expect((await call(stepUpHandler, { method: "POST", body: { password: PASSWORD } })).status).toBe(401);
  });
});
