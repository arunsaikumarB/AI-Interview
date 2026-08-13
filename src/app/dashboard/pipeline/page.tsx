import { PipelineBoard } from "@/components/pipeline-board";
import { RecruitingSubnav } from "@/components/recruiting-subnav";
import { PIPELINE_STAGES } from "@/lib/constants";
import type { PipelineStage } from "@prisma/client";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Jobs & Candidates",
};

export default function PipelinePage({
  searchParams,
}: {
  searchParams?: { stage?: string };
}) {
  const raw = searchParams?.stage;
  const focusStage =
    raw && (PIPELINE_STAGES as readonly string[]).includes(raw)
      ? (raw as PipelineStage)
      : undefined;

  return (
    <div className="space-y-6">
      <RecruitingSubnav />
      <div>
        <h1 className="page-title">Pipeline</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          All open applications across jobs. Drag to move stages — AI never
          auto-advances.
        </p>
        {focusStage === "SCREENING" ? (
          <p className="mt-2 text-sm text-warning">
            Showing Screening — candidates waiting for review.
          </p>
        ) : null}
      </div>
      <PipelineBoard focusStage={focusStage} />
    </div>
  );
}
