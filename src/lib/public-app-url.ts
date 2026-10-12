import os from "node:os";

/**
 * Build phone-reachable app URLs for QR / secondary camera pairing.
 * Prefer request host → non-loopback NEXT_PUBLIC_APP_URL → auto LAN IPv4.
 */

export function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "0.0.0.0"
  );
}

function scoreLanIp(ip: string): number {
  if (ip.startsWith("192.168.")) return 0;
  if (ip.startsWith("10.")) return 1;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return 2;
  return 9;
}

/** First non-internal IPv4 (prefers typical home/office LAN ranges). */
export function detectLanIPv4(): string | null {
  const ifaces = os.networkInterfaces();
  const candidates: { name: string; address: string }[] = [];
  for (const [name, entries] of Object.entries(ifaces)) {
    if (!entries) continue;
    const lower = name.toLowerCase();
    // Skip virtual adapters that phones cannot route to.
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
  candidates.sort((a, b) => {
    const byRange = scoreLanIp(a.address) - scoreLanIp(b.address);
    if (byRange !== 0) return byRange;
    // Prefer Wi-Fi / WLAN when scores tie.
    const wifiScore = (n: string) =>
      /wi-?fi|wlan|wireless/i.test(n) ? 0 : 1;
    return wifiScore(a.name) - wifiScore(b.name);
  });
  return candidates[0]?.address ?? null;
}

export type PublicAppUrlResult = {
  url: string;
  reachableFromPhone: boolean;
  source: "request" | "env" | "lan" | "loopback";
  lanIp?: string;
};

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function lanAddressesOnThisPc(): Set<string> {
  const ips = new Set<string>();
  const ifaces = os.networkInterfaces();
  for (const entries of Object.values(ifaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      const family = String(entry.family);
      if (family !== "IPv4" && family !== "4") continue;
      if (entry.internal) continue;
      ips.add(entry.address);
    }
  }
  return ips;
}

function lanIpFromEnv(): string | null {
  const raw = (
    process.env.PUBLIC_LAN_IP ||
    process.env.APP_LAN_IP ||
    ""
  )
    .trim()
    .replace(/^https?:\/\//i, "")
    .split("/")[0]!
    .split(":")[0]!;
  if (!raw || isLoopbackHostname(raw)) return null;
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) return null;
  // Ignore leftover IPs from a previous Wi‑Fi (phone timeouts).
  if (!lanAddressesOnThisPc().has(raw)) return null;
  return raw;
}

function isIPv4Literal(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

/** HTTPS origin the candidate's browser used (e.g. nginx on the app server). */
function httpsOriginFromRequest(request?: Request): string | null {
  if (!request) return null;
  const xfProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = (
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? ""
  )
    .split(",")[0]!
    .trim();
  let proto = xfProto;
  if (!proto) {
    try {
      proto = new URL(request.url).protocol.replace(":", "");
    } catch {
      return null;
    }
  }
  if (proto !== "https" || !host) return null;
  try {
    const url = new URL(`https://${host}`);
    if (isLoopbackHostname(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Configured HTTPS address (PUBLIC_HTTPS_URL, then NEXT_PUBLIC_APP_URL). */
function configuredHttpsOrigin(): string | null {
  for (const raw of [process.env.PUBLIC_HTTPS_URL, process.env.NEXT_PUBLIC_APP_URL]) {
    const value = (raw ?? "").trim();
    if (!value) continue;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || isLoopbackHostname(url.hostname)) continue;
    // An IP from a previous Wi‑Fi times out on the phone; only trust IPs this machine has.
    if (isIPv4Literal(url.hostname) && !lanAddressesOnThisPc().has(url.hostname)) continue;
    return url.origin;
  }
  return null;
}

function phoneHttpsOrigin(): { origin: string; lanIp: string } | null {
  const live = detectLanIPv4();
  if (!live) return null;
  const port = (process.env.PUBLIC_HTTPS_PORT || "3443").trim() || "3443";
  return { origin: `https://${live}:${port}`, lanIp: live };
}

/**
 * Resolve a base URL phones can open on the same Wi‑Fi.
 * Pass the incoming Request when available (pairing APIs).
 */
export function resolvePublicAppUrl(request?: Request): PublicAppUrlResult {
  const envRaw = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  let envUrl: URL | null = null;
  if (envRaw) {
    try {
      envUrl = new URL(envRaw);
    } catch {
      envUrl = null;
    }
  }
  const forcedLan = lanIpFromEnv();
  const appHostPort = (process.env.APP_HOST_PORT || "").trim() || "3000";

  const fromForcedLan = (port: string): PublicAppUrlResult | null => {
    if (!forcedLan) return null;
    return {
      url: `http://${forcedLan}:${port}`,
      reachableFromPhone: true,
      source: "env",
      lanIp: forcedLan,
    };
  };

  if (request) {
    const xfProto = request.headers.get("x-forwarded-proto");
    const xfHost = request.headers.get("x-forwarded-host");
    if (xfProto && xfHost) {
      const host = xfHost.split(",")[0]!.trim();
      const proto = xfProto.split(",")[0]!.trim();
      const hostname = host.split(":")[0]!;
      if (!isLoopbackHostname(hostname)) {
        return {
          url: stripTrailingSlash(`${proto}://${host}`),
          reachableFromPhone: true,
          source: "request",
        };
      }
    }

    try {
      const reqUrl = new URL(request.url);
      const hostHeader = request.headers.get("host");
      if (hostHeader) {
        const hostname = hostHeader.split(":")[0]!;
        if (!isLoopbackHostname(hostname)) {
          const proto = reqUrl.protocol.replace(":", "") || "http";
          return {
            url: stripTrailingSlash(`${proto}://${hostHeader}`),
            reachableFromPhone: true,
            source: "request",
          };
        }
      }

      if (!isLoopbackHostname(reqUrl.hostname)) {
        return {
          url: stripTrailingSlash(reqUrl.origin),
          reachableFromPhone: true,
          source: "request",
        };
      }

      const port =
        reqUrl.port ||
        (reqUrl.protocol === "https:" ? "443" : appHostPort);

      // Host/Docker: explicit LAN IP beats localhost NEXT_PUBLIC_APP_URL.
      const forced = fromForcedLan(port);
      if (forced) return forced;

      if (envUrl && !isLoopbackHostname(envUrl.hostname)) {
        return {
          url: stripTrailingSlash(envUrl.origin),
          reachableFromPhone: true,
          source: "env",
        };
      }

      const lan = detectLanIPv4();
      if (lan) {
        return {
          url: `http://${lan}:${port}`,
          reachableFromPhone: true,
          source: "lan",
          lanIp: lan,
        };
      }

      return {
        url: stripTrailingSlash(reqUrl.origin),
        reachableFromPhone: false,
        source: "loopback",
      };
    } catch {
      /* fall through */
    }
  }

  const forced = fromForcedLan(appHostPort);
  if (forced) return forced;

  if (envUrl && !isLoopbackHostname(envUrl.hostname)) {
    return {
      url: stripTrailingSlash(envUrl.origin),
      reachableFromPhone: true,
      source: "env",
    };
  }

  const lan = detectLanIPv4();
  if (lan) {
    const port = envUrl?.port || appHostPort;
    return {
      url: `http://${lan}:${port}`,
      reachableFromPhone: true,
      source: "lan",
      lanIp: lan,
    };
  }

  return {
    url: stripTrailingSlash(envRaw || "http://localhost:3000"),
    reachableFromPhone: false,
    source: "loopback",
  };
}

export function secondaryPairUrl(
  pairToken: string,
  request?: Request,
): {
  pairUrl: string;
  reachableFromPhone: boolean;
  lanIp?: string;
  requiresHttpsTrust?: boolean;
} {
  // The phone camera needs HTTPS. Prefer the HTTPS address the candidate is already
  // using (server behind nginx), then a configured one; the live LAN IP on
  // PUBLIC_HTTPS_PORT is only for the laptop pilot proxy.
  const https = httpsOriginFromRequest(request) ?? configuredHttpsOrigin();
  if (https) {
    return {
      pairUrl: `${https}/interview/secondary/${pairToken}`,
      reachableFromPhone: true,
      requiresHttpsTrust: true,
    };
  }

  const phone = phoneHttpsOrigin();
  if (phone) {
    return {
      pairUrl: `${phone.origin}/interview/secondary/${pairToken}`,
      reachableFromPhone: true,
      lanIp: phone.lanIp,
      requiresHttpsTrust: true,
    };
  }

  const base = resolvePublicAppUrl(request);
  return {
    pairUrl: `${base.url}/interview/secondary/${pairToken}`,
    reachableFromPhone: base.reachableFromPhone,
    lanIp: base.lanIp,
    requiresHttpsTrust: base.url.startsWith("https://"),
  };
}
