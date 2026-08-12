import { redirect } from "next/navigation";
import { InterviewLinksPanel } from "@/components/interview-links-panel";
import { getSession } from "@/lib/auth/session";
import { canManagePipeline, orgScopeWhere } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function InterviewLinksPage({
  searchParams,
}: {
  searchParams?: { filter?: string };
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

  const [sessions, applications] = await Promise.all([
    prisma.interviewSession.findMany({
      where: sessionWhere,
      orderBy: { updatedAt: "desc" },
      take: 40,
      select: {
        id: true,
        status: true,
        interviewType: true,
        deliveryMode: true,
        accessToken: true,
        createdAt: true,
        scheduledAt: true,
        application: {
          select: {
            stage: true,
            candidate: { select: { firstName: true, lastName: true } },
            job: { select: { title: true } },
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
      take: 50,
      select: {
        id: true,
        candidate: { select: { firstName: true, lastName: true } },
        job: { select: { title: true } },
      },
    }),
  ]);

  const rows = sessions.map((s) => {
    const decided =
      s.application.stage === "SELECTED" || s.application.stage === "REJECTED";
    return {
      id: s.id,
      status: s.status,
      interviewType: s.interviewType,
      deliveryMode: s.deliveryMode,
      accessToken: s.accessToken,
      createdAt: s.createdAt.toISOString(),
      scheduledAt: s.scheduledAt?.toISOString() ?? null,
      candidateName:
        `${s.application.candidate.firstName} ${s.application.candidate.lastName}`.trim(),
      jobTitle: s.application.job.title,
      awaitingDecision: s.status === "COMPLETED" && !decided,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-slate-900">Interview Links</h1>
        <p className="mt-2 text-sm text-slate-500">
          Create sessions, copy candidate links, and open interview reports. AI suggestions
          are advisory — you decide.
        </p>
      </div>
      <InterviewLinksPanel
        rows={rows}
        applications={applications.map((a) => ({
          id: a.id,
          label: `${a.candidate.firstName} ${a.candidate.lastName} · ${a.job.title}`,
        }))}
        filterAwaiting={searchParams?.filter === "awaiting"}
      />
    </div>
  );
}
