"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { PIPELINE_FLOW, STAGE_LABELS, TERMINAL_STAGES } from "@/lib/constants";
import type { PipelineStage } from "@prisma/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { DraftEmailChip } from "@/components/draft-email-chip";
import { ComposeEmailDialog } from "@/components/compose-email-dialog";
import { STAGE_TO_CATEGORY } from "@/lib/templates";

type BoardApp = {
  id: string;
  stage: PipelineStage;
  candidate: { id: string; firstName: string; lastName: string; email: string };
  job: { id: string; title: string; department: { name: string } | null };
  aiEvaluations: { scores: { overall?: number }; recommendation: string }[];
};

type DraftPrompt = {
  applicationId: string;
  candidateId: string;
  stage: PipelineStage;
};

const BOARD_STAGES: PipelineStage[] = [...PIPELINE_FLOW, ...TERMINAL_STAGES];

function matchPct(app: BoardApp): number | null {
  const overall = app.aiEvaluations[0]?.scores?.overall;
  return typeof overall === "number" ? Math.round(overall) : null;
}

function Card({
  app,
  dragging,
  onCompose,
}: {
  app: BoardApp;
  dragging?: boolean;
  onCompose?: (app: BoardApp) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: app.id,
    data: { app },
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  const pct = matchPct(app);
  const name = `${app.candidate.firstName} ${app.candidate.lastName}`;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        "cursor-grab rounded-lg border border-border bg-card p-3 shadow-sm active:cursor-grabbing",
        (isDragging || dragging) && "opacity-40",
      )}
    >
      <Link
        href={`/dashboard/candidates/${app.candidate.id}?applicationId=${app.id}`}
        className="font-medium text-foreground hover:underline"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {name}
      </Link>
      <p className="mt-1 text-xs text-muted-foreground">{app.job.title}</p>
      {pct != null ? (
        <p className="mt-2 text-xs text-muted-foreground">
          AI Match {pct}%
          <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            · advisory
          </span>
        </p>
      ) : null}
      {onCompose ? (
        <button
          type="button"
          className="mt-2 text-[11px] text-muted-foreground underline"
          onClick={(e) => {
            e.stopPropagation();
            onCompose(app);
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          Email…
        </button>
      ) : null}
    </div>
  );
}

function Column({
  stage,
  apps,
  onCompose,
  focused,
  columnRef,
}: {
  stage: PipelineStage;
  apps: BoardApp[];
  onCompose: (app: BoardApp) => void;
  focused?: boolean;
  columnRef?: (el: HTMLDivElement | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });

  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        columnRef?.(el);
      }}
      className={cn(
        "flex w-64 shrink-0 flex-col rounded-xl border border-border bg-muted/30",
        isOver && "ring-2 ring-primary/40",
        focused && "ring-2 ring-primary/50",
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {STAGE_LABELS[stage]}
        </h3>
        <span className="text-xs text-muted-foreground">{apps.length}</span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-2">
        {apps.map((app) => (
          <Card key={app.id} app={app} onCompose={onCompose} />
        ))}
      </div>
    </div>
  );
}

export function PipelineBoard({
  jobId,
  focusStage,
}: {
  jobId?: string;
  focusStage?: PipelineStage;
}) {
  const queryClient = useQueryClient();
  const [active, setActive] = useState<BoardApp | null>(null);
  const [draftPrompt, setDraftPrompt] = useState<DraftPrompt | null>(null);
  const [composeApp, setComposeApp] = useState<BoardApp | null>(null);
  const focusRef = useRef<HTMLDivElement | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const { data, isLoading, error } = useQuery({
    queryKey: ["pipeline-board", jobId ?? "all"],
    queryFn: async () => {
      const qs = jobId ? `?jobId=${jobId}` : "";
      const res = await fetch(`/api/applications/board${qs}`);
      if (!res.ok) throw new Error("Failed to load board");
      return res.json() as Promise<{ columns: Record<PipelineStage, BoardApp[]> }>;
    },
  });

  const move = useMutation({
    mutationFn: async (payload: {
      id: string;
      toStage: PipelineStage;
      candidateId: string;
    }) => {
      const needsNote = payload.toStage === "SELECTED" || payload.toStage === "REJECTED";
      const res = await fetch(`/api/applications/${payload.id}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toStage: payload.toStage,
          note: needsNote
            ? "Moved via pipeline board (human decision)"
            : "Moved via pipeline board",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Stage update failed");
      return { ...json, payload };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["pipeline-board"] });
      toast.success("Stage updated");
      const toStage = result.payload.toStage as PipelineStage;
      if (STAGE_TO_CATEGORY[toStage]) {
        setDraftPrompt({
          applicationId: result.payload.id,
          candidateId: result.payload.candidateId,
          stage: toStage,
        });
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const columns = useMemo(() => data?.columns, [data]);

  useEffect(() => {
    if (focusStage && focusRef.current) {
      focusRef.current.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }, [focusStage, columns]);

  function onDragStart(event: DragStartEvent) {
    setActive((event.active.data.current?.app as BoardApp) ?? null);
  }

  function onDragEnd(event: DragEndEvent) {
    setActive(null);
    const app = event.active.data.current?.app as BoardApp | undefined;
    const overId = event.over?.id;
    if (!app || !overId) return;

    const toStage = String(overId) as PipelineStage;
    if (!BOARD_STAGES.includes(toStage) || toStage === app.stage) return;
    move.mutate({
      id: app.id,
      toStage,
      candidateId: app.candidate.id,
    });
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading pipeline…</p>;
  if (error || !columns) {
    return <p className="text-sm text-destructive">Could not load pipeline board.</p>;
  }

  return (
    <div className="space-y-3">
      {draftPrompt ? (
        <DraftEmailChip
          key={`${draftPrompt.applicationId}-${draftPrompt.stage}`}
          stage={draftPrompt.stage}
          candidateId={draftPrompt.candidateId}
          applicationId={draftPrompt.applicationId}
        />
      ) : null}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div className="flex gap-3 overflow-x-auto pb-4">
          {BOARD_STAGES.map((stage) => (
            <Column
              key={stage}
              stage={stage}
              apps={columns[stage] ?? []}
              onCompose={setComposeApp}
              focused={focusStage === stage}
              columnRef={
                focusStage === stage
                  ? (el) => {
                      focusRef.current = el;
                    }
                  : undefined
              }
            />
          ))}
        </div>
        <DragOverlay>{active ? <Card app={active} dragging /> : null}</DragOverlay>
      </DndContext>
      {composeApp ? (
        <ComposeEmailDialog
          open
          onClose={() => setComposeApp(null)}
          candidateId={composeApp.candidate.id}
          applicationId={composeApp.id}
        />
      ) : null}
    </div>
  );
}
