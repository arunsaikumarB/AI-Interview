import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAIProvider, healthCheck } from "@/lib/ai/ollama";
import { speechHealth, speechServiceUrl } from "@/lib/speech";
import { getMailMode } from "@/lib/mail";
import { isDatabaseUnavailable } from "@/lib/api";

export const dynamic = "force-dynamic";

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

  const provider = getAIProvider();
  const ollama = await healthCheck();
  const speech = await speechHealth();

  return NextResponse.json({
    ok: dbOk && ollama.ok,
    service: "AI Recruitment OS",
    selfHosted: provider === "local",
    aiProvider: provider,
    database: { ok: dbOk, error: dbError },
    ollama,
    speech: {
      ...speech,
      url: speechServiceUrl(),
    },
    storage: process.env.STORAGE_ROOT ?? "./storage",
    mail: {
      mode: getMailMode(),
      smtpConfigured: getMailMode() === "smtp",
    },
  });
}
