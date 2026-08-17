/**
 * Phase 4B staff async cutover. Default OFF — Next.js heavy paths remain live.
 * Independent of NEXT_PUBLIC_USE_DJANGO_READS.
 * Rollback: set NEXT_PUBLIC_USE_DJANGO_ASYNC=false and restart Next.js.
 */
import { parseUseDjangoReads } from "@/lib/staff-reads/flag";

export function useDjangoAsync(): boolean {
  return parseUseDjangoReads(process.env.NEXT_PUBLIC_USE_DJANGO_ASYNC);
}

export type AsyncJobKind =
  | "RESUME_PROCESSING"
  | "AI_SCREENING"
  | "INTERVIEW_PLAN"
  | "INTERVIEW_FINALIZE"
  | "TTS_PREFETCH"
  | "PROCTORING_PROCESS";

export type AsyncEnqueueResult = {
  status: string;
  task_id: string | null;
  kind: AsyncJobKind;
};

export function normalizeAsyncStatus(raw: string | undefined | null): string {
  const s = (raw ?? "idle").trim();
  if (!s || s.toLowerCase() === "idle") return "IDLE";
  return s.replace(/-/g, "_").toUpperCase();
}

export function isTerminalAsyncStatus(status: string): boolean {
  const s = normalizeAsyncStatus(status);
  return s === "COMPLETED" || s === "FAILED" || s === "CANCELLED";
}

export function isAcceptedEnqueue(status: string): boolean {
  const s = normalizeAsyncStatus(status);
  return s === "QUEUED" || s === "ALREADY_PROCESSING" || s === "PROCESSING";
}
