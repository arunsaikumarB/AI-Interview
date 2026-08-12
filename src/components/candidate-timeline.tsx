import { STAGE_LABELS } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import type { PipelineStage } from "@prisma/client";

export type TimelineItem = {
  id: string;
  type: "STAGE" | "AI_SCORE" | "DECISION" | "DOCUMENT";
  at: string | Date;
  title: string;
  detail?: string | null;
  actor?: string | null;
};

const TYPE_LABEL: Record<TimelineItem["type"], string> = {
  STAGE: "Stage",
  AI_SCORE: "AI (advisory)",
  DECISION: "Decision",
  DOCUMENT: "Document",
};

export function CandidateTimeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-500">No timeline events yet.</p>;
  }

  return (
    <ol className="relative space-y-4 border-l border-slate-200 pl-5">
      {items.map((item) => (
        <li key={item.id} className="relative">
          <span className="absolute -left-[1.4rem] mt-1.5 h-2.5 w-2.5 rounded-full bg-slate-400" />
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-xs uppercase tracking-wide text-slate-400">
              {TYPE_LABEL[item.type]}
            </span>
            <time className="text-xs text-slate-400">
              {formatDateTime(item.at)}
            </time>
          </div>
          <p className="mt-1 text-sm font-medium text-slate-900">{item.title}</p>
          {item.detail ? (
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{item.detail}</p>
          ) : null}
          {item.actor ? <p className="mt-1 text-xs text-slate-400">by {item.actor}</p> : null}
        </li>
      ))}
    </ol>
  );
}

export function stageLabel(stage: PipelineStage) {
  return STAGE_LABELS[stage];
}
