import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { PipelineStage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { canManagePipeline, orgScopeWhere } from "@/lib/auth/rbac";
import { CandidateTimeline } from "@/components/candidate-timeline";
import { ResumeUpload } from "@/components/resume-upload";
import { AIScreeningSummary } from "@/components/ai-screening-summary";
import { InterviewStatusCard } from "@/components/interview-status-card";
import { ApplicationStageControls } from "@/components/application-stage-controls";
import { CandidateComposeButton } from "@/components/candidate-compose-button";
import { CommunicationHistory } from "@/components/communication-history";
import { CandidateTags } from "@/components/candidate-tags";
import { CreateInterviewDialog } from "@/components/create-interview-dialog";
import type { ScreeningResult } from "@/lib/ai/screening";
import { ScreeningResultSchema } from "@/lib/ai/screening";
import { FinalResultSchema } from "@/lib/ai/interview";
import { STAGE_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import {
  buildAttentionItems,
  countProctoringSignals,
  experienceProfileLabel,
  experienceSnapshotLabel,
  formatEducationEntries,
  humanTimelineTitle,
  interviewHumanStatus,
  lastDecisionNote,
  pipelineSteps,
  pipelineStepState,
  proctoringSnapshotLabel,
  resumeFileName,
  resumeUploadedAt,
  resumeUploadedName,
  secondaryCameraAvailable,
  stageBadgeClass,
} from "@/lib/candidate-detail-ui";
import { cn } from "@/lib/utils";

type Ctx = {
  params: { id: string };
  searchParams: { applicationId?: string };
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Candidates",
};

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
              proctoring: {
                select: { type: true, meta: true },
              },
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

  const comms = await prisma.communicationLog.findMany({
    where: {
      meta: { path: ["candidateId"], equals: candidate.id },
      ...(scope.organizationId
        ? {
            OR: [
              { actor: { organizationId: scope.organizationId } },
              { template: { organizationId: scope.organizationId } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      status: true,
      subject: true,
      body: true,
      createdAt: true,
      sentAt: true,
      toAddress: true,
    },
  });

  const backHref = selectedApp
    ? `/dashboard/jobs/${selectedApp.job.id}`
    : "/dashboard/candidates";

  const fullName = `${candidate.firstName} ${candidate.lastName}`.trim();
  const expProfile = experienceProfileLabel(candidate.experience);
  const expSnapshot = experienceSnapshotLabel(candidate.experience);
  const education = formatEducationEntries(candidate.education);
  const signals = latestInterview
    ? countProctoringSignals(latestInterview.proctoring)
    : { tabSwitches: 0, copyPaste: 0, cameraInterruptions: 0 };
  const recordingReady = latestInterview
    ? secondaryCameraAvailable(
        latestInterview.secondaryRecordingStatus,
        latestInterview.secondaryRecordingPath,
      )
    : false;
  const interviewLabel = latestInterview
    ? interviewHumanStatus({
        status: latestInterview.status,
        tokenExpiresAt: latestInterview.tokenExpiresAt,
      })
    : "Not started";
  const aiMatch =
    scores && typeof scores.overall === "number" ? Math.round(scores.overall) : null;
  const decisionNote = selectedApp
    ? lastDecisionNote(selectedApp.timelineEvents)
    : null;
  const resumeAt = selectedApp
    ? resumeUploadedAt(selectedApp.timelineEvents)
    : null;
  const uploadedName = selectedApp
    ? resumeUploadedName(selectedApp.timelineEvents)
    : null;
  const attention = selectedApp
    ? buildAttentionItems({
        interviewStatus: latestInterview?.status ?? null,
        interviewId: latestInterview?.id ?? null,
        screeningExists: Boolean(scores),
        screeningAction: scores?.recommendedAction ?? null,
        stage: selectedApp.stage,
        resumeUrl: candidate.resumeUrl,
        resumeText: candidate.resumeText,
        secondaryRecordingAvailable: recordingReady,
      })
    : [];

  const otherApps = selectedApp
    ? candidate.applications.filter((a) => a.id !== selectedApp.id)
    : candidate.applications;

  const interviewApp = selectedApp
    ? {
        id: selectedApp.id,
        candidateId: candidate.id,
        candidateName: fullName,
        candidateEmail: candidate.email,
        jobId: selectedApp.job.id,
        jobTitle: selectedApp.job.title,
      }
    : null;

  const section = "glass-card space-y-4 rounded-[var(--radius-card)] p-5";

  return (
    <div className="mx-auto w-full max-w-[1120px] space-y-6">
      <header className={section}>
        <Link
          href={backHref}
          className="text-[13px] text-muted-foreground hover:underline"
        >
          ← {selectedApp ? selectedApp.job.title : "Back to candidates"}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <h1 className="text-[30px] font-semibold leading-tight tracking-tight text-foreground">
              {fullName}
            </h1>
            {selectedApp ? (
              <p className="text-[15px] text-muted-foreground">{selectedApp.job.title}</p>
            ) : null}
            {selectedApp ? (
              <p
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold uppercase tracking-wide",
                  stageBadgeClass(selectedApp.stage),
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                {STAGE_LABELS[selectedApp.stage]}
              </p>
            ) : null}
            <div className="space-y-0.5 text-[13px] text-muted-foreground">
              <p>{expProfile}</p>
              {candidate.location ? <p>{candidate.location}</p> : null}
              <p>
                <a href={`mailto:${candidate.email}`} className="hover:underline">
                  {candidate.email}
                </a>
              </p>
            </div>
          </div>
          {selectedApp && canDecide ? (
            <div className="flex flex-wrap gap-2">
              <Link
                href="#decision"
                className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm text-foreground/90 hover:bg-muted/40"
              >
                Move Stage
              </Link>
              {interviewApp ? (
                <CreateInterviewDialog
                  applications={[interviewApp]}
                  triggerLabel="Create Interview"
                  preselectedApplicationId={selectedApp.id}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      {selectedApp ? (
        <section className={section} aria-labelledby="current-application">
          <div>
            <h2 id="current-application" className="text-[17px] font-semibold text-foreground">
              Current application
            </h2>
            <p className="mt-1 text-sm font-medium text-foreground">
              {selectedApp.job.title}
            </p>
          </div>
          <PipelineStrip current={selectedApp.stage} />
          {otherApps.length > 0 ? (
            <div>
              <h3 className="text-[13px] font-medium text-muted-foreground">
                Other applications
              </h3>
              <ul className="mt-1.5 space-y-1">
                {otherApps.map((app) => (
                  <li key={app.id}>
                    <Link
                      href={`/dashboard/candidates/${candidate.id}?applicationId=${app.id}`}
                      className="text-sm text-muted-foreground hover:text-foreground hover:underline"
                    >
                      {app.job.title} · {STAGE_LABELS[app.stage]}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {selectedApp ? (
        <section className={section} aria-labelledby="hiring-snapshot">
          <h2 id="hiring-snapshot" className="text-[17px] font-semibold text-foreground">
            Hiring snapshot
          </h2>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <SnapshotCell label="Experience" value={expSnapshot} />
            <SnapshotCell
              label="AI Match"
              value={aiMatch != null ? `${aiMatch}%` : "—"}
            />
            <SnapshotCell label="Interview" value={interviewLabel} />
            <SnapshotCell
              label="Current Stage"
              value={STAGE_LABELS[selectedApp.stage]}
            />
            <SnapshotCell
              label="Proctoring"
              value={proctoringSnapshotLabel({
                enabled: Boolean(latestInterview?.proctoringEnabled),
                eventCount: latestInterview?._count.proctoring ?? 0,
              })}
            />
          </dl>
        </section>
      ) : null}

      {selectedApp && attention.length > 0 ? (
        <section className={section} aria-labelledby="needs-attention">
          <h2 id="needs-attention" className="text-[17px] font-semibold text-warning">
            Needs attention
          </h2>
          <ul className="space-y-1">
            {attention.map((item) => (
              <li key={item.id}>
                {item.href ? (
                  <Link href={item.href} className="text-sm text-foreground hover:underline">
                    {item.label}
                  </Link>
                ) : (
                  <span className="text-sm text-foreground">{item.label}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : selectedApp ? (
        <p className="px-1 text-[13px] text-muted-foreground">No action required</p>
      ) : null}

      {selectedApp ? (
        <>
          <section className={section} aria-labelledby="profile">
            <h2 id="profile" className="text-[17px] font-semibold text-foreground">
              Profile
            </h2>
            <p className="text-sm font-medium text-foreground">{fullName}</p>
            <p className="text-sm text-muted-foreground">{selectedApp.job.title}</p>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-[12px] text-muted-foreground">Email</dt>
                <dd>
                  <a href={`mailto:${candidate.email}`} className="hover:underline">
                    {candidate.email}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted-foreground">Location</dt>
                <dd>{candidate.location || "—"}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted-foreground">Experience</dt>
                <dd>{expProfile}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted-foreground">Skills</dt>
                <dd>
                  {candidate.skills.length > 0
                    ? candidate.skills.join(" · ")
                    : "No skills available"}
                </dd>
              </div>
            </dl>
            <CandidateTags candidateId={candidate.id} />
          </section>

          <section id="resume" className={section} aria-labelledby="resume-heading">
            <h2 id="resume-heading" className="text-[17px] font-semibold text-foreground">
              Resume
            </h2>
            {candidate.resumeUrl ? (
              <>
                <p className="text-sm font-medium text-foreground">
                  {uploadedName ?? resumeFileName(candidate.resumeUrl)}
                </p>
                {resumeAt ? (
                  <p className="text-[13px] text-muted-foreground">
                    Uploaded {formatDate(resumeAt)}
                  </p>
                ) : null}
                <p className="inline-flex items-center gap-1.5 text-sm text-foreground">
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      candidate.resumeText ? "bg-success" : "bg-warning",
                    )}
                    aria-hidden
                  />
                  {candidate.resumeText
                    ? "Parsed successfully"
                    : "Resume could not be fully parsed."}
                </p>
                <div>
                  <p className="text-[12px] text-muted-foreground">Experience</p>
                  <p className="text-sm">{expProfile}</p>
                </div>
                {education.length > 0 ? (
                  <div>
                    <p className="text-[12px] text-muted-foreground">Education</p>
                    <p className="text-sm">{education.join(" · ")}</p>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <a
                    href={candidate.resumeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm hover:bg-muted/40"
                  >
                    View Resume
                  </a>
                  <a
                    href={candidate.resumeUrl}
                    download
                    className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm hover:bg-muted/40"
                  >
                    Download
                  </a>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No resume uploaded yet.</p>
            )}
            <ResumeUpload applicationId={selectedApp.id} />
          </section>

          <section className={section}>
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
          </section>

          <section className={section}>
            <InterviewStatusCard
              application={interviewApp!}
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
                      tokenExpiresAt: latestInterview.tokenExpiresAt,
                      startedAt: latestInterview.startedAt,
                      endedAt: latestInterview.endedAt,
                      secondaryRecordingStatus:
                        latestInterview.secondaryRecordingStatus,
                      secondaryRecordingPath: latestInterview.secondaryRecordingPath,
                      tabSwitches: signals.tabSwitches,
                      copyPaste: signals.copyPaste,
                      cameraInterruptions: signals.cameraInterruptions,
                    }
                  : null
              }
            />
          </section>

          <section id="communication" className={section} aria-labelledby="communication-heading">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="communication-heading" className="text-[17px] font-semibold text-foreground">
                Communication
              </h2>
              <CandidateComposeButton
                candidateId={candidate.id}
                applicationId={selectedApp.id}
              />
            </div>
            <CommunicationHistory
              candidateId={candidate.id}
              initialLogs={comms.map((l) => ({
                ...l,
                createdAt: l.createdAt.toISOString(),
                sentAt: l.sentAt?.toISOString() ?? null,
              }))}
            />
          </section>

          <section className={section} aria-labelledby="activity">
            <h2 id="activity" className="text-[17px] font-semibold text-foreground">
              Activity
            </h2>
            <CandidateTimeline items={timeline} />
          </section>

          {canDecide ? (
            <section className={section}>
              <ApplicationStageControls
                applicationId={selectedApp.id}
                currentStage={selectedApp.stage}
                decisionNote={decisionNote}
              />
            </section>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No applications yet.</p>
      )}
    </div>
  );
}

function SnapshotCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium text-foreground">{value}</dd>
    </div>
  );
}

function PipelineStrip({ current }: { current: PipelineStage }) {
  const steps = pipelineSteps(current);
  return (
    <ol className="flex gap-2 overflow-x-auto pb-1 text-[13px]">
      {steps.map((step, i) => {
        const state = pipelineStepState(step, current);
        return (
          <li key={step} className="inline-flex shrink-0 items-center gap-2">
            {i > 0 ? (
              <span className="text-muted-foreground/70" aria-hidden>
                →
              </span>
            ) : null}
            <span
              className={cn(
                state === "current" && "font-semibold text-foreground",
                state === "past" && "text-foreground/70",
                state === "future" && "text-muted-foreground",
              )}
            >
              {STAGE_LABELS[step]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
