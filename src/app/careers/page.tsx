import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const EMPLOYMENT_LABELS: Record<string, string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  CONTRACT: "Contract",
  INTERN: "Intern",
  TEMPORARY: "Temporary",
};

function experienceLabel(min: number, max: number | null) {
  if (max == null) return `${min}+ years`;
  if (min === max) return `${min} years`;
  return `${min}–${max} years`;
}

export default async function CareersPage() {
  const jobs = await prisma.job.findMany({
    where: { status: "OPEN" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      location: true,
      employmentType: true,
      experienceMin: true,
      experienceMax: true,
      department: { select: { name: true } },
      organization: { select: { name: true } },
    },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-sans text-4xl font-semibold tracking-tight text-foreground">Open roles</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Apply in a few minutes — no account required.
        </p>
      </div>
      <ul className="space-y-3">
        {jobs.map((job) => (
          <li key={job.id}>
            <Link
              href={`/careers/${job.id}`}
              className="block rounded-xl border border-border bg-card/80 px-5 py-4 transition hover:border-border hover:bg-card"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-foreground">{job.title}</p>
                <p className="text-xs text-muted-foreground">{job.organization.name}</p>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {[
                  job.department?.name,
                  job.location,
                  EMPLOYMENT_LABELS[job.employmentType] ?? job.employmentType,
                  experienceLabel(job.experienceMin, job.experienceMax),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </Link>
          </li>
        ))}
        {jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open roles right now. Check back soon.</p>
        ) : null}
      </ul>
    </div>
  );
}
