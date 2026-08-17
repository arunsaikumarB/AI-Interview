import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAIProvider, healthCheck } from "@/lib/ai/ollama";
import { speechHealth, speechServiceUrl } from "@/lib/speech";
import { getMailMode } from "@/lib/mail";
import { isDatabaseUnavailable } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import {
  canSeeHealthDetail,
  detailedHealthPayload,
  publicHealthPayload,
  type HealthSnapshot,
} from "@/lib/health-payload";

export const dynamic = "force-dynamic";

/**
 * R-2: this endpoint is reachable without a session (middleware allow-lists
 * it), so the default response is boolean-only. Admins get the full
 * diagnostics — same URL, so no second endpoint can be left exposed by
 * accident.
 */
export async function GET() {
  let dbOk = false;
  let dbError: string | undefined;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch (err) {
    dbError = isDatabaseUnavailable(err)
      ? "Database unavailable"
      : err instanceof Error
        ? err.message
        : "DB unreachable";
  }

  const snapshot: HealthSnapshot = {
    database: dbOk ? { ok: true } : { ok: false, error: dbError },
    provider: getAIProvider(),
    ollama: await healthCheck(),
    speech: await speechHealth(),
    speechUrl: speechServiceUrl(),
    storageRoot: process.env.STORAGE_ROOT ?? "./storage",
    mailMode: getMailMode(),
  };

  // A database outage is exactly when getSession() cannot resolve a role, so
  // this must never be allowed to turn a health check into an error.
  let role: string | null = null;
  try {
    role = (await getSession())?.role ?? null;
  } catch {
    role = null;
  }

  return NextResponse.json(
    canSeeHealthDetail(role)
      ? detailedHealthPayload(snapshot)
      : publicHealthPayload(snapshot),
  );
}
