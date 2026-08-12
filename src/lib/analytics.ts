import { Prisma, type PipelineStage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PIPELINE_STAGES, STAGE_LABELS } from "@/lib/constants";

const INTERVIEW_STAGES: PipelineStage[] = [
  "ASSESSMENT",
  "AI_INTERVIEW",
  "TECH_INTERVIEW",
  "HR_INTERVIEW",
];

export type AnalyticsPayload = {
  funnel: {
    stages: {
      stage: PipelineStage;
      label: string;
      count: number;
      conversionFromPrev: number | null;
    }[];
    total: number;
  };
  timeMetrics: {
    timeToShortlist: { n: number; medianDays: number | null; avgDays: number | null };
    timeToHire: { n: number; medianDays: number | null; avgDays: number | null };
  };
  perJob: {
    jobId: string;
    title: string;
    applications: number;
    inInterview: number;
    selected: number;
    rejected: number;
  }[];
  scoreDistribution: {
    interviewOverall: { n: number; buckets: { label: string; count: number }[] };
    resumeScreen: { n: number; buckets: { label: string; count: number }[] };
  };
  aiVsHuman: {
    n: number;
    agreementRate: number | null;
    neutralMaybe: number;
    matrix: {
      aiPositiveHumanSelected: number;
      aiPositiveHumanRejected: number;
      aiNegativeHumanSelected: number;
      aiNegativeHumanRejected: number;
    };
    disagreements: {
      applicationId: string;
      interviewId: string | null;
      candidateName: string;
      jobTitle: string;
      aiSide: "positive" | "negative";
      humanSide: "positive" | "negative";
      aiRecommendation: string;
      humanStage: "SELECTED" | "REJECTED";
    }[];
    caption: string;
  };
  provenance: { model: string; count: number }[];
};

const AI_VS_HUMAN_CAPTION =
  "Agreement, not accuracy — the recruiter's decision is ground truth here. Low agreement may mean the AI is miscalibrated OR that recruiters weigh factors the AI doesn't see.";

function emptyBuckets() {
  return Array.from({ length: 10 }, (_, i) => {
    const lo = i * 10;
    const hi = i === 9 ? 100 : i * 10 + 9;
    return { label: i === 9 ? "90–100" : `${lo}–${hi}`, count: 0 };
  });
}

function bucketIndex(score: number): number {
  if (!Number.isFinite(score)) return -1;
  const s = Math.max(0, Math.min(100, score));
  if (s >= 100) return 9;
  return Math.floor(s / 10);
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function roundDays(n: number | null): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

function extractOverall(scores: unknown): number | null {
  if (!scores || typeof scores !== "object") return null;
  const o = (scores as { overall?: unknown }).overall;
  return typeof o === "number" && Number.isFinite(o) ? o : null;
}

function mapAiRec(rec: string): "positive" | "negative" | "neutral" {
  if (rec === "STRONG_YES" || rec === "YES") return "positive";
  if (rec === "NO" || rec === "STRONG_NO") return "negative";
  return "neutral";
}

type OrgScope = { organizationId?: string };

/** Single query layer — read-only aggregations for the analytics dashboard. */
export async function getOrgAnalytics(scope: OrgScope): Promise<AnalyticsPayload> {
  const orgFilter = scope.organizationId
    ? { job: { organizationId: scope.organizationId } }
    : {};

  const jobOrgFilter = scope.organizationId
    ? { organizationId: scope.organizationId }
    : {};

  // 1) Funnel — same org scope as pipeline board (all apps)
  const stageGroups = await prisma.application.groupBy({
    by: ["stage"],
    where: orgFilter,
    _count: { _all: true },
  });
  const countByStage = Object.fromEntries(
    PIPELINE_STAGES.map((s) => [s, 0]),
  ) as Record<PipelineStage, number>;
  for (const g of stageGroups) {
    countByStage[g.stage] = g._count._all;
  }
  const total = Object.values(countByStage).reduce((a, b) => a + b, 0);

  const funnelStages = PIPELINE_STAGES.map((stage, i) => {
    const count = countByStage[stage];
    let conversionFromPrev: number | null = null;
    if (i > 0) {
      const prev = countByStage[PIPELINE_STAGES[i - 1]!];
      if (prev > 0) {
        conversionFromPrev = Math.round((count / prev) * 1000) / 10;
      }
    }
    return {
      stage,
      label: STAGE_LABELS[stage],
      count,
      conversionFromPrev,
    };
  });

  const orgAppIds = (
    await prisma.application.findMany({
      where: orgFilter,
      select: { id: true },
    })
  ).map((a) => a.id);

  let timeToShortlistDays: number[] = [];
  let timeToHireDays: number[] = [];

  if (orgAppIds.length > 0) {
    const rows = await prisma.$queryRaw<{ kind: string; days: number }[]>`
      WITH created AS (
        SELECT "applicationId", MIN("createdAt") AS t0
        FROM "TimelineEvent"
        WHERE type = 'APPLICATION_CREATED'
          AND "applicationId" IN (${Prisma.join(orgAppIds)})
        GROUP BY "applicationId"
      ),
      shortlisted AS (
        SELECT "applicationId", MIN("createdAt") AS t1
        FROM "TimelineEvent"
        WHERE type = 'STAGE_CHANGED'
          AND (payload->>'to') = 'SHORTLISTED'
          AND "applicationId" IN (${Prisma.join(orgAppIds)})
        GROUP BY "applicationId"
      ),
      hired AS (
        SELECT "applicationId", MIN("createdAt") AS t1
        FROM "TimelineEvent"
        WHERE type = 'STAGE_CHANGED'
          AND (payload->>'to') = 'SELECTED'
          AND "applicationId" IN (${Prisma.join(orgAppIds)})
        GROUP BY "applicationId"
      )
      SELECT 'shortlist' AS kind,
             EXTRACT(EPOCH FROM (s.t1 - c.t0)) / 86400.0 AS days
      FROM created c
      INNER JOIN shortlisted s ON s."applicationId" = c."applicationId"
      WHERE s.t1 >= c.t0
      UNION ALL
      SELECT 'hire' AS kind,
             EXTRACT(EPOCH FROM (h.t1 - c.t0)) / 86400.0 AS days
      FROM created c
      INNER JOIN hired h ON h."applicationId" = c."applicationId"
      WHERE h.t1 >= c.t0
    `;

    timeToShortlistDays = rows
      .filter((r) => r.kind === "shortlist")
      .map((r) => Number(r.days))
      .filter((d) => Number.isFinite(d) && d >= 0);
    timeToHireDays = rows
      .filter((r) => r.kind === "hire")
      .map((r) => Number(r.days))
      .filter((d) => Number.isFinite(d) && d >= 0);
  }

  const jobs = await prisma.job.findMany({
    where: jobOrgFilter,
    select: {
      id: true,
      title: true,
      applications: { select: { stage: true } },
    },
  });
  const perJob = jobs
    .map((j) => {
      const apps = j.applications;
      return {
        jobId: j.id,
        title: j.title,
        applications: apps.length,
        inInterview: apps.filter((a) => INTERVIEW_STAGES.includes(a.stage)).length,
        selected: apps.filter((a) => a.stage === "SELECTED").length,
        rejected: apps.filter((a) => a.stage === "REJECTED").length,
      };
    })
    .sort((a, b) => b.applications - a.applications);

  const interviewBuckets = emptyBuckets();
  const resumeBuckets = emptyBuckets();
  let interviewN = 0;
  let resumeN = 0;

  if (orgAppIds.length > 0) {
    const latestScores = await prisma.$queryRaw<{ kind: string; scores: unknown }[]>`
      SELECT DISTINCT ON ("applicationId", kind)
             kind, scores
      FROM "AIEvaluation"
      WHERE "applicationId" IN (${Prisma.join(orgAppIds)})
        AND kind IN ('INTERVIEW_OVERALL', 'RESUME_SCREEN')
      ORDER BY "applicationId", kind, "createdAt" DESC
    `;

    for (const row of latestScores) {
      const overall = extractOverall(row.scores);
      if (overall == null) continue;
      const idx = bucketIndex(overall);
      if (idx < 0) continue;
      if (row.kind === "INTERVIEW_OVERALL") {
        interviewBuckets[idx]!.count += 1;
        interviewN += 1;
      } else if (row.kind === "RESUME_SCREEN") {
        resumeBuckets[idx]!.count += 1;
        resumeN += 1;
      }
    }
  }

  const terminalApps = await prisma.application.findMany({
    where: {
      ...orgFilter,
      stage: { in: ["SELECTED", "REJECTED"] },
    },
    select: {
      id: true,
      stage: true,
      candidate: { select: { firstName: true, lastName: true } },
      job: { select: { title: true } },
      interviewSessions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true },
      },
      aiEvaluations: {
        where: { kind: "INTERVIEW_OVERALL" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { recommendation: true },
      },
    },
  });

  const matrix = {
    aiPositiveHumanSelected: 0,
    aiPositiveHumanRejected: 0,
    aiNegativeHumanSelected: 0,
    aiNegativeHumanRejected: 0,
  };
  let neutralMaybe = 0;
  const disagreements: AnalyticsPayload["aiVsHuman"]["disagreements"] = [];

  for (const app of terminalApps) {
    const evalRec = app.aiEvaluations[0]?.recommendation;
    if (!evalRec) continue;
    const aiSide = mapAiRec(evalRec);
    if (aiSide === "neutral") {
      neutralMaybe += 1;
      continue;
    }
    const humanPositive = app.stage === "SELECTED";
    const humanSide = humanPositive ? "positive" : "negative";

    if (aiSide === "positive" && humanPositive) {
      matrix.aiPositiveHumanSelected += 1;
    } else if (aiSide === "positive" && !humanPositive) {
      matrix.aiPositiveHumanRejected += 1;
      disagreements.push({
        applicationId: app.id,
        interviewId: app.interviewSessions[0]?.id ?? null,
        candidateName: `${app.candidate.firstName} ${app.candidate.lastName}`.trim(),
        jobTitle: app.job.title,
        aiSide,
        humanSide,
        aiRecommendation: evalRec,
        humanStage: app.stage as "SELECTED" | "REJECTED",
      });
    } else if (aiSide === "negative" && humanPositive) {
      matrix.aiNegativeHumanSelected += 1;
      disagreements.push({
        applicationId: app.id,
        interviewId: app.interviewSessions[0]?.id ?? null,
        candidateName: `${app.candidate.firstName} ${app.candidate.lastName}`.trim(),
        jobTitle: app.job.title,
        aiSide,
        humanSide,
        aiRecommendation: evalRec,
        humanStage: app.stage as "SELECTED" | "REJECTED",
      });
    } else {
      matrix.aiNegativeHumanRejected += 1;
    }
  }

  const matrixN =
    matrix.aiPositiveHumanSelected +
    matrix.aiPositiveHumanRejected +
    matrix.aiNegativeHumanSelected +
    matrix.aiNegativeHumanRejected;
  const agree =
    matrix.aiPositiveHumanSelected + matrix.aiNegativeHumanRejected;
  const agreementRate =
    matrixN > 0 ? Math.round((agree / matrixN) * 1000) / 10 : null;

  let provenance: { model: string; count: number }[] = [];
  if (orgAppIds.length > 0) {
    const models = await prisma.aIEvaluation.groupBy({
      by: ["model"],
      where: { applicationId: { in: orgAppIds } },
      _count: { _all: true },
      orderBy: { _count: { model: "desc" } },
    });
    provenance = models.map((m) => ({
      model: m.model || "(unknown)",
      count: m._count._all,
    }));
  }

  return {
    funnel: { stages: funnelStages, total },
    timeMetrics: {
      timeToShortlist: {
        n: timeToShortlistDays.length,
        medianDays: roundDays(median(timeToShortlistDays)),
        avgDays: roundDays(avg(timeToShortlistDays)),
      },
      timeToHire: {
        n: timeToHireDays.length,
        medianDays: roundDays(median(timeToHireDays)),
        avgDays: roundDays(avg(timeToHireDays)),
      },
    },
    perJob,
    scoreDistribution: {
      interviewOverall: { n: interviewN, buckets: interviewBuckets },
      resumeScreen: { n: resumeN, buckets: resumeBuckets },
    },
    aiVsHuman: {
      n: matrixN,
      agreementRate,
      neutralMaybe,
      matrix,
      disagreements,
      caption: AI_VS_HUMAN_CAPTION,
    },
    provenance,
  };
}
