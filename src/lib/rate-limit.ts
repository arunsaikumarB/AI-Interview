/**
 * Simple in-memory sliding-window rate limiter (single-process).
 * Fine for local/self-hosted; not shared across multiple Node instances.
 */

type Bucket = { hits: number[]; windowMs: number };

const buckets = new Map<string, Bucket>();

const SWEEP_INTERVAL_MS = 5 * 60_000;
let lastSweep = Date.now();

function sweep(now: number) {
  buckets.forEach((bucket, key) => {
    const newest = bucket.hits[bucket.hits.length - 1];
    if (newest === undefined || newest <= now - bucket.windowMs) {
      buckets.delete(key);
    }
  });
  lastSweep = now;
}

export function rateLimit(params: {
  key: string;
  limit: number;
  windowMs: number;
}): { ok: boolean; remaining: number } {
  const now = Date.now();
  if (now - lastSweep >= SWEEP_INTERVAL_MS) sweep(now);

  const cutoff = now - params.windowMs;
  const prev = buckets.get(params.key)?.hits ?? [];
  const recent = prev.filter((t) => t > cutoff);

  if (recent.length >= params.limit) {
    buckets.set(params.key, { hits: recent, windowMs: params.windowMs });
    return { ok: false, remaining: 0 };
  }

  recent.push(now);
  buckets.set(params.key, { hits: recent, windowMs: params.windowMs });
  return { ok: true, remaining: params.limit - recent.length };
}

export function rateLimitBucketCountForTests(): number {
  return buckets.size;
}

export function sweepRateLimitBucketsForTests(now: number = Date.now()): void {
  sweep(now);
}
