import { prisma } from "@/lib/db";
import { AIError } from "@/lib/ai/ollama";
import {
  evaluateAnswerOnly,
  finalEvaluation,
  mapFinalRecommendation,
  type InterviewPlan,
  type TurnRecord,
} from "@/lib/ai/interview";
import {
  decideNextTurn,
  type JobInterviewScope,
} from "@/lib/ai/interview-guard";
import {
  asJson,
  isSessionTimeUp,
  mapDifficultyToEnum,
  parseAdaptiveState,
  parsePlan,
  turnsFromQuestions,
} from "@/lib/ai/interview-session";
import { prefetchQuestionTts } from "@/lib/question-tts";
import {
  EVALUATION_RETRY_DELAY_MS,
  MAX_EVALUATION_ATTEMPTS,
  evaluationFailurePayload,
  evaluationSuccessPayload,
  isRetryableEvaluationError,
  redactEvaluationError,
  type EvaluationKind,
} from "@/lib/ai/evaluation-status";

/**
 * Process the latest answered question (evaluate + next question / conclude).
 * Next question is chosen in code so the candidate is not blocked on Ollama.
 * Recruiter-facing model scores run in the background.
 * Does NOT change Application.stage.
 */
export async function processAnswerTurn(sessionId: string): Promise<{
  concluded: boolean;
  nextQuestion: { sequence: number; question: string } | null;
}> {
  const session = await prisma.interviewSession.findUniqueOrThrow({
    where: { id: sessionId },
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

  if (session.status === "COMPLETED" || session.status === "TERMINATED") {
    return { concluded: true, nextQuestion: null };
  }

  const plan = parsePlan(session.plan);
  const state = parseAdaptiveState(session.adaptiveState);
  const turns = turnsFromQuestions(session.questions);

  if (turns.length === 0) {
    throw new AIError("VALIDATION", "No answered turns to process");
  }

  const latestAnswered = [...session.questions]
    .reverse()
    .find((q) => q.answer);
  if (!latestAnswered?.answer) {
    throw new AIError("VALIDATION", "No answer to evaluate");
  }

  const hasEval = Boolean(latestAnswered.answer.evaluation);
  const openQuestion = session.questions.find((q) => !q.answer);
  if (hasEval && openQuestion) {
    return {
      concluded: false,
      nextQuestion: {
        sequence: openQuestion.sequence,
        question: openQuestion.question,
      },
    };
  }

  const job: JobInterviewScope = {
    title: session.application.job.title,
    description: session.application.job.description,
    skills: session.application.job.skills,
    interviewType: session.interviewType,
  };

  let { result: turnResult, nextState } = decideNextTurn({
    state,
    plan,
    maxQuestions: session.maxQuestions,
    lastAnswerText: turns[turns.length - 1]!.answerText,
    lastTopic: latestAnswered.topic,
    priorQuestions: turns.map((t) => t.question),
    job,
    modelResult: null,
  });

  if (
    isSessionTimeUp(session.startedAt, session.durationMinutes) &&
    turnResult.nextAction !== "CONCLUDE"
  ) {
    turnResult = {
      ...turnResult,
      nextAction: "CONCLUDE",
      nextQuestion: null,
      actionReasoning: `durationMinutes (${session.durationMinutes}) reached — concluding after final answer.`,
    };
    nextState = { ...nextState, concluded: true };
  }

  await prisma.interviewAnswer.update({
    where: { questionId: latestAnswered.id },
    data: { evaluation: asJson(turnResult.answerEvaluation) },
  });

  await prisma.interviewSession.update({
    where: { id: session.id },
    data: { adaptiveState: asJson(nextState) },
  });

  if (turnResult.nextAction === "CONCLUDE" || !turnResult.nextQuestion) {
    await prisma.interviewSession.updateMany({
      where: { id: session.id, status: "IN_PROGRESS" },
      data: {
        status: "COMPLETED",
        endedAt: new Date(),
        adaptiveState: asJson({ ...nextState, concluded: true }),
      },
    });

    try {
      const { endSecondaryCameraSession } = await import(
        "@/lib/secondary-camera-lifecycle"
      );
      await endSecondaryCameraSession(session.id);
    } catch (err) {
      console.warn(
        "[secondary-camera] cleanup after complete failed:",
        err instanceof Error ? err.message : err,
      );
    }

    await prisma.timelineEvent.create({
      data: {
        applicationId: session.applicationId,
        type: "INTERVIEW_COMPLETED",
        payload: {
          sessionId: session.id,
          questionsAsked: nextState.questionsAsked,
          model: "deterministic-guard",
          advisoryOnly: true,
          stageUnchanged: true,
        },
      },
    });

    void scoreInBackground({
      sessionId: session.id,
      questionId: latestAnswered.id,
      applicationId: session.applicationId,
      plan,
      interviewType: session.interviewType,
      jobTitle: session.application.job.title,
      jobDescription: session.application.job.description,
      jobSkills: session.application.job.skills,
      resumeText: session.application.candidate.resumeText ?? "",
      turns,
      concluded: true,
    });

    return { concluded: true, nextQuestion: null };
  }

  const nextSeq = latestAnswered.sequence + 1;
  const nq = turnResult.nextQuestion;

  const created = await prisma.interviewQuestion.create({
    data: {
      sessionId: session.id,
      sequence: nextSeq,
      question: nq.question,
      topic: nq.topic,
      difficulty: mapDifficultyToEnum(nq.difficulty),
      competency: nq.competency,
      action: turnResult.nextAction,
    },
  });

  prefetchQuestionTts({
    sessionId: session.id,
    questionId: created.id,
    sequence: created.sequence,
    text: created.question,
  });

  void scoreInBackground({
    sessionId: session.id,
    questionId: latestAnswered.id,
    applicationId: session.applicationId,
    plan,
    interviewType: session.interviewType,
    jobTitle: session.application.job.title,
    jobDescription: session.application.job.description,
    jobSkills: session.application.job.skills,
    resumeText: session.application.candidate.resumeText ?? "",
    turns,
    concluded: false,
  });

  return {
    concluded: false,
    nextQuestion: {
      sequence: created.sequence,
      question: created.question,
    },
  };
}

async function scoreInBackground(params: {
  sessionId: string;
  questionId: string;
  applicationId: string;
  plan: InterviewPlan;
  interviewType: string;
  jobTitle: string;
  jobDescription: string;
  jobSkills: string[];
  resumeText: string;
  turns: TurnRecord[];
  concluded: boolean;
}): Promise<void> {
  await runEvaluation({
    applicationId: params.applicationId,
    sessionId: params.sessionId,
    kind: "INTERVIEW_ANSWER",
    run: async () => {
      const scored = await evaluateAnswerOnly({
        plan: params.plan,
        interviewType: params.interviewType,
        jobTitle: params.jobTitle,
        jobDescription: params.jobDescription,
        jobSkills: params.jobSkills,
        turns: params.turns,
      });

      await prisma.interviewAnswer.update({
        where: { questionId: params.questionId },
        data: { evaluation: asJson(scored.evaluation) },
      });

      await prisma.aIEvaluation.create({
        data: {
          applicationId: params.applicationId,
          sessionId: params.sessionId,
          kind: "INTERVIEW_ANSWER",
          scores: asJson(scored.evaluation),
          recommendation: "MAYBE",
          reasoning: scored.evaluation.reasoning,
          model: scored.model,
          rawResponse: asJson(scored.raw),
        },
      });
      // Per-answer scores are an internal detail of the report; only the final
      // evaluation gets a timeline breadcrumb.
      return null;
    },
  });

  if (!params.concluded) return;

  await runEvaluation({
    applicationId: params.applicationId,
    sessionId: params.sessionId,
    kind: "INTERVIEW_OVERALL",
    run: async () => {
      const session = await prisma.interviewSession.findUnique({
        where: { id: params.sessionId },
        select: { adaptiveState: true },
      });
      const final = await finalEvaluation({
        plan: params.plan,
        interviewType: params.interviewType,
        jobTitle: params.jobTitle,
        jobDescription: params.jobDescription,
        resumeText: params.resumeText,
        turns: params.turns,
        adaptiveState: parseAdaptiveState(session?.adaptiveState),
      });

      await prisma.aIEvaluation.create({
        data: {
          applicationId: params.applicationId,
          sessionId: params.sessionId,
          kind: "INTERVIEW_OVERALL",
          scores: asJson(final.result),
          recommendation: mapFinalRecommendation(final.result.recommendation),
          reasoning: final.result.reasoning,
          model: final.model,
          rawResponse: asJson(final.raw),
        },
      });

      return {
        overall: final.result.overall,
        recommendation: final.result.recommendation,
      };
    },
  });
}

/**
 * R-3: run one background evaluation with a bounded retry, and make the
 * outcome durable either way.
 *
 * On success the existing AI_EVALUATION timeline row is written (now carrying
 * an explicit `status`). On final failure a row with `status: "failed"` is
 * written instead — never an AIEvaluation, so a failure can never be read back
 * as a result. Application.stage is untouched on both paths.
 */
async function runEvaluation(params: {
  applicationId: string;
  sessionId: string;
  kind: EvaluationKind;
  run: () => Promise<{ overall: number; recommendation: string } | null>;
}): Promise<void> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_EVALUATION_ATTEMPTS; attempt++) {
    try {
      const result = await params.run();
      if (result) {
        await prisma.timelineEvent.create({
          data: {
            applicationId: params.applicationId,
            type: "AI_EVALUATION",
            payload: evaluationSuccessPayload({
              sessionId: params.sessionId,
              kind: params.kind,
              overall: result.overall,
              recommendation: result.recommendation,
            }),
          },
        });
      }
      return;
    } catch (err) {
      lastError = err;
      console.warn(
        `[processAnswerTurn] ${params.kind} attempt ${attempt}/${MAX_EVALUATION_ATTEMPTS} failed:`,
        redactEvaluationError(err),
      );
      if (!isRetryableEvaluationError(err, attempt)) break;
      await new Promise((resolve) => setTimeout(resolve, EVALUATION_RETRY_DELAY_MS * attempt));
    }
  }

  // Only the final evaluation is surfaced to the recruiter, so only that one
  // needs a failure breadcrumb. A dropped per-answer score degrades the report
  // but is not a state the operator can act on.
  if (params.kind !== "INTERVIEW_OVERALL") return;

  try {
    await prisma.timelineEvent.create({
      data: {
        applicationId: params.applicationId,
        type: "AI_EVALUATION",
        payload: evaluationFailurePayload({
          sessionId: params.sessionId,
          kind: params.kind,
          attempts: MAX_EVALUATION_ATTEMPTS,
          error: lastError,
        }),
      },
    });
  } catch (err) {
    // The database is the last thing standing; if this fails there is nowhere
    // left to record the failure.
    console.error("[processAnswerTurn] could not record evaluation failure:", err);
  }
}
