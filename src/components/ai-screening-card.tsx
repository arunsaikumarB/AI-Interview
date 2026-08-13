"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ScreeningResult } from "@/lib/ai/screening";

const BREAKDOWN_LABELS: Record<keyof ScreeningResult["breakdown"], string> = {
  technicalSkills: "Technical skills",
  experience: "Experience",
  education: "Education",
  domainExperience: "Domain experience",
  jobRequirements: "Job requirements",
};

const ACTION_STYLE: Record<string, string> = {
  SHORTLIST: "bg-success/15 text-success",
  REVIEW: "bg-warning/15 text-warning",
  REJECT: "bg-destructive/15 text-destructive",
  YES: "bg-success/15 text-success",
  MAYBE: "bg-warning/15 text-warning",
  NO: "bg-destructive/15 text-destructive",
};

export type ScreeningCardEvaluation = {
  id: string;
  scores: ScreeningResult;
  recommendation: string;
  reasoning: string;
  model: string;
  createdAt: string | Date;
};

export function AIScreeningCard({
  applicationId,
  evaluation,
}: {
  applicationId: string;
  evaluation: ScreeningCardEvaluation | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; ollamaDown?: boolean } | null>(
    null,
  );
  const [reasoningOpen, setReasoningOpen] = useState(false);

  async function runScreening() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/applications/${applicationId}/screen`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError({
          message: data.error ?? "Screening failed",
          ollamaDown: Boolean(data.ollamaDown),
        });
        return;
      }
      router.refresh();
    } catch {
      setError({
        message: "Could not reach the server. Is the app running?",
        ollamaDown: false,
      });
    } finally {
      setLoading(false);
    }
  }

  const scores = evaluation?.scores;

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium text-foreground">AI Screening</h2>
          <p className="mt-1 text-xs font-medium uppercase tracking-wide text-warning">
            AI suggestion — recruiter decides
          </p>
        </div>
        <Button onClick={runScreening} disabled={loading}>
          {loading
            ? "Screening… (10–40s)"
            : evaluation
              ? "Re-run screening"
              : "Run AI screening"}
        </Button>
      </div>

      {error ? (
        <div
          className={cn(
            "rounded-lg border px-4 py-3 text-sm",
            error.ollamaDown
              ? "border-warning/30 bg-warning/10 text-foreground"
              : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          <p className="font-medium">
            {error.ollamaDown ? "AI screening unavailable" : "Screening error"}
          </p>
          <p className="mt-1">{error.message}</p>
          {error.ollamaDown ? (
            <p className="mt-2 text-xs">
              The local AI service is offline. Retry when it is available. Application
              stage was not changed.
            </p>
          ) : null}
        </div>
      ) : null}

      {loading && !scores ? (
        <div className="space-y-3 animate-pulse">
          <div className="h-16 w-24 rounded bg-muted" />
          <div className="h-3 rounded bg-muted" />
          <div className="h-3 rounded bg-muted" />
          <div className="h-3 w-2/3 rounded bg-muted" />
          <p className="text-sm text-muted-foreground">
            Running advisory resume match…
          </p>
        </div>
      ) : null}

      {scores ? (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Overall match</p>
              <p className="font-display text-5xl font-semibold text-foreground">
                {Math.round(scores.overall)}
                <span className="text-2xl text-muted-foreground">%</span>
              </p>
            </div>
            <Badge
              className={cn(
                "mb-2",
                ACTION_STYLE[scores.recommendedAction] ??
                  ACTION_STYLE[evaluation!.recommendation] ??
                  "bg-muted text-foreground",
              )}
            >
              {scores.recommendedAction}
            </Badge>
          </div>

          <div className="space-y-3">
            {(
              Object.keys(BREAKDOWN_LABELS) as Array<keyof ScreeningResult["breakdown"]>
            ).map((key) => (
              <BreakdownRow
                key={key}
                label={BREAKDOWN_LABELS[key]}
                value={scores.breakdown[key]}
              />
            ))}
          </div>

          <ListBlock title="Why this candidate matches" items={scores.whyMatch} tone="good" />
          <ListBlock
            title="Missing requirements"
            items={scores.missingRequirements}
            tone="warn"
          />
          <ListBlock title="Concerns" items={scores.concerns} tone="bad" />

          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <button
              type="button"
              className="text-sm font-medium text-foreground underline"
              onClick={() => setReasoningOpen((v) => !v)}
            >
              {reasoningOpen ? "Hide full reasoning" : "Show full reasoning"}
            </button>
            {reasoningOpen ? (
              <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                {evaluation!.reasoning}
              </p>
            ) : null}
          </div>

          <p className="text-xs text-muted-foreground">
            {formatDateTime(evaluation!.createdAt)} · advisory only
          </p>
        </>
      ) : !loading && !error ? (
        <p className="text-sm text-muted-foreground">
          No screening result yet. Run AI screening to get an advisory match score.
        </p>
      ) : null}
    </section>
  );
}

function BreakdownRow({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-foreground">{Math.round(pct)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ListBlock({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "good" | "warn" | "bad";
}) {
  const border =
    tone === "good"
      ? "border-success/30"
      : tone === "warn"
        ? "border-warning/30"
        : "border-destructive/30";
  return (
    <div className={cn("rounded-lg border p-3", border)}>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">None noted.</p>
      ) : (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
