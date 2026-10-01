/**
 * Deployed build identity for `GET /api/version`.
 *
 * `scripts/write-build-info.mjs` (postbuild) writes `{ "commit" }` into the
 * standalone output and into `.next/`. This module only reads that file.
 * It does not read the environment, so a running process cannot be pointed at
 * a different SHA without rebuilding, and secrets in the environment cannot
 * leak through the endpoint.
 */

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const COMMIT_RE = /^[0-9a-f]{7,40}$/;
const MAX_BYTES = 1024;

/** Hex commit, or "unknown" for anything else (including empty and non-strings). */
export function sanitizeCommit(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const commit = value.trim().toLowerCase();
  if (COMMIT_RE.test(commit)) return commit;
  return "unknown";
}

export function publicVersionPayload(commit: unknown): {
  service: string;
  commit: string;
} {
  return {
    service: "Logisoft HireOS",
    commit: sanitizeCommit(commit),
  };
}

/**
 * Standalone `node server.js` uses the standalone directory as cwd
 * (`build-info.json` beside `server.js`, including the Docker runner).
 * `next start` uses the repo root and reads `.next/build-info.json`.
 */
const RELATIVE_PATHS = [
  "build-info.json",
  join(".next", "standalone", "build-info.json"),
  join(".next", "build-info.json"),
];

function readCommitFile(path: string): string | null {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_BYTES) return null;
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const commit = sanitizeCommit((parsed as { commit?: unknown }).commit);
    return commit === "unknown" ? null : commit;
  } catch {
    return null;
  }
}

/** First valid commit under `dir`, or "unknown". Extra JSON keys are ignored. */
export function readBuildCommitFrom(dir: string): string {
  for (const rel of RELATIVE_PATHS) {
    const commit = readCommitFile(join(dir, rel));
    if (commit) return commit;
  }
  return "unknown";
}

let cached: string | null = null;

export function loadBuildCommit(): string {
  if (cached !== null) return cached;
  cached = readBuildCommitFrom(process.cwd());
  return cached;
}
