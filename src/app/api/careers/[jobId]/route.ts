import { prisma } from "@/lib/db";
import { handleApiError, jsonOk } from "@/lib/api";

type Ctx = { params: { jobId: string } };

/** Public — full JD for OPEN jobs. No candidate data. */
export async function GET(_request: Request, { params }: Ctx) {
  try {
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
        organization: { select: { id: true, name: true } },
      },
    });

    if (!job) {
      return Response.json({ error: "Job not found" }, { status: 404 });
    }

    return jsonOk({
      job: {
        id: job.id,
        title: job.title,
        description: job.description,
        location: job.location,
        employmentType: job.employmentType,
        experienceMin: job.experienceMin,
        experienceMax: job.experienceMax,
        skills: job.skills,
        department: job.department?.name ?? null,
        organizationName: job.organization.name,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
