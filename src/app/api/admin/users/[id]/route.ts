import { z } from "zod";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import {
  AuthError,
  requireAdmin,
  requireOrganizationId,
} from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";

type Ctx = { params: { id: string } };

const STAFF_ROLES = [
  "SUPER_ADMIN",
  "HR_ADMIN",
  "RECRUITER",
  "HIRING_MANAGER",
  "INTERVIEWER",
] as const satisfies readonly Role[];

const patchSchema = z.object({
  isActive: z.boolean().optional(),
  role: z.enum(STAFF_ROLES).optional(),
  departmentId: z.string().nullable().optional(),
  name: z.string().min(1).max(120).optional(),
});

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const actor = requireAdmin(session);
    const body = patchSchema.parse(await request.json());

    if (body.role !== undefined && actor.role !== "SUPER_ADMIN") {
      throw new AuthError("Only Super Admin can change roles", 403);
    }

    const orgId =
      actor.role === "SUPER_ADMIN"
        ? undefined
        : requireOrganizationId(actor);

    const target = await prisma.user.findFirst({
      where: {
        id: params.id,
        role: { not: "CANDIDATE" },
        ...(orgId ? { organizationId: orgId } : {}),
      },
    });
    if (!target) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    if (body.role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") {
      throw new AuthError("Insufficient permissions", 403);
    }

    if (target.id === actor.id && body.isActive === false) {
      return Response.json({ error: "Cannot deactivate your own account" }, { status: 400 });
    }

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: {
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.departmentId !== undefined
          ? { departmentId: body.departmentId }
          : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        departmentId: true,
        department: { select: { id: true, name: true } },
      },
    });

    return jsonOk({ user: updated });
  } catch (err) {
    return handleApiError(err);
  }
}
