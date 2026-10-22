import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setupTestDb, teardownTestDb } from "./helpers/db";
import { call } from "./helpers/http";
import { makeAdmin, makeCustomer, makeVendor } from "./helpers/factory";
import { buildContract } from "../scripts/gen-openapi";

/**
 * Cross-cutting guarantees checked against EVERY route in the app (docs/04 §9):
 * unauthenticated access, wrong role, missing permission, CSRF origin, and contract drift.
 */
const routesDir = path.resolve(import.meta.dirname, "../src/app/api");
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const isProtected = (e: { meta: { auth?: boolean | "optional" } }) => e.meta.auth !== false && e.meta.auth !== "optional";

interface Entry { path: string; method: string; handler: Handler; meta: { name: string; auth?: boolean | "optional" }; permission?: string; roles?: string[] }

// api/internal holds scheduler hooks (covered by worker-tick.test.ts), not part of the public contract.
const INTERNAL = path.join(routesDir, "internal");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (p === INTERNAL) return [];
    return statSync(p).isDirectory() ? walk(p) : f === "route.ts" ? [p] : [];
  });
}

const entries: Entry[] = [];
let admin0: Awaited<ReturnType<typeof makeAdmin>>;
let customer: Awaited<ReturnType<typeof makeCustomer>>;
let vendor: Awaited<ReturnType<typeof makeVendor>>;
let contract: Awaited<ReturnType<typeof buildContract>>;

beforeAll(async () => {
  await setupTestDb();
  contract = await buildContract();
  for (const file of walk(routesDir).sort()) {
    const mod = (await import(pathToFileURL(file).href)) as Record<string, Handler & { meta: Entry["meta"] }>;
    const rel = path.relative(routesDir, path.dirname(file)).split(path.sep).join("/");
    const apiPath = "/api/" + rel.replace(/\[([^\]]+)\]/g, "{$1}");
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      const handler = mod[method];
      if (!handler) continue;
      const op = (contract.paths[apiPath] as Record<string, Record<string, unknown>>)[method.toLowerCase()]!;
      entries.push({
        path: apiPath, method, handler, meta: handler.meta,
        permission: op["x-required-permission"] as string | undefined, roles: op["x-required-role"] as string[] | undefined,
      });
    }
  }
  admin0 = await makeAdmin([]); // an admin with no capabilities at all
  customer = await makeCustomer();
  vendor = await makeVendor();
});
afterAll(teardownTestDb);

const fakeParams = (p: string) => Object.fromEntries([...p.matchAll(/\{([^}]+)\}/g)].map((m) => [m[1]!, "0".repeat(24)]));
let ipn = 0;
const hit = (e: Entry, headers: Record<string, string> = {}, token?: string) =>
  call(e.handler, {
    method: e.method, token, params: fakeParams(e.path), headers: { "x-forwarded-for": `198.51.100.${(++ipn % 250) + 1}`, ...headers },
    ...(e.method === "GET" || e.method === "DELETE" ? {} : { body: {} }),
  });

describe("API contract", () => {
  it("is in sync with the route handlers (regenerate with: npx tsx scripts/gen-openapi.ts)", () => {
    const onDisk = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../packages/contracts/openapi.json"), "utf8"));
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(contract)));
  });

  it("covers every route with metadata and keeps every path under /api", () => {
    expect(entries.length).toBeGreaterThan(100);
    for (const e of entries) {
      expect(e.meta.name, e.path).toBeTruthy();
      expect(e.path.startsWith("/api/")).toBe(true);
    }
    const names = entries.map((e) => e.meta.name);
    expect(new Set(names).size).toBe(names.length); // operation ids are unique
  });
});

describe("every protected endpoint", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const protectedEntries = entries.filter(isProtected);
    expect(protectedEntries.length).toBeGreaterThan(80);
    for (const e of protectedEntries) {
      const r = await hit(e);
      expect(r.status, `${e.method} ${e.path}`).toBe(401);
      expect(r.error?.code).toBe("UNAUTHENTICATED");
    }
  });

  it("rejects a garbage bearer token", async () => {
    for (const e of entries.filter((x) => x.meta.auth !== false)) { // optional-auth routes must also reject bad credentials
      expect((await hit(e, {}, "not.a.token")).status, `${e.method} ${e.path}`).toBe(401);
    }
  });

  it("refuses state-changing cookie-authenticated requests that do not come from our origin (CSRF)", async () => {
    for (const e of entries.filter((x) => isProtected(x) && x.method !== "GET")) {
      const r = await hit(e, { cookie: "bf_at=whatever", origin: "https://evil.example" });
      expect(r.status, `${e.method} ${e.path}`).toBe(403);
      expect(r.error?.code).toBe("ORIGIN_NOT_ALLOWED");
    }
  });

  it("denies an admin that lacks the endpoint's permission", async () => {
    const guarded = entries.filter((e) => e.permission);
    expect(guarded.length).toBeGreaterThan(30);
    for (const e of guarded) {
      const r = await hit(e, {}, admin0.token);
      expect(r.status, `${e.method} ${e.path} needs ${e.permission}`).toBe(403);
    }
  });

  it("denies customers and vendors on permission-guarded (admin) endpoints", async () => {
    for (const e of entries.filter((x) => x.permission)) {
      for (const t of [customer.token, vendor.user.token]) expect((await hit(e, {}, t)).status, `${e.method} ${e.path}`).toBe(403);
    }
  });

  it("denies the wrong role on role-guarded endpoints", async () => {
    const tokens: Record<string, string> = { customer: customer.token, vendor: vendor.user.token, admin: admin0.token };
    const offenders: string[] = [];
    for (const e of entries.filter((x) => x.roles && !x.permission)) {
      for (const [role, token] of Object.entries(tokens)) {
        if (e.roles!.includes(role)) continue;
        const r = await hit(e, {}, token);
        if (r.status !== 403) offenders.push(`${e.method} ${e.path} as ${role} -> ${r.status}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("public endpoints", () => {
  it("never require credentials and always answer with the error envelope on failure", async () => {
    const open = entries.filter((e) => !isProtected(e));
    expect(open.length).toBeGreaterThan(10);
    for (const e of open) {
      const r = await hit(e);
      // A public route may still answer 401 for its own reasons (bad refresh token), but never "you are not signed in".
      expect(r.error?.code, `${e.method} ${e.path}`).not.toBe("UNAUTHENTICATED");
      expect(r.headers.get("x-request-id")).toBeTruthy();
      if (r.status >= 400) expect(r.error?.code, `${e.method} ${e.path}`).toBeTruthy();
    }
  });

  it("sends private no-store on everything that is not an explicit public cache", async () => {
    for (const e of entries.filter(isProtected)) {
      const r = await hit(e);
      expect(r.headers.get("cache-control"), `${e.method} ${e.path}`).toBe("no-store");
    }
  });
});
