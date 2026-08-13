"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ComposeEmailDialog } from "@/components/compose-email-dialog";
import {
  CATEGORY_LABELS,
  STAGE_TO_CATEGORY,
  type TemplateCategory,
} from "@/lib/templates";
import type { PipelineStage } from "@prisma/client";

/**
 * One-click "Draft email" after a stage move — UI only, never auto-sends.
 */
export function DraftEmailChip({
  stage,
  candidateId,
  applicationId,
}: {
  stage: PipelineStage | string;
  candidateId: string;
  applicationId: string;
}) {
  const category = STAGE_TO_CATEGORY[stage] as TemplateCategory | undefined;
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);

  if (!category || dismissed) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-sm">
        <span className="text-muted-foreground">
          Draft {CATEGORY_LABELS[category]} email?
        </span>
        <Button size="sm" onClick={() => setOpen(true)}>
          Draft email
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
          Dismiss
        </Button>
      </div>
      <ComposeEmailDialog
        open={open}
        onClose={() => setOpen(false)}
        candidateId={candidateId}
        applicationId={applicationId}
        category={category}
      />
    </>
  );
}
