"use client";

import { useEffect, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import type { CandidateHub } from "@/lib/candidate-assessment/service";
import { cn } from "@/lib/utils";

const STATUS_CLASS: Record<string, string> = {
  "Not Started": "bg-muted text-foreground",
  "In Progress": "bg-primary/10 text-primary",
  Submitted: "bg-primary/10 text-primary",
  Completed: "bg-success/10 text-success",
  Expired: "bg-muted/40 text-muted-foreground",
  Ended: "bg-muted/40 text-muted-foreground",
};

export function AssessmentHub({ token }: { token: string }) {
  const [hub, setHub] = useState<CandidateHub | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/assessment/${encodeURIComponent(token)}`, { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as { hub?: CandidateHub; error?: string };
        if (cancelled) return;
        if (!res.ok || !body.hub) {
          setError(
            res.status === 400 || res.status === 404
              ? "This assessment link is not valid."
              : (body.error ?? "Something went wrong. Please try again."),
          );
          return;
        }
        setHub(body.hub);
      } catch {
        if (!cancelled) setError("Network error — check your connection and try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (error) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <div className="glass-card rounded-[var(--radius-card)] p-8 text-center">
          <h1 className="text-xl font-semibold text-foreground">Assessment</h1>
          <p className="mt-3 text-sm text-muted-foreground">{error}</p>
        </div>
      </main>
    );
  }

  if (!hub) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <p className="text-center text-sm text-muted-foreground">Loading your assessment…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <header className="mb-8">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{hub.companyName}</p>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">{hub.jobTitle}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Candidate Assessment</p>
      </header>

      {hub.components.length === 0 ? (
        <div className="glass-card rounded-[var(--radius-card)] p-6 text-sm text-muted-foreground">
          Nothing has been assigned yet. The hiring team will let you know when your assessment is ready.
        </div>
      ) : (
        <ol className="space-y-4">
          {hub.components.map((c) => (
            <li key={c.key} className="glass-card rounded-[var(--radius-card)] p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-foreground">
                    {c.label}
                    {!c.required ? <span className="ml-2 text-xs font-normal text-muted-foreground">Optional</span> : null}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">{c.description}</p>
                  {c.estimatedMinutes ? (
                    <p className="mt-1 text-xs text-muted-foreground">About {c.estimatedMinutes} minutes</p>
                  ) : null}
                </div>
                <span
                  className={cn(
                    "inline-flex shrink-0 rounded-md px-2 py-0.5 text-xs font-medium",
                    STATUS_CLASS[c.status] ?? "bg-muted text-foreground",
                  )}
                >
                  {c.status}
                </span>
              </div>
              {c.action ? (
                <a href={c.action.href} className={cn(buttonVariants({ size: "sm" }), "mt-4")}>
                  {c.action.kind === "CONTINUE"
                    ? "Continue"
                    : c.key === "AI_INTERVIEW"
                      ? "Start Interview"
                      : "Start Assessment"}
                </a>
              ) : null}
              {c.note ? <p className="mt-3 text-xs text-muted-foreground">{c.note}</p> : null}
            </li>
          ))}
        </ol>
      )}

      {hub.progress.total > 0 ? (
        <div className="mt-8">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-foreground">Progress</span>
            <span className="text-muted-foreground">
              {hub.progress.completed} / {hub.progress.total} completed
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.round((hub.progress.completed / hub.progress.total) * 100)}%` }}
            />
          </div>
          {hub.assessmentStatus === "COMPLETED" ? (
            <p className="mt-4 text-sm text-foreground">
              Thank you — you have completed your assessment. The hiring team will be in touch.
            </p>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
