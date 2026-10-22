import { randomBytes } from "node:crypto";

/**
 * Optional error reporting to Sentry (or any Sentry-compatible endpoint) with no SDK: set SENTRY_DSN and every logged error
 * is sent as one small event. Only the logger's allow-listed fields are ever included (route, status, error class, request id):
 * no request bodies, headers, emails or names. Unset = nothing is sent. Reporting never throws and never blocks a request.
 */
export interface Dsn { endpoint: string; key: string }

export function parseDsn(dsn: string | undefined): Dsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const project = u.pathname.replace(/^\/+/, "").split("/").pop();
    if (!u.username || !project || !/^https?:$/.test(u.protocol)) return null;
    return { endpoint: `${u.protocol}//${u.host}/api/${project}/envelope/`, key: u.username };
  } catch {
    return null;
  }
}

type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<unknown>;
let fetcher: Fetcher = (url, init) => fetch(url, init);
export const setErrorReporterFetch = (f: Fetcher | undefined) => { fetcher = f ?? ((url, init) => fetch(url, init)); };

const MAX_PER_MINUTE = 30;
let windowStart = 0;
let sent = 0;

export function reportError(msg: string, ctx: Record<string, unknown>, dsnString = process.env.SENTRY_DSN): void {
  const dsn = parseDsn(dsnString);
  if (!dsn) return;
  const now = Date.now();
  if (now - windowStart > 60_000) { windowStart = now; sent = 0; }
  if (++sent > MAX_PER_MINUTE) return; // a failing dependency must not turn into a flood of events
  const id = randomBytes(16).toString("hex");
  const tags = Object.fromEntries(Object.entries(ctx).filter(([k]) => ["route", "method", "status", "errorName", "module", "provider"].includes(k)).map(([k, v]) => [k, String(v)]));
  const event = { event_id: id, timestamp: now / 1000, platform: "node", level: "error", message: msg, environment: process.env.NODE_ENV ?? "production", tags, extra: ctx };
  const body = [JSON.stringify({ event_id: id, sent_at: new Date(now).toISOString() }), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 3000);
  void Promise.resolve()
    .then(() => fetcher(dsn.endpoint, { method: "POST", headers: { "content-type": "application/x-sentry-envelope", "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=bazarflow/1.0` }, body, signal: ctl.signal }))
    .catch(() => undefined)
    .finally(() => clearTimeout(timer));
}
