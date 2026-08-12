import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

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

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  const cookieName = process.env.AUTH_COOKIE_NAME ?? "aros_session";
  const token = request.cookies.get(cookieName)?.value;

  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  try {
    const { payload } = await jwtVerify(token, secretKey());
    const role = String(payload.role ?? "");
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-user-id", String(payload.sub ?? ""));
    requestHeaders.set("x-user-role", role);
    requestHeaders.set("x-user-email", String(payload.email ?? ""));

    // Candidate ↔ staff isolation
    if (
      (pathname.startsWith("/dashboard") || pathname.startsWith("/api/admin")) &&
      role === "CANDIDATE"
    ) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/portal", request.url));
    }

    if (pathname.startsWith("/portal") && role !== "CANDIDATE") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    // Legacy /candidate → /portal
    if (pathname.startsWith("/candidate")) {
      const dest = pathname.replace(/^\/candidate/, "/portal") || "/portal";
      return NextResponse.redirect(new URL(dest, request.url));
    }

    return NextResponse.next({
      request: { headers: requestHeaders },
    });
  } catch {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }
    const login = new URL("/login", request.url);
    return NextResponse.redirect(login);
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\..*).*)"],
};
