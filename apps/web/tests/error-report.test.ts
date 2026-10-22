import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDsn, reportError, setErrorReporterFetch } from "@/server/shared/error-report";

afterEach(() => setErrorReporterFetch(undefined));
const DSN = "https://abc123publickey@o42.ingest.example.io/7";
const flush = () => new Promise((r) => setTimeout(r, 10));

describe("error reporting", () => {
  it("understands a DSN and rejects junk", () => {
    expect(parseDsn(DSN)).toEqual({ endpoint: "https://o42.ingest.example.io/api/7/envelope/", key: "abc123publickey" });
    expect(parseDsn(undefined)).toBeNull();
    expect(parseDsn("not a url")).toBeNull();
    expect(parseDsn("https://o42.ingest.example.io/7")).toBeNull(); // no key
  });

  it("sends one envelope with only the safe fields, and nothing when no DSN is set", async () => {
    const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
    setErrorReporterFetch(async (url, init) => { calls.push({ url, body: init.body, headers: init.headers }); });
    reportError("nothing configured", { route: "x" }, undefined);
    await flush();
    expect(calls).toHaveLength(0);

    reportError("request failed", { route: "orders.create", status: 500, errorName: "TypeError", requestId: "r-1" }, DSN);
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://o42.ingest.example.io/api/7/envelope/");
    expect(calls[0]!.headers["x-sentry-auth"]).toContain("sentry_key=abc123publickey");
    const [header, item, event] = calls[0]!.body.split("\n").map((l) => JSON.parse(l));
    expect(header.event_id).toBe(event.event_id);
    expect(item).toEqual({ type: "event" });
    expect(event).toMatchObject({ level: "error", message: "request failed", tags: { route: "orders.create", status: "500", errorName: "TypeError" } });
  });

  it("never throws when the reporting service is down, and does not flood", async () => {
    const fetcher = vi.fn(async () => { throw new Error("network down"); });
    setErrorReporterFetch(fetcher);
    for (let i = 0; i < 80; i++) reportError("boom", { route: "r" }, DSN);
    await flush();
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(30);
  });
});
