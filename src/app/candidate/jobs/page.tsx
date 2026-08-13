import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { ApplyButton } from "@/components/apply-button";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function CandidateJobsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const jobs = await prisma.job.findMany({
    where: {
      status: "OPEN",
      ...(session.organizationId ? { organizationId: session.organizationId } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: { department: { select: { name: true } } },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Open roles</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Apply in one click. Screening is human-reviewed.
        </p>
      </div>
      <div className="space-y-4">
        {jobs.map((job) => (
          <article key={job.id} className="rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-medium text-foreground">{job.title}</h2>
                <p className="text-sm text-muted-foreground">
                  {[job.department?.name, job.location].filter(Boolean).join(" · ") ||
                    "Remote / TBD"}
                </p>
              </div>
              <ApplyButton jobId={job.id} />
            </div>
            <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">{job.description}</p>
          </article>
        ))}
        {jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open roles right now.</p>
        ) : null}
      </div>
    </div>
  );
}
