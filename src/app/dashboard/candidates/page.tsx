import Link from "next/link";
import { redirect } from "next/navigation";
import type { PipelineStage } from "@prisma/client";
import { prisma } from "@/lib/db";
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
};

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

  const candidates = await prisma.candidate.findMany({
    where: {
      ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
      ...(q
        ? {
            OR: [
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              {
                applications: {
                  some: {
                    job: { title: { contains: q, mode: "insensitive" } },
                  },
                },
              },
            ],
          }
        : {}),
      ...(stageFilter
        ? { applications: { some: { stage: stageFilter } } }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    include: {
      applications: {
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
      },
    },
  });

  let rows = candidates.map((c) => {
    const app = c.applications[0] ?? null;
    const parsed = ScreeningResultSchema.safeParse(
      app?.aiEvaluations[0]?.scores,
    );
    return {
      id: c.id,
      name: `${c.firstName} ${c.lastName}`.trim(),
      email: c.email,
      experience: c.experience,
      aiMatch: parsed.success ? parsed.data.overall : null,
      stage: app?.stage ?? null,
      jobTitle: app?.job.title ?? null,
      applicationId: app?.id ?? null,
      interviewStatus: app?.interviewSessions[0]?.status ?? null,
      updatedAt: c.updatedAt,
    };
  });

  const sort = searchParams?.sort ?? "updated";
  rows = [...rows].sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "match") return (b.aiMatch ?? -1) - (a.aiMatch ?? -1);
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });

  return (
    <div className="space-y-6">
      <RecruitingSubnav />
      <div>
        <h1 className="page-title">Candidates</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Review applicants across jobs. Open a role from Jobs for a focused
          workspace.
        </p>
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
                  No candidates yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
