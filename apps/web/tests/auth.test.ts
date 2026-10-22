import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, teardownTestDb } from "./helpers/db";
import { call } from "./helpers/http";
import {
  forgotPasswordHandler, loginHandler, logoutAllHandler, logoutHandler, meGetHandler, mePatchHandler, mePasswordHandler,
  refreshHandler, registerHandler, resendVerificationHandler, resetPasswordHandler, sessionDeleteHandler, sessionsListHandler, verifyContactHandler,
} from "@/server/api/handlers/auth";
import { MemoryMailer, setMailer } from "@/server/modules/notifications/mailer";
import { getCollections } from "@/server/db/collections";
import { signAccessToken } from "@/server/modules/identity/tokens";
import { SignJWT } from "jose";

const mailer = new MemoryMailer();
const PASSWORD = "correct-horse-battery";
let n = 0;
const email = () => `user${++n}@example.com`;

async function register(e = email()) {
  const r = await call(registerHandler, { method: "POST", body: { email: e, password: PASSWORD, name: "Test User" }, headers: { "x-forwarded-for": `10.0.0.${n}` } });
  expect(r.status).toBe(201);
  return { email: e, ...r.data.tokens, user: r.data.user };
}

beforeAll(async () => {
  await setupTestDb();
  setMailer(mailer);
});
afterAll(teardownTestDb);
beforeEach(async () => {
  const c = await getCollections();
  await c.rateLimits.deleteMany({});
});

describe("registration and login", () => {
  it("registers, returns tokens, hashes the password and sends a verification code", async () => {
    const u = await register();
    expect(u.accessToken).toBeTruthy();
    expect(u.user.role).toBe("customer");
    expect(u.user.emailVerified).toBe(false);
    const c = await getCollections();
    const doc = await c.users.findOne({ emailNormalized: u.email });
    expect(doc?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(mailer.last(u.email, "verify_email")?.code).toMatch(/^\d{6}$/);
    expect(JSON.stringify(u.user)).not.toContain("passwordHash");
  });

  it("rejects duplicate email (case-insensitive), weak passwords and unknown fields", async () => {
    const u = await register();
    const dup = await call(registerHandler, { method: "POST", body: { email: u.email.toUpperCase(), password: PASSWORD, name: "X" } });
    expect(dup.error?.code).toBe("EMAIL_TAKEN");
    const weak = await call(registerHandler, { method: "POST", body: { email: email(), password: "short", name: "X" } });
    expect(weak.error?.code).toBe("VALIDATION_FAILED");
    const mass = await call(registerHandler, { method: "POST", body: { email: email(), password: PASSWORD, name: "X", role: "admin" } });
    expect(mass.status).toBe(400);
    const c = await getCollections();
    expect(await c.users.countDocuments({ role: "admin" })).toBe(0);
  });

  it("logs in with correct credentials and does not reveal which part was wrong", async () => {
    const u = await register();
    const ok = await call(loginHandler, { method: "POST", body: { email: u.email, password: PASSWORD } });
    expect(ok.status).toBe(200);
    const badPw = await call(loginHandler, { method: "POST", body: { email: u.email, password: "wrong-password!" } });
    const noUser = await call(loginHandler, { method: "POST", body: { email: "nobody@example.com", password: "wrong-password!" } });
    expect(badPw.error?.code).toBe("INVALID_CREDENTIALS");
    expect(noUser.error?.code).toBe("INVALID_CREDENTIALS");
    expect(badPw.error?.message).toBe(noUser.error?.message);
  });

  it("temporarily locks the account after repeated failures", async () => {
    const u = await register();
    for (let i = 0; i < 5; i++) await call(loginHandler, { method: "POST", body: { email: u.email, password: "wrong-password!" } });
    const locked = await call(loginHandler, { method: "POST", body: { email: u.email, password: PASSWORD } });
    expect(locked.status).toBe(429);
    expect(locked.headers.get("retry-after")).toBeTruthy();
  });

  it("rate limits login attempts per IP", async () => {
    const hdr = { "x-forwarded-for": "203.0.113.9" };
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await call(loginHandler, { method: "POST", body: { email: "x@example.com", password: "nope-nope-nope" }, headers: hdr })).status;
    expect(last).toBe(429);
  });

  it("blocks suspended accounts at login and on existing tokens", async () => {
    const u = await register();
    const c = await getCollections();
    await c.users.updateOne({ emailNormalized: u.email }, { $set: { status: "suspended" } });
    const login = await call(loginHandler, { method: "POST", body: { email: u.email, password: PASSWORD } });
    expect(login.error?.code).toBe("ACCOUNT_SUSPENDED");
    const me = await call(meGetHandler, { token: u.accessToken });
    expect(me.error?.code).toBe("ACCOUNT_SUSPENDED");
  });
});

describe("access tokens", () => {
  it("rejects missing, malformed, tampered, wrong-alg and expired tokens", async () => {
    const u = await register();
    expect((await call(meGetHandler)).error?.code).toBe("UNAUTHENTICATED");
    expect((await call(meGetHandler, { token: "garbage" })).error?.code).toBe("UNAUTHENTICATED");
    expect((await call(meGetHandler, { token: u.accessToken.slice(0, -3) + "abc" })).error?.code).toBe("UNAUTHENTICATED");
    const none = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url") + "." + u.accessToken.split(".")[1] + ".";
    expect((await call(meGetHandler, { token: none })).error?.code).toBe("UNAUTHENTICATED");
    const wrongKey = await new SignJWT({ sid: "x", role: "admin", typ: "access" })
      .setProtectedHeader({ alg: "HS256" }).setSubject(u.user.id).setIssuer("bazarflow").setAudience("bazarflow-api")
      .setIssuedAt().setExpirationTime("5m").sign(new TextEncoder().encode("a-different-secret-that-is-long-enough-123456"));
    expect((await call(meGetHandler, { token: wrongKey })).error?.code).toBe("UNAUTHENTICATED");
    const expired = await new SignJWT({ sid: "x", role: "customer", typ: "access" })
      .setProtectedHeader({ alg: "HS256" }).setSubject(u.user.id).setIssuer("bazarflow").setAudience("bazarflow-api")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600).setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode("test-access-secret-0123456789abcdef-0123456789"));
    expect((await call(meGetHandler, { token: expired })).error?.code).toBe("TOKEN_EXPIRED");
  });

  it("rejects a valid token whose session was revoked", async () => {
    const u = await register();
    expect((await call(meGetHandler, { token: u.accessToken })).status).toBe(200);
    await call(logoutHandler, { method: "POST", body: { refreshToken: u.refreshToken } });
    expect((await call(meGetHandler, { token: u.accessToken })).error?.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a token signed for a session that does not exist", async () => {
    const u = await register();
    const { token } = await signAccessToken({ sub: u.user.id, sid: "no-such-session", role: "customer" });
    expect((await call(meGetHandler, { token })).error?.code).toBe("UNAUTHENTICATED");
  });
});

describe("refresh rotation", () => {
  it("rotates the refresh token and issues a working access token", async () => {
    const u = await register();
    const r = await call(refreshHandler, { method: "POST", body: { refreshToken: u.refreshToken } });
    expect(r.status).toBe(200);
    expect(r.data.refreshToken).not.toBe(u.refreshToken);
    expect((await call(meGetHandler, { token: r.data.accessToken })).status).toBe(200);
  });

  it("detects reuse of a rotated token and revokes the whole family", async () => {
    const u = await register();
    const first = await call(refreshHandler, { method: "POST", body: { refreshToken: u.refreshToken } });
    const replay = await call(refreshHandler, { method: "POST", body: { refreshToken: u.refreshToken } });
    expect(replay.error?.code).toBe("REFRESH_TOKEN_INVALID");
    // The legitimate newest token is now dead too.
    const afterTheft = await call(refreshHandler, { method: "POST", body: { refreshToken: first.data.refreshToken } });
    expect(afterTheft.error?.code).toBe("REFRESH_TOKEN_INVALID");
    expect((await call(meGetHandler, { token: first.data.accessToken })).error?.code).toBe("UNAUTHENTICATED");
  });

  it("only one of two concurrent refreshes with the same token succeeds", async () => {
    const u = await register();
    const results = await Promise.all([
      call(refreshHandler, { method: "POST", body: { refreshToken: u.refreshToken } }),
      call(refreshHandler, { method: "POST", body: { refreshToken: u.refreshToken } }),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it("rejects unknown refresh tokens and suspended users", async () => {
    expect((await call(refreshHandler, { method: "POST", body: { refreshToken: "x".repeat(60) } })).error?.code).toBe("REFRESH_TOKEN_INVALID");
    const u = await register();
    const c = await getCollections();
    await c.users.updateOne({ emailNormalized: u.email }, { $set: { status: "suspended" } });
    expect((await call(refreshHandler, { method: "POST", body: { refreshToken: u.refreshToken } })).error?.code).toBe("REFRESH_TOKEN_INVALID");
  });

  it("stores only a hash of the refresh token", async () => {
    const u = await register();
    const c = await getCollections();
    expect(await c.sessions.countDocuments({ tokenHash: u.refreshToken })).toBe(0);
  });
});

describe("sessions", () => {
  it("lists devices, revokes one and signs out everywhere", async () => {
    const a = await register();
    const b = await call(loginHandler, { method: "POST", body: { email: a.email, password: PASSWORD, device: { platform: "ios", name: "iPhone" } } });
    const list = await call(sessionsListHandler, { token: a.accessToken });
    expect(list.data).toHaveLength(2);
    expect(list.data.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    const other = list.data.find((s: { current: boolean }) => !s.current);
    expect((await call(sessionDeleteHandler, { method: "DELETE", token: a.accessToken, params: { sessionId: other.id } })).status).toBe(204);
    expect((await call(meGetHandler, { token: b.data.tokens.accessToken })).error?.code).toBe("UNAUTHENTICATED");
    // Another user's session id is not found (no existence leak).
    const c2 = await register();
    expect((await call(sessionDeleteHandler, { method: "DELETE", token: c2.accessToken, params: { sessionId: other.id } })).status).toBe(404);
    expect((await call(logoutAllHandler, { method: "POST", token: a.accessToken })).status).toBe(204);
    expect((await call(meGetHandler, { token: a.accessToken })).status).toBe(401);
  });
});

describe("verification and recovery", () => {
  it("verifies email with the code, and rejects wrong codes with attempt limits", async () => {
    const u = await register();
    const real = mailer.last(u.email, "verify_email")!.code;
    const wrong = real === "000000" ? "000001" : "000000";
    expect((await call(verifyContactHandler, { method: "POST", token: u.accessToken, body: { code: wrong } })).error?.code).toBe("VALIDATION_FAILED");
    const ok = await call(verifyContactHandler, { method: "POST", token: u.accessToken, body: { code: real } });
    expect(ok.data.emailVerified).toBe(true);
    expect((await call(verifyContactHandler, { method: "POST", token: u.accessToken, body: { code: real } })).status).toBe(400); // single use
  });

  it("locks a code after too many wrong attempts", async () => {
    const u = await register();
    const real = mailer.last(u.email, "verify_email")!.code;
    const c = await getCollections();
    for (let i = 0; i < 5; i++) {
      await c.rateLimits.deleteMany({});
      await call(verifyContactHandler, { method: "POST", token: u.accessToken, body: { code: real === "123456" ? "654321" : "123456" } });
    }
    await c.rateLimits.deleteMany({});
    expect((await call(verifyContactHandler, { method: "POST", token: u.accessToken, body: { code: real } })).status).toBe(400);
  });

  it("resends verification only once verified=false", async () => {
    const u = await register();
    const before = mailer.sent.length;
    expect((await call(resendVerificationHandler, { method: "POST", token: u.accessToken })).status).toBe(202);
    expect(mailer.sent.length).toBe(before + 1);
  });

  it("responds identically for known and unknown emails and resets the password, revoking sessions", async () => {
    const u = await register();
    const known = await call(forgotPasswordHandler, { method: "POST", body: { email: u.email } });
    const unknown = await call(forgotPasswordHandler, { method: "POST", body: { email: "ghost@example.com" } });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(mailer.last("ghost@example.com")).toBeUndefined();
    const code = mailer.last(u.email, "password_reset")!.code;
    const bad = await call(resetPasswordHandler, { method: "POST", body: { email: u.email, code: code === "111111" ? "222222" : "111111", newPassword: "a-brand-new-password" } });
    expect(bad.status).toBe(400);
    const good = await call(resetPasswordHandler, { method: "POST", body: { email: u.email, code, newPassword: "a-brand-new-password" } });
    expect(good.status).toBe(204);
    expect((await call(meGetHandler, { token: u.accessToken })).status).toBe(401);
    expect((await call(loginHandler, { method: "POST", body: { email: u.email, password: PASSWORD } })).status).toBe(401);
    expect((await call(loginHandler, { method: "POST", body: { email: u.email, password: "a-brand-new-password" } })).status).toBe(200);
  });
});

describe("profile", () => {
  it("updates allow-listed fields only and changes password", async () => {
    const u = await register();
    const patched = await call(mePatchHandler, { method: "PATCH", token: u.accessToken, body: { name: "New Name", phone: "+8801700000000" } });
    expect(patched.data.name).toBe("New Name");
    const forbidden = await call(mePatchHandler, { method: "PATCH", token: u.accessToken, body: { role: "admin", permissions: ["audit.read"] } });
    expect(forbidden.status).toBe(400);
    const pw = await call(mePasswordHandler, { method: "POST", token: u.accessToken, body: { currentPassword: "wrong-current", newPassword: "another-long-password" } });
    expect(pw.error?.code).toBe("INVALID_CREDENTIALS");
    expect((await call(mePasswordHandler, { method: "POST", token: u.accessToken, body: { currentPassword: PASSWORD, newPassword: "another-long-password" } })).status).toBe(204);
    expect((await call(meGetHandler, { token: u.accessToken })).status).toBe(200); // current session kept
  });
});

describe("web cookie transport", () => {
  it("sets HttpOnly cookies, hides tokens from the body and enforces same-origin on mutations", async () => {
    const e = email();
    const r = await call(registerHandler, { method: "POST", body: { email: e, password: PASSWORD, name: "Web", transport: "cookie" } });
    expect(r.data.tokens).toBeUndefined();
    const cookies = r.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith("bf_at=") && c.includes("HttpOnly") && c.includes("SameSite=Lax"))).toBe(true);
    expect(cookies.some((c) => c.startsWith("bf_rt=") && c.includes("Path=/api/v1/auth"))).toBe(true);
    const at = cookies.find((c) => c.startsWith("bf_at="))!.split(";")[0]!;
    // GET with cookie works
    expect((await call(meGetHandler, { headers: { cookie: at } })).status).toBe(200);
    // Mutation without a matching Origin is a CSRF attempt
    expect((await call(mePatchHandler, { method: "PATCH", body: { name: "x" }, headers: { cookie: at } })).error?.code).toBe("ORIGIN_NOT_ALLOWED");
    expect((await call(mePatchHandler, { method: "PATCH", body: { name: "x" }, headers: { cookie: at, origin: "https://evil.example" } })).error?.code).toBe("ORIGIN_NOT_ALLOWED");
    expect((await call(mePatchHandler, { method: "PATCH", body: { name: "ok" }, headers: { cookie: at, origin: "http://localhost:3000" } })).status).toBe(200);
  });
});

describe("request hygiene", () => {
  it("returns the standard error envelope, request id and no-store; rejects bad JSON and oversized bodies", async () => {
    const bad = await call(loginHandler, { method: "POST", rawBody: "{not json" });
    expect(bad.error?.code).toBe("MALFORMED_JSON");
    expect(bad.error?.requestId).toBeTruthy();
    expect(bad.headers.get("cache-control")).toBe("no-store");
    const big = await call(loginHandler, { method: "POST", rawBody: JSON.stringify({ email: "a@b.co", password: "x".repeat(70_000) }) });
    expect(big.error?.code).toBe("PAYLOAD_TOO_LARGE");
    const echo = await call(loginHandler, { method: "POST", body: {}, headers: { "x-request-id": "req-123" } });
    expect(echo.error?.requestId).toBe("req-123");
  });
});
