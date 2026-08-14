/**
 * Make https://<LAN>:3443 reachable from the phone for secondary camera.
 * - TLS cert for the LAN IP
 * - Stop Docker https-proxy (WSL published ports often time out on Wi‑Fi)
 * - Host Node HTTPS proxy → 127.0.0.1:3000
 * - Windows Firewall inbound allow on 3443 (UAC once)
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PID_FILE = path.join(ROOT, "certs", "lan-https-proxy.pid");
const PROXY_IP_FILE = path.join(ROOT, "certs", "lan-https-proxy.ip");
const HTTPS_PORT = Number(process.env.PUBLIC_HTTPS_PORT || 3443);
const RULE_NAME = "Logisoft HireOS secondary camera HTTPS";

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

function pidAlive(pid) {
  if (!pid || !Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid() {
  try {
    const n = Number(fs.readFileSync(PID_FILE, "utf8").trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function stopDockerHttps() {
  try {
    execFileSync("docker", ["stop", "aros-https"], {
      stdio: "ignore",
      windowsHide: true,
    });
    console.log("[https] Stopped Docker aros-https (phone uses host TLS on :3443)");
  } catch {
    /* not running */
  }
}

function firewallRuleExists() {
  try {
    execFileSync(
      "netsh",
      ["advfirewall", "firewall", "show", "rule", `name=${RULE_NAME}`],
      { stdio: "ignore", windowsHide: true },
    );
    return true;
  } catch {
    return false;
  }
}

function ensureFirewallRule() {
  if (process.platform !== "win32") return;
  const ps1 = path.join(ROOT, "scripts", "allow-secondary-camera-firewall.ps1");
  console.log(
    "[https] Windows must allow inbound TCP 3443 (all network profiles) — approve UAC if prompted.",
  );
  try {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        ps1,
      ],
      { stdio: "inherit", windowsHide: false },
    );
  } catch {
    console.warn(
      "[https] Firewall rule not added. As Administrator run:\n" +
        `  powershell -ExecutionPolicy Bypass -File "${ps1}"`,
    );
  }
}

async function waitForListen() {
  for (let i = 0; i < 20; i++) {
    if (await canTcp("127.0.0.1", HTTPS_PORT)) return true;
    await sleep(250);
  }
  return false;
}

function stopPid(pid) {
  if (!pidAlive(pid)) return;
  try {
    process.kill(pid);
  } catch {
    /* already gone */
  }
}

function readCertLanIp() {
  try {
    return fs.readFileSync(path.join(ROOT, "certs", "lan-ip.txt"), "utf8").trim();
  } catch {
    return "";
  }
}

function readProxyIp() {
  try {
    return fs.readFileSync(PROXY_IP_FILE, "utf8").trim();
  } catch {
    return "";
  }
}

async function startHostProxy() {
  const lanIp = readCertLanIp();
  const existing = readPid();
  const listening = await canTcp("127.0.0.1", HTTPS_PORT);

  if (
    existing &&
    pidAlive(existing) &&
    listening &&
    lanIp &&
    readProxyIp() === lanIp
  ) {
    console.log(
      `[https] Host TLS proxy already running (pid ${existing}) → https://${lanIp}:${HTTPS_PORT}`,
    );
    return;
  }

  // Restart when Wi‑Fi IP changed so the cert + bind match the QR.
  if (existing && pidAlive(existing)) {
    console.log("[https] Restarting host TLS proxy for current LAN IP…");
    stopPid(existing);
    await sleep(500);
  }

  if (await canTcp("127.0.0.1", HTTPS_PORT)) {
    stopDockerHttps();
    await sleep(800);
  }

  if (await canTcp("127.0.0.1", HTTPS_PORT)) {
    const maybe = readPid();
    if (maybe && pidAlive(maybe)) {
      console.log(`[https] Host TLS proxy already listening on :${HTTPS_PORT}`);
      return;
    }
    console.warn(
      `[https] Port ${HTTPS_PORT} is already in use — phone QR may still time out.`,
    );
    return;
  }

  fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
  const child = spawn(
    process.execPath,
    [path.join(ROOT, "scripts", "lan-https-proxy.mjs")],
    {
      cwd: ROOT,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: process.env,
    },
  );
  child.unref();
  if (child.pid) {
    fs.writeFileSync(PID_FILE, `${child.pid}\n`, "utf8");
    if (lanIp) fs.writeFileSync(PROXY_IP_FILE, `${lanIp}\n`, "utf8");
  }

  const ok = await waitForListen();
  if (!ok) {
    console.warn("[https] Host TLS proxy did not start listening on", HTTPS_PORT);
    return;
  }
  console.log(
    `[https] Phone URL is https://${lanIp || "<LAN>"}:${HTTPS_PORT} → 127.0.0.1:3000`,
  );
}

async function main() {
  execFileSync(process.execPath, [path.join(ROOT, "scripts", "ensure-local-https.mjs")], {
    cwd: ROOT,
    stdio: "inherit",
    windowsHide: true,
  });
  stopDockerHttps();
  await sleep(400);
  await startHostProxy();
  ensureFirewallRule();
}

main().catch((err) => {
  console.error("[https]", err);
  process.exit(1);
});
