import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request Content-Security-Policy with a nonce. Scripts run only if they carry the nonce (or are loaded by
 * one that does), so injected markup cannot execute. Cloudinary is allowed for images and signed uploads only.
 */
export function proxy(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== "production";
  // Firebase sign-in popups: only allowed when Firebase is configured, and only for Firebase's own hosts.
  const fbDomain = process.env.FIREBASE_AUTH_DOMAIN;
  const fbConnect = fbDomain ? " https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com" : "";
  const fbFrame = fbDomain ? `frame-src https://${fbDomain} https://accounts.google.com https://appleid.apple.com https://www.facebook.com` : "frame-src 'none'";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://res.cloudinary.com",
    "font-src 'self'",
    `connect-src 'self' https://api.cloudinary.com${fbConnect}`,
    fbFrame,
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
