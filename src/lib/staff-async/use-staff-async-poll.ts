"use client";

import { useEffect, useRef, useState } from "react";

function nextDelay(attempt: number): number {
  return Math.min(8000, 1000 * 2 ** Math.min(attempt, 3));
}

export function isStopStatus(status: string): boolean {
  const s = status.toUpperCase();
  return s === "COMPLETED" || s === "FAILED" || s === "CANCELLED" || s === "IDLE";
}

/** Backoff poll. Stops on terminal status or maxWaitMs. Does not re-submit. */
export function useStaffAsyncPoll(opts: {
  url: string | null;
  enabled: boolean;
  onComplete?: () => void;
  onFailed?: (message: string) => void;
  maxWaitMs?: number;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    if (!opts.enabled || !opts.url) return;
    const started = Date.now();
    const maxWait = opts.maxWaitMs ?? 5 * 60 * 1000;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      if (stopped.current || !opts.url) return;
      if (Date.now() - started > maxWait) {
        setError("Timed out waiting for background job");
        opts.onFailed?.("Timed out waiting for background job");
        return;
      }
      try {
        const res = await fetch(opts.url, { cache: "no-store" });
        const data = (await res.json()) as {
          status?: string;
          error?: string;
          error_class?: string;
        };
        if (!res.ok) {
          setError(data.error ?? "Status check failed");
          return;
        }
        const st = String(data.status ?? "idle");
        setStatus(st);
        const upper = st.toUpperCase();
        if (upper === "COMPLETED") {
          opts.onComplete?.();
          return;
        }
        if (upper === "FAILED" || upper === "CANCELLED") {
          const msg = data.error_class ?? data.error ?? "Background job failed";
          setError(msg);
          opts.onFailed?.(msg);
          return;
        }
      } catch {
        setError("Could not reach the server");
      }
      attempt += 1;
      timer = setTimeout(() => void tick(), nextDelay(attempt));
    }

    void tick();
    return () => {
      stopped.current = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled, opts.url]);

  return { status, error };
}
