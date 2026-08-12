"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PipelineStage } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { STAGE_LABELS, PIPELINE_FLOW } from "@/lib/constants";
import { toast } from "sonner";

export function ApplicationStageControls({
  applicationId,
  currentStage,
}: {
  applicationId: string;
  currentStage: PipelineStage;
}) {
  const router = useRouter();
  const [moving, setMoving] = useState(false);
  const [stage, setStage] = useState<PipelineStage>(currentStage);
  const [note, setNote] = useState("");

  const flowIndex = PIPELINE_FLOW.indexOf(
    currentStage as (typeof PIPELINE_FLOW)[number],
  );
  const nextStage =
    flowIndex >= 0 && flowIndex < PIPELINE_FLOW.length - 1
      ? PIPELINE_FLOW[flowIndex + 1]
      : null;

  async function move(toStage: PipelineStage, rationale?: string) {
    const needsNote = toStage === "SELECTED" || toStage === "REJECTED";
    const bodyNote =
      rationale?.trim() ||
      note.trim() ||
      (needsNote ? "" : "Moved by recruiter from candidate profile");
    if (needsNote && bodyNote.length < 5) {
      toast.error("Select / Reject requires a short note (5+ characters)");
      return;
    }
    setMoving(true);
    const res = await fetch(`/api/applications/${applicationId}/stage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toStage, note: bodyNote }),
    });
    const data = await res.json();
    setMoving(false);
    if (!res.ok) {
      toast.error(data.error ?? "Could not update stage");
      return;
    }
    toast.success(`Moved to ${STAGE_LABELS[toStage]}`);
    setStage(toStage);
    setNote("");
    router.refresh();
  }

  return (
    <section className="space-y-4 rounded-xl border border-slate-900/10 bg-slate-50 p-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900">
          Recruiter Decision
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Current stage:{" "}
          <span className="font-medium text-slate-800">
            {STAGE_LABELS[stage]}
          </span>
          . AI suggestions never change the stage — you do.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label className="text-xs text-slate-500" htmlFor="stage-select">
            Move to stage
          </label>
          <select
            id="stage-select"
            className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
            value={stage}
            onChange={(e) => setStage(e.target.value as PipelineStage)}
          >
            {(Object.keys(STAGE_LABELS) as PipelineStage[]).map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <Button
          size="sm"
          disabled={moving || stage === currentStage}
          onClick={() => move(stage)}
        >
          Move Stage
        </Button>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-slate-500" htmlFor="decision-note">
          Note (required for Select / Reject)
        </label>
        <textarea
          id="decision-note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          placeholder="Short rationale for the decision…"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {nextStage ? (
          <Button
            size="sm"
            variant="outline"
            disabled={moving}
            onClick={() =>
              move(nextStage, `Advanced to ${STAGE_LABELS[nextStage]}`)
            }
          >
            Move to {STAGE_LABELS[nextStage]}
          </Button>
        ) : null}
        <Button
          size="sm"
          disabled={moving}
          onClick={() => move("SELECTED", note || "Selected by recruiter")}
        >
          Select
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={moving}
          onClick={() => move("REJECTED", note || "Rejected by recruiter")}
        >
          Reject
        </Button>
      </div>
    </section>
  );
}
