import { prisma } from "@/lib/db";
import { handleApiError, jsonOk } from "@/lib/api";

/** Public — OPEN jobs only. No candidate data. */
export async function GET() {
  try {
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
        organization: { select: { id: true, name: true } },
      },
    });

    return jsonOk({
      jobs: jobs.map((j) => ({
        id: j.id,
        title: j.title,
        location: j.location,
        employmentType: j.employmentType,
        experienceMin: j.experienceMin,
        experienceMax: j.experienceMax,
        department: j.department?.name ?? null,
        organizationName: j.organization.name,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
