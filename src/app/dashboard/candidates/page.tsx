import Link from "next/link";
import { redirect } from "next/navigation";
import type { PipelineStage, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { buttonVariants } from "@/components/ui/button";
import { RESUME_PARSER_LABEL, RESUME_PARSER_SOURCE } from "@/lib/resume-parser-import/constants";
import { ACTIVE_PIPELINE_FILTER, IN_HIRING_CANDIDATE_FILTER } from "@/lib/resume-parser-import/pipeline-filter";
import { UPLOAD_ROLES } from "@/lib/resume-upload/constants";
import { getSession } from "@/lib/auth/session";
import { orgScopeWhere } from "@/lib/auth/rbac";
import { RecruitingSubnav } from "@/components/recruiting-subnav";
import { STAGE_LABELS } from "@/lib/constants";
import { ScreeningResultSchema } from "@/lib/ai/screening";
import { formatDate } from "@/lib/format";
import { CandidatesListToolbar } from "@/components/candidates-list-toolbar";
import { Suspense } from "react";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Candidates",
};

type Search = {
  q?: string;
  stage?: string;
  sort?: string;
  page?: string;
};

const PAGE_SIZE = 50;

export default async function CandidatesPage({
  searchParams,
}: {
  searchParams?: Search;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const scope = orgScopeWhere(session);
  const q = searchParams?.q?.trim() ?? "";
  const stageFilter =
    searchParams?.stage && searchParams.stage in STAGE_LABELS
      ? (searchParams.stage as PipelineStage)
      : undefined;

  const where: Prisma.CandidateWhereInput = {
    ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
    AND: [
      IN_HIRING_CANDIDATE_FILTER,
      ...(q
        ? [
            {
              OR: [
                { firstName: { contains: q, mode: "insensitive" } },
                { lastName: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
                {
                  applications: {
                    some: {
                      AND: [ACTIVE_PIPELINE_FILTER, { job: { title: { contains: q, mode: "insensitive" } } }],
                    },
                  },
                },
              ],
            } satisfies Prisma.CandidateWhereInput,
          ]
        : []),
      ...(stageFilter
        ? [{ applications: { some: { AND: [ACTIVE_PIPELINE_FILTER, { stage: stageFilter }] } } }]
        : []),
    ],
  };

  const latestApplication = {
    where: ACTIVE_PIPELINE_FILTER,
    orderBy: { updatedAt: "desc" },
    take: 1,
    include: {
      job: { select: { title: true } },
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
  } satisfies Prisma.Candidate$applicationsArgs;
  const include = {
    applications: latestApplication,
    _count: {
      select: { applications: { where: { source: RESUME_PARSER_SOURCE } } },
    },
  } satisfies Prisma.CandidateInclude;

  const sort = searchParams?.sort ?? "updated";
  const total = await prisma.candidate.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const requestedPage = Number.parseInt(searchParams?.page ?? "1", 10);
  const page = Number.isFinite(requestedPage)
    ? Math.min(Math.max(requestedPage, 1), pageCount)
    : 1;
  const skip = (page - 1) * PAGE_SIZE;

  const matchOf = (app: { aiEvaluations: { scores: unknown }[] } | undefined) => {
    const parsed = ScreeningResultSchema.safeParse(app?.aiEvaluations[0]?.scores);
    return parsed.success ? parsed.data.overall : null;
  };

  let candidates;
  if (sort === "match") {
    // Only screened candidates can have a match score; everyone else follows by last update.
    const screened = await prisma.candidate.findMany({
      where: {
        AND: [
          where,
          { applications: { some: { aiEvaluations: { some: { kind: "RESUME_SCREEN" } } } } },
        ],
      },
      select: { id: true, updatedAt: true, applications: latestApplication },
    });
    const scored = screened
      .map((c) => ({ id: c.id, updatedAt: c.updatedAt, match: matchOf(c.applications[0]) }))
      .filter((c): c is { id: string; updatedAt: Date; match: number } => c.match !== null)
      .sort((a, b) => b.match - a.match || b.updatedAt.getTime() - a.updatedAt.getTime());
    const pageIds = scored.slice(skip, skip + PAGE_SIZE).map((c) => c.id);
    if (pageIds.length < PAGE_SIZE) {
      const rest = await prisma.candidate.findMany({
        where: { AND: [where, { id: { notIn: scored.map((c) => c.id) } }] },
        orderBy: { updatedAt: "desc" },
        skip: Math.max(0, skip - scored.length),
        take: PAGE_SIZE - pageIds.length,
        select: { id: true },
      });
      pageIds.push(...rest.map((c) => c.id));
    }
    const found = await prisma.candidate.findMany({
      where: { id: { in: pageIds } },
      include,
    });
    const byId = new Map(found.map((c) => [c.id, c]));
    candidates = pageIds.flatMap((id) => byId.get(id) ?? []);
  } else {
    candidates = await prisma.candidate.findMany({
      where,
      orderBy:
        sort === "name"
          ? [{ firstName: "asc" }, { lastName: "asc" }]
          : { updatedAt: "desc" },
      skip,
      take: PAGE_SIZE,
      include,
    });
  }

  const rows = candidates.map((c) => {
    const app = c.applications[0] ?? null;
    return {
      id: c.id,
      name: `${c.firstName} ${c.lastName}`.trim(),
      email: c.email,
      experience: c.experience,
      aiMatch: matchOf(app ?? undefined),
      stage: app?.stage ?? null,
      onHold: app?.status === "ON_HOLD",
      jobTitle: app?.job.title ?? null,
      applicationId: app?.id ?? null,
      interviewStatus: app?.interviewSessions[0]?.status ?? null,
      updatedAt: c.updatedAt,
      fromResumeParser: c._count.applications > 0,
    };
  });

  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (stageFilter) sp.set("stage", stageFilter);
    if (sort !== "updated") sp.set("sort", sort);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `/dashboard/candidates?${s}` : "/dashboard/candidates";
  };
  const canImport = UPLOAD_ROLES.includes(session.role);

  return (
    <div className="space-y-6">
      <RecruitingSubnav />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Candidates</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            People in a HireOS hiring process. Open a role from Jobs for a focused
            workspace. Historical and uploaded profiles not in hiring are in the{" "}
            <Link href="/dashboard/talent" className="underline hover:text-foreground">
              Talent Pool
            </Link>
            .
          </p>
        </div>
        {canImport ? (
          <Link
            href="/dashboard/candidates/import"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Upload resumes
          </Link>
        ) : null}
      </div>

      <Suspense fallback={null}>
        <CandidatesListToolbar />
      </Suspense>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Candidate</th>
              <th className="px-4 py-3 font-medium">Experience</th>
              <th className="px-4 py-3 font-medium">AI Match</th>
              <th className="px-4 py-3 font-medium">Stage</th>
              <th className="px-4 py-3 font-medium">Interview</th>
              <th className="px-4 py-3 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-t border-border">
                <td className="px-4 py-3">
                  <Link
                    href={
                      c.applicationId
                        ? `/dashboard/candidates/${c.id}?applicationId=${c.applicationId}`
                        : `/dashboard/candidates/${c.id}`
                    }
                    className="font-medium text-foreground hover:underline"
                  >
                    {c.name}
                  </Link>
                  {c.fromResumeParser ? (
                    <span className="ml-2 rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {RESUME_PARSER_LABEL}
                    </span>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {c.email}
                    {c.jobTitle ? ` · ${c.jobTitle}` : ""}
                  </p>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {c.experience} yr{c.experience === 1 ? "" : "s"}
                </td>
                <td className="px-4 py-3">
                  {c.aiMatch == null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <div>
                      <span className="tabular-nums text-foreground">
                        {Math.round(c.aiMatch)}%
                      </span>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        AI Match
                      </p>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-foreground/90">
                  {c.stage ? STAGE_LABELS[c.stage] : "—"}
                  {c.onHold ? (
                    <span className="text-muted-foreground"> · On hold</span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {c.interviewStatus === "COMPLETED"
                    ? "Completed"
                    : c.interviewStatus === "IN_PROGRESS"
                      ? "In progress"
                      : c.interviewStatus === "SCHEDULED"
                        ? "Scheduled"
                        : "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {formatDate(c.updatedAt)}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-muted-foreground"
                >
                  No candidates in hiring yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {total > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <p>
            Showing {skip + 1}–{skip + rows.length} of {total}
          </p>
          {pageCount > 1 ? (
            <div className="flex items-center gap-2">
              {page > 1 ? (
                <Link
                  href={pageHref(page - 1)}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Previous
                </Link>
              ) : null}
              <span className="tabular-nums">
                Page {page} of {pageCount}
              </span>
              {page < pageCount ? (
                <Link
                  href={pageHref(page + 1)}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Next
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
