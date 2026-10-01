/**
 * postbuild: record the commit next to the standalone server and under `.next`.
 *
 *   .next/build-info.json              — `next start` (cwd = repository root)
 *   .next/standalone/build-info.json   — `node server.js` / Docker runner
 *
 * The running app reads this file. It does not trust environment variables
 * at request time.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveBuildCommit } from "./build-commit.mjs";

const commit = resolveBuildCommit(process.env);
const body = `${JSON.stringify({ commit })}\n`;

function write(target) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body);
}

const nextDir = join(process.cwd(), ".next");
write(join(nextDir, "build-info.json"));

const standalone = join(nextDir, "standalone");
if (existsSync(standalone)) {
  write(join(standalone, "build-info.json"));
}

console.log(`[build-info] commit=${commit}`);
