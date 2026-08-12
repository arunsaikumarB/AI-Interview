import type { InterviewStatus, PipelineStage } from "@prisma/client";
import { FinalResultSchema } from "@/lib/ai/interview";
import type { SessionUser } from "@/lib/auth/session";
import { orgScopeWhere } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";

export type MetricValue =
  | { ok: true; value: number }
  | { ok: false };

export type AttentionItem = {
  id: string;
  label: string;
  href: string;
};

export type RecentInterviewRow = {
  id: string;
  candidateName: string;
  roleTitle: string;
  interviewLabel: string;
  /** null → "—"; "pending" → Pending; number → score */
  score: number | "pending" | null;
  statusLabel: "Scheduled" | "In Progress" | "Completed" | "Awaiting Decision";
  href: string;
};

export type DashboardSummary = {
  metrics: {
    candidates: MetricValue;
    activeJobs: MetricValue;
    interviews: MetricValue;
    selected: MetricValue;
  };
  activity: {
    ok: boolean;
    completed: number;
    inProgress: number;
  };
  attention: {
    ok: boolean;
    items: AttentionItem[];
  };
  recent: {
    ok: boolean;
    rows: RecentInterviewRow[];
  };
};

function metricOk(value: number): MetricValue {
  return { ok: true, value };
}

function metricFail(): MetricValue {
  return { ok: false };
}

/** Calendar day bounds in Asia/Kolkata (matches en-IN product locale). */
export function dayBoundsInKolkata(now = new Date()): { start: Date; end: Date } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const day = fmt.format(now); // YYYY-MM-DD
  // Kolkata is UTC+5:30 year-round
  const start = new Date(`${day}T00:00:00+05:30`);
  const end = new Date(`${day}T23:59:59.999+05:30`);
  return { start, end };
}

function interviewOrgWhere(organizationId?: string) {
  return organizationId
    ? { application: { job: { organizationId } } }
    : {};
}

function displayStatus(
  status: InterviewStatus,
  appStage: PipelineStage,
  hasScore: boolean,
): RecentInterviewRow["statusLabel"] {
  if (status === "SCHEDULED") return "Scheduled";
  if (status === "IN_PROGRESS") return "In Progress";
  if (status === "COMPLETED") {
    const decided = appStage === "SELECTED" || appStage === "REJECTED";
    if (!hasScore || !decided) return "Awaiting Decision";
    return "Completed";
  }
  // CANCELLED / NO_SHOW — still listable as Completed-adjacent; treat as Completed label
  return "Completed";
}

function parseOverall(scores: unknown): number | null {
  const parsed = FinalResultSchema.safeParse(scores);
  if (!parsed.success) return null;
  return Math.round(parsed.data.overall);
}

/**
 * Read-only dashboard summary for staff home.
 * Per-section failures return ok:false so one bad query cannot blank the page.
 */
export async function getDashboardSummary(
  user: SessionUser,
): Promise<DashboardSummary> {
  const scope = orgScopeWhere(user);
  const orgId = scope.organizationId;
  const { start: dayStart, end: dayEnd } = dayBoundsInKolkata();

  const candidateWhere = orgId ? { organizationId: orgId } : {};
  const jobWhere = orgId ? { organizationId: orgId } : {};
  const appWhere = orgId ? { job: { organizationId: orgId } } : {};
  const sessionWhere = interviewOrgWhere(orgId);

  const [
    candidates,
    activeJobs,
    liveInterviews,
    selected,
    completedCount,
    inProgressCount,
    screeningCount,
    scheduledToday,
    awaitingDecision,
    recentSessions,
  ] = await Promise.all([
    prisma.candidate.count({ where: candidateWhere }).then(metricOk).catch(metricFail),
    prisma.job
      .count({ where: { ...jobWhere, status: "OPEN" } })
      .then(metricOk)
      .catch(metricFail),
    prisma.interviewSession
      .count({
        where: {
          ...sessionWhere,
          status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        },
      })
      .then(metricOk)
      .catch(metricFail),
    prisma.application
      .count({ where: { ...appWhere, stage: "SELECTED" } })
      .then(metricOk)
      .catch(metricFail),
    prisma.interviewSession
      .count({ where: { ...sessionWhere, status: "COMPLETED" } })
      .then((n) => n)
      .catch(() => null),
    prisma.interviewSession
      .count({ where: { ...sessionWhere, status: "IN_PROGRESS" } })
      .then((n) => n)
      .catch(() => null),
    prisma.application
      .count({ where: { ...appWhere, stage: "SCREENING" } })
      .then((n) => n)
      .catch(() => null),
    prisma.interviewSession
      .count({
        where: {
          ...sessionWhere,
          status: "SCHEDULED",
          OR: [
            { scheduledAt: { gte: dayStart, lte: dayEnd } },
            {
              scheduledAt: null,
              createdAt: { gte: dayStart, lte: dayEnd },
            },
          ],
        },
      })
      .then((n) => n)
      .catch(() => null),
    prisma.interviewSession
      .findMany({
        where: {
          ...sessionWhere,
          status: "COMPLETED",
          application: {
            ...(orgId ? { job: { organizationId: orgId } } : {}),
            stage: { notIn: ["SELECTED", "REJECTED"] },
          },
        },
        select: { id: true },
        take: 50,
        orderBy: { endedAt: "desc" },
      })
      .then((rows) => rows)
      .catch(() => null),
    prisma.interviewSession
      .findMany({
        where: {
          ...sessionWhere,
          status: { in: ["SCHEDULED", "IN_PROGRESS", "COMPLETED"] },
        },
        orderBy: { updatedAt: "desc" },
        take: 8,
        select: {
          id: true,
          status: true,
          interviewType: true,
          application: {
            select: {
              stage: true,
              candidate: { select: { firstName: true, lastName: true } },
              job: { select: { title: true } },
            },
          },
          aiEvaluations: {
            where: { kind: "INTERVIEW_OVERALL" },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { scores: true },
          },
        },
      })
      .then((rows) => rows)
      .catch(() => null),
  ]);

  const activityOk = completedCount != null && inProgressCount != null;
  const attentionOk =
    screeningCount != null &&
    scheduledToday != null &&
    awaitingDecision != null;

  const attentionItems: AttentionItem[] = [];
  if (attentionOk) {
    if (screeningCount > 0) {
      attentionItems.push({
        id: "screening",
        label: `${screeningCount} candidate${screeningCount === 1 ? "" : "s"} waiting for review`,
        href: "/dashboard/pipeline?stage=SCREENING",
      });
    }
    if (scheduledToday > 0) {
      attentionItems.push({
        id: "today",
        label: `${scheduledToday} interview${scheduledToday === 1 ? "" : "s"} scheduled today`,
        href: "/dashboard/interview-links",
      });
    }
    if (awaitingDecision.length > 0) {
      const n = awaitingDecision.length;
      const first = awaitingDecision[0]!;
      attentionItems.push({
        id: "decision",
        label: `${n} completed interview${n === 1 ? "" : "s"} awaiting decision`,
        href:
          n === 1
            ? `/dashboard/interviews/${first.id}`
            : "/dashboard/interview-links?filter=awaiting",
      });
    }
  }

  const recentRows: RecentInterviewRow[] = [];
  if (recentSessions) {
    for (const s of recentSessions) {
      const overall = s.aiEvaluations[0]
        ? parseOverall(s.aiEvaluations[0].scores)
        : null;
      const hasScore = overall != null;
      let score: RecentInterviewRow["score"] = null;
      if (s.status === "COMPLETED") {
        score = hasScore ? overall : "pending";
      }
      const statusLabel = displayStatus(s.status, s.application.stage, hasScore);
      recentRows.push({
        id: s.id,
        candidateName: `${s.application.candidate.firstName} ${s.application.candidate.lastName}`.trim(),
        roleTitle: s.application.job.title,
        interviewLabel: "AI Interview",
        score,
        statusLabel,
        href:
          s.status === "SCHEDULED"
            ? `/dashboard/interviews/${s.id}/plan`
            : `/dashboard/interviews/${s.id}`,
      });
    }
  }

  return {
    metrics: {
      candidates,
      activeJobs,
      interviews: liveInterviews,
      selected,
    },
    activity: {
      ok: activityOk,
      completed: completedCount ?? 0,
      inProgress: inProgressCount ?? 0,
    },
    attention: {
      ok: attentionOk,
      items: attentionItems,
    },
    recent: {
      ok: recentSessions != null,
      rows: recentRows,
    },
  };
}
