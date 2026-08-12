import { prisma } from "@/lib/db";
import { AIError } from "@/lib/ai/ollama";
import {
  finalEvaluation,
  mapFinalRecommendation,
  nextTurnWithState,
} from "@/lib/ai/interview";
import {
  asJson,
  isSessionTimeUp,
  mapDifficultyToEnum,
  parseAdaptiveState,
  parsePlan,
  turnsFromQuestions,
} from "@/lib/ai/interview-session";

/**
 * Process the latest answered question (evaluate + next question / conclude).
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

  if (session.status === "COMPLETED") {
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
  // hasEval && !openQuestion → fall through to re-run conclude path if needed

  const out = await nextTurnWithState({
    plan,
    state,
    turns,
    maxQuestions: session.maxQuestions,
    interviewType: session.interviewType,
    jobTitle: session.application.job.title,
  });

  const { model, raw } = out;
  let { result: turnResult, nextState } = out;

  // Wall-clock limit: accept the current answer, then conclude (no further questions).
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

  await prisma.aIEvaluation.create({
    data: {
      applicationId: session.applicationId,
      sessionId: session.id,
      kind: "INTERVIEW_ANSWER",
      scores: asJson(turnResult.answerEvaluation),
      recommendation: "MAYBE",
      reasoning: turnResult.answerEvaluation.reasoning,
      model,
      rawResponse: asJson({
        nextAction: turnResult.nextAction,
        actionReasoning: turnResult.actionReasoning,
        raw,
      }),
    },
  });

  await prisma.interviewSession.update({
    where: { id: session.id },
    data: { adaptiveState: asJson(nextState) },
  });

  if (turnResult.nextAction === "CONCLUDE" || !turnResult.nextQuestion) {
    let finalModel = model;
    try {
      const final = await finalEvaluation({
        plan,
        interviewType: session.interviewType,
        jobTitle: session.application.job.title,
        jobDescription: session.application.job.description,
        resumeText: session.application.candidate.resumeText ?? "",
        turns,
        adaptiveState: { ...nextState, concluded: true },
      });
      finalModel = final.model;

      await prisma.aIEvaluation.create({
        data: {
          applicationId: session.applicationId,
          sessionId: session.id,
          kind: "INTERVIEW_OVERALL",
          scores: asJson(final.result),
          recommendation: mapFinalRecommendation(final.result.recommendation),
          reasoning: final.result.reasoning,
          model: final.model,
          rawResponse: asJson(final.raw),
        },
      });

      await prisma.timelineEvent.create({
        data: {
          applicationId: session.applicationId,
          type: "AI_EVALUATION",
          payload: {
            sessionId: session.id,
            kind: "INTERVIEW_OVERALL",
            overall: final.result.overall,
            recommendation: final.result.recommendation,
            advisoryOnly: true,
          },
        },
      });
    } catch (err) {
      console.error("finalEvaluation failed", err);
    }

    await prisma.interviewSession.update({
      where: { id: session.id },
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
          model: finalModel,
          advisoryOnly: true,
          stageUnchanged: true,
        },
      },
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

  return {
    concluded: false,
    nextQuestion: {
      sequence: created.sequence,
      question: created.question,
    },
  };
}
