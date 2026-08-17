import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { requireAdmin, requireOrganizationId } from "@/lib/auth/rbac";
import { handleApiError, jsonCreated, jsonOk } from "@/lib/api";
import { djangoPostJson } from "@/lib/staff-reads/django-client";
import { djangoReadToResponse } from "@/lib/staff-reads/errors";
import { useDjangoAdminWrites } from "@/lib/staff-writes/flag";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  organizationId: z.string().optional(),
});

export async function GET(request: Request) {
  try {
    const session = await getSession();
    const user = requireAdmin(session);
    const url = new URL(request.url);
    const organizationId = requireOrganizationId(
      user,
      url.searchParams.get("organizationId"),
    );

    const departments = await prisma.department.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      include: { _count: { select: { users: true, jobs: true } } },
    });

    return jsonOk({ departments });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    const user = requireAdmin(session);
    const body = createSchema.parse(await request.json());

    if (useDjangoAdminWrites()) {
      const { organizationId: _ignored, ...forward } = body;
      try {
        const data = await djangoPostJson<{ department: unknown }>(
          "/api/v1/admin/departments/",
          forward as Record<string, unknown>,
          { request },
        );
        return jsonCreated({ department: data.department });
      } catch (err) {
        const mapped = djangoReadToResponse(err);
        if (mapped) return mapped;
        throw err;
      }
    }

    const organizationId = requireOrganizationId(user, body.organizationId);

    const department = await prisma.department.create({
      data: { name: body.name.trim(), organizationId },
    });

    return jsonCreated({ department });
  } catch (err) {
    return handleApiError(err);
  }
}
