/**
 * One-time / idempotent setup for the V3.0 practical assessment sandbox.
 *
 *   node scripts/sandbox-setup.mjs
 *
 * 1. Generates sandbox secrets into sandbox-runner/.env (git-ignored) if missing.
 * 2. Adds SANDBOX_RUNNER_URL + SANDBOX_RUNNER_SECRET to the root .env if missing
 *    (Next.js only needs these two — it never receives SQL sandbox credentials).
 * 3. Builds the hireos-code-runner:v1 image.
 * 4. Starts the dedicated SQL sandbox container (hireos-sql-sandbox).
 *
 * Secret values are never printed.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER_DIR = path.join(ROOT, "sandbox-runner");
const RUNNER_ENV = path.join(RUNNER_DIR, ".env");
const ROOT_ENV = path.join(ROOT, ".env");

function parseEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq > 0) out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

function appendMissing(file, entries) {
  const existing = parseEnv(file);
  const missing = Object.entries(entries).filter(([k]) => !existing[k]);
  if (!missing.length) return [];
  const prefix = fs.existsSync(file) && !fs.readFileSync(file, "utf8").endsWith("\n") ? "\n" : "";
  fs.appendFileSync(file, prefix + missing.map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
  return missing.map(([k]) => k);
}

const token = (bytes) => crypto.randomBytes(bytes).toString("hex");

const runnerEnv = parseEnv(RUNNER_ENV);
const runnerSecret = runnerEnv.SANDBOX_RUNNER_SECRET || token(32);
const addedRunner = appendMissing(RUNNER_ENV, {
  SANDBOX_RUNNER_SECRET: runnerSecret,
  SANDBOX_RUNNER_PORT: "8010",
  SQL_SANDBOX_HOST: "127.0.0.1",
  SQL_SANDBOX_PORT: "55433",
  SQL_SANDBOX_ADMIN_USER: "sandbox_admin",
  SQL_SANDBOX_ADMIN_DB: "sandbox_admin",
  SQL_SANDBOX_ADMIN_PASSWORD: token(24),
  SQL_SANDBOX_ROLE_SECRET: token(32),
});
console.log(`[sandbox] sandbox-runner/.env: ${addedRunner.length ? `added ${addedRunner.join(", ")}` : "already configured"}`);

const rootSecret = parseEnv(ROOT_ENV).SANDBOX_RUNNER_SECRET;
if (rootSecret && rootSecret !== parseEnv(RUNNER_ENV).SANDBOX_RUNNER_SECRET) {
  console.error("[sandbox] SANDBOX_RUNNER_SECRET differs between .env and sandbox-runner/.env — fix manually.");
  process.exit(1);
}
const addedRoot = appendMissing(ROOT_ENV, {
  SANDBOX_RUNNER_URL: "http://127.0.0.1:8010",
  SANDBOX_RUNNER_SECRET: parseEnv(RUNNER_ENV).SANDBOX_RUNNER_SECRET,
});
console.log(`[sandbox] .env: ${addedRoot.length ? `added ${addedRoot.join(", ")}` : "already configured"}`);

function run(cmd, args) {
  execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
}

console.log("[sandbox] building hireos-code-runner:v1 …");
run("docker", ["build", "-q", "-t", "hireos-code-runner:v1", path.join("sandbox-runner", "image")]);

console.log("[sandbox] starting hireos-sql-sandbox …");
run("docker", [
  "compose",
  "-f",
  path.join("sandbox-runner", "docker-compose.sandbox.yml"),
  "--env-file",
  path.join("sandbox-runner", ".env"),
  "up",
  "-d",
  "--wait",
]);
console.log("[sandbox] ready. Start the runner with: npm run sandbox:runner");
