import { mkdir, writeFile, readFile, unlink, stat } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

/** Same convention Next.js uses: cwd + STORAGE_ROOT (repo `./storage` when Next runs from repo root). */
export function getStorageRoot(): string {
  const root = process.env.STORAGE_ROOT ?? "./storage";
  return path.resolve(path.isAbsolute(root) ? root : path.join(process.cwd(), root));
}

export function resolveStoragePath(relativePath: string): string {
  const root = getStorageRoot();
  const resolved = path.resolve(root, relativePath);
  const rel = path.relative(root, resolved);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Invalid storage path");
  }
  return resolved;
}

/** True only if the file exists, is a file, and has size > 0. */
export async function verifyStoredFile(
  relativePath: string | null | undefined,
): Promise<{ ok: true; byteLength: number } | { ok: false; byteLength: 0 }> {
  if (!relativePath || relativePath.includes("..")) {
    return { ok: false, byteLength: 0 };
  }
  try {
    const abs = resolveStoragePath(relativePath);
    const info = await stat(abs);
    if (!info.isFile() || info.size <= 0) {
      return { ok: false, byteLength: 0 };
    }
    return { ok: true, byteLength: info.size };
  } catch {
    return { ok: false, byteLength: 0 };
  }
}

export async function ensureStorageDirs(): Promise<void> {
  const root = getStorageRoot();
  await mkdir(path.join(root, "resumes"), { recursive: true });
  await mkdir(path.join(root, "assessments"), { recursive: true });
  await mkdir(path.join(root, "recordings"), { recursive: true });
  await mkdir(path.join(root, "interviews"), { recursive: true });
  await mkdir(path.join(root, "misc"), { recursive: true });
}

/** Relative path under STORAGE_ROOT for interview audio assets. */
export function interviewAudioRelPath(
  sessionId: string,
  fileName: string,
): string {
  return path.join("interviews", sessionId, fileName).replace(/\\/g, "/");
}

export async function saveInterviewAudio(params: {
  sessionId: string;
  fileName: string;
  data: Buffer;
}): Promise<{ relativePath: string; absolutePath: string }> {
  await ensureStorageDirs();
  const relativePath = interviewAudioRelPath(params.sessionId, params.fileName);
  const absolutePath = resolveStoragePath(relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, params.data);
  return { relativePath, absolutePath };
}

export type StoredFile = {
  relativePath: string;
  absolutePath: string;
  fileName: string;
  sizeBytes: number;
};

export async function saveUpload(params: {
  category: "resumes" | "assessments" | "recordings" | "misc";
  originalName: string;
  data: Buffer;
}): Promise<StoredFile> {
  await ensureStorageDirs();
  const safeBase = params.originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileName = `${Date.now()}-${randomUUID().slice(0, 8)}-${safeBase}`;
  const relativePath = path.join(params.category, fileName);
  const absolutePath = resolveStoragePath(relativePath);
  await writeFile(absolutePath, params.data);

  return {
    relativePath: relativePath.replace(/\\/g, "/"),
    absolutePath,
    fileName: params.originalName,
    sizeBytes: params.data.length,
  };
}

export async function readStoredFile(relativePath: string): Promise<Buffer> {
  return readFile(resolveStoragePath(relativePath));
}

export async function deleteStoredFile(relativePath: string): Promise<void> {
  await unlink(resolveStoragePath(relativePath));
}
