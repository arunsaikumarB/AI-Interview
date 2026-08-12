import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { requireAdmin, requireOrganizationId } from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";

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
