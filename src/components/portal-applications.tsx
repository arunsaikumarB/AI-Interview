"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Interview = {
  id: string;
  status: string;
  accessToken: string;
  actionLabel: string;
  href: string;
};

type ApplicationRow = {
  id: string;
  jobTitle: string;
  department: string | null;
  stageLabel: string;
  interviews: Interview[];
};

export function PortalApplications() {
  const [apps, setApps] = useState<ApplicationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/portal/applications", { cache: "no-store" });
      const data = await res.json();
      if (cancelled) return;
      if (!res.ok) {
        setError(data.error ?? "Failed to load");
        return;
      }
      setApps(data.applications ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p className="text-sm text-rose-600">{error}</p>;
  }
  if (!apps) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  return (
    <div className="space-y-3">
      {apps.map((app) => (
        <article key={app.id} className="rounded-xl border border-slate-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium text-slate-900">{app.jobTitle}</p>
              <p className="text-sm text-slate-500">{app.department ?? "—"}</p>
            </div>
            <Badge variant="secondary">{app.stageLabel}</Badge>
          </div>
          {app.interviews.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {app.interviews.map((iv) => (
                <Link key={iv.id} href={iv.href}>
                  <Button size="sm">{iv.actionLabel}</Button>
                </Link>
              ))}
            </div>
          ) : null}
        </article>
      ))}
      {apps.length === 0 ? (
        <p className="text-sm text-slate-500">
          No applications yet.{" "}
          <Link href="/careers" className="underline">
            Browse open roles
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
