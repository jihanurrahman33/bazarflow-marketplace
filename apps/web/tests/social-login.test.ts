import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, teardownTestDb } from "./helpers/db";
import { call } from "./helpers/http";
import { PASSWORD, makeUser, uniq } from "./helpers/factory";
import { PERMISSIONS } from "@/server/modules/authorization/permissions";
import { socialConfigHandler, socialLoginHandler } from "@/server/api/handlers/auth";
import { setFirebaseVerifier, type FirebaseIdentity } from "@/server/modules/identity/firebase";
import { getCollections } from "@/server/db/collections";
import { login } from "@/server/modules/identity/service";

beforeAll(async () => {
  await setupTestDb();
});
afterAll(teardownTestDb);
afterEach(() => setFirebaseVerifier(undefined));

const FAKE_TOKEN = "t".repeat(120); // only its length matters: the injected verifier decides what it means
const device = { platform: "web" };
const as = (id: Partial<FirebaseIdentity> & { subject: string }) =>
  setFirebaseVerifier(async () => ({ provider: "google.com", emailVerified: true, ...id }));
const signIn = () => call(socialLoginHandler, { method: "POST", body: { idToken: FAKE_TOKEN, device, transport: "token" } });

describe("social sign-in (Firebase)", () => {
  it("creates a verified customer on first sign-in and signs the same person back in later", async () => {
    const email = `${uniq("new")}@example.com`;
    as({ subject: "g-1", email, name: "Social Person" });
    const first = await signIn();
    expect(first.status).toBe(200);
    expect(first.data.user).toMatchObject({ email, name: "Social Person", role: "customer", emailVerified: true });
    expect(first.data.tokens.accessToken).toBeTruthy();

    // Their email changed at the provider: the stable subject still finds them, no duplicate account.
    as({ subject: "g-1", email: `${uniq("changed")}@example.com` });
    const again = await signIn();
    expect(again.status).toBe(200);
    expect(again.data.user.id).toBe(first.data.user.id);
    const c = await getCollections();
    expect(await c.users.countDocuments({ "identities.subject": "g-1" })).toBe(1);
  });

  it("links to an existing account with the same verified email, keeping its password", async () => {
    const existing = await makeUser({ role: "customer" });
    as({ subject: "g-2", email: existing.email });
    const r = await signIn();
    expect(r.status).toBe(200);
    expect(r.data.user.id).toBe(existing.id.toHexString());
    await expect(login({ email: existing.email, password: PASSWORD, device })).resolves.toBeTruthy(); // password still works
  });

  it("discards the password and sessions of an UNVERIFIED local account when linking (pre-registration takeover)", async () => {
    const squatter = await makeUser({ role: "customer", verified: false }); // someone registered the victim's email first
    const c = await getCollections();
    const before = (await c.sessions.find({ userId: squatter.id, revokedAt: { $exists: false } }).toArray()).map((x) => x._id);
    expect(before.length).toBeGreaterThan(0);
    as({ subject: "g-3", email: squatter.email });
    const r = await signIn();
    expect(r.status).toBe(200);
    await expect(login({ email: squatter.email, password: PASSWORD, device })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    // every session that existed before the link is revoked; only the fresh social session is live
    expect(await c.sessions.countDocuments({ _id: { $in: before }, revokedAt: { $exists: false } })).toBe(0);
    expect(await c.sessions.countDocuments({ userId: squatter.id, revokedAt: { $exists: false } })).toBe(1);
  });

  it("refuses a provider email that is not verified, or missing", async () => {
    as({ subject: "g-4", email: `${uniq("unv")}@example.com`, emailVerified: false });
    expect((await signIn()).status).toBe(422);
    as({ subject: "g-5" });
    expect((await signIn()).status).toBe(422);
    const c = await getCollections();
    expect(await c.users.countDocuments({ "identities.subject": { $in: ["g-4", "g-5"] } })).toBe(0);
  });

  it("never signs in an administrator, by email match or by a linked identity", async () => {
    const admin = await makeUser({ role: "admin", permissions: PERMISSIONS });
    as({ subject: "g-6", email: admin.email });
    expect((await signIn()).status).toBe(403);
    const c = await getCollections();
    await c.users.updateOne({ _id: admin.id }, { $push: { identities: { provider: "google.com", subject: "g-7", linkedAt: new Date() } } });
    as({ subject: "g-7", email: admin.email });
    expect((await signIn()).status).toBe(403);
  });

  it("refuses suspended accounts and providers that are not enabled", async () => {
    const u = await makeUser({ role: "customer" });
    const c = await getCollections();
    await c.users.updateOne({ _id: u.id }, { $set: { status: "suspended" } });
    as({ subject: "g-8", email: u.email });
    expect((await signIn()).status).toBe(403);

    as({ subject: "x-1", email: `${uniq("tw")}@example.com`, provider: "twitter.com" });
    expect((await signIn()).status).toBe(422);
  });

  it("rejects a token the verifier cannot validate", async () => {
    setFirebaseVerifier(async () => { throw Object.assign(new Error("bad"), { name: "AppError" }); });
    const r = await signIn();
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).not.toBe(200);
  });

  it("reports itself disabled when Firebase is not configured", async () => {
    const r = await call(socialConfigHandler, {});
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ enabled: false, providers: [] });
  });
});
