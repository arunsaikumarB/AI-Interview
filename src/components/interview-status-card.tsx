"use client";

import Link from "next/link";
import { CreateInterviewDialog } from "@/components/create-interview-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type InterviewSummary = {
  id: string;
  status: string;
  interviewType: string;
  overallScore: number | null;
  recommendation: string | null;
  proctoringEnabled: boolean;
  proctoringEventCount: number;
};

function statusLabel(status: string) {
  switch (status) {
    case "SCHEDULED":
      return "Scheduled";
    case "IN_PROGRESS":
      return "In progress";
    case "COMPLETED":
      return "Completed";
    default:
      return status;
  }
}

export function InterviewStatusCard({
  applicationId,
  latest,
}: {
  applicationId: string;
  latest: InterviewSummary | null;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">Interview</h2>
        {!latest ? <CreateInterviewDialog applicationId={applicationId} /> : null}
      </div>

      {!latest ? (
        <p className="text-sm text-slate-500">
          No interview yet. Create a link when you&apos;re ready to invite the candidate.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-900">AI Interview</p>
          <p className="text-sm text-slate-600">{statusLabel(latest.status)}</p>
          {latest.status === "COMPLETED" && latest.overallScore != null ? (
            <p className="text-sm text-slate-800">
              <span className="text-2xl font-semibold tabular-nums">
                {latest.overallScore}
              </span>
              <span className="text-slate-500"> / 100</span>
              {latest.recommendation ? (
                <span className="ml-2 text-slate-600">
                  · {latest.recommendation.replace(/_/g, " ")}
                </span>
              ) : null}
              <span
                className="ml-2 rounded bg-slate-100 px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500"
                title="AI suggestion — recruiter decides"
              >
                AI
              </span>
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-1">
            {latest.status === "SCHEDULED" ? (
              <Link
                href={`/dashboard/interviews/${latest.id}/plan`}
                className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
              >
                Open Interview
              </Link>
            ) : (
              <Link
                href={`/dashboard/interviews/${latest.id}`}
                className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
              >
                {latest.status === "COMPLETED"
                  ? "View Interview Report"
                  : "Open Interview"}
              </Link>
            )}
            <CreateInterviewDialog applicationId={applicationId} />
          </div>
          <p className="pt-2 text-xs text-slate-500">
            Proctoring
            {latest.proctoringEnabled
              ? latest.proctoringEventCount > 0
                ? " · Signals recorded"
                : " · Enabled"
              : " · Not enabled"}
          </p>
        </div>
      )}
    </section>
  );
}
