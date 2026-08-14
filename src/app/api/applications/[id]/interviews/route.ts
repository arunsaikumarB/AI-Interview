import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import {
  AuthError,
  canManagePipeline,
  requireStaff,
} from "@/lib/auth/rbac";
import { handleApiError, jsonCreated, jsonOk } from "@/lib/api";
import { AIError } from "@/lib/ai/ollama";
import {
  generatePlan,
  initialAdaptiveState,
  type InterviewType,
} from "@/lib/ai/interview";
import { inferInterviewType } from "@/lib/ai/interview-guard";
import { INTERVIEW_TYPES } from "@/lib/constants";
import { ScreeningResultSchema } from "@/lib/ai/screening";
import {
  asJson,
  createAccessToken,
  tokenExpiresInDays,
} from "@/lib/ai/interview-session";

type Ctx = { params: { id: string } };

const bodySchema = z.object({
  interviewType: z.enum(
    INTERVIEW_TYPES as unknown as [string, ...string[]],
  ).default("TECHNICAL"),
  maxQuestions: z.number().int().min(3).max(30).default(12),
  /** Candidate channel — TEXT | VOICE (stored as deliveryMode). */
  mode: z.enum(["TEXT", "VOICE"]).default("TEXT"),
  proctoringEnabled: z.boolean().default(false),
  /** OFF | STANDARD | ENHANCED — Enhanced enables secondary-camera pairing. */
  proctoringMode: z.enum(["OFF", "STANDARD", "ENHANCED"]).optional(),
  /** STANDARD | STRICT — Strict may end the interview after repeated browser signals. */
  integrityMode: z.enum(["STANDARD", "STRICT"]).default("STANDARD"),
  /** Link validity from creation. */
  linkExpiresInDays: z.union([z.literal(1), z.literal(3), z.literal(7)]).default(3),
  /** Wall-clock session length after start. */
  durationMinutes: z
    .union([z.literal(15), z.literal(30), z.literal(45), z.literal(60)])
    .default(30),
});

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    if (!canManagePipeline(user.role)) {
      throw new AuthError("Insufficient permissions", 403);
    }

    const application = await prisma.application.findUnique({
      where: { id: params.id },
      include: { job: { select: { organizationId: true } } },
    });
    if (!application) {
      return Response.json({ error: "Application not found" }, { status: 404 });
    }
    if (
      user.role !== "SUPER_ADMIN" &&
      user.organizationId &&
      application.job.organizationId !== user.organizationId
    ) {
      throw new AuthError("Insufficient permissions", 403);
    }

    const interviews = await prisma.interviewSession.findMany({
      where: { applicationId: params.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        interviewType: true,
        deliveryMode: true,
        proctoringEnabled: true,
        maxQuestions: true,
        accessToken: true,
        tokenExpiresAt: true,
        scheduledAt: true,
        startedAt: true,
        endedAt: true,
        createdAt: true,
      },
    });

    return jsonOk({
      interviews: interviews.map((i) => ({
        ...i,
        mode: i.deliveryMode,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * Create SCHEDULED interview with plan + candidate magic link.
 * Does NOT change Application.stage.
 */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    if (!canManagePipeline(user.role)) {
      throw new AuthError("Insufficient permissions", 403);
    }

    const body = bodySchema.parse(await request.json());

    const application = await prisma.application.findUnique({
      where: { id: params.id },
      include: {
        job: true,
        candidate: true,
        aiEvaluations: {
          where: { kind: "RESUME_SCREEN" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!application) {
      return Response.json({ error: "Application not found" }, { status: 404 });
    }
    if (
      user.role !== "SUPER_ADMIN" &&
      user.organizationId &&
      application.job.organizationId !== user.organizationId
    ) {
      throw new AuthError("Insufficient permissions", 403);
    }

    const resumeText = application.candidate.resumeText?.trim() ?? "";
    const latestScreen = application.aiEvaluations[0];
    const screeningFocus = latestScreen
      ? ScreeningResultSchema.safeParse(latestScreen.scores).data ?? null
      : null;

    const interviewType = inferInterviewType(
      application.job.title,
      body.interviewType as InterviewType,
    );

    const { plan, model, raw } = await generatePlan({
      job: application.job,
      candidate: {
        firstName: application.candidate.firstName,
        lastName: application.candidate.lastName,
        summary: application.candidate.summary,
        skills: application.candidate.skills,
        experience: application.candidate.experience,
      },
      resumeText,
      interviewType,
      screeningFocus,
    });

    const accessToken = createAccessToken();
    let proctoringMode =
      body.proctoringMode ??
      (body.proctoringEnabled ? "STANDARD" : "OFF");
    const integrityMode = body.integrityMode === "STRICT" ? "STRICT" : "STANDARD";
    // Strict integrity needs browser signal collectors — enable at least STANDARD proctoring.
    if (integrityMode === "STRICT" && proctoringMode === "OFF") {
      proctoringMode = "STANDARD";
    }
    const proctoringEnabled =
      proctoringMode === "STANDARD" || proctoringMode === "ENHANCED";

    const interview = await prisma.interviewSession.create({
      data: {
        applicationId: application.id,
        mode: "AI_ADAPTIVE",
        deliveryMode: body.mode,
        proctoringEnabled,
        proctoringMode,
        integrityMode,
        status: "SCHEDULED",
        interviewType,
        maxQuestions: body.maxQuestions,
        durationMinutes: body.durationMinutes,
        accessToken,
        tokenExpiresAt: tokenExpiresInDays(body.linkExpiresInDays),
        scheduledAt: new Date(),
        plan: asJson(plan),
        adaptiveState: asJson(initialAdaptiveState(plan.openingQuestion.difficulty)),
        interviewerId: user.id,
      },
    });

    await prisma.timelineEvent.create({
      data: {
        applicationId: application.id,
        type: "INTERVIEW_SCHEDULED",
        payload: {
          sessionId: interview.id,
          interviewType,
          deliveryMode: body.mode,
          proctoringEnabled,
          proctoringMode,
          integrityMode,
          maxQuestions: body.maxQuestions,
          durationMinutes: body.durationMinutes,
          linkExpiresInDays: body.linkExpiresInDays,
          model,
          planTopics: plan.topics.map((t) => t.name),
          advisoryOnly: true,
        },
      },
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const candidateLink = `${appUrl}/interview/${accessToken}`;

    return jsonCreated({
      interview: {
        id: interview.id,
        status: interview.status,
        interviewType: interview.interviewType,
        mode: interview.deliveryMode,
        maxQuestions: interview.maxQuestions,
        durationMinutes: interview.durationMinutes,
        accessToken: interview.accessToken,
        tokenExpiresAt: interview.tokenExpiresAt,
        proctoringEnabled: interview.proctoringEnabled,
        proctoringMode: interview.proctoringMode,
        integrityMode: interview.integrityMode,
      },
      candidateLink,
      planMeta: {
        topicCount: plan.topics.length,
        openingTopic: plan.openingQuestion.topic,
        model,
      },
      // Plan details are recruiter-only; not returned on token routes
      plan,
      rawStored: Boolean(raw),
    });
  } catch (err) {
    if (err instanceof AIError) {
      return Response.json(
        {
          error: err.message,
          code: err.code,
          ollamaDown: err.code === "OLLAMA_UNREACHABLE" || err.code === "OLLAMA_HTTP",
        },
        { status: err.code === "VALIDATION" ? 400 : 503 },
      );
    }
    return handleApiError(err);
  }
}
