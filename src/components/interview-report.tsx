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

const VERDICT_STYLE: Record<string, string> = {
  VALIDATED: "bg-emerald-100 text-emerald-800",
  PARTIAL: "bg-amber-100 text-amber-900",
  NOT_VALIDATED: "bg-slate-100 text-slate-700",
  CONTRADICTED: "bg-rose-100 text-rose-800",
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
  const router = useRouter();
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
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

  async function regenerate() {
    setRegenerating(true);
    const res = await fetch(
      `/api/interviews/${interviewId}/regenerate-evaluation`,
      { method: "POST" },
    );
    const data = await res.json();
    setRegenerating(false);
    if (!res.ok) {
      toast.error(data.error ?? "Regenerate failed");
      return;
    }
    toast.success("Final evaluation regenerated");
    router.refresh();
  }

  const result = overall?.result;
  const showMissingBanner = !result && interviewStatus === "COMPLETED";

  return (
    <div className="space-y-8">
      {showMissingBanner ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950">
          <p className="text-sm font-medium">
            Final evaluation missing — regenerate
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={regenerating}
            onClick={regenerate}
          >
            {regenerating ? "Regenerating…" : "Regenerate evaluation"}
          </Button>
        </div>
      ) : null}

      {result ? (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Overall</p>
              <p className="font-display text-5xl font-semibold text-slate-900">
                {Math.round(result.overall)}
                <span className="text-2xl text-slate-400">%</span>
              </p>
            </div>
            <Badge className="bg-slate-900 text-white">{overall!.recommendation}</Badge>
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
            <p className="text-sm font-medium text-slate-900">Resume validation</p>
            <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Claim</th>
                    <th className="px-3 py-2 font-medium">Verdict</th>
                    <th className="px-3 py-2 font-medium">Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {result.resumeValidation.map((row) => (
                    <tr key={row.claim} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-800">{row.claim}</td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            "rounded px-2 py-0.5 text-xs font-medium",
                            VERDICT_STYLE[row.verdict] ?? "bg-slate-100",
                          )}
                        >
                          {row.verdict}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{row.evidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 p-3">
            <button
              type="button"
              className="text-sm font-medium underline"
              onClick={() => setReasoningOpen((v) => !v)}
            >
              {reasoningOpen ? "Hide reasoning" : "Show full reasoning"}
            </button>
            {reasoningOpen ? (
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
                {overall!.reasoning}
              </p>
            ) : null}
            <p className="mt-2 text-xs text-slate-400">
              Model {overall!.model} · {formatDateTime(overall!.createdAt)}
            </p>
          </div>
        </section>
      ) : !showMissingBanner ? (
        <p className="text-sm text-slate-500">
          Final evaluation not available yet (interview may still be in progress).
        </p>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Transcript</h2>
        {transcript.map((t) => (
          <article key={t.sequence} className="rounded-xl border border-slate-200 p-4">
            <p className="text-xs text-slate-400">
              #{t.sequence} · {t.topic ?? "—"} · {t.difficulty}
              {t.action ? ` · ${t.action}` : ""}
            </p>
            <p className="mt-2 font-medium text-slate-900">{t.question}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
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
              <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
                <p className="font-medium">
                  Score {Math.round(t.evaluation.score)} · {t.evaluation.competency}
                </p>
                {t.evaluation.redFlags.length > 0 ? (
                  <p className="mt-1 text-rose-700">
                    Red flags: {t.evaluation.redFlags.join("; ")}
                  </p>
                ) : null}
                <p className="mt-1 text-slate-600">{t.evaluation.reasoning}</p>
              </div>
            ) : null}
          </article>
        ))}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 p-4">
        <h2 className="text-lg font-medium">Recruiter decision</h2>
        <p className="text-sm text-slate-500">
          Current stage: <strong>{currentStage}</strong>. These buttons call the human
          stage-move API — AI never advances the pipeline.
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
    </div>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-slate-600">{label}</span>
        <span className="font-medium">{Math.round(pct)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-slate-800" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-sm font-medium text-slate-900">{title}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-600">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}
