import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import {
  canManagePipeline,
  orgScopeWhere,
  requireStaff,
} from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";

type Ctx = { params: { id: string } };

const patchSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  color: z.string().trim().max(32).optional().nullable(),
});

async function getOwnedTag(id: string, userOrgId: string | undefined) {
  const tag = await prisma.tag.findUnique({ where: { id } });
  if (!tag) return null;
  if (userOrgId && tag.organizationId !== userOrgId) return null;
  return tag;
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    if (!canManagePipeline(user.role)) {
      return Response.json({ error: "Insufficient permissions" }, { status: 403 });
    }
    const scope = orgScopeWhere(user);
    const existing = await getOwnedTag(params.id, scope.organizationId);
    if (!existing) {
      return Response.json({ error: "Tag not found" }, { status: 404 });
    }

    const body = patchSchema.parse(await request.json());
    const tag = await prisma.tag.update({
      where: { id: params.id },
      data: {
        ...(body.name != null ? { name: body.name } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
      },
    });

    return jsonOk({ tag });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    if (!canManagePipeline(user.role)) {
      return Response.json({ error: "Insufficient permissions" }, { status: 403 });
    }
    const scope = orgScopeWhere(user);
    const existing = await getOwnedTag(params.id, scope.organizationId);
    if (!existing) {
      return Response.json({ error: "Tag not found" }, { status: 404 });
    }

    await prisma.tag.delete({ where: { id: params.id } });
    return jsonOk({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
