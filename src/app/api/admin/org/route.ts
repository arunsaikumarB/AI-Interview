import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { requireAdmin, requireOrganizationId } from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { djangoPatchJson } from "@/lib/staff-reads/django-client";
import { djangoReadToResponse } from "@/lib/staff-reads/errors";
import { useDjangoAdminWrites } from "@/lib/staff-writes/flag";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  companyName: z.string().max(120).optional(),
  organizationId: z.string().optional(),
});

export async function GET(request: Request) {
  try {
    const session = await getSession();
    const user = requireAdmin(session);
    const url = new URL(request.url);
    const organizationId = requireOrganizationId(
      user,
      url.searchParams.get("organizationId") ?? user.organizationId,
    );

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        companyName: true,
      },
    });
    if (!organization) {
      return Response.json({ error: "Organization not found" }, { status: 404 });
    }

    return jsonOk({ organization });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getSession();
    const user = requireAdmin(session);
    const body = patchSchema.parse(await request.json());

    if (useDjangoAdminWrites()) {
      const { organizationId: _ignored, ...forward } = body;
      try {
        const data = await djangoPatchJson<{ organization: unknown }>(
          "/api/v1/admin/org/",
          forward as Record<string, unknown>,
          { request },
        );
        return jsonOk({ organization: data.organization });
      } catch (err) {
        const mapped = djangoReadToResponse(err);
        if (mapped) return mapped;
        throw err;
      }
    }

    const organizationId = requireOrganizationId(user, body.organizationId);

    const organization = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.companyName !== undefined
          ? { companyName: body.companyName.trim() }
          : {}),
      },
      select: {
        id: true,
        name: true,
        slug: true,
        companyName: true,
      },
    });

    return jsonOk({ organization });
  } catch (err) {
    return handleApiError(err);
  }
}
