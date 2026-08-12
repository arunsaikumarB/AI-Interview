import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { canManagePipeline, orgScopeWhere } from "@/lib/auth/rbac";
import { Badge } from "@/components/ui/badge";
import { CandidateTimeline, stageLabel } from "@/components/candidate-timeline";
import { ResumeUpload } from "@/components/resume-upload";
import { AIScreeningSummary } from "@/components/ai-screening-summary";
import { InterviewStatusCard } from "@/components/interview-status-card";
import { ApplicationStageControls } from "@/components/application-stage-controls";
import { CandidateComposeButton } from "@/components/candidate-compose-button";
import { CommunicationHistory } from "@/components/communication-history";
import { CandidateTags } from "@/components/candidate-tags";
import type { ScreeningResult } from "@/lib/ai/screening";
import { ScreeningResultSchema } from "@/lib/ai/screening";
import { FinalResultSchema } from "@/lib/ai/interview";
import { STAGE_LABELS } from "@/lib/constants";

type Ctx = {
  params: { id: string };
  searchParams: { applicationId?: string };
};

export const dynamic = "force-dynamic";

function asScreeningScores(raw: unknown): ScreeningResult | null {
  const parsed = ScreeningResultSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export default async function CandidateDetailPage({ params, searchParams }: Ctx) {
  const session = await getSession();
  if (!session) redirect("/login");
  const scope = orgScopeWhere(session);
  const canDecide = canManagePipeline(session.role);

  const candidate = await prisma.candidate.findFirst({
    where: {
      id: params.id,
      ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
    },
    include: {
      applications: {
        orderBy: { updatedAt: "desc" },
        include: {
          job: {
            select: {
              id: true,
              title: true,
              department: { select: { name: true } },
            },
          },
          timelineEvents: { orderBy: { createdAt: "desc" }, take: 20 },
          aiEvaluations: {
            where: { kind: { in: ["RESUME_SCREEN", "INTERVIEW_OVERALL"] } },
            orderBy: { createdAt: "desc" },
          },
          interviewSessions: {
            orderBy: { updatedAt: "desc" },
            take: 1,
            include: {
              _count: { select: { proctoring: true } },
            },
          },
        },
      },
    },
  });

  if (!candidate) notFound();

  const selectedApp =
    candidate.applications.find((a) => a.id === searchParams.applicationId) ??
    candidate.applications[0] ??
    null;

  const latestScreen =
    selectedApp?.aiEvaluations.find((e) => e.kind === "RESUME_SCREEN") ?? null;
  const scores = latestScreen ? asScreeningScores(latestScreen.scores) : null;

  const latestInterview = selectedApp?.interviewSessions[0] ?? null;
  const overallEval =
    latestInterview &&
    selectedApp?.aiEvaluations.find(
      (e) => e.kind === "INTERVIEW_OVERALL" && e.sessionId === latestInterview.id,
    );
  const overallParsed = overallEval
    ? FinalResultSchema.safeParse(overallEval.scores)
    : null;

  const timeline = selectedApp
    ? selectedApp.timelineEvents.map((t) => ({
        id: t.id,
        type: (t.type === "STAGE_CHANGED"
          ? "STAGE"
          : t.type === "AI_EVALUATION" || t.type === "SCREENING_COMPLETED"
            ? "AI_SCORE"
            : t.type === "DOCUMENT_UPLOADED"
              ? "DOCUMENT"
              : t.type === "DECISION" ||
                  t.type === "INTERVIEW_COMPLETED" ||
                  t.type === "INTERVIEW_SCHEDULED" ||
                  t.type === "INTERVIEW_STARTED"
                ? "DECISION"
                : "STAGE") as "STAGE" | "AI_SCORE" | "DECISION" | "DOCUMENT",
        at: t.createdAt,
        title: humanTimelineTitle(t.type, t.payload),
        detail: null as string | null,
        actor: null as string | null,
      }))
    : [];

  const backHref = selectedApp
    ? `/dashboard/jobs/${selectedApp.job.id}`
    : "/dashboard/candidates";

  return (
    <div className="space-y-8">
      <div>
        <Link href={backHref} className="text-sm text-slate-500 hover:underline">
          ← {selectedApp ? selectedApp.job.title : "Candidates"}
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl text-slate-900">
              {candidate.firstName} {candidate.lastName}
            </h1>
            {selectedApp ? (
              <p className="mt-1 text-sm font-medium text-slate-700">
                {selectedApp.job.title}
              </p>
            ) : null}
            {selectedApp ? (
              <p className="mt-1 text-sm text-slate-500">
                Current stage:{" "}
                <span className="font-medium text-slate-800">
                  {STAGE_LABELS[selectedApp.stage]}
                </span>
              </p>
            ) : null}
          </div>
          {selectedApp && canDecide ? (
            <div className="flex flex-wrap gap-2">
              <Link
                href="#decision"
                className="inline-flex h-8 items-center rounded-lg border border-slate-200 px-3 text-sm text-slate-700 hover:bg-slate-50"
              >
                Move Stage
              </Link>
              <Link
                href="#interview"
                className="inline-flex h-8 items-center rounded-lg bg-slate-900 px-3 text-sm text-white hover:bg-slate-800"
              >
                Create Interview
              </Link>
            </div>
          ) : null}
        </div>
      </div>

      {candidate.applications.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {candidate.applications.map((app) => (
            <Link
              key={app.id}
              href={`/dashboard/candidates/${candidate.id}?applicationId=${app.id}`}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                selectedApp?.id === app.id
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              {app.job.title} · {stageLabel(app.stage)}
            </Link>
          ))}
        </div>
      ) : null}

      <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-900">Profile</h2>
        <p className="text-sm text-slate-800">
          {candidate.firstName} {candidate.lastName}
        </p>
        <p className="text-sm text-slate-500">{candidate.email}</p>
        <p className="text-sm text-slate-600">
          {candidate.experience} year{candidate.experience === 1 ? "" : "s"}{" "}
          experience
          {candidate.location ? ` · ${candidate.location}` : ""}
        </p>
        {candidate.summary ? (
          <p className="max-w-2xl text-sm text-slate-600">{candidate.summary}</p>
        ) : null}
        {candidate.skills.length > 0 ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {candidate.skills.map((s) => (
              <Badge key={s} variant="secondary">
                {s}
              </Badge>
            ))}
          </div>
        ) : null}
        <div className="pt-2">
          <CandidateTags candidateId={candidate.id} />
        </div>
      </section>

      {selectedApp ? (
        <>
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-base font-semibold text-slate-900">Resume</h2>
            {candidate.resumeText ? (
              <p className="text-sm text-slate-600">
                Resume on file
                {candidate.resumeUrl ? (
                  <>
                    {" "}
                    ·{" "}
                    <a
                      href={candidate.resumeUrl}
                      className="underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      View / Download
                    </a>
                  </>
                ) : null}
              </p>
            ) : (
              <p className="text-sm text-slate-500">No resume uploaded yet.</p>
            )}
            {candidate.summary ? (
              <p className="text-sm text-slate-600">{candidate.summary}</p>
            ) : null}
            <ResumeUpload applicationId={selectedApp.id} />
          </section>

          <AIScreeningSummary
            applicationId={selectedApp.id}
            evaluation={
              latestScreen && scores
                ? {
                    id: latestScreen.id,
                    scores,
                    recommendation: latestScreen.recommendation,
                    reasoning: latestScreen.reasoning,
                    model: latestScreen.model,
                    createdAt: latestScreen.createdAt,
                  }
                : null
            }
          />

          <div id="interview">
            <InterviewStatusCard
              application={{
                id: selectedApp.id,
                candidateId: candidate.id,
                candidateName: `${candidate.firstName} ${candidate.lastName}`.trim(),
                candidateEmail: candidate.email,
                jobId: selectedApp.job.id,
                jobTitle: selectedApp.job.title,
              }}
              latest={
                latestInterview
                  ? {
                      id: latestInterview.id,
                      status: latestInterview.status,
                      interviewType: latestInterview.interviewType,
                      overallScore: overallParsed?.success
                        ? Math.round(overallParsed.data.overall)
                        : null,
                      recommendation: overallEval?.recommendation ?? null,
                      proctoringEnabled: latestInterview.proctoringEnabled,
                      proctoringEventCount: latestInterview._count.proctoring,
                    }
                  : null
              }
            />
          </div>

          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900">
                Communication
              </h2>
              <CandidateComposeButton
                candidateId={candidate.id}
                applicationId={selectedApp.id}
              />
            </div>
            <CommunicationHistory candidateId={candidate.id} />
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-900">Activity</h2>
            <CandidateTimeline items={timeline} />
          </section>

          {canDecide ? (
            <div id="decision">
              <ApplicationStageControls
                applicationId={selectedApp.id}
                currentStage={selectedApp.stage}
              />
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-slate-500">No applications yet.</p>
      )}
    </div>
  );
}

function humanTimelineTitle(type: string, payload: unknown): string {
  if (type === "STAGE_CHANGED" && payload && typeof payload === "object") {
    const p = payload as { to?: string; from?: string };
    if (p.to && p.to in STAGE_LABELS) {
      return `Moved to ${STAGE_LABELS[p.to as keyof typeof STAGE_LABELS]}`;
    }
  }
  switch (type) {
    case "APPLICATION_CREATED":
      return "Application received";
    case "SCREENING_COMPLETED":
      return "AI screening completed";
    case "INTERVIEW_SCHEDULED":
      return "Interview scheduled";
    case "INTERVIEW_STARTED":
      return "Interview started";
    case "INTERVIEW_COMPLETED":
      return "Interview completed";
    case "AI_EVALUATION":
      return "AI evaluation recorded";
    case "DOCUMENT_UPLOADED":
      return "Document uploaded";
    case "EMAIL_SENT":
      return "Email sent";
    case "NOTE_ADDED":
      return "Note added";
    default:
      return type.replace(/_/g, " ").toLowerCase();
  }
}
