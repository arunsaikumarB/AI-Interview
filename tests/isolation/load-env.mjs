/** Optional .env loader so `npm run test:isolation` works locally and in CI. */
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

function loadEnvFile(path, { override = false } = {}) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (override || process.env[key] === undefined) process.env[key] = val;
  }
}

function readAuthSecret(path) {
  if (!existsSync(path)) return null;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^AUTH_SECRET=(.*)$/);
    if (!m) continue;
    let val = m[1].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    return val;
  }
  return null;
}

const root = process.cwd();
const dotenvPath = resolve(root, ".env");
const dockerEnvPath = resolve(root, ".env.docker");

// Single source of truth for local/pilot: `.env`
loadEnvFile(dotenvPath);

const fromEnv = readAuthSecret(dotenvPath);
const fromDocker = readAuthSecret(dockerEnvPath);
if (fromDocker && fromEnv && fromDocker !== fromEnv) {
  console.warn(
    "[test:isolation] WARNING: .env.docker still defines AUTH_SECRET and it differs from .env. " +
      "Docker must use AUTH_SECRET from .env only — remove AUTH_SECRET from .env.docker and recreate the app container.",
  );
} else if (fromDocker && !fromEnv) {
  console.warn(
    "[test:isolation] WARNING: AUTH_SECRET is only in .env.docker. Move it to .env (single source of truth).",
  );
}

if (!process.env.AUTH_SECRET) {
  console.warn(
    "[test:isolation] AUTH_SECRET is not set. Isolation JWT minting will fail. Set it in .env.",
  );
}
