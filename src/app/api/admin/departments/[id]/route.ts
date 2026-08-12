import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { requireAdmin, requireOrganizationId } from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";

type Ctx = { params: { id: string } };

const patchSchema = z.object({
  name: z.string().min(1).max(120),
});

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireAdmin(session);
    const body = patchSchema.parse(await request.json());

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

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireAdmin(session);
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
