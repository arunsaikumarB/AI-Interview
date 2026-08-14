/**
 * Host-side HTTPS terminator for the secondary-camera phone QR.
 *
 * Docker Desktop on Windows publishes :3443 inside WSL — other devices on
 * Wi‑Fi often time out even when this PC can open https://<LAN>:3443.
 * Binding TLS on the host and proxying to 127.0.0.1:3000 (npm run dev)
 * is reachable from the phone after the firewall rule is allowed.
 */
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CERT = path.join(ROOT, "certs", "lan.pem");
const KEY = path.join(ROOT, "certs", "lan-key.pem");
const LISTEN_PORT = Number(process.env.PUBLIC_HTTPS_PORT || 3443);
const TARGET_HOST = "127.0.0.1";
const TARGET_PORT = Number(process.env.APP_HOST_PORT || 3000);

if (!fs.existsSync(CERT) || !fs.existsSync(KEY)) {
  console.error("[lan-https] Missing certs/lan.pem — run npm run https:certs");
  process.exit(1);
}

function hopByHop() {
  return new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
  ]);
}

function proxyRequest(req, res) {
  const skip = hopByHop();
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null || skip.has(key.toLowerCase())) continue;
    headers[key] = value;
  }
  headers["x-forwarded-proto"] = "https";
  headers["x-forwarded-host"] = req.headers.host ?? `127.0.0.1:${LISTEN_PORT}`;
  const remote = req.socket.remoteAddress;
  if (remote) headers["x-forwarded-for"] = remote;

  const upstream = http.request(
    {
      hostname: TARGET_HOST,
      port: TARGET_PORT,
      path: req.url,
      method: req.method,
      headers,
    },
    (up) => {
      const out = { ...up.headers };
      delete out.connection;
      res.writeHead(up.statusCode ?? 502, out);
      up.pipe(res);
    },
  );
  upstream.on("error", (err) => {
    console.error("[lan-https] upstream", err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    }
    res.end("Secondary camera proxy could not reach the local app on port 3000.");
  });
  req.pipe(upstream);
}

const server = https.createServer(
  {
    cert: fs.readFileSync(CERT),
    key: fs.readFileSync(KEY),
  },
  proxyRequest,
);

server.on("upgrade", (req, socket, head) => {
  const proxy = net.connect(TARGET_PORT, TARGET_HOST, () => {
    let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
    for (const [key, value] of Object.entries(req.headers)) {
      if (value == null) continue;
      raw += `${key}: ${Array.isArray(value) ? value.join(", ") : value}\r\n`;
    }
    raw += "\r\n";
    proxy.write(raw);
    if (head.length) proxy.write(head);
    proxy.pipe(socket);
    socket.pipe(proxy);
  });
  proxy.on("error", () => socket.destroy());
  socket.on("error", () => proxy.destroy());
});

server.timeout = 0;
server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;

server.listen(LISTEN_PORT, "0.0.0.0", () => {
  console.log(
    `[lan-https] https://0.0.0.0:${LISTEN_PORT} → http://${TARGET_HOST}:${TARGET_PORT}`,
  );
});

server.on("error", (err) => {
  console.error("[lan-https]", err.message);
  process.exit(1);
});
