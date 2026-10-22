import { z } from "zod";
import { ACCESS_COOKIE, REFRESH_COOKIE, accepted, clearCookie, noContent, ok, readCookie, route, setCookie, type Reply } from "@/server/api/route";
import { getEnv } from "@/server/config/env";
import { AppError } from "@/server/shared/errors";
import {
  changePassword, forgotPassword, getProfile, listSessions, login, logoutAll, logoutByRefreshToken, refresh,
  registerUser, resendVerification, stepUp, resetPassword, revokeSession, updateProfile, verifyContact, type TokenPair, type UserDto,
} from "@/server/modules/identity/service";

const email = z.email().max(254);
const password = z.string().min(10).max(128);
const phone = z.string().regex(/^\+?[0-9]{7,15}$/, "invalid phone");
const device = z
  .object({ platform: z.enum(["android", "ios", "web"]), name: z.string().max(80).optional(), appId: z.string().max(80).optional() })
  .default({ platform: "web" });
const transport = z.enum(["token", "cookie"]).default("token");

const registerBody = z.strictObject({ email, password, name: z.string().trim().min(1).max(80), phone: phone.optional(), device, transport });
const loginBody = z.strictObject({ email, password: z.string().min(1).max(128), device, transport });
const refreshBody = z.strictObject({ refreshToken: z.string().min(20).max(256).optional(), device: device.optional(), transport: transport.optional() });

function authCookies(tokens: TokenPair): string[] {
  const env = getEnv();
  return [
    setCookie(ACCESS_COOKIE, tokens.accessToken, { maxAgeSeconds: tokens.expiresIn }),
    // Refresh cookie is only ever sent to the auth endpoints.
    setCookie(REFRESH_COOKIE, tokens.refreshToken, { maxAgeSeconds: env.REFRESH_TOKEN_TTL_DAYS * 86_400, path: "/api/v1/auth" }),
  ];
}

function sessionReply(status: 200 | 201, user: UserDto, tokens: TokenPair, mode: "token" | "cookie"): Reply {
  if (mode === "cookie") return { status, data: { user, expiresIn: tokens.expiresIn }, cookies: authCookies(tokens) };
  return { status, data: { user, tokens: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresIn: tokens.expiresIn, tokenType: "Bearer" } } };
}

export const registerHandler = route(
  { name: "auth.register", auth: false, rateLimit: { rule: { name: "auth.register", limit: 10, windowSeconds: 3600 }, by: "ip" } },
  async (ctx) => {
    const b = await ctx.body(registerBody);
    const { user, tokens } = await registerUser({ email: b.email, password: b.password, name: b.name, phone: b.phone, device: b.device });
    return sessionReply(201, user, tokens, b.transport);
  },
);

export const loginHandler = route(
  { name: "auth.login", auth: false, rateLimit: { rule: { name: "auth.login", limit: 20, windowSeconds: 900 }, by: "ip" } },
  async (ctx) => {
    const b = await ctx.body(loginBody);
    const { user, tokens } = await login({ email: b.email, password: b.password, device: b.device });
    return sessionReply(200, user, tokens, b.transport);
  },
);

export const refreshHandler = route(
  { name: "auth.refresh", auth: false, rateLimit: { rule: { name: "auth.refresh", limit: 60, windowSeconds: 60 }, by: "ip" } },
  async (ctx) => {
    const b = (await ctx.body(refreshBody)) ?? {};
    const fromCookie = readCookie(ctx.req, REFRESH_COOKIE);
    const token = b.refreshToken ?? fromCookie;
    if (!token) throw new AppError("REFRESH_TOKEN_INVALID");
    const mode = b.refreshToken ? (b.transport ?? "token") : "cookie";
    if (mode === "cookie") {
      const origin = ctx.req.headers.get("origin");
      const configured = new URL(getEnv().APP_ORIGIN).origin;
      const host = ctx.req.headers.get("x-forwarded-host") ?? ctx.req.headers.get("host");
      const proto = ctx.req.headers.get("x-forwarded-proto") ?? "https";
      if (!origin || (origin !== configured && (!host || origin !== `${proto}://${host}`))) {
        throw new AppError("ORIGIN_NOT_ALLOWED");
      }
    }
    const tokens = await refresh(token, b.device);
    if (mode === "cookie") return { status: 200, data: { expiresIn: tokens.expiresIn }, cookies: authCookies(tokens) };
    return ok({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresIn: tokens.expiresIn, tokenType: "Bearer" });
  },
);

export const logoutHandler = route({ name: "auth.logout", auth: false }, async (ctx) => {
  const body = (await ctx.body(z.strictObject({ refreshToken: z.string().max(256).optional() }))) ?? {};
  const token = body.refreshToken ?? readCookie(ctx.req, REFRESH_COOKIE);
  if (token) await logoutByRefreshToken(token);
  return noContent({ cookies: [clearCookie(ACCESS_COOKIE), clearCookie(REFRESH_COOKIE, "/api/v1/auth")] });
});

export const logoutAllHandler = route({ name: "auth.logout_all" }, async (ctx) => {
  await logoutAll(ctx.actor.userId);
  return noContent({ cookies: [clearCookie(ACCESS_COOKIE), clearCookie(REFRESH_COOKIE, "/api/v1/auth")] });
});

export const verifyContactHandler = route(
  { name: "auth.verify_contact", rateLimit: { rule: { name: "auth.verify", limit: 10, windowSeconds: 900 }, by: "actor" } },
  async (ctx) => {
    const { code } = await ctx.body(z.strictObject({ code: z.string().regex(/^\d{6}$/) }));
    return ok(await verifyContact(ctx.actor.userId, code));
  },
);

export const resendVerificationHandler = route(
  { name: "auth.resend_verification", rateLimit: { rule: { name: "auth.resend", limit: 3, windowSeconds: 900 }, by: "actor" } },
  async (ctx) => {
    await resendVerification(ctx.actor.userId);
    return accepted();
  },
);

export const forgotPasswordHandler = route(
  { name: "auth.forgot", auth: false, rateLimit: { rule: { name: "auth.forgot", limit: 5, windowSeconds: 3600 }, by: "ip" } },
  async (ctx) => {
    const b = await ctx.body(z.strictObject({ email }));
    await forgotPassword(b.email);
    return accepted(); // identical response whether or not the account exists
  },
);

export const resetPasswordHandler = route(
  { name: "auth.reset", auth: false, rateLimit: { rule: { name: "auth.reset", limit: 10, windowSeconds: 900 }, by: "ip" } },
  async (ctx) => {
    const b = await ctx.body(z.strictObject({ email, code: z.string().regex(/^\d{6}$/), newPassword: password }));
    await resetPassword(b);
    return noContent();
  },
);

export const stepUpHandler = route(
  { name: "auth.step_up", rateLimit: { rule: { name: "auth.step_up", limit: 5, windowSeconds: 900 }, by: "actor" } },
  async (ctx) => {
    const b = await ctx.body(z.strictObject({ password: z.string().min(1).max(128) }));
    return ok(await stepUp(ctx.actor.userId, ctx.actor.sessionId, b.password));
  },
);

export const meGetHandler = route({ name: "me.get" }, async (ctx) => ok(await getProfile(ctx.actor.userId)));

export const mePatchHandler = route({ name: "me.patch" }, async (ctx) => {
  const b = await ctx.body(z.strictObject({ name: z.string().trim().min(1).max(80).optional(), phone: phone.nullable().optional() }));
  return ok(await updateProfile(ctx.actor.userId, b));
});

export const mePasswordHandler = route(
  { name: "me.password", rateLimit: { rule: { name: "me.password", limit: 5, windowSeconds: 900 }, by: "actor" } },
  async (ctx) => {
    const b = await ctx.body(z.strictObject({ currentPassword: z.string().min(1).max(128), newPassword: password }));
    await changePassword(ctx.actor.userId, b.currentPassword, b.newPassword, ctx.actor.sessionId);
    return noContent();
  },
);

export const sessionsListHandler = route({ name: "me.sessions" }, async (ctx) => ok(await listSessions(ctx.actor.userId, ctx.actor.sessionId)));

export const sessionDeleteHandler = route<{ sessionId: string }>({ name: "me.sessions.delete" }, async (ctx) => {
  await revokeSession(ctx.actor.userId, ctx.params.sessionId);
  return noContent();
});

