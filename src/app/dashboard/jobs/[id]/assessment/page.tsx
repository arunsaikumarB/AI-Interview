import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { canManagePipeline } from "@/lib/auth/rbac";
import { AssessmentEngineService } from "@/lib/assessment/service";
import { loadBlueprintSources, RECORD_ID_RE } from "@/lib/assessment/load";
import { AssessmentBlueprintView } from "@/components/assessment-blueprint-view";
import { AssessmentAiGenerate } from "@/components/assessment-ai-generate";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Assessment Blueprint",
};

export const dynamic = "force-dynamic";

type Ctx = {
  params: { id: string };
  searchParams?: { applicationId?: string };
};

export default async function AssessmentBlueprintPage({ params, searchParams }: Ctx) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canManagePipeline(session.role)) notFound();
  if (!RECORD_ID_RE.test(params.id)) notFound();

  const rawAppId = searchParams?.applicationId;
  const applicationId = rawAppId && RECORD_ID_RE.test(rawAppId) ? rawAppId : null;

  let sources = await loadBlueprintSources(session, params.id, applicationId);
  if (sources.kind === "JOB_NOT_FOUND") notFound();
  const applicationMissing = sources.kind === "APPLICATION_NOT_FOUND" || (rawAppId != null && !applicationId);
  if (sources.kind === "APPLICATION_NOT_FOUND") {
    sources = await loadBlueprintSources(session, params.id, null);
  }
  if (sources.kind !== "OK") notFound();

  const blueprint = AssessmentEngineService.buildBlueprint({
    job: sources.job,
    candidate: sources.candidate,
  });

  const applicants = await prisma.application.findMany({
    where: { jobId: sources.job.id },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true,
      candidate: { select: { firstName: true, lastName: true } },
    },
  });

  const base = `/dashboard/jobs/${sources.job.id}/assessment`;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/dashboard/jobs/${sources.job.id}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← {blueprint.job.title}
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Assessment Blueprint</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Advisory planning aid generated from this job
          {blueprint.candidate ? ` and ${blueprint.candidate.name}'s resume` : ""}. It does not score
          candidates, change pipeline stages or make hiring decisions, and it never uses proctoring
          signals or protected attributes.
        </p>
      </div>

      <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Resume grounding
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Link
            href={base}
            className={cn(
              "rounded-full border px-3 py-1 text-[13px] font-medium transition-colors",
              !blueprint.candidate
                ? "border-foreground/20 bg-foreground text-background"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            Job only
          </Link>
          {applicants.map((a) => {
            const name = `${a.candidate.firstName} ${a.candidate.lastName}`.trim();
            const active = blueprint.candidate?.applicationId === a.id;
            return (
              <Link
                key={a.id}
                href={`${base}?applicationId=${encodeURIComponent(a.id)}`}
                className={cn(
                  "rounded-full border px-3 py-1 text-[13px] font-medium transition-colors",
                  active
                    ? "border-foreground/20 bg-foreground text-background"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {name || "Unnamed candidate"}
              </Link>
            );
          })}
        </div>
        {applicationMissing ? (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
            That application was not found for this job. Showing the job-level blueprint.
          </p>
        ) : null}
      </section>

      <AssessmentAiGenerate
        key={blueprint.candidate?.applicationId ?? "job"}
        jobId={sources.job.id}
        applicationId={blueprint.candidate?.applicationId ?? null}
      >
        <AssessmentBlueprintView blueprint={blueprint} />
      </AssessmentAiGenerate>
    </div>
  );
}
