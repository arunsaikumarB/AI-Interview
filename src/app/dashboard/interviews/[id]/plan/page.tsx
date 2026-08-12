import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { canManagePipeline } from "@/lib/auth/rbac";
import { InterviewPlanEditor } from "@/components/interview-plan-editor";
import { parsePlan } from "@/lib/ai/interview-session";

type Ctx = { params: { id: string } };

export const dynamic = "force-dynamic";

export default async function InterviewPlanPage({ params }: Ctx) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canManagePipeline(session.role)) redirect("/dashboard");

  const interview = await prisma.interviewSession.findUnique({
    where: { id: params.id },
    include: {
      application: {
        include: {
          job: { select: { title: true, organizationId: true } },
          candidate: {
            select: { firstName: true, lastName: true, id: true },
          },
        },
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

  const plan = parsePlan(interview.plan);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return (
    <div className="space-y-4">
      <Link
        href={`/dashboard/candidates/${interview.application.candidate.id}?applicationId=${interview.applicationId}`}
        className="text-sm text-slate-500 hover:underline"
      >
        ← Back to candidate
      </Link>
      <InterviewPlanEditor
        interviewId={interview.id}
        initialPlan={plan}
        editable={interview.status === "SCHEDULED"}
        candidateLink={`${appUrl}/interview/${interview.accessToken}`}
        jobTitle={interview.application.job.title}
        candidateName={`${interview.application.candidate.firstName} ${interview.application.candidate.lastName}`}
      />
    </div>
  );
}
