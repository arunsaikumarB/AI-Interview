"use client";

import { cn } from "@/lib/utils";
import type { InterviewUiPhase } from "./orb-state";

const ROWS: {
  id: InterviewUiPhase | "READY";
  title: string;
  idleDetail: string;
  activeDetail: string;
  badge: string;
}[] = [
  {
    id: "AI_SPEAKING",
    title: "AI is speaking",
    idleDetail: "Waiting for the next question",
    activeDetail: "Please listen to the question",
    badge: "breathing",
  },
  {
    id: "READY",
    title: "Your turn",
    idleDetail: "Waiting…",
    activeDetail: "Click the mic to answer",
    badge: "Ready",
  },
  {
    id: "CANDIDATE_RECORDING",
    title: "Recording",
    idleDetail: "Mic idle",
    activeDetail: "Your answer is being recorded",
    badge: "Active",
  },
  {
    id: "AI_ANALYZING",
    title: "AI is analyzing",
    idleDetail: "Waiting…",
    activeDetail: "Understanding your response",
    badge: "connecting",
  },
];

function isActive(phase: InterviewUiPhase, rowId: (typeof ROWS)[number]["id"]) {
  if (rowId === "AI_SPEAKING") return phase === "AI_SPEAKING";
  if (rowId === "CANDIDATE_RECORDING") return phase === "CANDIDATE_RECORDING";
  if (rowId === "AI_ANALYZING")
    return phase === "AI_ANALYZING" || phase === "ANSWER_SUBMITTING";
  if (rowId === "READY")
    return phase === "CANDIDATE_READY" || phase === "IDLE";
  return false;
}

export function InterviewStatusRail({
  phase,
  className,
}: {
  phase: InterviewUiPhase;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-white/10 bg-[#0d121c]/90 p-3",
        className,
      )}
      aria-label="Interview status"
    >
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
        Interview status
      </h2>
      <ul className="space-y-2">
        {ROWS.map((row) => {
          const active = isActive(phase, row.id);
          return (
            <li
              key={row.id}
              className={cn(
                "rounded-xl border px-3 py-2.5 transition-colors",
                active
                  ? "border-violet-400/35 bg-violet-500/10"
                  : "border-white/5 bg-white/[0.02]",
              )}
              aria-current={active ? "true" : undefined}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p
                    className={cn(
                      "text-sm font-medium",
                      active ? "text-zinc-50" : "text-zinc-400",
                    )}
                  >
                    {row.title}
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 text-xs",
                      active ? "text-zinc-300" : "text-zinc-600",
                    )}
                  >
                    {active ? row.activeDetail : row.idleDetail}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                    active
                      ? "bg-violet-400/20 text-violet-100"
                      : "bg-white/5 text-zinc-500",
                  )}
                >
                  {active ? row.badge : "—"}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
