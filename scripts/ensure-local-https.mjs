/**
 * Generate a local TLS cert for LAN IP + start-ready HTTPS URLs.
 * Phones block getUserMedia on http://192.168.* (not a secure context).
 *
 * Usage: node scripts/ensure-local-https.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CERT_DIR = path.join(ROOT, "certs");
const CERT = path.join(CERT_DIR, "lan.pem");
const KEY = path.join(CERT_DIR, "lan-key.pem");
const HTTPS_PORT = process.env.PUBLIC_HTTPS_PORT || "3443";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const raw of fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = val;
  }
  return out;
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
    next.push(`# Auto-set for HTTPS secondary-camera QR (phone Secure Context)`);
    next.push(`${key}=${value}`);
  }
  fs.writeFileSync(filePath, next.join("\n"), "utf8");
}

function detectLanIPv4() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, entries] of Object.entries(ifaces)) {
    if (!entries) continue;
    const lower = name.toLowerCase();
    if (
      /wsl|hyper-v|vethernet|docker|virtualbox|vmware|loopback/i.test(lower)
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

function opensslAvailable() {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function generateCert(lanIp) {
  fs.mkdirSync(CERT_DIR, { recursive: true });
  const san = `subjectAltName=IP:${lanIp},DNS:localhost,IP:127.0.0.1`;
  const args = [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-sha256",
    "-nodes",
    "-days",
    "825",
    "-keyout",
    KEY,
    "-out",
    CERT,
    "-subj",
    "/CN=AI-Recruitment-OS-Local",
    "-addext",
    san,
  ];

  if (opensslAvailable()) {
    execFileSync("openssl", args, { cwd: ROOT, stdio: "inherit", windowsHide: true });
    return;
  }

  // Fallback: openssl inside a tiny Docker image (local only).
  console.log("[https] Host openssl missing — generating cert via Docker…");
  execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${CERT_DIR}:/certs`,
      "alpine/openssl",
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-sha256",
      "-nodes",
      "-days",
      "825",
      "-keyout",
      "/certs/lan-key.pem",
      "-out",
      "/certs/lan.pem",
      "-subj",
      "/CN=AI-Recruitment-OS-Local",
      "-addext",
      san,
    ],
    { stdio: "inherit", windowsHide: true },
  );
}

function certCoversIp(lanIp) {
  if (!fs.existsSync(CERT) || !fs.existsSync(KEY)) return false;
  try {
    const text = execFileSync("openssl", ["x509", "-in", CERT, "-noout", "-text"], {
      encoding: "utf8",
      windowsHide: true,
    });
    return text.includes(`IP Address:${lanIp}`);
  } catch {
    // If we can't inspect, regenerate when missing marker file.
    const meta = path.join(CERT_DIR, "lan-ip.txt");
    if (!fs.existsSync(meta)) return false;
    return fs.readFileSync(meta, "utf8").trim() === lanIp;
  }
}

function main() {
  const env = {
    ...loadEnvFile(path.join(ROOT, ".env.docker")),
    ...loadEnvFile(path.join(ROOT, ".env")),
    ...process.env,
  };
  const lan = (env.PUBLIC_LAN_IP || "").trim() || detectLanIPv4();
  if (!lan) {
    console.error("[https] No LAN IPv4 — cannot build phone HTTPS cert.");
    process.exit(1);
  }

  if (!certCoversIp(lan)) {
    console.log(`[https] Generating TLS cert for ${lan}…`);
    generateCert(lan);
  } else {
    console.log(`[https] TLS cert already covers ${lan}`);
  }
  fs.writeFileSync(path.join(CERT_DIR, "lan-ip.txt"), `${lan}\n`, "utf8");

  const httpsUrl = `https://${lan}:${HTTPS_PORT}`;
  const dotenv = path.join(ROOT, ".env");
  upsertEnvKey(dotenv, "PUBLIC_LAN_IP", lan);
  upsertEnvKey(dotenv, "PUBLIC_HTTPS_PORT", HTTPS_PORT);
  upsertEnvKey(dotenv, "PUBLIC_HTTPS_URL", httpsUrl);
  console.log(`[https] PUBLIC_HTTPS_URL=${httpsUrl}`);
  console.log(
    "[https] Phone must open the HTTPS QR. Accept the certificate warning once, then Allow camera.",
  );
}

main();
