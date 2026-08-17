import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import {
  buildSecurityHeaders,
  createNonce,
  requestIsHttps,
} from "@/lib/security-headers";

const PUBLIC_PATHS = [
  "/",
  "/login",
  "/register",
  "/api/auth/login",
  "/api/auth/register",
  "/api/health",
];

function isPublic(pathname: string) {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (pathname.startsWith("/_next")) return true;
  if (pathname.startsWith("/favicon")) return true;
  // Public careers site (no auth)
  if (pathname.startsWith("/careers")) return true;
  if (pathname.startsWith("/api/careers")) return true;
  // Candidate magic-link interview room (token auth, no session cookie)
  if (pathname.startsWith("/interview/")) return true;
  if (pathname.startsWith("/api/interview/")) return true;
  return false;
}

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set");
  }
  return new TextEncoder().encode(secret);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /**
   * R-1 — security headers. Built per request because the CSP carries a
   * one-time nonce and HSTS is only valid once the request is already HTTPS
   * (the LAN pilot proxy on :3443 sets x-forwarded-proto).
   */
  const nonce = createNonce();
  const security = buildSecurityHeaders({
    isProduction: process.env.NODE_ENV === "production",
    isHttps: requestIsHttps({
      forwardedProto: request.headers.get("x-forwarded-proto"),
      url: request.url,
    }),
    nonce,
  });

  /** Every exit path from this middleware must carry the headers. */
  function harden<T extends NextResponse>(response: T): T {
    for (const [key, value] of Object.entries(security)) {
      response.headers.set(key, value);
    }
    return response;
  }

  /**
   * Next reads the nonce out of the *request* CSP header and stamps it onto
   * its own inline bootstrap scripts, which is what lets production drop
   * 'unsafe-inline' from script-src.
   */
  function withNonce(base: Headers): Headers {
    const headers = new Headers(base);
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", security["Content-Security-Policy"]);
    return headers;
  }

  if (isPublic(pathname)) {
    return harden(
      NextResponse.next({ request: { headers: withNonce(request.headers) } }),
    );
  }

  const cookieName = process.env.AUTH_COOKIE_NAME ?? "aros_session";
  const token = request.cookies.get(cookieName)?.value;

  if (!token) {
    if (pathname.startsWith("/api/")) {
      return harden(
        NextResponse.json({ error: "Authentication required" }, { status: 401 }),
      );
    }
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return harden(NextResponse.redirect(login));
  }

  try {
    const { payload } = await jwtVerify(token, secretKey());
    const role = String(payload.role ?? "");
    const requestHeaders = withNonce(request.headers);
    requestHeaders.set("x-user-id", String(payload.sub ?? ""));
    requestHeaders.set("x-user-role", role);
    requestHeaders.set("x-user-email", String(payload.email ?? ""));

    // Candidate ↔ staff isolation
    if (
      (pathname.startsWith("/dashboard") || pathname.startsWith("/api/admin")) &&
      role === "CANDIDATE"
    ) {
      if (pathname.startsWith("/api/")) {
        return harden(
          NextResponse.json({ error: "Insufficient permissions" }, { status: 403 }),
        );
      }
      return harden(NextResponse.redirect(new URL("/portal", request.url)));
    }

    if (pathname.startsWith("/portal") && role !== "CANDIDATE") {
      return harden(NextResponse.redirect(new URL("/dashboard", request.url)));
    }

    // Legacy /candidate → /portal
    if (pathname.startsWith("/candidate")) {
      const dest = pathname.replace(/^\/candidate/, "/portal") || "/portal";
      return harden(NextResponse.redirect(new URL(dest, request.url)));
    }

    return harden(
      NextResponse.next({
        request: { headers: requestHeaders },
      }),
    );
  } catch {
    if (pathname.startsWith("/api/")) {
      return harden(NextResponse.json({ error: "Invalid session" }, { status: 401 }));
    }
    const login = new URL("/login", request.url);
    return harden(NextResponse.redirect(login));
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\..*).*)"],
};
