"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PipelineStage } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { STAGE_LABELS, PIPELINE_FLOW } from "@/lib/constants";
import { stageBadgeClass } from "@/lib/candidate-detail-ui";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function ApplicationStageControls({
  applicationId,
  currentStage,
  decisionNote,
}: {
  applicationId: string;
  currentStage: PipelineStage;
  decisionNote?: string | null;
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
  const canShortlist = currentStage !== "SHORTLISTED" && currentStage !== "SELECTED";

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
    <section id="decision" className="space-y-4">
      <div>
        <h2 className="text-[17px] font-semibold text-foreground">
          Recruiter Decision
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          AI suggestions never automatically change the hiring stage.
        </p>
      </div>

      <div>
        <p className="text-[12px] text-muted-foreground">Current stage</p>
        <p
          className={cn(
            "mt-1 inline-flex rounded-full px-2.5 py-0.5 text-sm font-semibold uppercase tracking-wide",
            stageBadgeClass(currentStage),
          )}
        >
          {STAGE_LABELS[currentStage]}
        </p>
      </div>

      {decisionNote ? (
        <div>
          <p className="text-[12px] text-muted-foreground">Decision note</p>
          <p className="mt-1 text-sm leading-snug text-foreground">
            “{decisionNote}”
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[8rem] flex-1 space-y-1">
          <label className="text-[12px] text-muted-foreground" htmlFor="stage-select">
            Move to stage
          </label>
          <select
            id="stage-select"
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
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
        <label className="text-[12px] text-muted-foreground" htmlFor="decision-note">
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
        {canShortlist ? (
          <Button
            size="sm"
            variant="outline"
            disabled={moving}
            onClick={() => move("SHORTLISTED", "Shortlisted by recruiter")}
          >
            Shortlist
          </Button>
        ) : null}
        {nextStage ? (
          <Button
            size="sm"
            variant="outline"
            disabled={moving}
            onClick={() =>
              move(nextStage, `Advanced to ${STAGE_LABELS[nextStage]}`)
            }
          >
            Advance
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
