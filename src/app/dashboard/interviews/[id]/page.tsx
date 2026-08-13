import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { canManagePipeline } from "@/lib/auth/rbac";
import { Badge } from "@/components/ui/badge";
import {
  InterviewAiEvaluation,
  InterviewTranscript,
  RecruiterDecisionPanel,
} from "@/components/interview-report";
import { InterviewReviewSummary } from "@/components/interview-review-summary";
import { IntegritySignalsSummary } from "@/components/integrity-signals-summary";
import { SecondaryCameraReview } from "@/components/secondary-camera-review";
import { CandidateAskedSection } from "@/components/candidate-asked-section";
import {
  AnswerEvaluationSchema,
  FinalResultSchema,
} from "@/lib/ai/interview";
import { finalizeSecondaryRecording } from "@/lib/secondary-recording-server";

type Ctx = { params: { id: string } };

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Interview",
};

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

  let recordingPath = interview.secondaryRecordingPath;
  let recordingStatus = interview.secondaryRecordingStatus;
  let recordingDurationMs = interview.secondaryRecordingDurationMs;
  let recordingHasGap = interview.secondaryRecordingHasGap;
  let recordingInterruptedMs = interview.secondaryRecordingInterruptedMs;
  if (
    !recordingPath &&
    interview.secondaryRecordingId &&
    (recordingStatus === "FAILED" ||
      recordingStatus === "INTERRUPTED" ||
      recordingStatus === "RECORDING" ||
      recordingStatus === "FINALIZING")
  ) {
    const salvaged = await finalizeSecondaryRecording(interview.id);
    recordingPath = salvaged.path;
    recordingStatus = salvaged.status;
    if (salvaged.path) {
      const refreshed = await prisma.interviewSession.findUnique({
        where: { id: interview.id },
        select: {
          secondaryRecordingDurationMs: true,
          secondaryRecordingHasGap: true,
          secondaryRecordingInterruptedMs: true,
        },
      });
      recordingDurationMs = refreshed?.secondaryRecordingDurationMs ?? recordingDurationMs;
      recordingHasGap = refreshed?.secondaryRecordingHasGap ?? recordingHasGap;
      recordingInterruptedMs =
        refreshed?.secondaryRecordingInterruptedMs ?? recordingInterruptedMs;
    }
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
          className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
        >
          ← Back to candidate
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
          Interview report
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {interview.application.candidate.firstName}{" "}
          {interview.application.candidate.lastName} ·{" "}
          {interview.application.job.title}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge variant="secondary">{interview.status}</Badge>
          <Badge variant="secondary">{interview.interviewType}</Badge>
          <Badge className="bg-warning/15 text-warning">
            AI suggestion — recruiter decides
          </Badge>
        </div>
      </div>

      <InterviewReviewSummary
        candidateName={`${interview.application.candidate.firstName} ${interview.application.candidate.lastName}`}
        role={interview.application.job.title}
        interviewType={interview.interviewType}
        deliveryMode={interview.deliveryMode}
        durationMs={
          interview.startedAt && interview.endedAt
            ? interview.endedAt.getTime() - interview.startedAt.getTime()
            : recordingDurationMs
        }
        status={interview.status}
        aiRecommendation={overall?.recommendation ?? null}
        currentStage={interview.application.stage}
        proctoringMode={interview.proctoringMode}
        secondaryDeviceStatus={interview.secondaryDeviceStatus}
        recordingStatus={recordingStatus}
        hasRecording={Boolean(recordingPath)}
      />

      <SecondaryCameraReview
        interviewId={interview.id}
        status={recordingStatus}
        durationMs={recordingDurationMs}
        interruptedMs={recordingInterruptedMs}
        hasGap={recordingHasGap}
        hasPath={Boolean(recordingPath)}
        recordingStartedAt={
          interview.secondaryRecordingStartedAt?.toISOString() ??
          interview.startedAt?.toISOString() ??
          null
        }
        placementConfirmed={Boolean(interview.secondaryPlacementConfirmedAt)}
        secondaryDeviceStatus={interview.secondaryDeviceStatus}
        events={interview.proctoring.map((e) => ({
          id: e.id,
          type: e.type,
          timestamp: e.timestamp.toISOString(),
          meta: e.meta,
        }))}
      />

      <IntegritySignalsSummary
        integrityMode={interview.integrityMode}
        status={interview.status}
        terminatedReason={interview.integrityTerminatedReason}
        events={interview.proctoring.map((e) => ({
          id: e.id,
          type: e.type,
          timestamp: e.timestamp.toISOString(),
          meta: e.meta,
        }))}
      />

      <CandidateAskedSection items={candidateAsked} />

      <InterviewTranscript interviewId={interview.id} transcript={transcript} />

      <InterviewAiEvaluation
        interviewId={interview.id}
        interviewStatus={interview.status}
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

      <RecruiterDecisionPanel
        applicationId={interview.applicationId}
        candidateId={interview.application.candidate.id}
        currentStage={interview.application.stage}
      />
    </div>
  );
}
