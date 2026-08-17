"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AnswerEvaluation, FinalResult } from "@/lib/ai/interview";
import type { PipelineStage } from "@prisma/client";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DraftEmailChip } from "@/components/draft-email-chip";
import { STAGE_TO_CATEGORY } from "@/lib/templates";
import { isAcceptedEnqueue } from "@/lib/staff-async/flag";
import { staffAsyncLabel } from "@/lib/staff-async/label";
import { useStaffAsyncPoll } from "@/lib/staff-async/use-staff-async-poll";

const VERDICT_STYLE: Record<string, string> = {
  VALIDATED: "bg-success/15 text-success",
  PARTIAL: "bg-warning/15 text-warning",
  NOT_VALIDATED: "bg-muted text-foreground/90",
  CONTRADICTED: "bg-destructive/15 text-destructive",
};

const DIM_LABELS: Record<keyof FinalResult["dimensions"], string> = {
  technicalKnowledge: "Technical knowledge",
  problemSolving: "Problem solving",
  communication: "Communication",
  roleKnowledge: "Role knowledge",
  behavioral: "Behavioral",
  confidenceClarity: "Confidence & clarity",
};

type TranscriptRow = {
  sequence: number;
  question: string;
  topic: string | null;
  difficulty: string;
  action: string | null;
  answerText: string | null;
  hasAudio?: boolean;
  evaluation: AnswerEvaluation | null | undefined;
};

export function InterviewReport({
  applicationId,
  candidateId,
  interviewId,
  interviewStatus,
  currentStage,
  transcript,
  overall,
}: {
  applicationId: string;
  candidateId: string;
  interviewId: string;
  interviewStatus: string;
  currentStage: PipelineStage;
  transcript: TranscriptRow[];
  overall: {
    recommendation: string;
    reasoning: string;
    model: string;
    createdAt: string;
    result: FinalResult;
  } | null;
}) {
  return (
    <div className="space-y-8">
      <InterviewTranscript interviewId={interviewId} transcript={transcript} />
      <InterviewAiEvaluation
        interviewId={interviewId}
        interviewStatus={interviewStatus}
        overall={overall}
      />
      <RecruiterDecisionPanel
        applicationId={applicationId}
        candidateId={candidateId}
        currentStage={currentStage}
      />
    </div>
  );
}

export function InterviewAiEvaluation({
  interviewId,
  interviewStatus,
  overall,
  evaluationStatus,
}: {
  interviewId: string;
  interviewStatus: string;
  /**
   * R-3: "no evaluation" used to be one undifferentiated state. It is now
   * pending (still generating — normal, takes a couple of minutes) or failed
   * (the background job gave up after bounded retries).
   */
  evaluationStatus?: {
    state: "not_applicable" | "pending" | "completed" | "failed";
    canRetry: boolean;
    attempts?: number;
    error?: string;
  };
  overall: {
    recommendation: string;
    reasoning: string;
    model: string;
    createdAt: string;
    result: FinalResult;
  } | null;
}) {
  const router = useRouter();
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [pollUrl, setPollUrl] = useState<string | null>(null);
  const result = overall?.result;
  // Fall back to the old "missing" heuristic only when the caller has not
  // supplied a derived status (keeps older call sites rendering sensibly).
  const state =
    evaluationStatus?.state ??
    (result ? "completed" : interviewStatus === "COMPLETED" ? "pending" : "not_applicable");
  const showFailed = !result && state === "failed";
  const showPending = !result && state === "pending";

  const poll = useStaffAsyncPoll({
    url: pollUrl,
    enabled: Boolean(pollUrl),
    onComplete: () => {
      setRegenerating(false);
      setPollUrl(null);
      toast.success("Final evaluation ready");
      router.refresh();
    },
    onFailed: (message) => {
      setRegenerating(false);
      setPollUrl(null);
      toast.error(message);
    },
  });

  async function regenerate() {
    setRegenerating(true);
    const res = await fetch(
      `/api/interviews/${interviewId}/regenerate-evaluation`,
      { method: "POST" },
    );
    const data = await res.json();
    if (!res.ok) {
      setRegenerating(false);
      toast.error(data.error ?? "Regenerate failed");
      return;
    }
    if (isAcceptedEnqueue(String(data.status ?? ""))) {
      setPollUrl(`/api/interviews/${interviewId}/async-status?kind=finalize`);
      return;
    }
    if (!data.evaluation) {
      setRegenerating(false);
      toast.error("Final evaluation was not accepted");
      return;
    }
    setRegenerating(false);
    toast.success("Final evaluation regenerated");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {showFailed ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-foreground">
          <div>
            <p className="text-sm font-medium">
              AI evaluation failed — no score was produced
            </p>
            <p className="text-xs text-muted-foreground">
              {evaluationStatus?.attempts
                ? `Gave up after ${evaluationStatus.attempts} attempts. `
                : null}
              {evaluationStatus?.error ?? "The interview transcript is unaffected."}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={regenerating}
            onClick={regenerate}
          >
            {regenerating
              ? pollUrl
                ? staffAsyncLabel(poll.status ?? "QUEUED")
                : "Retrying…"
              : "Retry evaluation"}
          </Button>
        </div>
      ) : null}

      {showPending ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-foreground">
          <div>
            <p className="text-sm font-medium">Final evaluation is being generated</p>
            <p className="text-xs text-muted-foreground">
              This usually takes a couple of minutes. Refresh to check, or
              generate it now.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={regenerating}
            onClick={regenerate}
          >
            {regenerating
              ? pollUrl
                ? staffAsyncLabel(poll.status ?? "QUEUED")
                : "Generating…"
              : "Generate now"}
          </Button>
        </div>
      ) : null}

      {result ? (
        <section className="space-y-4 rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium text-foreground">
                AI Evaluation
              </h2>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                AI recommendation — recruiter decides
              </p>
              <p className="font-display text-5xl font-semibold text-foreground">
                {Math.round(result.overall)}
                <span className="text-2xl text-muted-foreground">%</span>
              </p>
            </div>
            <Badge className="bg-primary/15 text-foreground">{overall!.recommendation}</Badge>
          </div>

          <div className="space-y-3">
            {(Object.keys(DIM_LABELS) as Array<keyof FinalResult["dimensions"]>).map(
              (key) => (
                <Bar key={key} label={DIM_LABELS[key]} value={result.dimensions[key]} />
              ),
            )}
          </div>

          <List title="Strengths" items={result.strengths} />
          <List title="Weaknesses" items={result.weaknesses} />

          <div>
            <p className="text-sm font-medium text-foreground">Resume validation</p>
            <div className="mt-2 overflow-x-auto rounded-lg border border-border">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Claim</th>
                    <th className="px-3 py-2 font-medium">Verdict</th>
                    <th className="px-3 py-2 font-medium">Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {result.resumeValidation.map((row) => (
                    <tr key={row.claim} className="border-t border-border">
                      <td className="px-3 py-2 text-foreground">{row.claim}</td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            "rounded px-2 py-0.5 text-xs font-medium",
                            VERDICT_STYLE[row.verdict] ?? "bg-muted",
                          )}
                        >
                          {row.verdict}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{row.evidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg bg-muted/40 p-3">
            <button
              type="button"
              className="text-sm font-medium underline"
              onClick={() => setReasoningOpen((v) => !v)}
            >
              {reasoningOpen ? "Hide reasoning" : "Show full reasoning"}
            </button>
            {reasoningOpen ? (
              <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                {overall!.reasoning}
              </p>
            ) : null}
            <p className="mt-2 text-xs text-muted-foreground">
              Model {overall!.model} · {formatDateTime(overall!.createdAt)}
            </p>
          </div>
        </section>
      ) : !showFailed && !showPending ? (
        <p className="text-sm text-muted-foreground">
          Final evaluation not available yet (interview may still be in progress).
        </p>
      ) : null}
    </div>
  );
}

export function InterviewTranscript({
  interviewId,
  transcript,
}: {
  interviewId: string;
  transcript: TranscriptRow[];
}) {
  return (
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Transcript</h2>
        {transcript.map((t) => (
          <article key={t.sequence} className="rounded-xl border border-border p-4">
            <p className="text-xs text-muted-foreground">
              Question {t.sequence}
              {t.topic ? ` · ${t.topic}` : ""}
            </p>
            <p className="mt-2 font-medium text-foreground">{t.question}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/90">
              {t.answerText ?? "(no answer)"}
            </p>
            {t.hasAudio ? (
              <audio
                className="mt-2 w-full max-w-md"
                controls
                preload="none"
                src={`/api/interviews/${interviewId}/audio/${t.sequence}`}
              />
            ) : null}
            {t.evaluation ? (
              <div className="mt-3 rounded-lg bg-muted/40 p-3 text-sm">
                <p className="font-medium">
                  Score {Math.round(t.evaluation.score)} · {t.evaluation.competency}
                </p>
                {t.evaluation.redFlags.length > 0 ? (
                  <p className="mt-1 text-destructive">
                    Red flags: {t.evaluation.redFlags.join("; ")}
                  </p>
                ) : null}
                <p className="mt-1 text-muted-foreground">{t.evaluation.reasoning}</p>
              </div>
            ) : null}
          </article>
        ))}
      </section>
  );
}

export function RecruiterDecisionPanel({
  applicationId,
  candidateId,
  currentStage,
}: {
  applicationId: string;
  candidateId: string;
  currentStage: PipelineStage;
}) {
  const router = useRouter();
  const [moving, setMoving] = useState(false);
  const [draftStage, setDraftStage] = useState<PipelineStage | null>(null);

  async function moveStage(toStage: PipelineStage, note: string) {
    setMoving(true);
    const res = await fetch(`/api/applications/${applicationId}/stage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toStage, note }),
    });
    const data = await res.json();
    setMoving(false);
    if (!res.ok) {
      toast.error(data.error ?? "Stage update failed");
      return;
    }
    toast.success(`Moved to ${toStage} (human decision)`);
    if (STAGE_TO_CATEGORY[toStage]) setDraftStage(toStage);
    router.refresh();
  }

  return (
      <section className="space-y-3 rounded-xl border border-border p-4">
        <h2 className="text-lg font-medium">Recruiter decision</h2>
        <p className="text-sm text-muted-foreground">
          Current stage: <strong>{currentStage}</strong>. AI does not automatically
          change this decision.
        </p>
        {draftStage ? (
          <DraftEmailChip
            key={draftStage}
            stage={draftStage}
            candidateId={candidateId}
            applicationId={applicationId}
          />
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={moving}
            onClick={() =>
              moveStage(
                "SHORTLISTED",
                "Human decision after reviewing AI interview report",
              )
            }
          >
            Shortlist
          </Button>
          <Button
            variant="outline"
            disabled={moving}
            onClick={() =>
              moveStage(
                "TECH_INTERVIEW",
                "Human decision: advance to tech interview after AI interview review",
              )
            }
          >
            Advance to tech interview
          </Button>
          <Button
            variant="destructive"
            disabled={moving}
            onClick={() =>
              moveStage("REJECTED", "Human decision after reviewing AI interview report")
            }
          >
            Reject
          </Button>
        </div>
      </section>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{Math.round(pct)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}
