import { mkdir, writeFile, readFile } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { resolveStoragePath, verifyStoredFile, ensureStorageDirs } from "@/lib/storage";

export const PRIMARY_RECORDING_KIND = "primary_camera_recording" as const;

export function newPrimaryRecordingId(): string {
  return `pcr_${randomBytes(12).toString("hex")}`;
}

export function primaryRecordingDir(sessionId: string, recordingId: string): string {
  return path
    .join("interviews", sessionId, "primary-camera", recordingId)
    .replace(/\\/g, "/");
}

export function primaryChunkRelPath(
  sessionId: string,
  recordingId: string,
  index: number,
): string {
  const name = `chunk-${String(index).padStart(6, "0")}.part`;
  return `${primaryRecordingDir(sessionId, recordingId)}/${name}`;
}

export function primaryFinalRelPath(sessionId: string, recordingId: string): string {
  return `${primaryRecordingDir(sessionId, recordingId)}/recording.webm`;
}

export function primaryMetaRelPath(sessionId: string, recordingId: string): string {
  return `${primaryRecordingDir(sessionId, recordingId)}/meta.json`;
}

type Meta = {
  kind: typeof PRIMARY_RECORDING_KIND;
  sessionId: string;
  recordingId: string;
  status: "RECORDING" | "SAVED" | "FAILED";
  mime: string;
  startedAt: string;
  endedAt?: string;
  chunkCount: number;
  byteLength?: number;
  path?: string;
  advisoryOnly: true;
  noAiInput: true;
};

async function writeMeta(rel: string, meta: Meta): Promise<void> {
  const abs = resolveStoragePath(rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, JSON.stringify(meta, null, 2), "utf8");
}

export async function startPrimaryRecording(params: {
  accessToken: string;
}): Promise<{ recordingId: string; sessionId: string }> {
  const session = await prisma.interviewSession.findUnique({
    where: { accessToken: params.accessToken },
    select: {
      id: true,
      status: true,
      applicationId: true,
      proctoringEnabled: true,
      proctoringCameraConsent: true,
    },
  });
  if (!session) throw new Error("NOT_FOUND");
  if (session.status !== "IN_PROGRESS") throw new Error("NOT_IN_PROGRESS");
  if (!session.proctoringEnabled || session.proctoringCameraConsent !== true) {
    throw new Error("NO_CAMERA_CONSENT");
  }

  await ensureStorageDirs();
  const recordingId = newPrimaryRecordingId();
  const meta: Meta = {
    kind: PRIMARY_RECORDING_KIND,
    sessionId: session.id,
    recordingId,
    status: "RECORDING",
    mime: "video/webm",
    startedAt: new Date().toISOString(),
    chunkCount: 0,
    advisoryOnly: true,
    noAiInput: true,
  };
  await writeMeta(primaryMetaRelPath(session.id, recordingId), meta);

  await prisma.timelineEvent.create({
    data: {
      applicationId: session.applicationId,
      type: "OTHER",
      payload: {
        kind: PRIMARY_RECORDING_KIND,
        status: "RECORDING",
        sessionId: session.id,
        recordingId,
        advisoryOnly: true,
        noAiInput: true,
        noAtsStageChange: true,
      },
    },
  });

  return { recordingId, sessionId: session.id };
}

export async function savePrimaryChunk(params: {
  accessToken: string;
  recordingId: string;
  chunkIndex: number;
  data: Buffer;
}): Promise<{ ok: true; byteLength: number }> {
  const session = await prisma.interviewSession.findUnique({
    where: { accessToken: params.accessToken },
    select: { id: true, status: true, proctoringCameraConsent: true },
  });
  if (!session) throw new Error("NOT_FOUND");
  if (session.proctoringCameraConsent !== true) throw new Error("NO_CAMERA_CONSENT");
  if (session.status !== "IN_PROGRESS" && session.status !== "COMPLETED") {
    throw new Error("BAD_STATUS");
  }
  if (params.chunkIndex < 0 || params.chunkIndex > 50_000) {
    throw new Error("BAD_INDEX");
  }
  if (params.data.byteLength <= 0) throw new Error("EMPTY_CHUNK");

  const rel = primaryChunkRelPath(session.id, params.recordingId, params.chunkIndex);
  const abs = resolveStoragePath(rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, params.data);
  return { ok: true, byteLength: params.data.byteLength };
}

export async function finalizePrimaryRecording(params: {
  accessToken: string;
  recordingId: string;
  mime?: string;
}): Promise<{
  ok: boolean;
  path: string | null;
  byteLength: number;
  status: "SAVED" | "FAILED";
}> {
  const session = await prisma.interviewSession.findUnique({
    where: { accessToken: params.accessToken },
    select: { id: true, applicationId: true, proctoringCameraConsent: true },
  });
  if (!session) throw new Error("NOT_FOUND");
  if (session.proctoringCameraConsent !== true) throw new Error("NO_CAMERA_CONSENT");

  const dirRel = primaryRecordingDir(session.id, params.recordingId);
  const dirAbs = resolveStoragePath(dirRel);
  const { readdir } = await import("fs/promises");
  let names: string[] = [];
  try {
    names = await readdir(dirAbs);
  } catch {
    names = [];
  }
  const chunks = names
    .filter((n) => /^chunk-\d+\.part$/.test(n))
    .sort();
  if (chunks.length === 0) {
    const failMeta: Meta = {
      kind: PRIMARY_RECORDING_KIND,
      sessionId: session.id,
      recordingId: params.recordingId,
      status: "FAILED",
      mime: params.mime ?? "video/webm",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      chunkCount: 0,
      advisoryOnly: true,
      noAiInput: true,
    };
    await writeMeta(primaryMetaRelPath(session.id, params.recordingId), failMeta);
    await prisma.timelineEvent.create({
      data: {
        applicationId: session.applicationId,
        type: "OTHER",
        payload: {
          kind: PRIMARY_RECORDING_KIND,
          status: "FAILED",
          sessionId: session.id,
          recordingId: params.recordingId,
          reason: "no_chunks",
          advisoryOnly: true,
          noAiInput: true,
          noAtsStageChange: true,
        },
      },
    });
    return { ok: false, path: null, byteLength: 0, status: "FAILED" };
  }

  const parts: Buffer[] = [];
  for (const name of chunks) {
    parts.push(await readFile(path.join(dirAbs, name)));
  }
  const blob = Buffer.concat(parts);
  const finalRel = primaryFinalRelPath(session.id, params.recordingId);
  const finalAbs = resolveStoragePath(finalRel);
  await writeFile(finalAbs, blob);
  const verified = await verifyStoredFile(finalRel);
  if (!verified.ok) {
    return { ok: false, path: null, byteLength: 0, status: "FAILED" };
  }

  const meta: Meta = {
    kind: PRIMARY_RECORDING_KIND,
    sessionId: session.id,
    recordingId: params.recordingId,
    status: "SAVED",
    mime: params.mime ?? "video/webm",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    chunkCount: chunks.length,
    byteLength: verified.byteLength,
    path: finalRel,
    advisoryOnly: true,
    noAiInput: true,
  };
  await writeMeta(primaryMetaRelPath(session.id, params.recordingId), meta);
  await prisma.timelineEvent.create({
    data: {
      applicationId: session.applicationId,
      type: "OTHER",
      payload: {
        kind: PRIMARY_RECORDING_KIND,
        status: "SAVED",
        sessionId: session.id,
        recordingId: params.recordingId,
        path: finalRel,
        byteLength: verified.byteLength,
        advisoryOnly: true,
        noAiInput: true,
        noAtsStageChange: true,
      },
    },
  });

  return {
    ok: true,
    path: finalRel,
    byteLength: verified.byteLength,
    status: "SAVED",
  };
}

export async function findLatestPrimaryRecordingPath(
  sessionId: string,
): Promise<string | null> {
  const { readdir } = await import("fs/promises");
  const rootRel = path.join("interviews", sessionId, "primary-camera").replace(/\\/g, "/");
  let abs: string;
  try {
    abs = resolveStoragePath(rootRel);
  } catch {
    return null;
  }
  let dirs: string[] = [];
  try {
    dirs = await readdir(abs);
  } catch {
    return null;
  }
  for (const id of dirs.reverse()) {
    const rel = primaryFinalRelPath(sessionId, id);
    const ok = await verifyStoredFile(rel);
    if (ok.ok) return rel;
  }
  return null;
}
