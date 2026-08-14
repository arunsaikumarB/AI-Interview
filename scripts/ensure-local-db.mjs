/**
 * Ensure local Postgres (and optionally Ollama) is reachable before `npm run dev`.
 *
 * Root cause this fixes: Docker Desktop stopped → host DATABASE_URL
 * (localhost:55432) fails → every page shows "Database unavailable".
 *
 * Usage:
 *   node scripts/ensure-local-db.mjs
 *   npm run db:ensure   (same)
 *   npm run dev         (runs this via predev)
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const DEFAULT_URL =
  "postgresql://ats:ats_local_dev@localhost:55432/ai_recruitment_os?schema=public";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function parseDbTarget(databaseUrl) {
  try {
    const u = new URL(databaseUrl);
    return {
      host: u.hostname || "localhost",
      port: Number(u.port || 5432),
      url: databaseUrl,
    };
  } catch {
    return { host: "localhost", port: 55432, url: DEFAULT_URL };
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function canTcp(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port }, () => {
      socket.end();
      resolve(true);
    });
    const fail = () => {
      socket.destroy();
      resolve(false);
    };
    socket.on("error", fail);
    socket.setTimeout(timeoutMs, fail);
  });
}

function dockerAvailable() {
  try {
    execFileSync("docker", ["info"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

function findDockerDesktopExe() {
  const candidates = [
    path.join(
      process.env["ProgramFiles"] || "C:\\Program Files",
      "Docker",
      "Docker",
      "Docker Desktop.exe",
    ),
    path.join(
      process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
      "Docker",
      "Docker",
      "Docker Desktop.exe",
    ),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

async function ensureDockerDesktopRunning() {
  if (dockerAvailable()) return true;

  if (process.platform !== "win32") {
    console.error(
      "[db:ensure] Docker is not running. Start Docker, then re-run npm run dev.",
    );
    return false;
  }

  const exe = findDockerDesktopExe();
  if (!exe) {
    console.error(
      "[db:ensure] Docker Desktop not found. Install it, then re-run npm run dev.",
    );
    return false;
  }

  console.log("[db:ensure] Starting Docker Desktop…");
  spawn(exe, [], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (dockerAvailable()) {
      console.log("[db:ensure] Docker is ready.");
      return true;
    }
    await sleep(2500);
  }

  console.error(
    "[db:ensure] Timed out waiting for Docker Desktop. Open it manually, wait until it is running, then retry.",
  );
  return false;
}

function composeArgs(services) {
  const args = ["compose"];
  const dockerEnv = path.join(ROOT, ".env.docker");
  const dotenv = path.join(ROOT, ".env");
  if (fs.existsSync(dockerEnv)) {
    args.push("--env-file", ".env.docker");
  }
  if (fs.existsSync(dotenv)) {
    args.push("--env-file", ".env");
  }
  args.push("up", "-d", "--remove-orphans", ...services);
  return args;
}

function startComposeServices(services) {
  console.log(`[db:ensure] Starting: ${services.join(", ")}`);
  execFileSync("docker", composeArgs(services), {
    cwd: ROOT,
    stdio: "inherit",
    windowsHide: true,
  });
}

async function waitForPort(host, port, label, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canTcp(host, port)) {
      console.log(`[db:ensure] ${label} is accepting connections on ${host}:${port}`);
      return true;
    }
    await sleep(1500);
  }
  console.error(
    `[db:ensure] Timed out waiting for ${label} at ${host}:${port}`,
  );
  return false;
}

function detectLanIPv4() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, entries] of Object.entries(ifaces)) {
    if (!entries) continue;
    const lower = name.toLowerCase();
    if (
      lower.includes("wsl") ||
      lower.includes("hyper-v") ||
      lower.includes("vethernet") ||
      lower.includes("docker") ||
      lower.includes("virtualbox") ||
      lower.includes("vmware") ||
      lower.includes("loopback")
    ) {
      continue;
    }
    for (const entry of entries) {
      const family = String(entry.family);
      if (family !== "IPv4" && family !== "4") continue;
      if (entry.internal) continue;
      candidates.push({ name, address: entry.address });
    }
  }
  const score = (ip) =>
    ip.startsWith("192.168.")
      ? 0
      : ip.startsWith("10.")
        ? 1
        : /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
          ? 2
          : 9;
  candidates.sort((a, b) => {
    const byRange = score(a.address) - score(b.address);
    if (byRange !== 0) return byRange;
    return /wi-?fi|wlan|wireless/i.test(a.name) ? -1 : 1;
  });
  return candidates[0]?.address ?? null;
}

function upsertEnvKey(filePath, key, value) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `${key}=${value}\n`, "utf8");
    return;
  }
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  let found = false;
  const next = lines.map((line) => {
    if (line.trimStart().startsWith("#")) return line;
    if (new RegExp(`^\\s*${key}=`).test(line)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) {
    if (next.length && next[next.length - 1] !== "") next.push("");
    next.push(`# Auto-set for phone QR / secondary camera (same Wi‑Fi)`);
    next.push(`${key}=${value}`);
  }
  fs.writeFileSync(filePath, next.join("\n"), "utf8");
}

function syncPublicLanIp() {
  const lan = detectLanIPv4();
  if (!lan) {
    console.warn(
      "[db:ensure] No LAN IPv4 found — phone QR may still use localhost.",
    );
    return null;
  }
  const dotenv = path.join(ROOT, ".env");
  upsertEnvKey(dotenv, "PUBLIC_LAN_IP", lan);
  process.env.PUBLIC_LAN_IP = lan;
  console.log(`[db:ensure] PUBLIC_LAN_IP=${lan} (for phone secondary camera QR)`);
  return lan;
}

async function main() {
  syncPublicLanIp();
  try {
    execFileSync("node", [path.join(ROOT, "scripts", "ensure-lan-https-proxy.mjs")], {
      cwd: ROOT,
      stdio: "inherit",
      windowsHide: true,
    });
  } catch {
    console.warn(
      "[db:ensure] HTTPS phone proxy skipped — run npm run https:up later for secondary camera.",
    );
  }

  const env = {
    ...loadEnvFile(path.join(ROOT, ".env.docker")),
    ...loadEnvFile(path.join(ROOT, ".env")),
    ...process.env,
  };

  const { host, port } = parseDbTarget(env.DATABASE_URL || DEFAULT_URL);
  const ollamaPort = Number(env.OLLAMA_HOST_PORT || 11434);

  if (await canTcp(host, port)) {
    console.log(`[db:ensure] Postgres already up at ${host}:${port}`);
    // Still bring Ollama up if missing (chat/screening).
    if (!(await canTcp("127.0.0.1", ollamaPort))) {
      if (await ensureDockerDesktopRunning()) {
        try {
          startComposeServices(["ollama"]);
        } catch (err) {
          console.warn(
            "[db:ensure] Could not start ollama:",
            err instanceof Error ? err.message : err,
          );
        }
      }
    }
    process.exit(0);
  }

  console.log(
    `[db:ensure] Postgres not reachable at ${host}:${port} — bringing it up…`,
  );

  if (!(await ensureDockerDesktopRunning())) {
    process.exit(1);
  }

  try {
    // Postgres is required for the app. Ollama is required for AI screens.
    // Do NOT start the compose `app` service — host `npm run dev` owns :3000.
    startComposeServices(["postgres", "ollama"]);
  } catch (err) {
    console.error(
      "[db:ensure] docker compose failed:",
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  }

  const ok = await waitForPort(host, port, "Postgres");
  if (!ok) process.exit(1);

  // Brief settle so Prisma does not race pg_isready.
  await sleep(1000);
  console.log("[db:ensure] Local database is ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[db:ensure] Unexpected failure:", err);
  process.exit(1);
});
