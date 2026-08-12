import { z } from "zod";
import { prisma } from "@/lib/db";
import { jsonOk } from "@/lib/api";
import {
  answerCandidateQuestion,
  isDeclineQuestion,
} from "@/lib/ai/candidate-question";

type Ctx = { params: { token: string } };

const bodySchema = z.object({
  question: z.string().trim().min(1).max(500),
});

const MAX_QUESTIONS = 3;

/**
 * Post-interview candidate Q&A — NOT scored, NOT part of evaluation turns.
 */
export async function POST(request: Request, { params }: Ctx) {
  const session = await prisma.interviewSession.findUnique({
    where: { accessToken: params.token },
    include: {
      application: {
        include: {
          job: {
            select: {
              title: true,
              description: true,
              location: true,
              employmentType: true,
            },
          },
        },
      },
    },
  });

  if (!session) {
    return Response.json({ error: "Interview not found" }, { status: 404 });
  }
  if (session.tokenExpiresAt && session.tokenExpiresAt < new Date()) {
    return Response.json({ error: "This interview link has expired" }, { status: 410 });
  }
  if (session.status !== "COMPLETED") {
    return Response.json(
      { error: "Questions are only available after the interview concludes" },
      { status: 400 },
    );
  }

  const prior = await prisma.timelineEvent.findMany({
    where: {
      applicationId: session.applicationId,
      type: "OTHER",
    },
    orderBy: { createdAt: "asc" },
  });
  const asked = prior.filter((e) => {
    const p = e.payload as { kind?: string; sessionId?: string } | null;
    return p?.kind === "candidate_question" && p?.sessionId === session.id;
  });
  if (asked.length >= MAX_QUESTIONS) {
    return Response.json(
      { error: "You may ask up to 3 questions", maxReached: true },
      { status: 400 },
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Invalid question" }, { status: 400 });
  }

  // "no" / "none" — finish without counting toward the 3-question cap
  if (isDeclineQuestion(body.question)) {
    return jsonOk({
      answer: "No problem — you can finish whenever you are ready.",
      deferred: false,
      remaining: MAX_QUESTIONS - asked.length,
      declined: true,
    });
  }

  const result = await answerCandidateQuestion({
    question: body.question,
    job: session.application.job,
  });

  await prisma.timelineEvent.create({
    data: {
      applicationId: session.applicationId,
      type: "OTHER",
      payload: {
        kind: "candidate_question",
        sessionId: session.id,
        question: body.question,
        answer: result.answer,
        deferred: result.deferred,
        model: result.model,
        notScored: true,
        advisoryOnly: true,
      },
    },
  });

  return jsonOk({
    answer: result.answer,
    deferred: result.deferred,
    remaining: MAX_QUESTIONS - asked.length - 1,
  });
}
