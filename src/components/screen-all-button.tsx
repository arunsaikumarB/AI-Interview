"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * Progressive screening UI: loads screenable apps, then calls
 * POST /api/applications/:id/screen one at a time (local GPU).
 */
export function ScreenAllButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  async function onClick() {
    setRunning(true);
    setProgress("Loading applicants…");

    try {
      const listRes = await fetch(`/api/jobs/${jobId}/screenable`);
      const listData = await listRes.json();
      if (!listRes.ok) {
        toast.error(listData.error ?? "Could not load applicants");
        return;
      }

      const apps = (listData.applications ?? []) as {
        id: string;
        candidateName: string;
        hasResumeText: boolean;
      }[];

      const withResume = apps.filter((a) => a.hasResumeText);
      const skipped = apps.length - withResume.length;

      if (withResume.length === 0) {
        toast.message(
          skipped
            ? `Nothing to screen — ${skipped} applicant(s) missing resume text.`
            : "No ACTIVE applicants in APPLIED/SCREENING.",
        );
        return;
      }

      let screened = 0;
      let failed = 0;

      for (let i = 0; i < withResume.length; i++) {
        const app = withResume[i];
        setProgress(`Screening ${i + 1} of ${withResume.length}… ${app.candidateName}`);
        const res = await fetch(`/api/applications/${app.id}/screen`, {
          method: "POST",
        });
        if (res.ok) screened += 1;
        else failed += 1;
      }

      toast.success(
        `Done: ${screened} screened` +
          (failed ? `, ${failed} failed` : "") +
          (skipped ? `, ${skipped} skipped (no resume)` : "") +
          ". Stages unchanged.",
      );
      router.refresh();
    } catch {
      toast.error("Screen-all failed. Is Ollama running?");
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={onClick} disabled={running} variant="outline">
        {running ? progress ?? "Screening…" : "Screen all applicants"}
      </Button>
      {running && progress ? (
        <p className="max-w-xs text-right text-xs text-muted-foreground">{progress}</p>
      ) : (
        <p className="text-xs text-muted-foreground">AI suggestion only — stages unchanged</p>
      )}
    </div>
  );
}
