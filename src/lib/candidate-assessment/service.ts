import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { orgScopeWhere } from "@/lib/auth/rbac";
import type { SessionUser } from "@/lib/auth/session";
import { familyLabel } from "@/lib/assessment/taxonomy";
import { loadBlueprintSources } from "@/lib/assessment/load";
import { AssessmentEngineService } from "@/lib/assessment/service";
import type { AssessmentBlueprint, CandidateInput } from "@/lib/assessment/types";
import { generateAiAssistedBlueprint, timelineAuditSink, type TimelineWriter } from "@/lib/assessment/ai-service";
import type { AiChatFn } from "@/lib/assessment/ai-generator";
import { selectPracticalTask } from "@/lib/practical/select";
import { getPracticalTask } from "@/lib/practical/tasks";
import { listPracticalAssessments } from "@/lib/practical/service";
import {
  ACCESS_TOKEN_RE,
  derivePracticalToken,
  hashAccessToken,
  isDerivedPracticalHash,
  newAccessToken,
} from "@/lib/practical/token";
import { buildEvidence, matchBlueprintQuestion, practicalResultView, type CompetencyEvidence, type PracticalResultView } from "./evidence";
import {
  buildInterviewBlock,
  interviewQuestionBudget,
  planFromInterviewBlock,
  readInterviewBlock,
  type AssessmentInterviewBlock,
} from "./interview-block";
import {
  buildComponents,
  completionSignature,
  overallState,
  progressOf,
  type ComponentKey,
  type ComponentState,
  type ComponentStatus,
  type OverallState,
} from "./status";

/**
 * V3.1 candidate assessment = the application's existing InterviewSession +
 * PracticalAssessment rows, organised around the V1 blueprint. Evidence only:
 * nothing here changes a stage, creates an AIEvaluation, scores a candidate,
 * reads proctoring or calls an LLM (except the V2 question wording upgrade).
 */

export const HUB_LINK_VALID_DAYS = 14;
export const ASSESSMENT_NOTE = "Objective assessment evidence only. Not a hiring recommendation.";

export type AssessmentErrorCode = "NOT_FOUND" | "LINK_EXPIRED" | "NO_QUESTIONS" | "ALREADY_ACTIVE";

export class AssessmentError extends Error {
  constructor(
    readonly code: AssessmentErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AssessmentError";
  }
}

const notFound = () => new AssessmentError("NOT_FOUND", 404, "Assessment not found");

// -----------------------------------------------------------------------------
// Audit (TimelineEvent OTHER — advisory, never AI_EVALUATION)
// -----------------------------------------------------------------------------

export type AssessmentAuditKind = "assessment_link_issued" | "assessment_link_revoked" | "assessment_completed";

export function assessmentAuditPayload(
  kind: AssessmentAuditKind,
  fields: Record<string, Prisma.InputJsonValue | null>,
): Prisma.InputJsonObject {
  return {
    ...fields,
    kind,
    advisoryOnly: true,
    noAtsStageChange: true,
    noAiInput: true,
    evidenceOnly: true,
  };
}

// -----------------------------------------------------------------------------
// Loading
// -----------------------------------------------------------------------------

const contextSelect = {
  id: true,
  jobId: true,
  candidate: { select: { id: true, firstName: true, lastName: true, updatedAt: true } },
  job: { select: { id: true, title: true, organization: { select: { name: true, companyName: true } } } },
  interviewSessions: {
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      status: true,
      accessToken: true,
      tokenExpiresAt: true,
      durationMinutes: true,
      createdAt: true,
      startedAt: true,
      endedAt: true,
      plan: true,
    },
  },
  practicalAssessments: {
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      type: true,
      taskKey: true,
      taskVersion: true,
      competency: true,
      difficulty: true,
      status: true,
      provenance: true,
      accessTokenHash: true,
      tokenExpiresAt: true,
      timeLimitMinutes: true,
      createdAt: true,
      startedAt: true,
      submittedAt: true,
      completedAt: true,
      submission: {
        select: { id: true, language: true, execStatus: true, submittedAt: true, executedAt: true, result: true },
      },
    },
  },
  assessmentLink: { select: { tokenExpiresAt: true, revokedAt: true, createdAt: true, updatedAt: true } },
} satisfies Prisma.ApplicationSelect;

type Context = Prisma.ApplicationGetPayload<{ select: typeof contextSelect }>;
type InterviewRow = Context["interviewSessions"][number];
type PracticalRow = Context["practicalAssessments"][number];

function runtimeMatches(provenance: unknown): boolean {
  return Boolean(
    provenance && typeof provenance === "object" && (provenance as { runtimeMatchesRecommendation?: unknown }).runtimeMatchesRecommendation === true,
  );
}

function componentsFor(ctx: Context, now: Date): ComponentStatus[] {
  return buildComponents({
    interviews: ctx.interviewSessions.map((s) => ({
      id: s.id,
      status: s.status,
      tokenExpiresAt: s.tokenExpiresAt,
      createdAt: s.createdAt,
      blueprintLinked: readInterviewBlock(s.plan) !== null,
    })),
    practicals: ctx.practicalAssessments.map((p) => ({
      id: p.id,
      type: p.type,
      status: p.status,
      tokenExpiresAt: p.tokenExpiresAt,
      createdAt: p.createdAt,
      hasSubmission: Boolean(p.submission),
      runtimeMatchesRecommendation: runtimeMatches(p.provenance),
    })),
    now,
  });
}

/** Writes "assessment_completed" once per component set. Serialised per application. */
export async function recordCompletionIfNeeded(applicationId: string, components: ComponentStatus[]): Promise<void> {
  if (overallState(components) !== "COMPLETED") return;
  const signature = completionSignature(components);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`assessment-completed:${applicationId}`}))`;
    const existing = await tx.timelineEvent.findFirst({
      where: {
        applicationId,
        type: "OTHER",
        AND: [
          { payload: { path: ["kind"], equals: "assessment_completed" } },
          { payload: { path: ["signature"], equals: signature } },
        ],
      },
      select: { id: true },
    });
    if (existing) return;
    await tx.timelineEvent.create({
      data: {
        applicationId,
        type: "OTHER",
        payload: assessmentAuditPayload("assessment_completed", {
          signature,
          components: components
            .filter((c) => c.state !== "NOT_ASSIGNED")
            .map((c) => ({ key: c.key, sourceId: c.sourceId, state: c.state, required: c.required })),
        }),
      },
    });
  });
}

// -----------------------------------------------------------------------------
// Staff view
// -----------------------------------------------------------------------------

export type StaffInterviewQuestion = {
  id: string;
  sequence: number;
  question: string;
  competency: string | null;
  action: string | null;
  blueprint: {
    id: string;
    type: string;
    stageTitle: string;
    difficulty: number;
    source: string;
    expectedEvidence: string[];
    rubric: { name: string; weight: number }[];
    generationMode: "AI_GENERATED" | "DETERMINISTIC_FALLBACK";
  } | null;
  answer: { text: string; answeredAt: string } | null;
};

export type StaffPracticalView = {
  id: string;
  type: "CODING" | "SQL";
  title: string;
  taskKey: string;
  taskVersion: number;
  competency: string;
  difficulty: string;
  required: boolean;
  status: string;
  state: ComponentState;
  submittedAt: string | null;
  executedAt: string | null;
  language: string | null;
  result: PracticalResultView | null;
};

export type StaffComponentView = ComponentStatus & {
  label: string;
  competencies: string[];
};

export type StaffAssessment = {
  application: { id: string; candidateName: string; jobTitle: string };
  blueprint: {
    engineVersion: string;
    generatedAt: string;
    roleFamily: string;
    roleLabel: string;
    seniority: string;
    competencies: { id: string; name: string; category: string; source: string; importance: string }[];
    recommendedPractical: { type: string; title: string; competency: string };
  };
  components: StaffComponentView[];
  overall: OverallState;
  progress: ReturnType<typeof progressOf>;
  interview: {
    sessionId: string;
    status: string;
    blueprintLinked: boolean;
    generation: AssessmentInterviewBlock["generation"] | null;
    questions: StaffInterviewQuestion[];
    notAsked: { id: string; competency: string; text: string; generationMode: string }[];
  } | null;
  practicals: StaffPracticalView[];
  evidence: CompetencyEvidence[];
  hubLink: { status: "ACTIVE" | "EXPIRED" | "REVOKED"; issuedAt: string; expiresAt: string } | null;
  capabilities: {
    createInterview: { allowed: boolean; reason: string | null };
    assignCoding: PracticalCapability;
    assignSql: PracticalCapability;
  };
  note: string;
};

export type PracticalCapability = {
  allowed: boolean;
  reason: string | null;
  competency: string | null;
  requiredWhenAssigned: boolean;
};

const LABELS: Record<ComponentKey, string> = {
  AI_INTERVIEW: "AI Interview",
  CODING: "Coding Assessment",
  SQL: "SQL Assessment",
};

async function loadScoped(user: SessionUser, applicationId: string): Promise<Context | null> {
  return prisma.application.findFirst({
    where: { id: applicationId, job: orgScopeWhere(user) },
    select: contextSelect,
  });
}

function practicalCapability(
  blueprint: AssessmentBlueprint,
  type: "CODING" | "SQL",
  rows: PracticalRow[],
): PracticalCapability {
  const selection = selectPracticalTask(blueprint, type);
  const competency = selection.ok ? selection.competency : null;
  const requiredWhenAssigned = selection.ok ? selection.provenance.runtimeMatchesRecommendation : false;
  if (rows.some((p) => p.type === type && ["NOT_STARTED", "STARTED", "IN_PROGRESS", "SUBMITTED", "EXECUTING"].includes(p.status))) {
    return { allowed: false, reason: "Already assigned and open", competency, requiredWhenAssigned };
  }
  if (!selection.ok) {
    return {
      allowed: false,
      reason:
        selection.reason === "NO_MATCHING_COMPETENCY"
          ? `The blueprint has no competency a ${type === "SQL" ? "SQL" : "coding"} task can evidence`
          : "No practical task is available for this blueprint",
      competency: null,
      requiredWhenAssigned,
    };
  }
  return { allowed: true, reason: null, competency, requiredWhenAssigned };
}

export async function getStaffAssessment(user: SessionUser, applicationId: string, now = new Date()): Promise<StaffAssessment> {
  const scoped = await prisma.application.findFirst({
    where: { id: applicationId, job: orgScopeWhere(user) },
    select: { id: true, jobId: true },
  });
  if (!scoped) throw notFound();
  // Existing V3 stale-execution recovery, so a crashed run is shown honestly.
  await listPracticalAssessments(user, scoped.id, now);
  const ctx = await loadScoped(user, scoped.id);
  if (!ctx) throw notFound();

  const sources = await loadBlueprintSources(user, ctx.jobId, ctx.id);
  if (sources.kind !== "OK") throw notFound();
  const blueprint = AssessmentEngineService.buildBlueprint({ job: sources.job, candidate: sources.candidate, now });

  const components = componentsFor(ctx, now);
  const interviewId = components.find((c) => c.key === "AI_INTERVIEW")?.sourceId ?? null;
  const interviewRow = interviewId ? ctx.interviewSessions.find((s) => s.id === interviewId) ?? null : null;
  const block = interviewRow ? readInterviewBlock(interviewRow.plan) : null;

  const questions = interviewRow
    ? await prisma.interviewQuestion.findMany({
        where: { sessionId: interviewRow.id },
        orderBy: { sequence: "asc" },
        take: 60,
        select: {
          id: true,
          sequence: true,
          question: true,
          topic: true,
          competency: true,
          difficulty: true,
          action: true,
          answer: { select: { answerText: true, answeredAt: true } },
        },
      })
    : [];

  const shownPracticalIds = new Set(components.filter((c) => c.key !== "AI_INTERVIEW" && c.sourceId).map((c) => c.sourceId!));
  const practicalRows = ctx.practicalAssessments.filter((p) => shownPracticalIds.has(p.id));
  const practicals: StaffPracticalView[] = practicalRows.map((p) => {
    const comp = components.find((c) => c.sourceId === p.id)!;
    return {
      id: p.id,
      type: p.type,
      title: getPracticalTask(p.taskKey, p.taskVersion)?.title ?? p.taskKey,
      taskKey: p.taskKey,
      taskVersion: p.taskVersion,
      competency: p.competency,
      difficulty: p.difficulty,
      required: comp.required,
      status: p.status,
      state: comp.state,
      submittedAt: p.submission?.submittedAt.toISOString() ?? null,
      executedAt: p.submission?.executedAt?.toISOString() ?? null,
      language: p.submission?.language ?? null,
      result: p.submission?.result ? practicalResultView(p.submission.result) : null,
    };
  });

  const evidence = buildEvidence({
    competencies: blueprint.competencies.map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      source: c.source,
      importance: c.importance,
    })),
    resume: {
      candidateId: ctx.candidate.id,
      at: ctx.candidate.updatedAt,
      byCompetency: blueprint.resume.byCompetency.map((r) => ({
        competencyId: r.competencyId,
        strength: r.strength,
        quotes: r.evidence.map((e) => e.quote),
      })),
    },
    interview: interviewRow
      ? {
          sessionId: interviewRow.id,
          block,
          questions: questions.map((q) => ({
            id: q.id,
            sequence: q.sequence,
            question: q.question,
            topic: q.topic,
            competency: q.competency,
            difficulty: q.difficulty,
            action: q.action,
            answer: q.answer ? { answeredAt: q.answer.answeredAt, text: q.answer.answerText } : null,
          })),
        }
      : null,
    practicals: practicalRows.map((p) => ({
      id: p.id,
      type: p.type,
      title: getPracticalTask(p.taskKey, p.taskVersion)?.title ?? p.taskKey,
      taskKey: p.taskKey,
      taskVersion: p.taskVersion,
      competency: p.competency,
      status: p.status,
      required: runtimeMatches(p.provenance),
      submission: p.submission,
    })),
  });

  const askedTexts = questions.map((q) => q.question);
  const staffQuestions: StaffInterviewQuestion[] = questions.map((q) => {
    const m = matchBlueprintQuestion(block, q.question);
    return {
      id: q.id,
      sequence: q.sequence,
      question: q.question,
      competency: m?.competency ?? q.competency,
      action: q.action,
      blueprint: m
        ? {
            id: m.id,
            type: m.type,
            stageTitle: m.stageTitle,
            difficulty: m.difficulty,
            source: m.source,
            expectedEvidence: m.expectedEvidence,
            rubric: m.rubric.map((r) => ({ name: r.name, weight: r.weight })),
            generationMode: m.generationMode,
          }
        : null,
      answer: q.answer ? { text: q.answer.answerText.slice(0, 6000), answeredAt: q.answer.answeredAt.toISOString() } : null,
    };
  });
  const notAsked = block
    ? block.questions
        .filter((bq) => !askedTexts.some((t) => matchBlueprintQuestion({ ...block, questions: [bq] }, t)))
        .map((bq) => ({ id: bq.id, competency: bq.competency, text: bq.text, generationMode: bq.generationMode }))
    : [];

  const link = ctx.assessmentLink;
  const hubLink = link
    ? {
        status: link.revokedAt
          ? ("REVOKED" as const)
          : link.tokenExpiresAt.getTime() <= now.getTime()
            ? ("EXPIRED" as const)
            : ("ACTIVE" as const),
        issuedAt: link.updatedAt.toISOString(),
        expiresAt: link.tokenExpiresAt.toISOString(),
      }
    : null;

  const activeInterview = ctx.interviewSessions.some((s) => s.status === "SCHEDULED" || s.status === "IN_PROGRESS");
  const interviewCompetencies = block ? Array.from(new Set(block.questions.map((q) => q.competency))) : [];

  // Applications never set up through the V3.1 assessment get no retroactive audit rows from a page view.
  if (ctx.assessmentLink || ctx.interviewSessions.some((s) => readInterviewBlock(s.plan) !== null)) {
    await recordCompletionIfNeeded(ctx.id, components);
  }

  return {
    application: {
      id: ctx.id,
      candidateName: `${ctx.candidate.firstName} ${ctx.candidate.lastName}`.trim(),
      jobTitle: ctx.job.title,
    },
    blueprint: {
      engineVersion: blueprint.engineVersion,
      generatedAt: blueprint.generatedAt,
      roleFamily: blueprint.classification.roleFamily,
      roleLabel: familyLabel(blueprint.classification.roleFamily),
      seniority: blueprint.analysis.seniority,
      competencies: blueprint.competencies.map((c) => ({
        id: c.id,
        name: c.name,
        category: c.category,
        source: c.source,
        importance: c.importance,
      })),
      recommendedPractical: {
        type: blueprint.practical.type,
        title: blueprint.practical.title,
        competency: blueprint.practical.competency,
      },
    },
    components: components.map((c) => ({
      ...c,
      label: LABELS[c.key],
      competencies:
        c.key === "AI_INTERVIEW"
          ? interviewCompetencies
          : practicals.filter((p) => p.id === c.sourceId).map((p) => p.competency),
    })),
    overall: overallState(components),
    progress: progressOf(components),
    interview: interviewRow
      ? {
          sessionId: interviewRow.id,
          status: interviewRow.status,
          blueprintLinked: block !== null,
          generation: block?.generation ?? null,
          questions: staffQuestions,
          notAsked,
        }
      : null,
    practicals,
    evidence,
    hubLink,
    capabilities: {
      createInterview: activeInterview
        ? { allowed: false, reason: "An interview is already open for this application" }
        : blueprint.questions.some((q) => q.type !== "PRACTICAL_RECOMMENDATION")
          ? { allowed: true, reason: null }
          : { allowed: false, reason: "The blueprint has no interview questions" },
      assignCoding: practicalCapability(blueprint, "CODING", ctx.practicalAssessments),
      assignSql: practicalCapability(blueprint, "SQL", ctx.practicalAssessments),
    },
    note: ASSESSMENT_NOTE,
  };
}

// -----------------------------------------------------------------------------
// Hub link (staff)
// -----------------------------------------------------------------------------

export async function issueHubLink(
  user: SessionUser,
  applicationId: string,
  now = new Date(),
): Promise<{ candidatePath: string; expiresAt: string; rotated: boolean }> {
  const app = await prisma.application.findFirst({
    where: { id: applicationId, job: orgScopeWhere(user) },
    select: { id: true, assessmentLink: { select: { id: true } } },
  });
  if (!app) throw notFound();
  const { token, hash } = newAccessToken();
  const expiresAt = new Date(now.getTime() + HUB_LINK_VALID_DAYS * 86_400_000);
  const rotated = Boolean(app.assessmentLink);
  await prisma.$transaction(async (tx) => {
    await tx.candidateAssessmentLink.upsert({
      where: { applicationId: app.id },
      create: { applicationId: app.id, accessTokenHash: hash, tokenExpiresAt: expiresAt, createdById: user.id },
      update: { accessTokenHash: hash, tokenExpiresAt: expiresAt, revokedAt: null, createdById: user.id },
    });
    await tx.timelineEvent.create({
      data: {
        applicationId: app.id,
        type: "OTHER",
        payload: assessmentAuditPayload("assessment_link_issued", {
          actorId: user.id,
          rotated,
          expiresAt: expiresAt.toISOString(),
        }),
      },
    });
  });
  return { candidatePath: `/assessment/${token}`, expiresAt: expiresAt.toISOString(), rotated };
}

export async function revokeHubLink(user: SessionUser, applicationId: string, now = new Date()): Promise<{ revoked: boolean }> {
  const app = await prisma.application.findFirst({
    where: { id: applicationId, job: orgScopeWhere(user) },
    select: { id: true },
  });
  if (!app) throw notFound();
  return prisma.$transaction(async (tx) => {
    const res = await tx.candidateAssessmentLink.updateMany({
      where: { applicationId: app.id, revokedAt: null },
      data: { revokedAt: now },
    });
    if (res.count > 0) {
      await tx.timelineEvent.create({
        data: {
          applicationId: app.id,
          type: "OTHER",
          payload: assessmentAuditPayload("assessment_link_revoked", { actorId: user.id }),
        },
      });
    }
    return { revoked: res.count > 0 };
  });
}

// -----------------------------------------------------------------------------
// Candidate hub (magic link)
// -----------------------------------------------------------------------------

export type CandidateComponentView = {
  key: ComponentKey;
  label: string;
  description: string;
  status: "Not Started" | "In Progress" | "Submitted" | "Completed" | "Expired" | "Ended";
  required: boolean;
  estimatedMinutes: number | null;
  action: { kind: "START" | "CONTINUE"; href: string } | null;
  note: string | null;
};

export type CandidateHub = {
  jobTitle: string;
  companyName: string;
  components: CandidateComponentView[];
  progress: { completed: number; total: number };
  assessmentStatus: OverallState;
};

const DESCRIPTIONS: Record<ComponentKey, string> = {
  AI_INTERVIEW: "Test your technical knowledge and experience",
  CODING: "Test your implementation skills",
  SQL: "Test your database skills",
};

function interviewView(c: ComponentStatus, row: InterviewRow): CandidateComponentView {
  const open = c.state === "NOT_STARTED" || c.state === "IN_PROGRESS";
  return {
    key: c.key,
    label: LABELS[c.key],
    description: DESCRIPTIONS[c.key],
    status:
      c.state === "COMPLETED"
        ? "Completed"
        : c.state === "IN_PROGRESS"
          ? "In Progress"
          : c.state === "EXPIRED"
            ? "Expired"
            : c.state === "FAILED"
              ? "Ended"
              : "Not Started",
    required: c.required,
    estimatedMinutes: row.durationMinutes,
    action: open ? { kind: c.state === "IN_PROGRESS" ? "CONTINUE" : "START", href: `/interview/${row.accessToken}` } : null,
    note: c.state === "EXPIRED" ? "This link has expired. Please contact the hiring team." : null,
  };
}

function practicalView(c: ComponentStatus, row: PracticalRow): CandidateComponentView {
  const submitted = ["SUBMITTED", "EXECUTING", "EXECUTION_FAILED"].includes(row.status) || Boolean(row.submission);
  const editable = c.state === "NOT_STARTED" || (c.state === "IN_PROGRESS" && !submitted);
  const launchable = isDerivedPracticalHash(row.id, row.accessTokenHash);
  const status: CandidateComponentView["status"] =
    c.state === "COMPLETED"
      ? "Completed"
      : submitted
        ? "Submitted"
        : c.state === "IN_PROGRESS"
          ? "In Progress"
          : c.state === "EXPIRED"
            ? "Expired"
            : "Not Started";
  return {
    key: c.key,
    label: LABELS[c.key],
    description: DESCRIPTIONS[c.key],
    status,
    required: c.required,
    estimatedMinutes: row.timeLimitMinutes,
    action:
      editable && launchable
        ? { kind: c.state === "IN_PROGRESS" ? "CONTINUE" : "START", href: `/practical/${derivePracticalToken(row.id)}` }
        : null,
    note:
      editable && !launchable
        ? "Please use the link the hiring team sent you for this assessment."
        : c.state === "EXPIRED"
          ? "This assessment window has closed. Please contact the hiring team."
          : null,
  };
}

export async function getCandidateHub(token: string, now = new Date()): Promise<CandidateHub> {
  if (!ACCESS_TOKEN_RE.test(token)) throw notFound();
  const link = await prisma.candidateAssessmentLink.findUnique({
    where: { accessTokenHash: hashAccessToken(token) },
    select: { applicationId: true, tokenExpiresAt: true, revokedAt: true },
  });
  if (!link || link.revokedAt) throw notFound();
  if (link.tokenExpiresAt.getTime() <= now.getTime()) {
    throw new AssessmentError("LINK_EXPIRED", 410, "This assessment link has expired. Please contact the hiring team.");
  }
  const ctx = await prisma.application.findUnique({ where: { id: link.applicationId }, select: contextSelect });
  if (!ctx) throw notFound();

  const components = componentsFor(ctx, now);
  // Candidates see only assigned, non-cancelled components.
  const visible = components.filter((c) => c.state !== "NOT_ASSIGNED" && c.state !== "CANCELLED");
  const views = visible.map((c) => {
    if (c.key === "AI_INTERVIEW") return interviewView(c, ctx.interviewSessions.find((s) => s.id === c.sourceId)!);
    return practicalView(c, ctx.practicalAssessments.find((p) => p.id === c.sourceId)!);
  });
  const progress = progressOf(components);

  await recordCompletionIfNeeded(ctx.id, components);

  return {
    jobTitle: ctx.job.title,
    companyName: ctx.job.organization.companyName || ctx.job.organization.name,
    components: views,
    progress: { completed: progress.completed, total: progress.total },
    assessmentStatus: overallState(components),
  };
}

// -----------------------------------------------------------------------------
// Blueprint-driven AI interview
// -----------------------------------------------------------------------------

export type PreparedBlueprintInterview = {
  plan: ReturnType<typeof planFromInterviewBlock>;
  block: AssessmentInterviewBlock;
  blueprint: AssessmentBlueprint;
  candidate: CandidateInput | null;
  maxQuestions: number;
};

/** V1 blueprint → validated questions with deterministic wording (= the V2 fallback), ready for InterviewSession.plan. */
export async function prepareBlueprintInterview(
  user: SessionUser,
  application: { id: string; jobId: string },
  requestedMaxQuestions: number | undefined,
  now = new Date(),
): Promise<PreparedBlueprintInterview> {
  const sources = await loadBlueprintSources(user, application.jobId, application.id);
  if (sources.kind !== "OK") throw notFound();
  const blueprint = AssessmentEngineService.buildBlueprint({ job: sources.job, candidate: sources.candidate, now });
  const block = buildInterviewBlock(blueprint, {
    status: "FALLBACK_PENDING_AI",
    total: 0,
    aiGenerated: 0,
    fallback: 0,
    model: null,
    upgradedAt: null,
  });
  if (!block) throw new AssessmentError("NO_QUESTIONS", 422, "The assessment blueprint has no interview questions");
  return {
    plan: planFromInterviewBlock(block, blueprint),
    block,
    blueprint,
    candidate: sources.candidate,
    maxQuestions: interviewQuestionBudget(block, requestedMaxQuestions),
  };
}

export type UpgradeOutcome = "UPGRADED" | "FALLBACK_ONLY" | "SKIPPED_STARTED" | "SKIPPED_CHANGED" | "SKIPPED_MISSING";

/**
 * Background V2 wording upgrade. Only lands while the interview is still
 * SCHEDULED and unstarted, with optimistic concurrency on updatedAt, so a
 * candidate never sees questions change mid-interview and staff plan edits are
 * never overwritten. On V2 failure the deterministic fallback stays in place.
 */
export async function upgradeAssessmentInterview(params: {
  sessionId: string;
  blueprint: AssessmentBlueprint;
  candidate: CandidateInput | null;
  actorId: string;
  chat?: AiChatFn;
  now?: () => Date;
}): Promise<UpgradeOutcome> {
  const clock = params.now ?? (() => new Date());
  let aiBlock: AssessmentInterviewBlock | null = null;
  try {
    const ai = await generateAiAssistedBlueprint({
      blueprint: params.blueprint,
      candidate: params.candidate,
      actorId: params.actorId,
      chat: params.chat,
      audit: timelineAuditSink(prisma as unknown as TimelineWriter),
    });
    aiBlock = buildInterviewBlock(ai, {
      status: ai.generationSummary.aiGenerated > 0 ? "AI_ASSISTED" : "FALLBACK_ONLY",
      total: 0,
      aiGenerated: 0,
      fallback: 0,
      model: ai.generationSummary.model,
      upgradedAt: clock().toISOString(),
    });
  } catch (err) {
    console.warn("[assessment] V2 wording upgrade failed; keeping deterministic fallback:", err instanceof Error ? err.name : "unknown");
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await prisma.interviewSession.findUnique({
      where: { id: params.sessionId },
      select: { status: true, startedAt: true, plan: true, updatedAt: true },
    });
    if (!row) return "SKIPPED_MISSING";
    if (row.status !== "SCHEDULED" || row.startedAt) return "SKIPPED_STARTED";
    const current = readInterviewBlock(row.plan);
    if (!current) return "SKIPPED_MISSING";

    const next: AssessmentInterviewBlock =
      aiBlock && aiBlock.generation.status === "AI_ASSISTED"
        ? aiBlock
        : { ...current, generation: { ...current.generation, status: "FALLBACK_ONLY", upgradedAt: clock().toISOString() } };
    const plan: Record<string, unknown> = { ...(row.plan as Record<string, unknown>), assessment: next };
    const opening = (row.plan as { openingQuestion?: { question?: string } }).openingQuestion;
    const firstOld = current.questions[0];
    const firstNew = next.questions.find((q) => q.id === firstOld?.id);
    if (opening && firstOld && firstNew && opening.question === firstOld.text) {
      plan.openingQuestion = { ...opening, question: firstNew.text };
    }

    const res = await prisma.interviewSession.updateMany({
      where: { id: params.sessionId, status: "SCHEDULED", startedAt: null, updatedAt: row.updatedAt },
      data: { plan: plan as Prisma.InputJsonObject },
    });
    if (res.count === 1) return next.generation.status === "AI_ASSISTED" ? "UPGRADED" : "FALLBACK_ONLY";
  }
  return "SKIPPED_CHANGED";
}
