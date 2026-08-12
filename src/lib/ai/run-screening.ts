import { prisma } from "@/lib/db";
import { AIError } from "@/lib/ai/ollama";
import {
  mapRecommendedActionToAIRecommendation,
  runResumeScreening,
  type ScreeningResult,
} from "@/lib/ai/screening";
import { embedCandidate } from "@/lib/ai/embeddings";

/**
 * Advisory screening for one application.
 * GUARDRAIL: does NOT touch Application.stage or Application.status.
 */
export async function screenApplication(applicationId: string): Promise<{
  evaluation: {
    id: string;
    kind: "RESUME_SCREEN";
    scores: ScreeningResult;
    recommendation: string;
    reasoning: string;
    model: string;
    createdAt: Date;
  };
  embeddingUpdated: boolean;
}> {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: {
      job: true,
      candidate: true,
    },
  });

  if (!application) {
    throw new AIError("VALIDATION", "Application not found");
  }

  const resumeText = application.candidate.resumeText?.trim() ?? "";
  if (!resumeText) {
    throw new AIError(
      "VALIDATION",
      "No resume text available for this candidate. Upload and parse a resume first.",
    );
  }

  const { result, model, raw } = await runResumeScreening({
    job: application.job,
    candidate: {
      firstName: application.candidate.firstName,
      lastName: application.candidate.lastName,
      summary: application.candidate.summary,
      skills: application.candidate.skills,
      experience: application.candidate.experience,
      education: application.candidate.education,
      certifications: application.candidate.certifications,
      resumeText,
    },
  });

  if (!result.reasoning?.trim()) {
    throw new AIError("VALIDATION", "AIEvaluation.reasoning cannot be empty");
  }

  const recommendation = mapRecommendedActionToAIRecommendation(
    result.recommendedAction,
  );

  const evaluation = await prisma.aIEvaluation.create({
    data: {
      applicationId: application.id,
      kind: "RESUME_SCREEN",
      scores: result,
      recommendation,
      reasoning: result.reasoning.trim(),
      model,
      rawResponse: raw as object,
    },
  });

  await prisma.timelineEvent.create({
    data: {
      applicationId: application.id,
      type: "SCREENING_COMPLETED",
      payload: {
        evaluationId: evaluation.id,
        overall: result.overall,
        recommendedAction: result.recommendedAction,
        recommendation,
        model,
        advisoryOnly: true,
      },
    },
  });

  let embeddingUpdated = false;
  try {
    const emb = await embedCandidate(application.candidateId);
    embeddingUpdated = emb.updated;
  } catch (err) {
    // Local embeddings only — never block screening if local Ollama is down.
    console.warn(
      "[screening] Skipping candidate embedding (local Ollama embed failed):",
      err instanceof Error ? err.message : err,
    );
    embeddingUpdated = false;
  }

  return {
    evaluation: {
      id: evaluation.id,
      kind: "RESUME_SCREEN",
      scores: result,
      recommendation: evaluation.recommendation,
      reasoning: evaluation.reasoning,
      model: evaluation.model,
      createdAt: evaluation.createdAt,
    },
    embeddingUpdated,
  };
}
