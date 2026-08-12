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

const bodySchema = z.object({
  tagId: z.string().min(1),
});

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    const scope = orgScopeWhere(user);

    const candidate = await prisma.candidate.findFirst({
      where: {
        id: params.id,
        ...(scope.organizationId
          ? { organizationId: scope.organizationId }
          : {}),
      },
      include: {
        tags: { include: { tag: true }, orderBy: { createdAt: "asc" } },
      },
    });
    if (!candidate) {
      return Response.json({ error: "Candidate not found" }, { status: 404 });
    }

    return jsonOk({
      tags: candidate.tags.map((ct) => ({
        id: ct.tag.id,
        name: ct.tag.name,
        color: ct.tag.color,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    if (!canManagePipeline(user.role)) {
      return Response.json({ error: "Insufficient permissions" }, { status: 403 });
    }
    const scope = orgScopeWhere(user);
    const body = bodySchema.parse(await request.json());

    const candidate = await prisma.candidate.findFirst({
      where: {
        id: params.id,
        ...(scope.organizationId
          ? { organizationId: scope.organizationId }
          : {}),
      },
    });
    if (!candidate) {
      return Response.json({ error: "Candidate not found" }, { status: 404 });
    }

    const tag = await prisma.tag.findFirst({
      where: {
        id: body.tagId,
        organizationId: candidate.organizationId,
      },
    });
    if (!tag) {
      return Response.json({ error: "Tag not found" }, { status: 404 });
    }

    await prisma.candidateTag.upsert({
      where: {
        candidateId_tagId: {
          candidateId: candidate.id,
          tagId: tag.id,
        },
      },
      create: { candidateId: candidate.id, tagId: tag.id },
      update: {},
    });

    return jsonOk({ ok: true, tag: { id: tag.id, name: tag.name, color: tag.color } });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    if (!canManagePipeline(user.role)) {
      return Response.json({ error: "Insufficient permissions" }, { status: 403 });
    }
    const scope = orgScopeWhere(user);
    const body = bodySchema.parse(await request.json());

    const candidate = await prisma.candidate.findFirst({
      where: {
        id: params.id,
        ...(scope.organizationId
          ? { organizationId: scope.organizationId }
          : {}),
      },
    });
    if (!candidate) {
      return Response.json({ error: "Candidate not found" }, { status: 404 });
    }

    await prisma.candidateTag.deleteMany({
      where: { candidateId: candidate.id, tagId: body.tagId },
    });

    return jsonOk({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
