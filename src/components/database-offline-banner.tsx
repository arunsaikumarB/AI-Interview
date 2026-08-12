"use client";

import { useEffect, useState } from "react";

/**
 * Red sticky banner when /api/health reports database.ok === false.
 * Same placement pattern as CloudAiBanner (dashboard layout).
 */
export function DatabaseOfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const data = (await res.json()) as {
          database?: { ok?: boolean };
        };
        if (!cancelled) {
          setOffline(data.database?.ok === false);
        }
      } catch {
        if (!cancelled) setOffline(true);
      }
    }

    void check();
    const id = setInterval(() => void check(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="alert"
      className="sticky top-0 z-50 border-b border-rose-400 bg-rose-600 px-4 py-2 text-center text-sm font-medium text-white"
    >
      Database offline — Postgres is unreachable. Run{" "}
      <code className="rounded bg-rose-800/50 px-1">docker compose up -d</code>{" "}
      and retry.
    </div>
  );
}
