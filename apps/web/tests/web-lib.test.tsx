import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { api, ApiError, messageFor, newIdempotencyKey, refreshSession } from "@/lib/api";
import { formatDate, formatMoney, humanize, parseMoneyInput } from "@/lib/format";
import { safeNext } from "@/lib/nav";
import { Alert, EmptyState, ErrorPanel, Money, StatusBadge, Stars } from "@/components/ui";
import { ProductCard } from "@/components/product-card";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

afterEach(() => vi.unstubAllGlobals());

describe("formatting", () => {
  it("formats minor units as BDT without floating-point surprises", () => {
    expect(formatMoney(250000)).toMatch(/2,500\.00/);
    expect(formatMoney(5)).toMatch(/0\.05/);
    expect(formatMoney(-12050)).toMatch(/120\.50/);
    expect(formatMoney(100, "XXX")).toBeTruthy(); // unknown currency never throws
  });
  it("parses money input strictly into integer minor units", () => {
    expect(parseMoneyInput("1200")).toBe(120000);
    expect(parseMoneyInput("1200.5")).toBe(120050);
    expect(parseMoneyInput(" 0.05 ")).toBe(5);
    for (const bad of ["", "abc", "12.345", "-5", "1e3", "1,200", "12.", "9999999999"]) expect(parseMoneyInput(bad), bad).toBeNull();
  });
  it("humanizes status codes and tolerates bad dates", () => {
    expect(humanize("pending_payment")).toBe("Pending payment");
    expect(humanize("vendor.approve")).toBe("Vendor approve");
    expect(formatDate("not a date")).toBe("—");
    expect(formatDate("2026-10-22T10:00:00Z")).toMatch(/2026/);
  });
  it("only allows same-site relative redirects after login", () => {
    expect(safeNext("/orders/123?x=1")).toBe("/orders/123?x=1");
    for (const evil of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", null, undefined, "/ok\nSet-Cookie: x"]) expect(safeNext(evil as string | null), String(evil)).toBe("/");
    expect(safeNext("evil", "/home")).toBe("/home");
  });
  it("generates unguessable idempotency keys that satisfy the server format", () => {
    vi.stubGlobal("crypto", { getRandomValues: (a: Uint8Array) => a.map((_, i) => (i * 37 + 11) % 256) });
    const k = newIdempotencyKey();
    expect(k).toMatch(/^[A-Za-z0-9_\-:.]{8,128}$/);
  });
});

describe("api client", () => {
  it("unwraps the success envelope and exposes paging meta", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { data: [{ id: "1" }], meta: { requestId: "r1", nextCursor: "abc", hasMore: true } })));
    const r = await api<{ id: string }[]>("/orders");
    expect(r.data[0]!.id).toBe("1");
    expect(r.meta).toMatchObject({ nextCursor: "abc", hasMore: true });
  });

  it("turns error envelopes into typed ApiErrors with field details and request id", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(400, { error: { code: "VALIDATION_FAILED", message: "bad", details: [{ field: "email", code: "INVALID_FORMAT" }], requestId: "req-9" } })));
    const e = await api("/auth/register", { method: "POST", body: {} }).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 400, code: "VALIDATION_FAILED", requestId: "req-9" });
    expect(e.fieldErrors()).toEqual({ email: "INVALID_FORMAT" });
    expect(e.retryable).toBe(false);
  });

  it("maps connection failures and timeouts to NETWORK / TIMEOUT (retryable)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const net = await api("/cart").catch((x) => x);
    expect(net).toMatchObject({ code: "NETWORK", retryable: true });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("t", "TimeoutError"); }));
    expect(await api("/cart").catch((x) => x)).toMatchObject({ code: "TIMEOUT", retryable: true });
  });

  it("handles 204 responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(204, null)));
    expect((await api("/me/sessions/x", { method: "DELETE" })).data).toBeUndefined();
  });

  it("sends the Idempotency-Key and a JSON body for mutations", async () => {
    const spy = vi.fn(async () => json(201, { data: { id: "o1" } }));
    vi.stubGlobal("fetch", spy);
    await api("/checkout", { method: "POST", idempotencyKey: "web-abcdef123456", body: { a: 1 } });
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/checkout");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("web-abcdef123456");
    expect(init.body).toBe('{"a":1}');
    expect(init.credentials).toBe("same-origin");
  });

  it("runs ONE refresh for many simultaneous expired-token responses, then retries each request once", async () => {
    let refreshCalls = 0;
    let authed = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/v1/auth/refresh") {
        refreshCalls++;
        await new Promise((r) => setTimeout(r, 20));
        authed = true;
        return json(200, { data: { expiresIn: 900 } });
      }
      return authed ? json(200, { data: { ok: url } }) : json(401, { error: { code: "TOKEN_EXPIRED", message: "x", requestId: "r" } });
    }));
    const results = await Promise.all([api("/orders"), api("/cart"), api("/me"), api("/addresses")]);
    expect(refreshCalls).toBe(1);
    expect(results.map((r) => (r.data as { ok: string }).ok)).toEqual(["/api/v1/orders", "/api/v1/cart", "/api/v1/me", "/api/v1/addresses"]);
  });

  it("surfaces 401 when refresh fails, and never loops", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      return url.endsWith("/auth/refresh") ? json(401, { error: { code: "REFRESH_TOKEN_INVALID", message: "x", requestId: "r" } }) : json(401, { error: { code: "UNAUTHENTICATED", message: "x", requestId: "r" } });
    }));
    const e = await api("/orders").catch((x) => x);
    expect(e).toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    expect(calls).toEqual(["/api/v1/orders", "/api/v1/auth/refresh"]); // original + one refresh, no retry
  });

  it("does not try to refresh for auth endpoints themselves (bad password is just a 401)", async () => {
    const spy = vi.fn(async () => json(401, { error: { code: "INVALID_CREDENTIALS", message: "no", requestId: "r" } }));
    vi.stubGlobal("fetch", spy);
    expect(await api("/auth/login", { method: "POST", body: {} }).catch((x) => x)).toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("refreshSession is a shared promise while in flight and resets afterwards", async () => {
    const spy = vi.fn(async () => json(200, { data: {} }));
    vi.stubGlobal("fetch", spy);
    const [a, b] = [refreshSession(), refreshSession()];
    expect(a).toBe(b);
    await a;
    await refreshSession();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("shows friendly copy for known codes and never leaks server detail for 5xx", () => {
    expect(messageFor(new ApiError(409, "PRICE_CHANGED", "internal words"))).toMatch(/Prices changed/);
    expect(messageFor(new ApiError(500, "INTERNAL", "stack trace here"))).not.toMatch(/stack/);
    expect(messageFor(new ApiError(0, "NETWORK", "x"))).toMatch(/offline/);
    expect(messageFor(new Error("boom"))).toBe("Something went wrong. Please try again.");
  });
});

describe("UI states (server-rendered markup)", () => {
  it("status badges carry text and an icon, never colour alone", () => {
    const html = renderToStaticMarkup(<StatusBadge status="pending_payment" />);
    expect(html).toContain("Pending payment");
    expect(html).toContain('aria-hidden="true"');
    expect(renderToStaticMarkup(<StatusBadge status="delivered" />)).toContain("badge-success");
    expect(renderToStaticMarkup(<StatusBadge status="totally_new_status" />)).toContain("Totally new status"); // unknown statuses degrade gracefully
  });
  it("alerts announce themselves to assistive tech", () => {
    expect(renderToStaticMarkup(<Alert tone="danger">Oops</Alert>)).toContain('role="alert"');
    expect(renderToStaticMarkup(<Alert tone="info">FYI</Alert>)).toContain('role="status"');
  });
  it("error panel offers retry only for retryable failures and shows a support reference", () => {
    const retryable = renderToStaticMarkup(<ErrorPanel error={new ApiError(503, "INTERNAL", "x", [], "req-77")} onRetry={() => undefined} />);
    expect(retryable).toContain("Try again");
    expect(retryable).toContain("req-77");
    const fatal = renderToStaticMarkup(<ErrorPanel error={new ApiError(403, "FORBIDDEN", "x")} onRetry={() => undefined} />);
    expect(fatal).not.toContain("Try again");
    expect(fatal).toContain('role="alert"');
  });
  it("empty state is distinct from an error", () => {
    const html = renderToStaticMarkup(<EmptyState title="No orders yet">Orders appear here.</EmptyState>);
    expect(html).toContain("No orders yet");
    expect(html).not.toContain('role="alert"');
  });
  it("money and ratings render accessibly", () => {
    expect(renderToStaticMarkup(<Money minor={150000} />)).toMatch(/1,500\.00/);
    expect(renderToStaticMarkup(<Stars value={4.4} />)).toContain('aria-label="4.4 out of 5 stars"');
    expect(renderToStaticMarkup(<Stars value={null} />)).toContain("No ratings yet");
  });
  it("product cards escape text, link to the slug and flag out-of-stock items", () => {
    const html = renderToStaticMarkup(<ProductCard p={{ id: "1", slug: "lamp-ab12", title: "<script>alert(1)</script> Lamp", image: "https://img/x.jpg", minPriceMinor: 25000, currency: "BDT", inStock: false, vendor: { slug: "s", name: "Shop" } }} />);
    expect(html).toContain('href="/products/lamp-ab12"');
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Out of stock");
    expect(html).toContain('alt=""');
  });
});

describe("step-up retry", () => {
  it("asks for the password once and retries the rejected request, never looping", async () => {
    const { setStepUpHandler } = await import("@/lib/api");
    let attempts = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      attempts++;
      return attempts === 1 ? json(403, { error: { code: "STEP_UP_REQUIRED", message: "x", requestId: "r" } }) : json(200, { data: { approved: true } });
    }));
    const handler = vi.fn(async () => true);
    setStepUpHandler(handler);
    expect((await api<{ approved: boolean }>("/admin/payouts/1/approve", { method: "POST", body: {} })).data.approved).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(attempts).toBe(2);

    // if the server still demands step-up after we complied, surface the error instead of prompting again
    attempts = 0;
    vi.stubGlobal("fetch", vi.fn(async () => json(403, { error: { code: "STEP_UP_REQUIRED", message: "x", requestId: "r" } })));
    expect(await api("/admin/payouts/1/approve", { method: "POST", body: {} }).catch((x) => x)).toMatchObject({ code: "STEP_UP_REQUIRED" });
    expect(handler).toHaveBeenCalledTimes(2);

    // user cancels the prompt: the original error is returned
    setStepUpHandler(async () => false);
    expect(await api("/x", { method: "POST", body: {} }).catch((x) => x)).toMatchObject({ code: "STEP_UP_REQUIRED" });
    setStepUpHandler(null);
  });
});
