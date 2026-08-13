"use client";

import { useState } from "react";
import { AIScreeningCard, type ScreeningCardEvaluation } from "@/components/ai-screening-card";
import { Button } from "@/components/ui/button";
import { matchSignalLabel, recommendationLabel } from "@/lib/candidate-detail-ui";
import { cn } from "@/lib/utils";

export function AIScreeningSummary({
  applicationId,
  evaluation,
}: {
  applicationId: string;
  evaluation: ScreeningCardEvaluation | null;
}) {
  const [open, setOpen] = useState(false);
  const scores = evaluation?.scores;
  const rec =
    recommendationLabel(evaluation?.recommendation) ??
    recommendationLabel(scores?.recommendedAction) ??
    null;

  if (open) {
    return (
      <div id="screening" className="space-y-2">
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Collapse
          </Button>
        </div>
        <AIScreeningCard applicationId={applicationId} evaluation={evaluation} />
      </div>
    );
  }

  const overall = scores ? Math.round(scores.overall) : null;
  const strengths = scores?.whyMatch.slice(0, 3) ?? [];
  const concerns = [
    ...(scores?.concerns ?? []),
    ...(scores?.missingRequirements ?? []),
  ].slice(0, 3);

  return (
    <section id="screening" className="space-y-4">
      <div>
        <h2 className="text-[17px] font-semibold text-foreground">AI Screening</h2>
        <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--ai))]">
          AI suggestion — recruiter decides
        </p>
      </div>

      {scores && overall != null ? (
        <div className="space-y-4">
          <div>
            <p className="text-[12px] text-muted-foreground">AI Match</p>
            <p className="mt-0.5 text-[26px] font-semibold leading-none tabular-nums text-foreground">
              {overall}
              <span className="ml-1 text-sm font-medium text-muted-foreground">/ 100</span>
            </p>
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={overall}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="AI match score"
            >
              <div
                className="h-full rounded-full bg-[hsl(var(--ai))]"
                style={{ width: `${Math.max(0, Math.min(100, overall))}%` }}
              />
            </div>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {matchSignalLabel(overall)} match signal
            </p>
          </div>

          {rec ? (
            <div>
              <p className="text-[12px] text-muted-foreground">Recommendation</p>
              <p className="text-sm font-semibold uppercase tracking-wide text-foreground">
                {rec}
              </p>
            </div>
          ) : null}

          <EvidenceList title="Strengths" items={strengths} tone="good" />
          <EvidenceList title="Concerns" items={concerns} tone="warn" />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No screening result yet. Run AI screening for an advisory match score.
        </p>
      )}

      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {scores ? "View full AI evaluation" : "Run / View Screening"}
      </Button>
    </section>
  );
}

function EvidenceList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "good" | "warn";
}) {
  return (
    <div>
      <p
        className={cn(
          "text-[12px] font-medium",
          tone === "good" ? "text-success" : "text-warning",
        )}
      >
        {title}
      </p>
      {items.length === 0 ? (
        <p className="mt-1 text-[13px] text-muted-foreground">None noted.</p>
      ) : (
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[13px] text-muted-foreground">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
