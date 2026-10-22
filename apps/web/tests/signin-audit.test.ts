import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, teardownTestDb } from "./helpers/db";
import { call } from "./helpers/http";
import { PASSWORD, makeUser } from "./helpers/factory";
import { PERMISSIONS } from "@/server/modules/authorization/permissions";
import { loginHandler } from "@/server/api/handlers/auth";
import { auditLogsHandler } from "@/server/api/handlers/admin";
import { getCollections } from "@/server/db/collections";

beforeAll(async () => {
  await setupTestDb();
});
afterAll(teardownTestDb);

const device = { platform: "web" };

describe("sign-in auditing", () => {
  it("records staff sign-ins (admin, seller) with the actor, but not customers", async () => {
    const c = await getCollections();
    const admin = await makeUser({ role: "admin", permissions: PERMISSIONS }); // makeUser signs the user in
    const seller = await makeUser({ role: "vendor" });
    const customer = await makeUser({ role: "customer" });
    expect(await c.auditLogs.countDocuments({ actorId: admin.id, action: "auth.login" })).toBe(1);
    expect(await c.auditLogs.countDocuments({ actorId: seller.id, action: "auth.login" })).toBe(1);
    expect(await c.auditLogs.countDocuments({ actorId: customer.id })).toBe(0);
  });

  it("records failed staff sign-ins and never stores the password", async () => {
    const c = await getCollections();
    const admin = await makeUser({ role: "admin", permissions: PERMISSIONS });
    const bad = await call(loginHandler, { method: "POST", body: { email: admin.email, password: "definitely-wrong-password", device } });
    expect(bad.status).toBe(401);
    const row = await c.auditLogs.findOne({ actorId: admin.id, action: "auth.login_failed" });
    expect(row).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain("definitely-wrong-password");
    expect(JSON.stringify(row)).not.toContain(PASSWORD);
  });

  it("shows who did it in the admin audit log", async () => {
    const admin = await makeUser({ role: "admin", permissions: PERMISSIONS });
    const r = await call(auditLogsHandler, { token: admin.token, query: { action: "auth.login", limit: "50" } });
    expect(r.status).toBe(200);
    const mine = (r.data as { actor?: { email: string }; actorId?: string }[]).find((x) => x.actorId === admin.id.toHexString());
    expect(mine?.actor?.email).toBe(admin.email);
  });
});
