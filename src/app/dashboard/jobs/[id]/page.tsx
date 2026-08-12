import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { canManageJobs, canManagePipeline, orgScopeWhere } from "@/lib/auth/rbac";
import { JobForm } from "@/components/job-form";
import { JobDeleteButton } from "@/components/job-delete-button";
import { ScreenAllButton } from "@/components/screen-all-button";
import { PipelineBoard } from "@/components/pipeline-board";
import { JobCandidatesTable } from "@/components/job-candidates-table";
import {
  JobWorkspaceTabs,
  type JobWorkspaceTab,
} from "@/components/job-workspace-tabs";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ScreeningResultSchema } from "@/lib/ai/screening";
import { formatDate } from "@/lib/format";
import {
  EMPLOYMENT_TYPE_LABELS,
  isInInterviewStage,
  JOB_STATUS_LABELS,
} from "@/lib/recruiting-ui";
import { cn } from "@/lib/utils";

type Ctx = {
  params: { id: string };
  searchParams?: { tab?: string };
};

export const dynamic = "force-dynamic";

function parseTab(raw?: string): JobWorkspaceTab {
  if (raw === "pipeline" || raw === "details") return raw;
  return "candidates";
}

export default async function JobDetailPage({ params, searchParams }: Ctx) {
  const session = await getSession();
  if (!session) redirect("/login");
  const scope = orgScopeWhere(session);
  const tab = parseTab(searchParams?.tab);
  const canEdit = canManageJobs(session.role);
  const canPipeline = canManagePipeline(session.role);

  const job = await prisma.job.findFirst({
    where: { id: params.id, ...scope },
    include: {
      department: true,
      applications: {
        orderBy: { updatedAt: "desc" },
        include: {
          candidate: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              experience: true,
            },
          },
          aiEvaluations: {
            where: { kind: "RESUME_SCREEN" },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { scores: true },
          },
          interviewSessions: {
            orderBy: { updatedAt: "desc" },
            take: 1,
            select: { status: true },
          },
        },
      },
    },
  });
  if (!job) notFound();

  const criteria =
    job.screeningCriteria && typeof job.screeningCriteria === "object"
      ? (job.screeningCriteria as { mustHave?: string[]; niceToHave?: string[] })
      : {};

  const applications = job.applications.length;
  const screening = job.applications.filter((a) => a.stage === "SCREENING").length;
  const interviews = job.applications.filter((a) =>
    isInInterviewStage(a.stage),
  ).length;
  const selected = job.applications.filter((a) => a.stage === "SELECTED").length;

  const candidateRows = job.applications.map((app) => {
    const parsed = ScreeningResultSchema.safeParse(app.aiEvaluations[0]?.scores);
    return {
      applicationId: app.id,
      candidateId: app.candidate.id,
      name: `${app.candidate.firstName} ${app.candidate.lastName}`.trim(),
      email: app.candidate.email,
      experience: app.candidate.experience,
      aiMatch: parsed.success ? parsed.data.overall : null,
      stage: app.stage,
      interviewStatus: app.interviewSessions[0]?.status ?? null,
      updatedAt: app.updatedAt.toISOString(),
    };
  });

  const meta = [
    job.location,
    EMPLOYMENT_TYPE_LABELS[job.employmentType],
    job.department?.name,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/dashboard/jobs"
            className="text-sm text-slate-500 hover:underline"
          >
            ← Jobs &amp; Candidates
          </Link>
          <h1 className="mt-2 font-display text-3xl text-slate-900">{job.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{JOB_STATUS_LABELS[job.status]}</Badge>
            {meta ? <p className="text-sm text-slate-500">{meta}</p> : null}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            AI screening is advisory. Pipeline moves stay with your team.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit ? (
            <Link
              href={`/dashboard/jobs/${job.id}?tab=details`}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              Edit Job
            </Link>
          ) : null}
          {canPipeline ? (
            <Link
              href={`/dashboard/interview-links?create=1&jobId=${job.id}`}
              className={cn(buttonVariants({ variant: "default" }))}
            >
              Create Interview Link
            </Link>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Applications", value: applications },
          { label: "Screening", value: screening },
          { label: "Interviews", value: interviews },
          { label: "Selected", value: selected },
        ].map((m) => (
          <div
            key={m.label}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {m.label}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
              {m.value}
            </p>
          </div>
        ))}
      </div>

      <JobWorkspaceTabs jobId={job.id} active={tab} />

      {tab === "candidates" ? (
        candidateRows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center">
            <p className="text-sm font-medium text-slate-900">No applicants yet</p>
            <p className="mt-1 text-sm text-slate-500">
              Candidates who apply to this role will appear here.
            </p>
          </div>
        ) : (
          <JobCandidatesTable rows={candidateRows} />
        )
      ) : null}

      {tab === "pipeline" ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            Drag cards to move stages. AI never auto-advances — every move is a
            human action.
          </p>
          <PipelineBoard jobId={job.id} />
        </div>
      ) : null}

      {tab === "details" ? (
        <div className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">Job Details</h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-slate-500">Job Title</dt>
                <dd className="text-slate-900">{job.title}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Department</dt>
                <dd className="text-slate-900">{job.department?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Location</dt>
                <dd className="text-slate-900">{job.location ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Employment Type</dt>
                <dd className="text-slate-900">
                  {EMPLOYMENT_TYPE_LABELS[job.employmentType]}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Status</dt>
                <dd className="text-slate-900">{JOB_STATUS_LABELS[job.status]}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Created</dt>
                <dd className="text-slate-900">{formatDate(job.createdAt)}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-500">Skills</dt>
                <dd className="text-slate-900">
                  {job.skills.length ? job.skills.join(" · ") : "—"}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-500">Description</dt>
                <dd className="mt-1 whitespace-pre-wrap text-slate-700">
                  {job.description}
                </dd>
              </div>
              {(criteria.mustHave?.length || criteria.niceToHave?.length) ? (
                <div className="sm:col-span-2 grid gap-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-slate-500">Must-have</dt>
                    <dd className="mt-1 text-slate-700">
                      {(criteria.mustHave ?? []).join(", ") || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Nice-to-have</dt>
                    <dd className="mt-1 text-slate-700">
                      {(criteria.niceToHave ?? []).join(", ") || "—"}
                    </dd>
                  </div>
                </div>
              ) : null}
            </dl>
          </section>

          {canEdit || canPipeline ? (
            <div className="flex flex-wrap gap-2">
              {canPipeline ? <ScreenAllButton jobId={job.id} /> : null}
              {canEdit ? <JobDeleteButton jobId={job.id} /> : null}
            </div>
          ) : null}

          {canEdit ? (
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-slate-900">Edit Job</h2>
              <JobForm
                initial={{
                  id: job.id,
                  title: job.title,
                  departmentId: job.departmentId,
                  location: job.location,
                  description: job.description,
                  skills: job.skills,
                  experienceMin: job.experienceMin,
                  experienceMax: job.experienceMax,
                  status: job.status,
                  screeningCriteria: criteria,
                }}
              />
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
