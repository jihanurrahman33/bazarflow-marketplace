import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request Content-Security-Policy with a nonce. Scripts run only if they carry the nonce (or are loaded by
 * one that does), so injected markup cannot execute. Cloudinary is allowed for images and signed uploads only.
 */
export function proxy(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== "production";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://res.cloudinary.com",
    "font-src 'self'",
    "connect-src 'self' https://api.cloudinary.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("content-security-policy", csp);
  return res;
}

export const config = {
  matcher: [{ source: "/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)", missing: [{ type: "header", key: "next-router-prefetch" }] }],
};
