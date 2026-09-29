/**
 * Starts the sandbox runner with an explicit allow-listed environment:
 * OS basics needed by the Docker CLI + the sandbox-runner/.env keys only.
 * HireOS secrets (DATABASE_URL, AUTH_SECRET, …) are never passed through.
 *
 *   npm run sandbox:runner
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER_ENV = path.join(ROOT, "sandbox-runner", ".env");

if (!fs.existsSync(RUNNER_ENV)) {
  console.error("[sandbox] sandbox-runner/.env missing — run: npm run sandbox:setup");
  process.exit(1);
}

const ALLOWED_RUNNER_KEYS = new Set([
  "SANDBOX_RUNNER_SECRET",
  "SANDBOX_RUNNER_PORT",
  "SQL_SANDBOX_HOST",
  "SQL_SANDBOX_PORT",
  "SQL_SANDBOX_ADMIN_USER",
  "SQL_SANDBOX_ADMIN_DB",
  "SQL_SANDBOX_ADMIN_PASSWORD",
  "SQL_SANDBOX_ROLE_SECRET",
]);
const OS_KEYS = [
  "PATH",
  "Path",
  "SYSTEMROOT",
  "SystemRoot",
  "WINDIR",
  "USERPROFILE",
  "HOME",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "HOMEDRIVE",
  "HOMEPATH",
  "PROGRAMDATA",
  "ProgramData",
  "ProgramFiles",
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
];

const env = { PYTHONUNBUFFERED: "1", PYTHONDONTWRITEBYTECODE: "1" };
for (const key of OS_KEYS) if (process.env[key]) env[key] = process.env[key];
for (const raw of fs.readFileSync(RUNNER_ENV, "utf8").split(/\r?\n/)) {
  const line = raw.trim();
  const eq = line.indexOf("=");
  if (!line || line.startsWith("#") || eq <= 0) continue;
  const key = line.slice(0, eq).trim();
  if (ALLOWED_RUNNER_KEYS.has(key)) env[key] = line.slice(eq + 1).trim();
}

const python =
  process.platform === "win32"
    ? path.join(ROOT, "backend", ".venv", "Scripts", "python.exe")
    : path.join(ROOT, "backend", ".venv", "bin", "python");

const child = spawn(python, [path.join(ROOT, "sandbox-runner", "runner.py")], {
  cwd: path.join(ROOT, "sandbox-runner"),
  env,
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 1));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
