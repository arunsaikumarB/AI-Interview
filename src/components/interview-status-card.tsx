"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { CreateInterviewDialog } from "@/components/create-interview-dialog";
import { buttonVariants } from "@/components/ui/button";
import {
  interviewDurationLabel,
  interviewHumanStatus,
  interviewTypeLabel,
} from "@/lib/candidate-detail-ui";
import { recordingStatusLabel } from "@/lib/secondary-recording-labels";
import { cn } from "@/lib/utils";

export type InterviewSummary = {
  id: string;
  status: string;
  interviewType: string;
  overallScore: number | null;
  recommendation: string | null;
  proctoringEnabled: boolean;
  proctoringEventCount: number;
  tokenExpiresAt?: string | Date | null;
  startedAt?: string | Date | null;
  endedAt?: string | Date | null;
  secondaryRecordingStatus?: string | null;
  secondaryRecordingPath?: string | null;
  tabSwitches?: number;
  copyPaste?: number;
  cameraInterruptions?: number;
};

export type InterviewStatusApplication = {
  id: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  jobId: string;
  jobTitle: string;
};

function statusDotClass(label: string): string {
  if (label === "Completed") return "bg-success";
  if (label === "In progress" || label === "Scheduled") return "bg-primary";
  if (label === "Expired" || label === "Cancelled" || label === "Ended") {
    return "bg-destructive";
  }
  return "bg-muted-foreground";
}

export function InterviewStatusCard({
  application,
  latest,
}: {
  application: InterviewStatusApplication;
  latest: InterviewSummary | null;
}) {
  const apps = [application];
  const human = latest
    ? interviewHumanStatus({
        status: latest.status,
        tokenExpiresAt: latest.tokenExpiresAt,
      })
    : "Not started";
  const duration = latest
    ? interviewDurationLabel(latest.startedAt, latest.endedAt)
    : null;
  const expired = human === "Expired";
  const completed = latest?.status === "COMPLETED";
  const inFlight =
    latest &&
    (latest.status === "SCHEDULED" || latest.status === "IN_PROGRESS") &&
    !expired;
  const canCreateAnother = !latest || expired || completed || !inFlight;
  const showCreate = !latest || canCreateAnother;
  const showOpen = Boolean(latest);
  const recordingLabel =
    latest?.proctoringEnabled &&
    (latest.secondaryRecordingStatus || latest.secondaryRecordingPath)
      ? recordingStatusLabel(
          latest.secondaryRecordingStatus ?? "NONE",
          Boolean(latest.secondaryRecordingPath),
        )
      : latest?.proctoringEnabled
        ? "Enabled"
        : "—";

  const recordingReady =
    recordingLabel === "Recording available" && Boolean(latest?.id);

  return (
    <section id="interview" className="space-y-4">
      <div>
        <h2 className="text-[17px] font-semibold text-foreground">Interview</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">AI Interview</p>
      </div>

      {!latest ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Interview not started.</p>
          <CreateInterviewDialog
            applications={apps}
            triggerLabel="Create Interview Link"
            preselectedApplicationId={application.id}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <dl className="space-y-2.5 text-sm">
            <Metric
              label="Status"
              value={
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={cn("h-2 w-2 rounded-full", statusDotClass(human))}
                    aria-hidden
                  />
                  {human}
                </span>
              }
            />
            <Metric label="Duration" value={duration ?? "—"} />
            <Metric label="Interview type" value={interviewTypeLabel(latest.interviewType)} />
            <Metric
              label="AI evaluation"
              value={
                completed && latest.overallScore != null
                  ? `${latest.overallScore} / 100`
                  : completed
                    ? "Available"
                    : "—"
              }
            />
            <Metric
              label="Proctoring"
              value={
                latest.proctoringEnabled
                  ? latest.proctoringEventCount > 0
                    ? "Signals recorded"
                    : "Enabled"
                  : "—"
              }
            />
            <Metric label="Secondary camera" value={recordingLabel} />
          </dl>

          {latest.proctoringEnabled ? (
            <div>
              <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
                Integrity signals
              </p>
              <p className="mt-1 text-sm text-foreground">
                {latest.tabSwitches ?? 0} tab switches
              </p>
              <p className="text-sm text-foreground">
                {latest.copyPaste ?? 0} copy/paste events
              </p>
              <p className="text-sm text-foreground">
                {latest.cameraInterruptions ?? 0} camera interruption
                {(latest.cameraInterruptions ?? 0) === 1 ? "" : "s"}
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Signals for human review.
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {showOpen ? (
              <Link
                href={
                  latest.status === "SCHEDULED"
                    ? `/dashboard/interviews/${latest.id}/plan`
                    : `/dashboard/interviews/${latest.id}`
                }
                className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
              >
                {completed
                  ? "View Interview Report"
                  : inFlight
                    ? "Open Interview"
                    : "Review Interview"}
              </Link>
            ) : null}
            {recordingReady ? (
              <Link
                href={`/dashboard/interviews/${latest.id}`}
                className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
              >
                Review Recording
              </Link>
            ) : null}
            {showCreate && !inFlight ? (
              <CreateInterviewDialog
                applications={apps}
                triggerLabel="Create Interview Link"
                preselectedApplicationId={application.id}
              />
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div>
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}
