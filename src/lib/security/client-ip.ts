import { isIP } from "node:net";

/**
 * Client IP for IP-based limits. Every IP-based control must use this helper.
 *
 * X-Forwarded-For is client-controlled: Next only fills it with the socket address when the
 * request has none, so a direct caller can put anything there. It is therefore ignored unless
 * TRUST_PROXY names how many reverse proxies sit in front of the app (production: nginx → 1).
 * Each trusted proxy appends the address it received the request from, so the client is the
 * entry that many places from the right; anything further left was sent by the client.
 * Only set TRUST_PROXY when the app port is reachable solely through those proxies.
 *
 * No trusted proxy → null. Callers must then fall back to non-IP limits, never a shared bucket
 * keyed by a client-supplied header.
 */

const MAX_TRUSTED_PROXIES = 5;

/** TRUST_PROXY: unset/false/0 → 0; true → 1; 1–5 → that many hops. Anything else fails closed (0). */
export function trustedProxyCount(value: string | undefined = process.env.TRUST_PROXY): number {
  const v = value?.trim().toLowerCase() ?? "";
  if (v === "" || v === "false" || v === "0") return 0;
  if (v === "true") return 1;
  if (!/^\d+$/.test(v)) return 0;
  const n = Number(v);
  return n >= 1 && n <= MAX_TRUSTED_PROXIES ? n : 0;
}

export function resolveClientIp(headers: Headers, trustedProxies: number): string | null {
  if (trustedProxies < 1) return null;
  const header = headers.get("x-forwarded-for");
  if (!header) return null;
  const hops = header.split(",").map((h) => h.trim());
  if (hops.length < trustedProxies) return null;
  return normalizeIp(hops[hops.length - trustedProxies]);
}

function normalizeIp(value: string): string | null {
  const bare = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  return isIP(bare) ? bare.toLowerCase() : null;
}

export function clientIp(request: Request): string | null {
  return resolveClientIp(request.headers, trustedProxyCount());
}
