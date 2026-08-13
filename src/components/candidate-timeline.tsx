import { STAGE_LABELS } from "@/lib/constants";
import { formatActivityWhen } from "@/lib/candidate-detail-ui";
import type { PipelineStage } from "@prisma/client";

export type TimelineItem = {
  id: string;
  type: "STAGE" | "AI_SCORE" | "DECISION" | "DOCUMENT";
  at: string | Date;
  title: string;
  detail?: string | null;
  actor?: string | null;
};

const PREVIEW = 6;

export function CandidateTimeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  }

  const preview = items.slice(0, PREVIEW);
  const rest = items.slice(PREVIEW);

  return (
    <div>
      <ol className="relative space-y-3 border-l border-border/70 pl-4">
        {preview.map((item) => (
          <TimelineRow key={item.id} item={item} />
        ))}
      </ol>
      {rest.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-primary hover:underline">
            View all activity
          </summary>
          <ol className="relative mt-3 space-y-3 border-l border-border/70 pl-4">
            {rest.map((item) => (
              <TimelineRow key={item.id} item={item} />
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}

function TimelineRow({ item }: { item: TimelineItem }) {
  return (
    <li className="relative">
      <span className="absolute -left-[1.28rem] mt-1.5 h-2 w-2 rounded-full bg-primary/70" />
      <time className="text-[12px] text-muted-foreground">
        {formatActivityWhen(item.at)}
      </time>
      <p className="text-sm font-medium leading-snug text-foreground">{item.title}</p>
      {item.detail ? (
        <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-muted-foreground">
          {item.detail}
        </p>
      ) : null}
      {item.actor ? (
        <p className="mt-0.5 text-[12px] text-muted-foreground">by {item.actor}</p>
      ) : null}
    </li>
  );
}

export function stageLabel(stage: PipelineStage) {
  return STAGE_LABELS[stage];
}
