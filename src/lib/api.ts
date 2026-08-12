import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AuthError } from "@/lib/auth/rbac";

/** Prisma codes that mean the DB is unreachable / unavailable. */
const DB_UNAVAILABLE_CODES = new Set([
  "P1000", // Authentication failed against DB
  "P1001", // Can't reach database server
  "P1002", // Database server timed out
  "P1003", // Database does not exist
  "P1008", // Operations timed out
  "P1017", // Server has closed the connection
]);

export function isDatabaseUnavailable(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  if (err instanceof Prisma.PrismaClientRustPanicError) return true;
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (DB_UNAVAILABLE_CODES.has(err.code)) return true;
  }
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/Can't reach database server/i.test(msg)) return true;
  if (/Timed out fetching a new connection/i.test(msg)) return true;
  if (/\bP1001\b|\bP1002\b|\bP1017\b/.test(msg)) return true;
  if (/Server has closed the connection/i.test(msg)) return true;
  return false;
}

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, { status: 200, ...init });
}

export function jsonCreated<T>(data: T) {
  return NextResponse.json(data, { status: 201 });
}

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function handleApiError(err: unknown) {
  if (err instanceof AuthError) {
    return jsonError(err.message, err.status);
  }
  if (err instanceof ZodError) {
    return jsonError("Validation failed", 400, { issues: err.issues });
  }
  if (isDatabaseUnavailable(err)) {
    console.error("[api] Database unavailable:", err);
    return jsonError("Database unavailable", 503);
  }
  console.error(err);
  return jsonError(
    err instanceof Error ? err.message : "Internal server error",
    500,
  );
}

type RouteCtx = { params?: Record<string, string | string[]> };

/**
 * Wrap a route handler so uncaught errors (incl. Prisma P1001) become clean JSON.
 * Prefer try/catch + handleApiError inside handlers; use this for thin routes.
 */
export function withApiHandler<TCtx extends RouteCtx = RouteCtx>(
  handler: (request: Request, ctx: TCtx) => Promise<Response> | Response,
) {
  return async (request: Request, ctx: TCtx): Promise<Response> => {
    try {
      return await handler(request, ctx);
    } catch (err) {
      return handleApiError(err);
    }
  };
}
