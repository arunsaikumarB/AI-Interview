import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import {
  canManagePipeline,
  orgScopeWhere,
  requireOrganizationId,
  requireStaff,
} from "@/lib/auth/rbac";
import { handleApiError, jsonCreated, jsonOk } from "@/lib/api";

export async function GET() {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    const scope = orgScopeWhere(user);

    const tags = await prisma.tag.findMany({
      where: scope.organizationId
        ? { organizationId: scope.organizationId }
        : undefined,
      orderBy: { name: "asc" },
      include: { _count: { select: { candidates: true } } },
    });

    return jsonOk({
      tags: tags.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        candidateCount: t._count.candidates,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(64),
  color: z.string().trim().max(32).optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    if (!canManagePipeline(user.role)) {
      return Response.json({ error: "Insufficient permissions" }, { status: 403 });
    }
    const body = createSchema.parse(await request.json());
    const organizationId = requireOrganizationId(user);

    const tag = await prisma.tag.create({
      data: {
        organizationId,
        name: body.name,
        color: body.color ?? null,
      },
    });

    return jsonCreated({ tag });
  } catch (err) {
    return handleApiError(err);
  }
}
