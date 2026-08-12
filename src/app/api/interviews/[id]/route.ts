import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import {
  AuthError,
  canManagePipeline,
  requireStaff,
} from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { FinalResultSchema } from "@/lib/ai/interview";
import { AnswerEvaluationSchema } from "@/lib/ai/interview";

type Ctx = { params: { id: string } };

/** Recruiter session report — includes scores (never exposed on token routes). */
export async function GET(_request: Request, { params }: Ctx) {
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
            job: { select: { id: true, title: true, organizationId: true } },
            candidate: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
        questions: {
          orderBy: { sequence: "asc" },
          include: { answer: true },
        },
        aiEvaluations: {
          where: { kind: { in: ["INTERVIEW_ANSWER", "INTERVIEW_OVERALL"] } },
          orderBy: { createdAt: "asc" },
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

    const overall = interview.aiEvaluations
      .filter((e) => e.kind === "INTERVIEW_OVERALL")
      .at(-1);

    const transcript = interview.questions.map((q) => {
      const ev = q.answer?.evaluation
        ? AnswerEvaluationSchema.safeParse(q.answer.evaluation).data
        : null;
      return {
        sequence: q.sequence,
        question: q.question,
        topic: q.topic,
        difficulty: q.difficulty,
        action: q.action,
        competency: q.competency,
        answerText: q.answer?.answerText ?? null,
        durationSec: q.answer?.durationSec ?? null,
        hasAudio: Boolean(q.answer?.audioPath),
        evaluation: ev,
      };
    });

    const finalParsed = overall
      ? FinalResultSchema.safeParse(overall.scores).data
      : null;

    return jsonOk({
      interview: {
        id: interview.id,
        status: interview.status,
        interviewType: interview.interviewType,
        maxQuestions: interview.maxQuestions,
        accessToken: interview.accessToken,
        startedAt: interview.startedAt,
        endedAt: interview.endedAt,
        plan: interview.plan,
        adaptiveState: interview.adaptiveState,
      },
      application: {
        id: interview.applicationId,
        stage: interview.application.stage,
        job: interview.application.job,
        candidate: interview.application.candidate,
      },
      transcript,
      overall: overall
        ? {
            id: overall.id,
            recommendation: overall.recommendation,
            reasoning: overall.reasoning,
            model: overall.model,
            createdAt: overall.createdAt,
            result: finalParsed,
          }
        : null,
      advisoryOnly: true,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
