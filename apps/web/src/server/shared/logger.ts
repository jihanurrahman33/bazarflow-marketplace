/* eslint-disable no-console -- the logger is the single sanctioned console sink */
import { reportError } from "./error-report";
type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Only these context keys are ever emitted — redaction is by allow-list, not regex cleanup. */
const ALLOWED = new Set([
  "requestId", "module", "route", "method", "status", "durationMs", "actorId", "code", "jobId", "eventId",
  "provider", "orderId", "paymentId", "attempt", "count", "action", "resourceType", "resourceId", "errorName",
]);

export type LogContext = Record<string, string | number | boolean | undefined>;

function minLevel(): Level {
  const l = process.env.LOG_LEVEL as Level | undefined;
  return l && l in order ? l : process.env.NODE_ENV === "test" ? "error" : "info";
}

function emit(level: Level, msg: string, ctx: LogContext = {}): void {
  if (order[level] < order[minLevel()]) return;
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) if (ALLOWED.has(k) && v !== undefined) safe[k] = v;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, env: process.env.NODE_ENV, msg, ...safe });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
  if (level === "error") reportError(msg, safe);
}

export const logger = {
  debug: (msg: string, ctx?: LogContext) => emit("debug", msg, ctx),
  info: (msg: string, ctx?: LogContext) => emit("info", msg, ctx),
  warn: (msg: string, ctx?: LogContext) => emit("warn", msg, ctx),
  error: (msg: string, ctx?: LogContext) => emit("error", msg, ctx),
};
