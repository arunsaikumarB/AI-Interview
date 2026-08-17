import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { JobStatus } from "@prisma/client";
import { getSession } from "@/lib/auth/session";
import { canManageJobs, orgScopeWhere } from "@/lib/auth/rbac";
import { loadJobsHub } from "@/lib/staff-reads/jobs-hub";
import { Badge } from "@/components/ui/badge";
import { RecruitingSubnav } from "@/components/recruiting-subnav";
import { JobsHubToolbar } from "@/components/jobs-hub-toolbar";
import { buttonVariants } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { JOB_STATUS_LABELS } from "@/lib/recruiting-ui";
import { cn } from "@/lib/utils";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Jobs & Candidates",
};

type Search = {
  q?: string;
  status?: string;
  sort?: string;
};

export default async function JobsPage({
  searchParams,
}: {
  searchParams?: Search;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const scope = orgScopeWhere(session);
  const canCreate = canManageJobs(session.role);

  const statusFilter =
    searchParams?.status &&
    ["DRAFT", "OPEN", "PAUSED", "CLOSED"].includes(searchParams.status)
      ? (searchParams.status as JobStatus)
      : undefined;
  const q = searchParams?.q?.trim() ?? "";

  const rows = await loadJobsHub({
    organizationId: scope.organizationId,
    q,
    statusFilter,
  });

  const sort = searchParams?.sort ?? "updated";
  rows.sort((a, b) => {
    if (sort === "title") return a.title.localeCompare(b.title);
    if (sort === "applications") return b.applications - a.applications;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });

  return (
    <div className="space-y-6">
      <RecruitingSubnav />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">
            Jobs &amp; Candidates
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage open roles and review applicants.
          </p>
        </div>
        {canCreate ? (
          <Link
            href="/dashboard/jobs/new"
            className={cn(buttonVariants({ variant: "default" }))}
          >
            + Add Job
          </Link>
        ) : null}
      </div>

      <Suspense fallback={null}>
        <JobsHubToolbar />
      </Suspense>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 px-6 py-12 text-center">
          <p className="text-sm font-medium text-foreground">No jobs yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first job to start receiving candidates.
          </p>
          {canCreate ? (
            <Link
              href="/dashboard/jobs/new"
              className={cn(buttonVariants({ variant: "default" }), "mt-4")}
            >
              Add Job
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Job</th>
                <th className="px-4 py-3 font-medium">Applications</th>
                <th className="px-4 py-3 font-medium">In Interview</th>
                <th className="px-4 py-3 font-medium">Selected</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((job) => (
                <tr key={job.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/jobs/${job.id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {job.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {job.location ?? "—"}
                    </p>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-foreground/90">
                    {job.applications}
                    <span className="ml-1 text-xs text-muted-foreground">
                      application{job.applications === 1 ? "" : "s"}
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-foreground/90">
                    {job.inInterview}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-foreground/90">
                    {job.selected}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="secondary">
                      {JOB_STATUS_LABELS[job.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDate(job.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
