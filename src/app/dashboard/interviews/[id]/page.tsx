import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { canManagePipeline } from "@/lib/auth/rbac";
import { Badge } from "@/components/ui/badge";
import { InterviewReport } from "@/components/interview-report";
import { ProctoringReportSection } from "@/components/proctoring-report";
import { CandidateAskedSection } from "@/components/candidate-asked-section";
import {
  AnswerEvaluationSchema,
  FinalResultSchema,
} from "@/lib/ai/interview";

type Ctx = { params: { id: string } };

export const dynamic = "force-dynamic";

export default async function InterviewReportPage({ params }: Ctx) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canManagePipeline(session.role)) redirect("/dashboard");

  const interview = await prisma.interviewSession.findUnique({
    where: { id: params.id },
    include: {
      application: {
        include: {
          job: { select: { id: true, title: true, organizationId: true } },
          candidate: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      },
      questions: {
        orderBy: { sequence: "asc" },
        include: { answer: true },
      },
      aiEvaluations: {
        where: { kind: "INTERVIEW_OVERALL" },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      proctoring: {
        orderBy: { timestamp: "asc" },
      },
    },
  });

  if (!interview) notFound();
  if (
    session.role !== "SUPER_ADMIN" &&
    session.organizationId &&
    interview.application.job.organizationId !== session.organizationId
  ) {
    notFound();
  }

  const overall = interview.aiEvaluations[0];
  const finalResult = overall
    ? FinalResultSchema.safeParse(overall.scores).data
    : null;

  const transcript = interview.questions.map((q) => ({
    sequence: q.sequence,
    question: q.question,
    topic: q.topic,
    difficulty: q.difficulty,
    action: q.action,
    answerText: q.answer?.answerText ?? null,
    hasAudio: Boolean(q.answer?.audioPath),
    evaluation: q.answer?.evaluation
      ? AnswerEvaluationSchema.safeParse(q.answer.evaluation).data
      : null,
  }));

  const timelineOther = await prisma.timelineEvent.findMany({
    where: {
      applicationId: interview.applicationId,
      type: "OTHER",
    },
    orderBy: { createdAt: "asc" },
  });
  const candidateAsked = timelineOther
    .filter((e) => {
      const p = e.payload as { kind?: string; sessionId?: string } | null;
      return p?.kind === "candidate_question" && p?.sessionId === interview.id;
    })
    .map((e) => {
      const p = e.payload as {
        question?: string;
        answer?: string;
        deferred?: boolean;
      };
      return {
        id: e.id,
        question: p.question ?? "",
        answer: p.answer ?? "",
        deferred: Boolean(p.deferred),
        at: e.createdAt.toISOString(),
      };
    });

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/dashboard/candidates/${interview.application.candidate.id}?applicationId=${interview.applicationId}`}
          className="inline-flex items-center text-sm font-medium text-slate-600 hover:text-slate-900 hover:underline"
        >
          ← Back to candidate
        </Link>
        <h1 className="mt-2 font-display text-3xl text-slate-900">
          Interview report
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {interview.application.candidate.firstName}{" "}
          {interview.application.candidate.lastName} ·{" "}
          {interview.application.job.title}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge variant="secondary">{interview.status}</Badge>
          <Badge variant="secondary">{interview.interviewType}</Badge>
          <Badge className="bg-amber-100 text-amber-900">
            AI suggestion — recruiter decides
          </Badge>
        </div>
      </div>

      <ProctoringReportSection
        enabled={interview.proctoringEnabled}
        cameraConsent={interview.proctoringCameraConsent}
        events={interview.proctoring.map((e) => ({
          id: e.id,
          type: e.type,
          timestamp: e.timestamp.toISOString(),
          meta: e.meta,
        }))}
      />

      <CandidateAskedSection items={candidateAsked} />

      <InterviewReport
        applicationId={interview.applicationId}
        candidateId={interview.application.candidate.id}
        interviewId={interview.id}
        interviewStatus={interview.status}
        currentStage={interview.application.stage}
        transcript={transcript}
        overall={
          overall && finalResult
            ? {
                recommendation: overall.recommendation,
                reasoning: overall.reasoning,
                model: overall.model,
                createdAt: overall.createdAt.toISOString(),
                result: finalResult,
              }
            : null
        }
      />
    </div>
  );
}
