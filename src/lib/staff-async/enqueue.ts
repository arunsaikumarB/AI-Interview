import { djangoGetJson, djangoPostJson } from "@/lib/staff-reads/django-client";
import {
  isAcceptedEnqueue,
  normalizeAsyncStatus,
  type AsyncEnqueueResult,
  type AsyncJobKind,
} from "./flag";

export async function enqueueDjangoJob(
  path: string,
  body: Record<string, unknown>,
  kind: AsyncJobKind,
  request: Request,
): Promise<AsyncEnqueueResult> {
  const raw = await djangoPostJson<{
    status?: string;
    task_id?: string;
    kind?: string;
  }>(path, body, { request });
  const status = raw.status ?? "";
  if (!isAcceptedEnqueue(status)) {
    throw new Error(`Unexpected enqueue status: ${status || "empty"}`);
  }
  return {
    status: normalizeAsyncStatus(status) === "ALREADY_PROCESSING"
      ? "already_processing"
      : "queued",
    task_id: raw.task_id ?? null,
    kind,
  };
}

export async function djangoAsyncStatus(
  path: string,
  request: Request,
  query: Record<string, string | undefined>,
) {
  return djangoGetJson<Record<string, unknown>>(path, { request, query });
}
