import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { Role } from "@prisma/client";

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

export async function setSessionCookie(token: string): Promise<void> {
  cookies().set(COOKIE_NAME(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ttlHours() * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  cookies().delete(COOKIE_NAME());
}

export async function getSession(): Promise<SessionUser | null> {
  const token = cookies().get(COOKIE_NAME())?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export { COOKIE_NAME };
