import type { PipelineStage } from "@prisma/client";
import { PIPELINE_FLOW, STAGE_LABELS } from "@/lib/constants";
import { recruiterRecordingState } from "@/lib/secondary-recording-labels";

/** Stored experience of 0 / missing is not reliable — never display "0 years". */
export function formatExperienceYears(years: number | null | undefined): string | null {
  if (years == null || Number.isNaN(Number(years)) || Number(years) <= 0) {
    return null;
  }
  const n = Number(years);
  const label = Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
  return `${label} year${n === 1 ? "" : "s"}`;
}

export function experienceProfileLabel(years: number | null | undefined): string {
  return formatExperienceYears(years) ?? "Experience not available";
}

export function experienceSnapshotLabel(years: number | null | undefined): string {
  return formatExperienceYears(years) ?? "—";
}

export function resumeFileName(resumeUrl: string | null | undefined): string {
  if (!resumeUrl) return "Resume";
  const base = resumeUrl.replace(/\\/g, "/").split("/").pop() ?? "Resume";
  const stripped = base.replace(/^\d+-[a-f0-9]+-/i, "");
  return stripped || base;
}

export function interviewHumanStatus(params: {
  status: string;
  tokenExpiresAt?: Date | string | null;
}): string {
  const { status, tokenExpiresAt } = params;
  if (status === "SCHEDULED" && tokenExpiresAt) {
    const exp = tokenExpiresAt instanceof Date ? tokenExpiresAt : new Date(tokenExpiresAt);
    if (!Number.isNaN(exp.getTime()) && exp.getTime() < Date.now()) {
      return "Expired";
    }
  }
  switch (status) {
    case "SCHEDULED":
      return "Scheduled";
    case "IN_PROGRESS":
      return "In progress";
    case "COMPLETED":
      return "Completed";
    case "CANCELLED":
      return "Cancelled";
    case "NO_SHOW":
      return "No show";
    case "TERMINATED":
      return "Ended";
    default:
      return status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  }
}

export function interviewTypeLabel(type: string | null | undefined): string {
  if (!type) return "—";
  const map: Record<string, string> = {
    TECHNICAL: "Technical",
    HR: "HR",
    BEHAVIORAL: "Behavioral",
    MANAGERIAL: "Managerial",
    FULLSTACK: "Full-stack",
    DATA_AI: "Data / AI",
    CUSTOM: "Custom",
  };
  return map[type] ?? type.replace(/_/g, " ");
}

export function interviewDurationLabel(
  startedAt: Date | string | null | undefined,
  endedAt: Date | string | null | undefined,
): string | null {
  if (!startedAt || !endedAt) return null;
  const start = startedAt instanceof Date ? startedAt : new Date(startedAt);
  const end = endedAt instanceof Date ? endedAt : new Date(endedAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const mins = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
  return `${mins} min`;
}

export function recommendationLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const map: Record<string, string> = {
    STRONG_YES: "Strong yes",
    YES: "Yes",
    MAYBE: "Maybe",
    NO: "No",
    STRONG_NO: "Strong no",
    SHORTLIST: "Yes",
    REVIEW: "Maybe",
    REJECT: "No",
  };
  return map[raw] ?? raw.replace(/_/g, " ");
}

export function matchSignalLabel(score: number): string {
  if (score >= 75) return "Strong";
  if (score >= 50) return "Moderate";
  return "Weak";
}

export function stageBadgeClass(stage: PipelineStage): string {
  if (stage === "REJECTED") return "bg-destructive/15 text-destructive";
  if (stage === "SELECTED") return "bg-success/15 text-success";
  if (stage === "SCREENING" || stage === "ASSESSMENT") {
    return "bg-warning/15 text-warning";
  }
  if (
    stage === "AI_INTERVIEW" ||
    stage === "TECH_INTERVIEW" ||
    stage === "HR_INTERVIEW"
  ) {
    return "bg-primary/15 text-primary";
  }
  return "bg-muted text-muted-foreground";
}

export function formatEducationEntries(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const out: string[] = [];
  for (const item of raw.slice(0, 4)) {
    if (typeof item === "string" && item.trim()) {
      out.push(item.trim());
      continue;
    }
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const parts = [o.degree, o.field, o.school, o.institution, o.university, o.name]
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((s) => s.trim());
      if (parts.length) out.push(Array.from(new Set(parts)).join(" · "));
    }
  }
  return out;
}

export function formatActivityWhen(at: Date | string): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  const yesterday =
    d.getFullYear() === yest.getFullYear() &&
    d.getMonth() === yest.getMonth() &&
    d.getDate() === yest.getDate();
  const time = new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  if (sameDay) return `Today · ${time}`;
  if (yesterday) return `Yesterday · ${time}`;
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

export function humanTimelineTitle(type: string, payload: unknown): string {
  if (type === "STAGE_CHANGED" && payload && typeof payload === "object") {
    const p = payload as { to?: string; from?: string };
    if (p.to && p.to in STAGE_LABELS) {
      return `Moved to ${STAGE_LABELS[p.to as keyof typeof STAGE_LABELS]}`;
    }
    return "Stage updated";
  }
  if (type === "DECISION") return "Recruiter decision recorded";
  switch (type) {
    case "APPLICATION_CREATED":
      return "Application received";
    case "SCREENING_COMPLETED":
      return "AI screening completed";
    case "INTERVIEW_SCHEDULED":
      return "Interview scheduled";
    case "INTERVIEW_STARTED":
      return "Interview started";
    case "INTERVIEW_COMPLETED":
      return "Interview completed";
    case "AI_EVALUATION":
      return "AI evaluation recorded";
    case "DOCUMENT_UPLOADED":
      return "Resume uploaded";
    case "EMAIL_SENT":
      return "Email sent";
    case "NOTE_ADDED":
      return "Note added";
    case "STATUS_CHANGED":
      return "Application status updated";
    case "PROCTORING_SIGNAL":
      return "Integrity signal recorded";
    case "TAG_ADDED":
      return "Tag added";
    case "TAG_REMOVED":
      return "Tag removed";
    case "OTHER":
      return "Update recorded";
    default:
      return "Update recorded";
  }
}

export function lastDecisionNote(events: { type: string; payload: unknown }[]): string | null {
  for (const event of events) {
    if (event.type !== "STAGE_CHANGED" && event.type !== "DECISION") continue;
    if (!event.payload || typeof event.payload !== "object") continue;
    const note = (event.payload as { note?: unknown }).note;
    if (typeof note === "string" && note.trim().length > 0) return note.trim();
  }
  return null;
}

export function resumeUploadedAt(
  events: { type: string; createdAt: Date }[],
): Date | null {
  const ev = events.find((e) => e.type === "DOCUMENT_UPLOADED");
  return ev?.createdAt ?? null;
}

export function resumeUploadedName(
  events: { type: string; payload: unknown }[],
): string | null {
  const ev = events.find((e) => e.type === "DOCUMENT_UPLOADED");
  if (!ev?.payload || typeof ev.payload !== "object") return null;
  const name = (ev.payload as { fileName?: unknown }).fileName;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

export type AttentionItem = {
  id: string;
  label: string;
  href?: string;
};

export function buildAttentionItems(params: {
  interviewStatus: string | null;
  interviewId: string | null;
  screeningExists: boolean;
  screeningAction: string | null;
  stage: PipelineStage | null;
  resumeUrl: string | null;
  resumeText: string | null;
  secondaryRecordingAvailable: boolean;
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (params.interviewStatus === "COMPLETED" && params.interviewId) {
    items.push({
      id: "interview-report",
      label: "Interview completed — report available",
      href: `/dashboard/interviews/${params.interviewId}`,
    });
  }
  if (params.secondaryRecordingAvailable && params.interviewId) {
    items.push({
      id: "secondary",
      label: "Secondary camera recording available",
      href: `/dashboard/interviews/${params.interviewId}`,
    });
  }
  if (!params.screeningExists && params.stage === "SCREENING") {
    items.push({
      id: "screen-needed",
      label: "AI screening requires recruiter review",
      href: "#screening",
    });
  } else if (params.screeningAction === "REVIEW") {
    items.push({
      id: "screen-review",
      label: "AI screening requires recruiter review",
      href: "#screening",
    });
  }
  if (params.resumeUrl && !params.resumeText) {
    items.push({
      id: "resume-parse",
      label: "Resume parsing needs review",
      href: "#resume",
    });
  }
  return items;
}

export function pipelineSteps(current: PipelineStage): PipelineStage[] {
  if (current === "REJECTED" || current === "SELECTED") {
    return [...PIPELINE_FLOW, current];
  }
  return [...PIPELINE_FLOW];
}

export function pipelineStepState(
  step: PipelineStage,
  current: PipelineStage,
): "past" | "current" | "future" {
  if (step === current) return "current";
  if (current === "REJECTED" || current === "SELECTED") {
    return PIPELINE_FLOW.includes(step as (typeof PIPELINE_FLOW)[number])
      ? "past"
      : "future";
  }
  const currentIndex = PIPELINE_FLOW.indexOf(
    current as (typeof PIPELINE_FLOW)[number],
  );
  const stepIndex = PIPELINE_FLOW.indexOf(step as (typeof PIPELINE_FLOW)[number]);
  if (currentIndex < 0 || stepIndex < 0) return "future";
  return stepIndex < currentIndex ? "past" : "future";
}

export function countProctoringSignals(
  events: { type: string; meta?: unknown }[],
): { tabSwitches: number; copyPaste: number; cameraInterruptions: number } {
  let tabSwitches = 0;
  let copyPaste = 0;
  let cameraInterruptions = 0;
  for (const e of events) {
    if (e.type === "TAB_BLUR") tabSwitches += 1;
    if (e.type === "WINDOW_SWITCH") {
      const meta = e.meta && typeof e.meta === "object" ? (e.meta as { kind?: unknown }) : null;
      if (meta?.kind === "blur") tabSwitches += 1;
    }
    if (e.type === "COPY_PASTE") copyPaste += 1;
    if (
      e.type === "SECONDARY_CAMERA_DISCONNECTED" ||
      e.type === "SECONDARY_CAMERA_MOVED"
    ) {
      cameraInterruptions += 1;
    }
  }
  return { tabSwitches, copyPaste, cameraInterruptions };
}

export function proctoringSnapshotLabel(params: {
  enabled: boolean;
  eventCount: number;
}): string {
  if (!params.enabled) return "—";
  if (params.eventCount > 0) return "Signals recorded";
  return "Enabled";
}

export function secondaryCameraAvailable(status: string | null | undefined, path: string | null | undefined): boolean {
  return recruiterRecordingState(status ?? "NONE", Boolean(path)) === "READY";
}
