"use client";

import { useState } from "react";
import { AIScreeningCard, type ScreeningCardEvaluation } from "@/components/ai-screening-card";
import { Button } from "@/components/ui/button";

export function AIScreeningSummary({
  applicationId,
  evaluation,
}: {
  applicationId: string;
  evaluation: ScreeningCardEvaluation | null;
}) {
  const [open, setOpen] = useState(false);
  const scores = evaluation?.scores;

  if (open) {
    return (
      <div className="space-y-2">
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Collapse
          </Button>
        </div>
        <AIScreeningCard applicationId={applicationId} evaluation={evaluation} />
      </div>
    );
  }

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">AI Screening</h2>
          <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-amber-700">
            AI suggestion — recruiter decides
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          {scores ? "View Screening" : "Run / View Screening"}
        </Button>
      </div>

      {scores ? (
        <>
          <p className="text-3xl font-semibold tabular-nums text-slate-900">
            {Math.round(scores.overall)}
            <span className="ml-1 text-base font-medium text-slate-500">% Match</span>
          </p>
          <p className="text-sm text-slate-600">
            {scores.whyMatch.slice(0, 2).join(" ")}
          </p>
        </>
      ) : (
        <p className="text-sm text-slate-500">
          No screening result yet. Run AI screening for an advisory match score.
        </p>
      )}
    </section>
  );
}
