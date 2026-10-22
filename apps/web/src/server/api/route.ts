import { randomUUID } from "node:crypto";
import { ZodError, type ZodType } from "zod";
import { getEnv } from "@/server/config/env";
import { AppError, isAppError, type FieldIssue } from "@/server/shared/errors";
import { logger } from "@/server/shared/logger";
import type { Actor } from "@/server/modules/authorization/actor";
import { authenticateAccessToken } from "@/server/modules/identity/service";
import { enforceRateLimit, type RateLimitRule } from "@/server/modules/ratelimit/ratelimit";

export const ACCESS_COOKIE = "bf_at";
export const REFRESH_COOKIE = "bf_rt";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const DEFAULT_MAX_BODY = 64 * 1024;

export interface Reply {
  status: number;
  data?: unknown;
  meta?: Record<string, unknown>;
  headers?: Record<string, string>;
  cookies?: string[];
  /** Overrides the default private `no-store` policy. Only for reviewed public responses. */
  cache?: string;
  /** Non-JSON response (webhook acknowledgements that providers expect verbatim). */
  raw?: { body: string; contentType: string };
  /** Redirect target (303). */
  redirectTo?: string;
}

export const ok = (data: unknown, meta?: Record<string, unknown>, extra: Partial<Reply> = {}): Reply => ({ status: 200, data, meta, ...extra });
export const created = (data: unknown, extra: Partial<Reply> = {}): Reply => ({ status: 201, data, ...extra });
export const accepted = (data?: unknown): Reply => ({ status: 202, data });
export const noContent = (extra: Partial<Reply> = {}): Reply => ({ status: 204, ...extra });
export const page = (items: unknown[], p: { nextCursor: string | null }, extra: Partial<Reply> = {}): Reply => ({
  status: 200, data: items, meta: { nextCursor: p.nextCursor, hasMore: p.nextCursor !== null }, ...extra,
});

export interface Ctx<P> {
  req: Request;
  requestId: string;
  ip: string;
  params: P;
  /** Present when the route requires auth (default). Undefined on public routes and for anonymous callers of optional ones. */
  actor: Actor;
  /** True when the credential came from a cookie (web), false for bearer tokens (mobile). */
  cookieAuth: boolean;
  body<T>(schema: ZodType<T>): Promise<T>;
  /** Exact request bytes as text (signature checks need them). Size-limited. */
  rawBody(): Promise<string>;
  query<T>(schema: ZodType<T>): T;
  header(name: string): string | null;
}

export interface RouteOptions {
  name: string;
  /**
   * Default true. Public routes (login, catalog) pass false; actor is then undefined at runtime.
   * "optional": anonymous callers are fine, but credentials that ARE sent must be valid; `ctx.actor` may be undefined.
   */
  auth?: boolean | "optional";
  rateLimit?: { rule: RateLimitRule; by: "ip" | "actor" };
  maxBodyBytes?: number;
}

export function zodIssues(e: ZodError): FieldIssue[] {
  return e.issues.slice(0, 20).map((i) => ({ field: i.path.join(".") || "(root)", code: String(i.code).toUpperCase() }));
}

export function clientIp(req: Request): string {
  // Behind a trusted proxy/CDN the first hop is the client. Deployments must strip client-supplied values at the edge.
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown").slice(0, 64);
}

function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.get("cookie");
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0 && part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}
export { readCookie };

export function setCookie(name: string, value: string, opts: { maxAgeSeconds: number; path?: string }): string {
  const secure = getEnv().NODE_ENV === "production";
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path ?? "/"}`,
    `Max-Age=${opts.maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}
export const clearCookie = (name: string, path = "/"): string => setCookie(name, "", { maxAgeSeconds: 0, path });

function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (!origin) throw new AppError("ORIGIN_NOT_ALLOWED");
  const configured = new URL(getEnv().APP_ORIGIN).origin;
  if (origin === configured) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  if (host && origin === `${proto}://${host}`) return;
  throw new AppError("ORIGIN_NOT_ALLOWED");
}

async function authenticate(req: Request): Promise<{ actor: Actor; cookieAuth: boolean }> {
  const header = req.headers.get("authorization");
  if (header) {
    const m = /^Bearer\s+(\S+)$/i.exec(header);
    if (!m?.[1]) throw new AppError("UNAUTHENTICATED");
    return { actor: await authenticateAccessToken(m[1]), cookieAuth: false };
  }
  const cookie = readCookie(req, ACCESS_COOKIE);
  if (cookie) {
    if (!SAFE_METHODS.has(req.method)) assertSameOrigin(req); // CSRF defence for cookie-authenticated mutations
    return { actor: await authenticateAccessToken(cookie), cookieAuth: true };
  }
  throw new AppError("UNAUTHENTICATED");
}

async function readBody(req: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new AppError("PAYLOAD_TOO_LARGE");
  const reader = req.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AppError("PAYLOAD_TOO_LARGE");
    }
    chunks.push(value);
  }
  if (total === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError("MALFORMED_JSON");
  }
}

/** Raw body helper for webhooks (signature checks need the exact bytes). */
export async function readRawBody(req: Request, maxBytes: number): Promise<string> {
  const text = await req.text();
  if (Buffer.byteLength(text) > maxBytes) throw new AppError("PAYLOAD_TOO_LARGE");
  return text;
}

function errorResponse(e: unknown, requestId: string): Response {
  const err = isAppError(e) ? e : new AppError("INTERNAL", { cause: e });
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store", "x-request-id": requestId });
  for (const [k, v] of Object.entries(err.headers)) headers.set(k, v);
  return new Response(
    JSON.stringify({ error: { code: err.code, message: err.message, details: err.details, requestId } }),
    { status: err.status, headers },
  );
}

type NextCtx<P> = { params: Promise<P> };

/** Transport adapter: validate → authenticate → rate-limit → delegate to a use case → map outcome to the response envelope. */
export function route<P extends Record<string, string> = Record<string, string>>(
  opts: RouteOptions,
  handler: (ctx: Ctx<P>) => Promise<Reply>,
): ((req: Request, nextCtx: NextCtx<P>) => Promise<Response>) & { meta: RouteOptions } {
  const handle = async (req: Request, nextCtx: NextCtx<P>): Promise<Response> => {
    const started = Date.now();
    const requestId = req.headers.get("x-request-id")?.slice(0, 64) || randomUUID();
    const ip = clientIp(req);
    let actorId: string | undefined;
    try {
      let actor: Actor | undefined;
      let cookieAuth = false;
      const hasCredentials = req.headers.has("authorization") || !!readCookie(req, ACCESS_COOKIE);
      if (opts.auth === undefined || opts.auth === true || (opts.auth === "optional" && hasCredentials)) {
        ({ actor, cookieAuth } = await authenticate(req));
        actorId = actor.userId.toHexString();
      }
      if (opts.rateLimit) {
        const subject = opts.rateLimit.by === "actor" && actor ? actor.userId.toHexString() : ip;
        await enforceRateLimit(opts.rateLimit.rule, subject);
      }
      const url = new URL(req.url);
      const maxBody = opts.maxBodyBytes ?? DEFAULT_MAX_BODY;
      let bodyCache: Promise<unknown> | undefined;
      const ctx: Ctx<P> = {
        req, requestId, ip, cookieAuth,
        params: await nextCtx.params,
        actor: actor as Actor,
        header: (n) => req.headers.get(n),
        rawBody: () => readRawBody(req, maxBody),
        async body<T>(schema: ZodType<T>) {
          bodyCache ??= readBody(req, maxBody);
          const result = schema.safeParse(await bodyCache);
          if (!result.success) throw new AppError("VALIDATION_FAILED", { details: zodIssues(result.error) });
          return result.data;
        },
        query<T>(schema: ZodType<T>) {
          const result = schema.safeParse(Object.fromEntries(url.searchParams));
          if (!result.success) throw new AppError("VALIDATION_FAILED", { details: zodIssues(result.error) });
          return result.data;
        },
      };
      const reply = await handler(ctx);
      const headers = new Headers({ "x-request-id": requestId, "cache-control": reply.cache ?? "no-store", ...(reply.headers ?? {}) });
      for (const c of reply.cookies ?? []) headers.append("set-cookie", c);
      logger.info("request", { requestId, route: opts.name, method: req.method, status: reply.status, durationMs: Date.now() - started, actorId });
      if (reply.redirectTo) {
        headers.set("location", reply.redirectTo);
        return new Response(null, { status: 303, headers });
      }
      if (reply.raw) {
        headers.set("content-type", reply.raw.contentType);
        return new Response(reply.raw.body, { status: reply.status, headers });
      }
      if (reply.status === 204) return new Response(null, { status: 204, headers });
      headers.set("content-type", "application/json");
      const payload = reply.data === undefined ? {} : { data: reply.data };
      return new Response(JSON.stringify({ ...payload, meta: { requestId, ...(reply.meta ?? {}) } }), { status: reply.status, headers });
    } catch (e) {
      const status = isAppError(e) ? e.status : 500;
      if (status >= 500) logger.error("request failed", { requestId, route: opts.name, method: req.method, status, errorName: e instanceof Error ? e.name : "unknown", actorId });
      else logger.info("request rejected", { requestId, route: opts.name, method: req.method, status, code: isAppError(e) ? e.code : undefined, durationMs: Date.now() - started, actorId });
      return errorResponse(e, requestId);
    }
  };
  // Route metadata powers the generated API contract (see scripts/gen-openapi.ts).
  return Object.assign(handle, { meta: opts });
}
