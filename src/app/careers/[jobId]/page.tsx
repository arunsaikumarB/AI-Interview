import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

type Props = { params: { jobId: string } };

const EMPLOYMENT_LABELS: Record<string, string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  CONTRACT: "Contract",
  INTERN: "Intern",
  TEMPORARY: "Temporary",
};

export default async function CareerJobPage({ params }: Props) {
  const job = await prisma.job.findFirst({
    where: { id: params.jobId, status: "OPEN" },
    select: {
      id: true,
      title: true,
      description: true,
      location: true,
      employmentType: true,
      experienceMin: true,
      experienceMax: true,
      skills: true,
      department: { select: { name: true } },
      organization: { select: { name: true } },
    },
  });

  if (!job) notFound();

  const experience =
    job.experienceMax == null
      ? `${job.experienceMin}+ years`
      : `${job.experienceMin}–${job.experienceMax} years`;

  return (
    <article className="space-y-8">
      <div>
        <p className="text-sm text-muted-foreground">{job.organization.name}</p>
        <h1 className="mt-1 font-sans text-4xl font-semibold tracking-tight text-foreground">{job.title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {[
            job.department?.name,
            job.location,
            EMPLOYMENT_LABELS[job.employmentType],
            experience,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {job.skills.length > 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Skills: {job.skills.join(", ")}
          </p>
        ) : null}
      </div>

      <div className="prose max-w-none whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
        {job.description}
      </div>

      <Link href={`/careers/${job.id}/apply`}>
        <Button size="lg">Apply for this role</Button>
      </Link>
    </article>
  );
}
