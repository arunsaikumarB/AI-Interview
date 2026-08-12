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
import { TEMPLATE_CATEGORIES } from "@/lib/templates";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    const scope = orgScopeWhere(user);
    const category = new URL(request.url).searchParams.get("category");

    const templates = await prisma.emailTemplate.findMany({
      where: {
        ...(scope.organizationId
          ? { organizationId: scope.organizationId }
          : {}),
        ...(category ? { category } : {}),
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });

    return jsonOk({ templates });
  } catch (err) {
    return handleApiError(err);
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.enum(TEMPLATE_CATEGORIES),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20000),
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

    const template = await prisma.emailTemplate.create({
      data: {
        organizationId,
        name: body.name,
        category: body.category,
        subject: body.subject,
        body: body.body,
      },
    });

    return jsonCreated({ template });
  } catch (err) {
    return handleApiError(err);
  }
}
