import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import {
  canManagePipeline,
  orgScopeWhere,
  requireStaff,
} from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { TEMPLATE_CATEGORIES } from "@/lib/templates";

type Ctx = { params: { id: string } };

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  category: z.enum(TEMPLATE_CATEGORIES).optional(),
  subject: z.string().trim().min(1).max(300).optional(),
  body: z.string().trim().min(1).max(20000).optional(),
});

async function getOwned(id: string, orgId: string | undefined) {
  const t = await prisma.emailTemplate.findUnique({ where: { id } });
  if (!t) return null;
  if (orgId && t.organizationId !== orgId) return null;
  return t;
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    if (!canManagePipeline(user.role)) {
      return Response.json({ error: "Insufficient permissions" }, { status: 403 });
    }
    const scope = orgScopeWhere(user);
    const existing = await getOwned(params.id, scope.organizationId);
    if (!existing) {
      return Response.json({ error: "Template not found" }, { status: 404 });
    }

    const body = patchSchema.parse(await request.json());
    const template = await prisma.emailTemplate.update({
      where: { id: params.id },
      data: body,
    });
    return jsonOk({ template });
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
    const existing = await getOwned(params.id, scope.organizationId);
    if (!existing) {
      return Response.json({ error: "Template not found" }, { status: 404 });
    }

    await prisma.emailTemplate.delete({ where: { id: params.id } });
    return jsonOk({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
