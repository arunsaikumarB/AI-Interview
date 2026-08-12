/**
 * Simple in-memory sliding-window rate limiter (single-process).
 * Fine for local/self-hosted; not shared across multiple Node instances.
 */

type Bucket = number[];

const buckets = new Map<string, Bucket>();

export function rateLimit(params: {
  key: string;
  limit: number;
  windowMs: number;
}): { ok: boolean; remaining: number } {
  const now = Date.now();
  const cutoff = now - params.windowMs;
  const prev = buckets.get(params.key) ?? [];
  const recent = prev.filter((t) => t > cutoff);

  if (recent.length >= params.limit) {
    buckets.set(params.key, recent);
    return { ok: false, remaining: 0 };
  }

  recent.push(now);
  buckets.set(params.key, recent);
  return { ok: true, remaining: params.limit - recent.length };
}

export function clientIp(request: Request): string {
  const xf = request.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
