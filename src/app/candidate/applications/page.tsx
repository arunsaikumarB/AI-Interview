import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { STAGE_LABELS } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function CandidateApplicationsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const candidate = await prisma.candidate.findUnique({
    where: { userId: session.id },
  });

  const applications = candidate
    ? await prisma.application.findMany({
        where: { candidateId: candidate.id },
        orderBy: { updatedAt: "desc" },
        include: {
          job: {
            select: {
              title: true,
              department: { select: { name: true } },
            },
          },
        },
      })
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-slate-900">My applications</h1>
        <p className="mt-2 text-sm text-slate-500">Track where you are in the hiring pipeline.</p>
      </div>
      <div className="space-y-3">
        {applications.map((app) => (
          <article key={app.id} className="rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium text-slate-900">{app.job.title}</p>
                <p className="text-sm text-slate-500">{app.job.department?.name ?? "—"}</p>
              </div>
              <Badge>{STAGE_LABELS[app.stage]}</Badge>
            </div>
          </article>
        ))}
        {applications.length === 0 ? (
          <p className="text-sm text-slate-500">You have not applied yet.</p>
        ) : null}
      </div>
    </div>
  );
}
