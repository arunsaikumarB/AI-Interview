/**
 * Secondary camera recording — local disk only (no cloud).
 * Chunks under interviews/{sessionId}/secondary-camera/{recordingId}/
 * Never sent to AI prompts. Review artifact only.
 * Retention: see docs/RECORDINGS.md — do not keep files indefinitely.
 */

import { mkdir, writeFile, readFile, readdir, access } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";
import { ensureStorageDirs, resolveStoragePath } from "@/lib/storage";

export const CHUNK_TIMESLICE_MS = 8_000;
export const MAX_CHUNK_BYTES = 2_500_000;
export const MAX_CHUNKS_PER_MINUTE = 20;
export const MAX_PENDING_CLIENT_CHUNKS = 8;

export type SecondaryRecordingStatus =
  | "NONE"
  | "READY"
  | "RECORDING"
  | "INTERRUPTED"
  | "FINALIZING"
  | "SAVED"
  | "FAILED"
  | "DISCARDED";

export function newSecondaryRecordingId(): string {
  return `scr_${randomBytes(12).toString("hex")}`;
}

export function secondaryRecordingDir(
  sessionId: string,
  recordingId: string,
): string {
  return path
    .join("interviews", sessionId, "secondary-camera", recordingId)
    .replace(/\\/g, "/");
}

export function chunkRelPath(
  sessionId: string,
  recordingId: string,
  chunkIndex: number,
): string {
  const name = `chunk-${String(chunkIndex).padStart(6, "0")}.part`;
  return `${secondaryRecordingDir(sessionId, recordingId)}/${name}`;
}

export function finalRelPath(
  sessionId: string,
  recordingId: string,
  ext = "webm",
): string {
  return `${secondaryRecordingDir(sessionId, recordingId)}/recording.${ext}`;
}

export async function ensureRecordingDir(
  sessionId: string,
  recordingId: string,
): Promise<string> {
  await ensureStorageDirs();
  const rel = secondaryRecordingDir(sessionId, recordingId);
  const abs = resolveStoragePath(rel);
  await mkdir(abs, { recursive: true });
  return abs;
}

export async function saveRecordingChunk(params: {
  sessionId: string;
  recordingId: string;
  chunkIndex: number;
  data: Buffer;
}): Promise<{ relativePath: string; alreadyExisted: boolean }> {
  if (params.chunkIndex < 0 || params.chunkIndex > 100_000) {
    throw new Error("Invalid chunk index");
  }
  if (params.data.length > MAX_CHUNK_BYTES) {
    throw new Error("Chunk too large");
  }
  await ensureRecordingDir(params.sessionId, params.recordingId);
  const relativePath = chunkRelPath(
    params.sessionId,
    params.recordingId,
    params.chunkIndex,
  );
  const absolutePath = resolveStoragePath(relativePath);
  try {
    await access(absolutePath);
    return { relativePath, alreadyExisted: true };
  } catch {
    /* write new */
  }
  await writeFile(absolutePath, params.data);
  return { relativePath, alreadyExisted: false };
}

/**
 * Concatenate MediaRecorder timeslice parts in order into one WebM-ish file.
 * Same-session chunks from one MediaRecorder are typically concatenable.
 */
export async function finalizeRecordingFile(params: {
  sessionId: string;
  recordingId: string;
  lastChunkIndex: number;
  mime?: string | null;
}): Promise<{ relativePath: string; byteLength: number }> {
  const ext = params.mime?.includes("mp4") ? "mp4" : "webm";
  const relativePath = finalRelPath(
    params.sessionId,
    params.recordingId,
    ext,
  );
  const absFinal = resolveStoragePath(relativePath);
  const parts: Buffer[] = [];
  for (let i = 0; i <= params.lastChunkIndex; i++) {
    const rel = chunkRelPath(params.sessionId, params.recordingId, i);
    try {
      const buf = await readFile(resolveStoragePath(rel));
      parts.push(buf);
    } catch {
      // missing chunk = gap; skip (honest interruption already tracked)
    }
  }
  const combined = Buffer.concat(parts);
  if (combined.length === 0) {
    return { relativePath, byteLength: 0 };
  }
  await mkdir(path.dirname(absFinal), { recursive: true });
  await writeFile(absFinal, combined);
  return { relativePath, byteLength: combined.length };
}

export async function listChunkIndexes(
  sessionId: string,
  recordingId: string,
): Promise<number[]> {
  const dir = resolveStoragePath(secondaryRecordingDir(sessionId, recordingId));
  try {
    const files = await readdir(dir);
    return files
      .map((f) => {
        const m = /^chunk-(\d+)\.part$/.exec(f);
        return m ? Number(m[1]) : null;
      })
      .filter((n): n is number => n != null)
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/** In-memory upload rate windows per session. */
const chunkWindows = new Map<string, number[]>();

export function allowChunkUpload(sessionId: string): boolean {
  const now = Date.now();
  const recent = (chunkWindows.get(sessionId) ?? []).filter(
    (t) => now - t < 60_000,
  );
  if (recent.length >= MAX_CHUNKS_PER_MINUTE) {
    chunkWindows.set(sessionId, recent);
    return false;
  }
  recent.push(now);
  chunkWindows.set(sessionId, recent);
  return true;
}
