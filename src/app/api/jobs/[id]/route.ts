import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import {
  AuthError,
  canManageJobs,
  orgScopeWhere,
  requireStaff,
  requireUser,
} from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { djangoGetJob } from "@/lib/staff-reads/django-reads";
import { djangoReadToResponse } from "@/lib/staff-reads/errors";
import { useDjangoReads } from "@/lib/staff-reads/flag";
import {
  djangoDeleteJson,
  djangoPatchJson,
} from "@/lib/staff-reads/django-client";
import { useDjangoJobWrites } from "@/lib/staff-writes/flag";
import { normalizeJob, type DjangoJob } from "@/lib/staff-reads/normalize";

type Ctx = { params: { id: string } };

const updateSchema = z.object({
  title: z.string().min(2).optional(),
  departmentId: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  description: z.string().min(10).optional(),
  skills: z.array(z.string()).optional(),
  experienceMin: z.number().int().min(0).optional(),
  experienceMax: z.number().int().min(0).nullable().optional(),
  salaryMin: z.number().int().nullable().optional(),
  salaryMax: z.number().int().nullable().optional(),
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
});

const jobInclude = {
  createdBy: { select: { id: true, name: true, email: true } },
  department: { select: { id: true, name: true } },
  organization: { select: { id: true, name: true, slug: true } },
  _count: { select: { applications: true } },
} as const;

export async function GET(request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireStaff(session);

    if (useDjangoReads()) {
      const job = await djangoGetJob(request, params.id);
      return jsonOk({ job });
    }

    const scope = orgScopeWhere(user);

    const job = await prisma.job.findFirst({
      where: {
        id: params.id,
        ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
      },
      include: jobInclude,
    });
    if (!job) {
      return Response.json({ error: "Job not found" }, { status: 404 });
    }

    return jsonOk({ job });
  } catch (err) {
    return djangoReadToResponse(err) ?? handleApiError(err);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireUser(session);
    if (!canManageJobs(user.role)) {
      throw new AuthError("Insufficient permissions", 403);
    }

    const body = updateSchema.parse(await request.json());

    if (useDjangoJobWrites()) {
      try {
        const data = await djangoPatchJson<{ job: DjangoJob }>(
          `/api/v1/jobs/${params.id}/`,
          body as Record<string, unknown>,
          { request },
        );
        return jsonOk({ job: normalizeJob(data.job) });
      } catch (err) {
        const mapped = djangoReadToResponse(err);
        if (mapped) return mapped;
        throw err;
      }
    }

    const scope = orgScopeWhere(user);
    const existing = await prisma.job.findFirst({
      where: { id: params.id, ...scope },
    });
    if (!existing) {
      return Response.json({ error: "Job not found" }, { status: 404 });
    }
    const data: Prisma.JobUncheckedUpdateInput = {
      ...body,
      screeningCriteria:
        body.screeningCriteria === undefined
          ? undefined
          : (body.screeningCriteria as Prisma.InputJsonValue),
      interviewStages:
        body.interviewStages === undefined
          ? undefined
          : (body.interviewStages as Prisma.InputJsonValue),
    };
    const job = await prisma.job.update({
      where: { id: params.id },
      data,
      include: jobInclude,
    });

    return jsonOk({ job });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireUser(session);
    if (!canManageJobs(user.role)) {
      throw new AuthError("Insufficient permissions", 403);
    }

    if (useDjangoJobWrites()) {
      try {
        const data = await djangoDeleteJson<{ ok?: boolean }>(
          `/api/v1/jobs/${params.id}/`,
          { request },
        );
        return jsonOk({ ok: data.ok ?? true });
      } catch (err) {
        const mapped = djangoReadToResponse(err);
        if (mapped) return mapped;
        throw err;
      }
    }

    const scope = orgScopeWhere(user);
    const existing = await prisma.job.findFirst({
      where: { id: params.id, ...scope },
    });
    if (!existing) {
      return Response.json({ error: "Job not found" }, { status: 404 });
    }

    await prisma.job.delete({ where: { id: params.id } });
    return jsonOk({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
