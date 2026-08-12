import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import {
  AuthError,
  canManagePipeline,
  requireStaff,
} from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { AIError } from "@/lib/ai/ollama";
import {
  finalEvaluation,
  mapFinalRecommendation,
} from "@/lib/ai/interview";
import {
  asJson,
  parseAdaptiveState,
  parsePlan,
  turnsFromQuestions,
} from "@/lib/ai/interview-session";

type Ctx = { params: { id: string } };

/**
 * Re-run finalEvaluation for a COMPLETED session from stored turns.
 * Creates a new INTERVIEW_OVERALL AIEvaluation. Does not change Application.stage.
 */
export async function POST(_request: Request, { params }: Ctx) {
  try {
    const sessionUser = await getSession();
    const user = requireStaff(sessionUser);
    if (!canManagePipeline(user.role)) {
      throw new AuthError("Insufficient permissions", 403);
    }

    const interview = await prisma.interviewSession.findUnique({
      where: { id: params.id },
      include: {
        application: {
          include: {
            job: true,
            candidate: true,
          },
        },
        questions: {
          orderBy: { sequence: "asc" },
          include: { answer: true },
        },
      },
    });

    if (!interview) {
      return Response.json({ error: "Interview not found" }, { status: 404 });
    }
    if (
      user.role !== "SUPER_ADMIN" &&
      user.organizationId &&
      interview.application.job.organizationId !== user.organizationId
    ) {
      throw new AuthError("Insufficient permissions", 403);
    }
    if (interview.status !== "COMPLETED") {
      return Response.json(
        { error: "Interview must be COMPLETED to regenerate evaluation" },
        { status: 400 },
      );
    }

    const plan = parsePlan(interview.plan);
    const adaptiveState = parseAdaptiveState(interview.adaptiveState);
    const turns = turnsFromQuestions(interview.questions);

    if (turns.length === 0) {
      return Response.json(
        { error: "No answered turns to evaluate" },
        { status: 400 },
      );
    }

    const { result, model, raw } = await finalEvaluation({
      plan,
      interviewType: interview.interviewType,
      jobTitle: interview.application.job.title,
      jobDescription: interview.application.job.description,
      resumeText: interview.application.candidate.resumeText ?? "",
      turns,
      adaptiveState: { ...adaptiveState, concluded: true },
    });

    const evaluation = await prisma.aIEvaluation.create({
      data: {
        applicationId: interview.applicationId,
        sessionId: interview.id,
        kind: "INTERVIEW_OVERALL",
        scores: asJson(result),
        recommendation: mapFinalRecommendation(result.recommendation),
        reasoning: result.reasoning,
        model,
        rawResponse: asJson(raw),
      },
    });

    await prisma.timelineEvent.create({
      data: {
        applicationId: interview.applicationId,
        type: "AI_EVALUATION",
        payload: {
          sessionId: interview.id,
          kind: "INTERVIEW_OVERALL",
          overall: result.overall,
          recommendation: result.recommendation,
          regenerated: true,
          advisoryOnly: true,
        },
      },
    });

    return jsonOk({
      evaluation: {
        id: evaluation.id,
        recommendation: evaluation.recommendation,
        overall: result.overall,
        model: evaluation.model,
        createdAt: evaluation.createdAt,
      },
      advisoryOnly: true,
    });
  } catch (err) {
    if (err instanceof AIError) {
      return Response.json(
        {
          error: err.message,
          code: err.code,
          ollamaDown:
            err.code === "OLLAMA_UNREACHABLE" || err.code === "OLLAMA_HTTP",
        },
        { status: err.code === "VALIDATION" ? 400 : 503 },
      );
    }
    return handleApiError(err);
  }
}
