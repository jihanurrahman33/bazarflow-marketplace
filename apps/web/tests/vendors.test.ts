import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, teardownTestDb } from "./helpers/db";
import { call } from "./helpers/http";
import { makeAdmin, makeCustomer, makeUser, makeVendor, uniq, PASSWORD } from "./helpers/factory";
import {
  applyHandler, getApplicationHandler, getProfileHandler, patchProfileHandler, publicVendorHandler, resubmitApplicationHandler,
} from "@/server/api/handlers/vendors";
import {
  approveApplicationHandler, auditLogsHandler, commissionHandler, listApplicationsHandler, listUsersHandler, listVendorsHandler,
  reinstateVendorHandler, rejectApplicationHandler, requestInfoHandler, suspendUserHandler, suspendVendorHandler,
} from "@/server/api/handlers/admin";
import { listNotificationsHandler, markReadHandler, registerDeviceHandler } from "@/server/api/handlers/notifications";
import { getCollections } from "@/server/db/collections";
import { processOutbox } from "@/server/modules/outbox/outbox";
import { outboxHandlers } from "@/server/modules/outbox/handlers";
import { MemoryPushProvider, setPushProvider } from "@/server/modules/notifications/push";
import { meGetHandler, loginHandler } from "@/server/api/handlers/auth";

const push = new MemoryPushProvider();
const appBody = (slug = uniq("store").toLowerCase()) => ({
  business: { name: "My Store", slug, phone: "+8801711111111", address: "Gulshan, Dhaka" },
  documents: [{ publicId: "docs/license1", kind: "trade_license" }],
});

beforeAll(async () => {
  await setupTestDb();
  setPushProvider(push);
});
afterAll(teardownTestDb);

describe("vendor application", () => {
  it("requires a verified customer and allows only one open application", async () => {
    const unverified = await makeCustomer(false);
    expect((await call(applyHandler, { method: "POST", token: unverified.token, body: appBody() })).status).toBe(403);
    const c = await makeCustomer();
    const first = await call(applyHandler, { method: "POST", token: c.token, body: appBody() });
    expect(first.status).toBe(201);
    expect(first.data.status).toBe("submitted");
    const second = await call(applyHandler, { method: "POST", token: c.token, body: appBody() });
    expect(second.error?.code).toBe("CONFLICT");
    expect((await call(getApplicationHandler, { token: c.token })).data.id).toBe(first.data.id);
  });

  it("rejects unknown fields (no self-approval) and bad slugs; guests cannot apply", async () => {
    const c = await makeCustomer();
    expect((await call(applyHandler, { method: "POST", token: c.token, body: { ...appBody(), status: "approved" } })).status).toBe(400);
    expect((await call(applyHandler, { method: "POST", token: c.token, body: appBody("Bad Slug!") })).status).toBe(400);
    expect((await call(applyHandler, { method: "POST", body: appBody() })).status).toBe(401);
  });

  it("rejects a slug that an active vendor already owns", async () => {
    const v = await makeVendor({ slug: "taken-slug" });
    expect(v.vendorId).toBeTruthy();
    const c = await makeCustomer();
    const r = await call(applyHandler, { method: "POST", token: c.token, body: appBody("taken-slug") });
    expect(r.error?.code).toBe("CONFLICT");
  });
});

describe("admin review", () => {
  it("approves, promotes the applicant to vendor, audits, notifies and forces re-login", async () => {
    const cust = await makeCustomer();
    const admin = await makeAdmin();
    const app = await call(applyHandler, { method: "POST", token: cust.token, body: appBody() });
    const approve = await call(approveApplicationHandler, { method: "POST", token: admin.token, params: { id: app.data.id } });
    expect(approve.status).toBe(200);
    expect(approve.data.commissionBps).toBe(1000);
    // old tokens revoked because the role changed
    expect((await call(meGetHandler, { token: cust.token })).status).toBe(401);
    const relog = await call(loginHandler, { method: "POST", body: { email: cust.email, password: PASSWORD } });
    expect(relog.data.user.role).toBe("vendor");
    expect(relog.data.user.vendorId).toBe(approve.data.id);
    // approving twice is an invalid transition
    expect((await call(approveApplicationHandler, { method: "POST", token: admin.token, params: { id: app.data.id } })).error?.code).toBe("INVALID_STATE_TRANSITION");
    // audit trail
    const logs = await call(auditLogsHandler, { token: admin.token, query: { resourceType: "vendor_application", resourceId: app.data.id } });
    expect(logs.data.map((l: { action: string }) => l.action)).toContain("vendor_application.approve");
    // outbox -> inbox notification (idempotent on redelivery)
    await processOutbox(outboxHandlers);
    const inbox = await call(listNotificationsHandler, { token: relog.data.tokens.accessToken });
    expect(inbox.data.filter((n: { eventType: string }) => n.eventType === "vendor.approved")).toHaveLength(1);
    const c = await getCollections();
    await c.outboxEvents.updateMany({}, { $set: { state: "pending", nextAttemptAt: new Date(0) } }); // force redelivery
    await processOutbox(outboxHandlers);
    const again = await call(listNotificationsHandler, { token: relog.data.tokens.accessToken });
    expect(again.data.filter((n: { eventType: string }) => n.eventType === "vendor.approved")).toHaveLength(1);
  });

  it("two admins approving concurrently create exactly one vendor", async () => {
    const cust = await makeCustomer();
    const [a1, a2] = [await makeAdmin(), await makeAdmin()];
    const app = await call(applyHandler, { method: "POST", token: cust.token, body: appBody() });
    const rs = await Promise.all([
      call(approveApplicationHandler, { method: "POST", token: a1.token, params: { id: app.data.id } }),
      call(approveApplicationHandler, { method: "POST", token: a2.token, params: { id: app.data.id } }),
    ]);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    const c = await getCollections();
    expect(await c.vendors.countDocuments({ ownerUserId: cust.id })).toBe(1);
  });

  it("requires the exact permission; customers, vendors and under-privileged admins are refused", async () => {
    const cust = await makeCustomer();
    const app = await call(applyHandler, { method: "POST", token: cust.token, body: appBody() });
    const support = await makeAdmin(["order.read_all"]);
    const v = await makeVendor();
    for (const t of [cust.token, v.user.token, support.token]) {
      expect((await call(approveApplicationHandler, { method: "POST", token: t, params: { id: app.data.id } })).status).toBe(403);
      expect((await call(listApplicationsHandler, { token: t })).status).toBe(403);
      expect((await call(auditLogsHandler, { token: t })).status).toBe(403);
    }
    expect((await call(approveApplicationHandler, { method: "POST", params: { id: app.data.id } })).status).toBe(401);
  });

  it("request-info then resubmit then reject; reasons are required; rejected apps cannot be revived", async () => {
    const cust = await makeCustomer();
    const admin = await makeAdmin();
    const app = await call(applyHandler, { method: "POST", token: cust.token, body: appBody() });
    expect((await call(requestInfoHandler, { method: "POST", token: admin.token, params: { id: app.data.id }, body: {} })).status).toBe(400);
    const info = await call(requestInfoHandler, { method: "POST", token: admin.token, params: { id: app.data.id }, body: { reason: "Please attach trade license" } });
    expect(info.data.status).toBe("more_info_required");
    const re = await call(resubmitApplicationHandler, { method: "PUT", token: cust.token, body: appBody() });
    expect(re.data.status).toBe("submitted");
    const rej = await call(rejectApplicationHandler, { method: "POST", token: admin.token, params: { id: app.data.id }, body: { reason: "Not eligible" } });
    expect(rej.data.status).toBe("rejected");
    expect((await call(approveApplicationHandler, { method: "POST", token: admin.token, params: { id: app.data.id } })).error?.code).toBe("INVALID_STATE_TRANSITION");
    // after rejection the user may apply again
    expect((await call(applyHandler, { method: "POST", token: cust.token, body: appBody() })).status).toBe(201);
  });

  it("lists applications with cursor pagination", async () => {
    const admin = await makeAdmin();
    for (let i = 0; i < 3; i++) await call(applyHandler, { method: "POST", token: (await makeCustomer()).token, body: appBody() });
    const p1 = await call(listApplicationsHandler, { token: admin.token, query: { limit: 2, status: "submitted" } });
    expect(p1.data).toHaveLength(2);
    expect(p1.json.meta?.hasMore).toBe(true);
    const p2 = await call(listApplicationsHandler, { token: admin.token, query: { limit: 2, status: "submitted", cursor: p1.json.meta!.nextCursor } });
    expect(p2.data.length).toBeGreaterThan(0);
    expect(p2.data[0].id).not.toBe(p1.data[1].id);
    expect((await call(listApplicationsHandler, { token: admin.token, query: { limit: 500 } })).status).toBe(400);
    expect((await call(listApplicationsHandler, { token: admin.token, query: { cursor: "!!!" } })).status).toBe(400);
  });
});

describe("vendor profile", () => {
  it("lets a vendor edit only allow-listed fields; commission/status/slug are not assignable", async () => {
    const v = await makeVendor();
    const ok = await call(patchProfileHandler, { method: "PATCH", token: v.user.token, body: { name: "Renamed", shipping: { flatFeeMinor: 6000, freeOverMinor: 100000 } } });
    expect(ok.data.name).toBe("Renamed");
    expect(ok.data.shipping).toEqual({ flatFeeMinor: 6000, freeOverMinor: 100000 });
    for (const bad of [{ commissionBps: 0 }, { status: "active" }, { slug: "hax" }, { ownerUserId: "x" }]) {
      expect((await call(patchProfileHandler, { method: "PATCH", token: v.user.token, body: bad })).status).toBe(400);
    }
    expect((await call(getProfileHandler, { token: v.user.token })).data.commissionBps).toBe(1000);
    const cust = await makeCustomer();
    expect((await call(getProfileHandler, { token: cust.token })).status).toBe(403);
  });

  it("exposes a public profile without commission or owner details", async () => {
    const v = await makeVendor({ slug: "public-shop" });
    const r = await call(publicVendorHandler, { params: { slug: "public-shop" } });
    expect(r.status).toBe(200);
    expect(r.data).not.toHaveProperty("commissionBps");
    expect(r.data).not.toHaveProperty("ownerUserId");
    expect(r.headers.get("cache-control")).toContain("s-maxage");
    expect((await call(publicVendorHandler, { params: { slug: "nope" } })).status).toBe(404);
    expect(v.vendorId).toBeTruthy();
  });
});

describe("vendor suspension and commission", () => {
  it("suspends and reinstates with audit, hides products, and versions commission changes", async () => {
    const v = await makeVendor({ slug: "to-suspend" });
    const admin = await makeAdmin();
    const c = await getCollections();
    const s = await call(suspendVendorHandler, { method: "POST", token: admin.token, params: { id: v.vendorId.toHexString() }, body: { reason: "Policy violation" } });
    expect(s.data.status).toBe("suspended");
    expect((await call(publicVendorHandler, { params: { slug: "to-suspend" } })).status).toBe(404);
    expect((await call(suspendVendorHandler, { method: "POST", token: admin.token, params: { id: v.vendorId.toHexString() }, body: { reason: "again" } })).error?.code).toBe("INVALID_STATE_TRANSITION");
    expect((await call(reinstateVendorHandler, { method: "POST", token: admin.token, params: { id: v.vendorId.toHexString() }, body: { reason: "Resolved" } })).data.status).toBe("active");
    const commission = await call(commissionHandler, { method: "PATCH", token: admin.token, params: { id: v.vendorId.toHexString() }, body: { commissionBps: 750, reason: "Negotiated rate" } });
    expect(commission.data.commissionBps).toBe(750);
    const doc = await c.vendors.findOne({ _id: v.vendorId });
    expect(doc?.commissionRuleVersion).toBe(2);
    const noSettings = await makeAdmin(["vendor.suspend"]);
    expect((await call(commissionHandler, { method: "PATCH", token: noSettings.token, params: { id: v.vendorId.toHexString() }, body: { commissionBps: 0, reason: "x y z" } })).status).toBe(403);
    expect((await call(commissionHandler, { method: "PATCH", token: admin.token, params: { id: v.vendorId.toHexString() }, body: { commissionBps: 9000, reason: "too high" } })).status).toBe(400);
    const actions = (await call(auditLogsHandler, { token: admin.token, query: { resourceType: "vendor", resourceId: v.vendorId.toHexString() } })).data.map((l: { action: string }) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["vendor.suspend", "vendor.reinstate", "vendor.commission_change"]));
    expect((await call(listVendorsHandler, { token: admin.token, query: { status: "active" } })).status).toBe(200);
  });
});

describe("user administration", () => {
  it("suspends a user, kills their sessions, blocks self-suspension and admin targets", async () => {
    const admin = await makeAdmin();
    const victim = await makeCustomer();
    const ok = await call(suspendUserHandler, { method: "POST", token: admin.token, params: { id: victim.id.toHexString() }, body: { reason: "Fraud review" } });
    expect(ok.data.permissions).toEqual([]);
    expect((await call(meGetHandler, { token: victim.token })).status).toBe(401);
    expect((await call(suspendUserHandler, { method: "POST", token: admin.token, params: { id: admin.id.toHexString() }, body: { reason: "oops oops" } })).status).toBe(422);
    const other = await makeAdmin();
    expect((await call(suspendUserHandler, { method: "POST", token: admin.token, params: { id: other.id.toHexString() }, body: { reason: "nope nope" } })).status).toBe(403);
    expect((await call(suspendUserHandler, { method: "POST", token: (await makeAdmin(["user.read"])).token, params: { id: victim.id.toHexString() }, body: { reason: "nope nope" } })).status).toBe(403);
    const list = await call(listUsersHandler, { token: admin.token, query: { email: victim.email } });
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).not.toHaveProperty("passwordHash");
    expect((await call(suspendUserHandler, { method: "POST", token: admin.token, params: { id: "not-an-id" }, body: { reason: "valid reason" } })).error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("notifications and devices", () => {
  it("delivers push to registered devices once, deactivates invalid tokens, and scopes read-marking to the owner", async () => {
    const u = await makeUser();
    const other = await makeUser();
    const reg = await call(registerDeviceHandler, { method: "POST", token: u.token, body: { installationId: "install-abc-123", platform: "android", appId: "com.bazarflow.customer", pushToken: "tok_valid_000001" } });
    expect(reg.status).toBe(201);
    await call(registerDeviceHandler, { method: "POST", token: u.token, body: { installationId: "install-bad-123", platform: "ios", appId: "com.bazarflow.customer", pushToken: "tok_invalid_0001" } });
    push.invalidTokens.add("tok_invalid_0001");
    const { enqueue } = await import("@/server/modules/outbox/outbox");
    await enqueue({ type: "notify.user", aggregateType: "t", aggregateId: "1", dedupeKey: "t-1", payload: { userId: u.id.toHexString(), eventType: "order.paid", title: "Paid", body: "Thanks", deepLink: "/orders/1" } });
    await processOutbox(outboxHandlers);
    expect(push.sent.filter((m) => m.token === "tok_valid_000001" && m.data.eventType === "order.paid")).toHaveLength(1);
    const c = await getCollections();
    expect((await c.devices.findOne({ pushToken: "tok_invalid_0001" }))?.active).toBe(false);
    const list = await call(listNotificationsHandler, { token: u.token });
    expect(list.json.meta?.unreadCount).toBe(1);
    expect((await call(markReadHandler, { method: "PATCH", token: other.token, params: { id: list.data[0].id } })).status).toBe(404);
    expect((await call(markReadHandler, { method: "PATCH", token: u.token, params: { id: list.data[0].id } })).data.read).toBe(true);
    // handing the device to another account moves the token
    await call(registerDeviceHandler, { method: "POST", token: other.token, body: { installationId: "install-xyz-123", platform: "android", appId: "com.bazarflow.customer", pushToken: "tok_valid_000001" } });
    expect((await c.devices.findOne({ userId: u.id, pushToken: "tok_valid_000001" }))?.active).toBe(false);
  });
});
