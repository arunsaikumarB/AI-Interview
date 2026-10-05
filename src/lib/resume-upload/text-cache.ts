import { createHash } from "node:crypto";

/**
 * OCR text kept briefly between the review step and Save, so a scanned resume is
 * not OCR'd twice. Keyed by organization + file content hash; in memory only.
 */

const TTL_MS = 30 * 60_000;
const MAX_ENTRIES = 300;

type Entry = { text: string; at: number };
const g = globalThis as typeof globalThis & { __hireosOcrText?: Map<string, Entry> };
const cache: Map<string, Entry> = (g.__hireosOcrText ??= new Map());

function key(organizationId: string, buffer: Buffer): string {
  return `${organizationId}:${createHash("sha256").update(buffer).digest("hex")}`;
}

export function rememberOcrText(organizationId: string, buffer: Buffer, text: string, now = Date.now()): void {
  cache.delete(key(organizationId, buffer));
  cache.set(key(organizationId, buffer), { text, at: now });
  for (const [k, v] of Array.from(cache.entries())) {
    if (cache.size <= MAX_ENTRIES && now - v.at <= TTL_MS) break;
    cache.delete(k);
  }
}

export function recallOcrText(organizationId: string, buffer: Buffer, now = Date.now()): string | null {
  const entry = cache.get(key(organizationId, buffer));
  if (!entry || now - entry.at > TTL_MS) return null;
  return entry.text;
}
