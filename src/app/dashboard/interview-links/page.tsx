import { redirect } from "next/navigation";
import { InterviewLinksPanel } from "@/components/interview-links-panel";
import { getSession } from "@/lib/auth/session";
import { canManagePipeline, orgScopeWhere } from "@/lib/auth/rbac";
import { interviewLinkDisplayStatus } from "@/lib/interview-links";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type Search = {
  q?: string;
  status?: string;
  sort?: string;
  filter?: string;
  create?: string;
  applicationId?: string;
  candidateId?: string;
  jobId?: string;
};

export default async function InterviewLinksPage({
  searchParams,
}: {
  searchParams?: Search;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canManagePipeline(session.role)) redirect("/dashboard");

  const scope = orgScopeWhere(session);
  const orgId = scope.organizationId;
  const sessionWhere = orgId
    ? { application: { job: { organizationId: orgId } } }
    : {};
  const appWhere = orgId ? { job: { organizationId: orgId } } : {};

  const q = searchParams?.q?.trim() ?? "";
  const statusFilter = searchParams?.status?.trim() ?? "";
  const sort = searchParams?.sort ?? "created";
  const filterAwaiting = searchParams?.filter === "awaiting";
  const createOpen =
    searchParams?.create === "1" ||
    Boolean(searchParams?.applicationId) ||
    Boolean(searchParams?.candidateId);

  const [sessions, applications] = await Promise.all([
    prisma.interviewSession.findMany({
      where: {
        ...sessionWhere,
        ...(q
          ? {
              OR: [
                {
                  application: {
                    candidate: {
                      OR: [
                        { firstName: { contains: q, mode: "insensitive" } },
                        { lastName: { contains: q, mode: "insensitive" } },
                        { email: { contains: q, mode: "insensitive" } },
                      ],
                    },
                  },
                },
                {
                  application: {
                    job: { title: { contains: q, mode: "insensitive" } },
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        status: true,
        interviewType: true,
        deliveryMode: true,
        accessToken: true,
        createdAt: true,
        tokenExpiresAt: true,
        scheduledAt: true,
        applicationId: true,
        application: {
          select: {
            id: true,
            stage: true,
            candidate: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            job: { select: { id: true, title: true } },
          },
        },
      },
    }),
    prisma.application.findMany({
      where: {
        ...appWhere,
        status: { in: ["ACTIVE", "ON_HOLD"] },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: {
        id: true,
        candidate: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        job: { select: { id: true, title: true } },
      },
    }),
  ]);

  let rows = sessions.map((s) => {
    const decided =
      s.application.stage === "SELECTED" || s.application.stage === "REJECTED";
    const displayStatus = interviewLinkDisplayStatus({
      status: s.status,
      tokenExpiresAt: s.tokenExpiresAt,
    });
    return {
      id: s.id,
      status: s.status,
      displayStatus,
      interviewType: s.interviewType,
      deliveryMode: s.deliveryMode,
      accessToken: s.accessToken,
      createdAt: s.createdAt.toISOString(),
      tokenExpiresAt: s.tokenExpiresAt?.toISOString() ?? null,
      candidateName:
        `${s.application.candidate.firstName} ${s.application.candidate.lastName}`.trim(),
      candidateId: s.application.candidate.id,
      jobTitle: s.application.job.title,
      applicationId: s.application.id,
      awaitingDecision: s.status === "COMPLETED" && !decided,
    };
  });

  if (filterAwaiting) {
    rows = rows.filter((r) => r.awaitingDecision);
  }
  if (statusFilter && statusFilter !== "all") {
    rows = rows.filter((r) => r.displayStatus === statusFilter);
  }

  rows = [...rows].sort((a, b) => {
    switch (sort) {
      case "expires": {
        const ae = a.tokenExpiresAt ? new Date(a.tokenExpiresAt).getTime() : 0;
        const be = b.tokenExpiresAt ? new Date(b.tokenExpiresAt).getTime() : 0;
        return be - ae;
      }
      case "candidate":
        return a.candidateName.localeCompare(b.candidateName);
      case "job":
        return a.jobTitle.localeCompare(b.jobTitle);
      case "created":
      default:
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
  });

  const appOptions = applications.map((a) => ({
    id: a.id,
    candidateId: a.candidate.id,
    candidateName: `${a.candidate.firstName} ${a.candidate.lastName}`.trim(),
    candidateEmail: a.candidate.email,
    jobId: a.job.id,
    jobTitle: a.job.title,
  }));

  return (
    <InterviewLinksPanel
      rows={rows}
      applications={appOptions}
      createOpen={createOpen}
      preselectedApplicationId={searchParams?.applicationId}
      preselectedCandidateId={searchParams?.candidateId}
      preselectedJobId={searchParams?.jobId}
    />
  );
}
