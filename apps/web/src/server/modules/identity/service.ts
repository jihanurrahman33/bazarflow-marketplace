import { randomInt } from "node:crypto";
import { ObjectId, MongoServerError } from "mongodb";
import { getEnv } from "@/server/config/env";
import { getCollections } from "@/server/db/collections";
import { withTransaction } from "@/server/db/transaction";
import type { OneTimeCodePurpose, SessionDoc, UserDoc } from "@/server/db/schema";
import { AppError } from "@/server/shared/errors";
import { hmacHex, newId, randomToken, safeEqual } from "@/server/shared/ids";
import { writeAudit } from "@/server/modules/audit/audit";
import { getMailer } from "@/server/modules/notifications/mailer";
import { STEP_UP_WINDOW_MS, type Actor } from "@/server/modules/authorization/actor";
import { enabledProviders, verifyFirebaseIdToken } from "./firebase";
import { dummyHash, hashPassword, verifyPassword } from "./password";
import { hashRefreshToken, newRefreshToken, signAccessToken, verifyAccessToken } from "./tokens";

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 5;
const OTP_TTL_MINUTES = 15;
const OTP_MAX_ATTEMPTS = 5;

export interface DeviceInfo {
  platform: string;
  name?: string;
  appId?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  sessionId: string;
}

export interface UserDto {
  id: string;
  email: string;
  name: string;
  phone?: string;
  role: UserDoc["role"];
  permissions: string[];
  vendorId?: string;
  emailVerified: boolean;
  createdAt: string;
}

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export function toUserDto(u: UserDoc): UserDto {
  return {
    id: u._id.toHexString(),
    email: u.email,
    name: u.name,
    phone: u.phone,
    role: u.role,
    permissions: u.permissions,
    vendorId: u.vendorId?.toHexString(),
    emailVerified: !!u.emailVerifiedAt,
    createdAt: u.createdAt.toISOString(),
  };
}

// ---------- sessions & tokens ----------

async function issueSession(user: UserDoc, device: DeviceInfo, familyId = randomToken(16)): Promise<TokenPair> {
  const c = await getCollections();
  const env = getEnv();
  const now = new Date();
  const refreshToken = newRefreshToken();
  await c.sessions.insertOne({
    _id: newId(),
    userId: user._id,
    familyId,
    tokenHash: hashRefreshToken(refreshToken),
    device,
    createdAt: now,
    expiresAt: new Date(now.getTime() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    lastUsedAt: now,
  });
  const { token, expiresIn } = await signAccessToken({ sub: user._id.toHexString(), sid: familyId, role: user.role });
  return { accessToken: token, refreshToken, expiresIn, sessionId: familyId };
}

async function revokeFamily(familyId: string, reason: NonNullable<SessionDoc["revokedReason"]>): Promise<void> {
  const c = await getCollections();
  await c.sessions.updateMany({ familyId, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date(), revokedReason: reason } });
}

export async function revokeAllSessionsForUser(userId: ObjectId, reason: NonNullable<SessionDoc["revokedReason"]>): Promise<void> {
  const c = await getCollections();
  await c.sessions.updateMany({ userId, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date(), revokedReason: reason } });
}

// ---------- one-time codes ----------

function codeHash(userId: ObjectId, purpose: OneTimeCodePurpose, code: string): string {
  return hmacHex(getEnv().REFRESH_TOKEN_PEPPER, `${userId.toHexString()}:${purpose}:${code}`);
}

async function createCode(userId: ObjectId, purpose: OneTimeCodePurpose): Promise<string> {
  const c = await getCollections();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const now = new Date();
  // Only the newest code is valid.
  await c.oneTimeCodes.deleteMany({ userId, purpose, consumedAt: { $exists: false } });
  await c.oneTimeCodes.insertOne({
    _id: newId(), userId, purpose, codeHash: codeHash(userId, purpose, code), attempts: 0,
    expiresAt: new Date(now.getTime() + OTP_TTL_MINUTES * 60_000), createdAt: now,
  });
  return code;
}

async function consumeCode(userId: ObjectId, purpose: OneTimeCodePurpose, code: string): Promise<boolean> {
  const c = await getCollections();
  const now = new Date();
  const doc = await c.oneTimeCodes.findOneAndUpdate(
    { userId, purpose, consumedAt: { $exists: false }, expiresAt: { $gt: now }, attempts: { $lt: OTP_MAX_ATTEMPTS } },
    { $inc: { attempts: 1 } },
    { sort: { createdAt: -1 }, returnDocument: "after" },
  );
  if (!doc || !safeEqual(doc.codeHash, codeHash(userId, purpose, code))) return false;
  const res = await c.oneTimeCodes.updateOne({ _id: doc._id, consumedAt: { $exists: false } }, { $set: { consumedAt: now } });
  return res.modifiedCount === 1;
}

async function sendCode(user: UserDoc, purpose: OneTimeCodePurpose): Promise<void> {
  const code = await createCode(user._id, purpose);
  // Sent best-effort outside any transaction; users can request a fresh code. Codes are never stored in plaintext/outbox.
  await getMailer()
    .send({ to: user.email, template: purpose === "verify_email" ? "verify_email" : "password_reset", code })
    .catch(() => undefined);
}

// ---------- public operations ----------

export async function registerUser(input: { email: string; password: string; name: string; phone?: string; device: DeviceInfo }) {
  const c = await getCollections();
  const now = new Date();
  const user: UserDoc = {
    _id: newId(),
    email: input.email.trim(),
    emailNormalized: normalizeEmail(input.email),
    passwordHash: await hashPassword(input.password),
    name: input.name.trim(),
    phone: input.phone,
    role: "customer",
    permissions: [],
    status: "active",
    failedLoginCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await c.users.insertOne(user);
  } catch (e) {
    if (e instanceof MongoServerError && e.code === 11000) throw new AppError("EMAIL_TAKEN");
    throw e;
  }
  await sendCode(user, "verify_email");
  const tokens = await issueSession(user, input.device);
  return { user: toUserDto(user), tokens };
}

/** Staff (seller and admin) sign-ins are security-relevant, so they are recorded; customer sign-ins are not (volume, little value). */
const isStaff = (role: string): boolean => role === "admin" || role === "vendor";

export async function login(input: { email: string; password: string; device: DeviceInfo }) {
  const c = await getCollections();
  const user = await c.users.findOne({ emailNormalized: normalizeEmail(input.email) });
  const now = new Date();
  if (!user) {
    await verifyPassword(await dummyHash(), input.password); // equalise timing
    throw new AppError("INVALID_CREDENTIALS");
  }
  if (user.lockedUntil && user.lockedUntil > now) {
    throw new AppError("RATE_LIMITED", {
      message: "Too many failed attempts. Try again later.",
      headers: { "Retry-After": String(Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000)) },
    });
  }
  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    await c.users.updateOne(
      { _id: user._id },
      failed >= MAX_FAILED_LOGINS
        ? { $set: { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000) } }
        : { $set: { failedLoginCount: failed } },
    );
    if (isStaff(user.role)) {
      await writeAudit({ actorId: user._id, actorRole: user.role, action: failed >= MAX_FAILED_LOGINS ? "auth.account_locked" : "auth.login_failed", resourceType: "user", resourceId: user._id.toHexString() });
    }
    throw new AppError("INVALID_CREDENTIALS");
  }
  if (user.status !== "active") throw new AppError("ACCOUNT_SUSPENDED");
  if (user.failedLoginCount > 0 || user.lockedUntil) {
    await c.users.updateOne({ _id: user._id }, { $set: { failedLoginCount: 0 }, $unset: { lockedUntil: "" } });
  }
  const tokens = await issueSession(user, input.device);
  if (isStaff(user.role)) {
    await writeAudit({ actorId: user._id, actorRole: user.role, action: "auth.login", resourceType: "user", resourceId: user._id.toHexString() });
  }
  return { user: toUserDto(user), tokens };
}

export async function refresh(refreshToken: string, device?: DeviceInfo): Promise<TokenPair> {
  const c = await getCollections();
  const now = new Date();
  const session = await c.sessions.findOne({ tokenHash: hashRefreshToken(refreshToken) });
  if (!session) throw new AppError("REFRESH_TOKEN_INVALID");

  if (session.rotatedAt || session.revokedAt) {
    // A token that was already rotated is being replayed: assume theft and kill the whole family.
    if (session.rotatedAt && !session.revokedAt) await revokeFamily(session.familyId, "reuse_detected");
    throw new AppError("REFRESH_TOKEN_INVALID");
  }
  if (session.expiresAt <= now) throw new AppError("REFRESH_TOKEN_INVALID");

  const user = await c.users.findOne({ _id: session.userId });
  if (!user || user.status !== "active") {
    await revokeFamily(session.familyId, "suspended");
    throw new AppError("REFRESH_TOKEN_INVALID");
  }

  const next = newRefreshToken();
  const claimed = await withTransaction(async (tx) => {
    const res = await c.sessions.updateOne(
      { _id: session._id, rotatedAt: { $exists: false }, revokedAt: { $exists: false } },
      { $set: { rotatedAt: now, lastUsedAt: now } },
      { session: tx },
    );
    if (res.modifiedCount !== 1) return false;
    await c.sessions.insertOne(
      {
        _id: newId(), userId: session.userId, familyId: session.familyId, tokenHash: hashRefreshToken(next),
        device: device ?? session.device, createdAt: now, expiresAt: session.expiresAt, lastUsedAt: now,
        ...(session.stepUpAt ? { stepUpAt: session.stepUpAt } : {}), // still bound by the 5-minute window
      },
      { session: tx },
    );
    return true;
  });
  if (!claimed) {
    // Lost a race with another use of the same token: treat as reuse.
    await revokeFamily(session.familyId, "reuse_detected");
    throw new AppError("REFRESH_TOKEN_INVALID");
  }
  const { token, expiresIn } = await signAccessToken({ sub: user._id.toHexString(), sid: session.familyId, role: user.role });
  return { accessToken: token, refreshToken: next, expiresIn, sessionId: session.familyId };
}

export async function logout(familyId: string): Promise<void> {
  await revokeFamily(familyId, "logout");
}

export async function logoutAll(userId: ObjectId): Promise<void> {
  await revokeAllSessionsForUser(userId, "logout_all");
}

/** Logout via an opaque refresh token (cookie/web flow without a valid access token). */
export async function logoutByRefreshToken(refreshToken: string): Promise<void> {
  const c = await getCollections();
  const s = await c.sessions.findOne({ tokenHash: hashRefreshToken(refreshToken) });
  if (s) {
    await revokeFamily(s.familyId, "logout");
    const u = await c.users.findOne({ _id: s.userId }, { projection: { role: 1 } });
    if (u && isStaff(u.role)) await writeAudit({ actorId: s.userId, actorRole: u.role, action: "auth.logout", resourceType: "user", resourceId: s.userId.toHexString() });
  }
}

export async function verifyContact(userId: ObjectId, code: string): Promise<UserDto> {
  const c = await getCollections();
  if (!(await consumeCode(userId, "verify_email", code))) {
    throw new AppError("VALIDATION_FAILED", { details: [{ field: "code", code: "INVALID_OR_EXPIRED" }] });
  }
  const user = await c.users.findOneAndUpdate({ _id: userId }, { $set: { emailVerifiedAt: new Date(), updatedAt: new Date() } }, { returnDocument: "after" });
  if (!user) throw new AppError("NOT_FOUND");
  return toUserDto(user);
}

export async function resendVerification(userId: ObjectId): Promise<void> {
  const c = await getCollections();
  const user = await c.users.findOne({ _id: userId });
  if (!user || user.emailVerifiedAt) return;
  await sendCode(user, "verify_email");
}

/** Always resolves the same way so callers can respond 202 without revealing whether the email exists. */
export async function forgotPassword(email: string): Promise<void> {
  const c = await getCollections();
  const user = await c.users.findOne({ emailNormalized: normalizeEmail(email) });
  if (user && user.status === "active") await sendCode(user, "password_reset");
}

export async function resetPassword(input: { email: string; code: string; newPassword: string }): Promise<void> {
  const c = await getCollections();
  const user = await c.users.findOne({ emailNormalized: normalizeEmail(input.email) });
  const invalid = new AppError("VALIDATION_FAILED", { details: [{ field: "code", code: "INVALID_OR_EXPIRED" }] });
  if (!user) throw invalid;
  if (!(await consumeCode(user._id, "password_reset", input.code))) throw invalid;
  await c.users.updateOne(
    { _id: user._id },
    { $set: { passwordHash: await hashPassword(input.newPassword), failedLoginCount: 0, updatedAt: new Date() }, $unset: { lockedUntil: "" } },
  );
  await revokeAllSessionsForUser(user._id, "password_reset");
  await writeAudit({ actorId: user._id, actorRole: user.role, action: "auth.password_reset", resourceType: "user", resourceId: user._id.toHexString() });
}

export async function getProfile(userId: ObjectId): Promise<UserDto> {
  const c = await getCollections();
  const user = await c.users.findOne({ _id: userId });
  if (!user) throw new AppError("NOT_FOUND");
  return toUserDto(user);
}

export async function updateProfile(userId: ObjectId, patch: { name?: string; phone?: string | null }): Promise<UserDto> {
  const c = await getCollections();
  const $set: Partial<UserDoc> = { updatedAt: new Date() };
  const $unset: Record<string, ""> = {};
  if (patch.name !== undefined) $set.name = patch.name.trim();
  if (patch.phone === null) $unset.phone = "";
  else if (patch.phone !== undefined) $set.phone = patch.phone;
  const user = await c.users.findOneAndUpdate({ _id: userId }, Object.keys($unset).length ? { $set, $unset } : { $set }, { returnDocument: "after" });
  if (!user) throw new AppError("NOT_FOUND");
  return toUserDto(user);
}

export async function changePassword(userId: ObjectId, current: string, next: string, keepSessionId: string): Promise<void> {
  const c = await getCollections();
  const user = await c.users.findOne({ _id: userId });
  if (!user || !(await verifyPassword(user.passwordHash, current))) throw new AppError("INVALID_CREDENTIALS");
  await c.users.updateOne({ _id: userId }, { $set: { passwordHash: await hashPassword(next), updatedAt: new Date() } });
  await c.sessions.updateMany(
    { userId, familyId: { $ne: keepSessionId }, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date(), revokedReason: "password_reset" } },
  );
}

export async function listSessions(userId: ObjectId, currentFamilyId: string) {
  const c = await getCollections();
  const rows = await c.sessions
    .find({ userId, revokedAt: { $exists: false }, rotatedAt: { $exists: false }, expiresAt: { $gt: new Date() } })
    .sort({ lastUsedAt: -1 })
    .limit(50)
    .toArray();
  return rows.map((s) => ({
    id: s.familyId,
    device: s.device,
    createdAt: s.createdAt.toISOString(),
    lastUsedAt: s.lastUsedAt.toISOString(),
    current: s.familyId === currentFamilyId,
  }));
}

export async function revokeSession(userId: ObjectId, familyId: string): Promise<void> {
  const c = await getCollections();
  const res = await c.sessions.updateMany(
    { userId, familyId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date(), revokedReason: "logout" } },
  );
  if (res.matchedCount === 0) throw new AppError("NOT_FOUND");
}

// ---------- request authentication ----------

/** Verify the access token, then re-check account + session state so suspension/logout take effect immediately. */
export async function authenticateAccessToken(token: string): Promise<Actor> {
  const claims = await verifyAccessToken(token);
  if (!ObjectId.isValid(claims.sub)) throw new AppError("UNAUTHENTICATED");
  const c = await getCollections();
  const userId = new ObjectId(claims.sub);
  const [user, live] = await Promise.all([
    c.users.findOne({ _id: userId }, { projection: { role: 1, permissions: 1, vendorId: 1, status: 1, emailVerifiedAt: 1 } }),
    c.sessions.findOne({ familyId: claims.sid, userId, revokedAt: { $exists: false } }, { projection: { _id: 1, stepUpAt: 1 }, sort: { createdAt: -1 } }),
  ]);
  if (!user || !live) throw new AppError("UNAUTHENTICATED");
  if (user.status !== "active") throw new AppError("ACCOUNT_SUSPENDED");
  return {
    userId,
    role: user.role,
    permissions: user.permissions,
    vendorId: user.vendorId,
    sessionId: claims.sid,
    emailVerified: !!user.emailVerifiedAt,
    stepUpAt: live.stepUpAt,
  };
}

/** Re-verify the password and mark this session as recently re-authenticated. */
export async function stepUp(userId: ObjectId, familyId: string, password: string): Promise<{ expiresInSeconds: number }> {
  const c = await getCollections();
  const user = await c.users.findOne({ _id: userId });
  if (!user || !(await verifyPassword(user.passwordHash, password))) throw new AppError("INVALID_CREDENTIALS");
  await c.sessions.updateMany({ userId, familyId, revokedAt: { $exists: false } }, { $set: { stepUpAt: new Date() } });
  await writeAudit({ actorId: userId, actorRole: user.role, action: "auth.step_up", resourceType: "session", resourceId: familyId });
  return { expiresInSeconds: STEP_UP_WINDOW_MS / 1000 };
}

// ---------- social sign-in (Firebase) ----------

/**
 * Sign in or sign up with Google / Apple / Facebook. The client gets a Firebase ID token; we verify it ourselves and then
 * issue our own session, so everything downstream (roles, step-up, revocation, audit) is unchanged.
 *
 * Account-takeover rules: an identity is linked to an existing account only when the provider vouches for the email
 * (email_verified). If that account's own email was never verified, it may have been pre-registered by someone else, so
 * its password is discarded and its sessions revoked on linking. Admin accounts never sign in this way.
 */
export async function socialLogin(input: { idToken: string; device: DeviceInfo }) {
  const identity = await verifyFirebaseIdToken(input.idToken);
  if (!enabledProviders().includes(identity.provider)) {
    throw new AppError("BUSINESS_RULE_VIOLATION", { message: "That sign-in method is not available." });
  }
  const c = await getCollections();
  const now = new Date();
  const staffOnly = (u: UserDoc) => {
    if (u.role === "admin") throw new AppError("FORBIDDEN", { message: "Administrator accounts must sign in with a password." });
    if (u.status !== "active") throw new AppError("ACCOUNT_SUSPENDED");
  };

  // 1) A returning social user: matched on the provider's stable subject, not on the (changeable) email.
  let user = await c.users.findOne({ identities: { $elemMatch: { provider: identity.provider, subject: identity.subject } } });
  if (user) staffOnly(user);

  if (!user) {
    if (!identity.email || !identity.emailVerified) {
      throw new AppError("BUSINESS_RULE_VIOLATION", { message: "Your account has no verified email address, so we can't create or link a BazarFlow account. Sign up with email instead." });
    }
    const emailNormalized = normalizeEmail(identity.email);
    const link = { provider: identity.provider, subject: identity.subject, email: identity.email, linkedAt: now };
    const existing = await c.users.findOne({ emailNormalized });
    if (existing) {
      // 2) Same verified email as an existing account: link it.
      staffOnly(existing);
      const unverifiedLocal = !existing.emailVerifiedAt;
      await c.users.updateOne(
        { _id: existing._id },
        {
          $push: { identities: link },
          $set: { updatedAt: now, emailVerifiedAt: existing.emailVerifiedAt ?? now, ...(unverifiedLocal ? { passwordHash: await hashPassword(randomToken(32)) } : {}) },
        },
      );
      if (unverifiedLocal) await revokeAllSessionsForUser(existing._id, "admin");
      await writeAudit({ actorId: existing._id, actorRole: existing.role, action: "auth.social_link", resourceType: "user", resourceId: existing._id.toHexString(), after: { provider: identity.provider, neutralisedUnverifiedPassword: unverifiedLocal } });
      user = (await c.users.findOne({ _id: existing._id }))!;
    } else {
      // 3) A new customer. The password is random and discarded: they can set one later via "forgot password".
      const doc: UserDoc = {
        _id: newId(), email: identity.email.trim(), emailNormalized, passwordHash: await hashPassword(randomToken(32)),
        name: (identity.name?.trim() || identity.email.split("@")[0]!).slice(0, 80), role: "customer", permissions: [], status: "active",
        emailVerifiedAt: now, identities: [link], failedLoginCount: 0, createdAt: now, updatedAt: now,
      };
      try {
        await c.users.insertOne(doc);
        user = doc;
      } catch (e) {
        if (e instanceof MongoServerError && e.code === 11000) throw new AppError("CONFLICT", { message: "Please try signing in again." });
        throw e;
      }
    }
  }

  const tokens = await issueSession(user, input.device);
  if (user.role === "vendor") {
    await writeAudit({ actorId: user._id, actorRole: user.role, action: "auth.login", resourceType: "user", resourceId: user._id.toHexString(), after: { via: identity.provider } });
  }
  return { user: toUserDto(user), tokens };
}
