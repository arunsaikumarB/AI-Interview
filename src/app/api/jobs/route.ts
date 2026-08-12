import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import {
  canManageJobs,
  orgScopeWhere,
  requireOrganizationId,
  requireRoles,
  requireUser,
  AuthError,
} from "@/lib/auth/rbac";
import { handleApiError, jsonCreated, jsonOk } from "@/lib/api";

const createSchema = z.object({
  title: z.string().min(2),
  departmentId: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  description: z.string().min(10),
  skills: z.array(z.string()).optional(),
  experienceMin: z.number().int().min(0).optional(),
  experienceMax: z.number().int().min(0).nullable().optional(),
  salaryMin: z.number().int().optional().nullable(),
  salaryMax: z.number().int().optional().nullable(),
  employmentType: z
    .enum(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN", "TEMPORARY"])
    .optional(),
  openings: z.number().int().min(1).optional(),
  status: z.enum(["DRAFT", "OPEN", "PAUSED", "CLOSED"]).optional(),
  screeningCriteria: z
    .object({
      mustHave: z.array(z.string()).optional(),
      niceToHave: z.array(z.string()).optional(),
    })
    .optional(),
  interviewStages: z.unknown().optional(),
  organizationId: z.string().optional(),
});

const jobInclude = {
  createdBy: { select: { id: true, name: true, email: true } },
  department: { select: { id: true, name: true } },
  organization: { select: { id: true, name: true, slug: true } },
  _count: { select: { applications: true } },
} as const;

export async function GET() {
  try {
    const session = await getSession();
    const user = requireUser(session);
    // CANDIDATE → 403; public careers use /api/careers
    requireRoles(user, [
      "SUPER_ADMIN",
      "HR_ADMIN",
      "RECRUITER",
      "HIRING_MANAGER",
      "INTERVIEWER",
    ]);
    const scope = orgScopeWhere(user);

    const jobs = await prisma.job.findMany({
      where: scope,
      orderBy: { createdAt: "desc" },
      include: jobInclude,
    });

    return jsonOk({ jobs });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    const user = requireUser(session);
    if (!canManageJobs(user.role)) {
      throw new AuthError("Insufficient permissions", 403);
    }

    const body = createSchema.parse(await request.json());
    const organizationId = requireOrganizationId(user, body.organizationId);

    if (body.departmentId) {
      const dept = await prisma.department.findFirst({
        where: { id: body.departmentId, organizationId },
      });
      if (!dept) {
        return Response.json({ error: "Department not found in organization" }, { status: 400 });
      }
    }

    const job = await prisma.job.create({
      data: {
        title: body.title,
        departmentId: body.departmentId ?? null,
        location: body.location ?? null,
        description: body.description,
        skills: body.skills ?? [],
        experienceMin: body.experienceMin ?? 0,
        experienceMax: body.experienceMax ?? null,
        salaryMin: body.salaryMin ?? null,
        salaryMax: body.salaryMax ?? null,
        employmentType: body.employmentType ?? "FULL_TIME",
        openings: body.openings ?? 1,
        status: body.status ?? "DRAFT",
        screeningCriteria: body.screeningCriteria ?? {},
        interviewStages: body.interviewStages ?? [],
        organizationId,
        createdById: user.id,
      },
      include: jobInclude,
    });

    return jsonCreated({ job });
  } catch (err) {
    return handleApiError(err);
  }
}
