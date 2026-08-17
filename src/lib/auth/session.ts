import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sessionCookieOptions } from "@/lib/auth/cookie-options";
import { requestIsHttps } from "@/lib/security-headers";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  organizationId: string | null;
};

const COOKIE_NAME = () => process.env.AUTH_COOKIE_NAME ?? "aros_session";

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set");
  }
  return new TextEncoder().encode(secret);
}

function ttlHours() {
  const n = Number(process.env.AUTH_TOKEN_TTL_HOURS ?? "12");
  return Number.isFinite(n) && n > 0 ? n : 12;
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({
    email: user.email,
    name: user.name,
    role: user.role,
    organizationId: user.organizationId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${ttlHours()}h`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (!payload.sub || typeof payload.email !== "string" || typeof payload.role !== "string") {
      return null;
    }
    return {
      id: payload.sub,
      email: payload.email,
      name: typeof payload.name === "string" ? payload.name : "",
      role: payload.role as Role,
      organizationId:
        typeof payload.organizationId === "string" ? payload.organizationId : null,
    };
  } catch {
    return null;
  }
}

/**
 * R-10: the Secure flag follows the actual transport, not just NODE_ENV, so
 * the LAN pilot over https://<LAN>:3443 no longer issues a non-Secure cookie
 * while running a development build.
 */
function cookieContext(expire = false) {
  let isHttps = false;
  try {
    const h = headers();
    isHttps = requestIsHttps({ forwardedProto: h.get("x-forwarded-proto") });
  } catch {
    // No request scope (unit tests, scripts) — fall back to NODE_ENV alone.
  }
  return {
    isProduction: process.env.NODE_ENV === "production",
    isHttps,
    ttlHours: ttlHours(),
    expire,
  };
}

export async function setSessionCookie(token: string): Promise<void> {
  cookies().set(COOKIE_NAME(), token, sessionCookieOptions(cookieContext()));
}

/**
 * Expire rather than plain-delete: a Secure/SameSite cookie must be cleared
 * with matching attributes or some browsers keep the original.
 */
export async function clearSessionCookie(): Promise<void> {
  cookies().set(COOKIE_NAME(), "", sessionCookieOptions(cookieContext(true)));
}

/**
 * True when the account behind a still-valid token is present and enabled.
 *
 * A signed JWT proves who minted it, not that the account is still allowed in.
 * Without this lookup a deactivated user keeps every staff API for the rest of
 * the token TTL, because nothing revokes an already-issued cookie. Django's
 * bridge already re-reads the same row (HIREOS_ENFORCE_PRISMA_USER_STATUS);
 * this keeps Next.js consistent with it.
 *
 * Database errors are intentionally NOT swallowed — a Postgres outage must
 * surface as 503 through handleApiError, not as a silent 401.
 */
async function isAccountEnabled(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true },
  });
  return user?.isActive === true;
}

export async function getSession(): Promise<SessionUser | null> {
  const token = cookies().get(COOKIE_NAME())?.value;
  if (!token) return null;

  const session = await verifySessionToken(token);
  if (!session) return null;

  if (!(await isAccountEnabled(session.id))) return null;

  return session;
}

export { COOKIE_NAME };
