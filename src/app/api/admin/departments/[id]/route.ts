import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { requireAdmin, requireOrganizationId } from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import {
  djangoDeleteJson,
  djangoPatchJson,
} from "@/lib/staff-reads/django-client";
import { djangoReadToResponse } from "@/lib/staff-reads/errors";
import { useDjangoAdminWrites } from "@/lib/staff-writes/flag";

type Ctx = { params: { id: string } };

const patchSchema = z.object({
  name: z.string().min(1).max(120),
});

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireAdmin(session);
    const body = patchSchema.parse(await request.json());

    if (useDjangoAdminWrites()) {
      try {
        const data = await djangoPatchJson<{ department: unknown }>(
          `/api/v1/admin/departments/${params.id}/`,
          body as Record<string, unknown>,
          { request },
        );
        return jsonOk({ department: data.department });
      } catch (err) {
        const mapped = djangoReadToResponse(err);
        if (mapped) return mapped;
        throw err;
      }
    }

    const orgId =
      user.role === "SUPER_ADMIN" ? undefined : requireOrganizationId(user);

    const existing = await prisma.department.findFirst({
      where: { id: params.id, ...(orgId ? { organizationId: orgId } : {}) },
    });
    if (!existing) {
      return Response.json({ error: "Department not found" }, { status: 404 });
    }

    const department = await prisma.department.update({
      where: { id: existing.id },
      data: { name: body.name.trim() },
    });

    return jsonOk({ department });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireAdmin(session);

    if (useDjangoAdminWrites()) {
      try {
        const data = await djangoDeleteJson<{ ok?: boolean }>(
          `/api/v1/admin/departments/${params.id}/`,
          { request },
        );
        return jsonOk({ ok: data.ok ?? true });
      } catch (err) {
        const mapped = djangoReadToResponse(err);
        if (mapped) return mapped;
        throw err;
      }
    }

    const orgId =
      user.role === "SUPER_ADMIN" ? undefined : requireOrganizationId(user);

    const existing = await prisma.department.findFirst({
      where: { id: params.id, ...(orgId ? { organizationId: orgId } : {}) },
      include: { _count: { select: { users: true, jobs: true } } },
    });
    if (!existing) {
      return Response.json({ error: "Department not found" }, { status: 404 });
    }
    if (existing._count.users > 0 || existing._count.jobs > 0) {
      return Response.json(
        { error: "Department still has users or jobs — reassign first" },
        { status: 400 },
      );
    }

    await prisma.department.delete({ where: { id: existing.id } });
    return jsonOk({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
