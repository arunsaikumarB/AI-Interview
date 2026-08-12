import { getSession } from "@/lib/auth/session";
import { handleApiError, jsonOk, jsonError } from "@/lib/api";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return jsonError("Authentication required", 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: session.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        organizationId: true,
        departmentId: true,
        createdAt: true,
        organization: { select: { id: true, name: true, slug: true } },
        department: { select: { id: true, name: true } },
      },
    });

    if (!user || !user.isActive) {
      return jsonError("Authentication required", 401);
    }

    return jsonOk({ user });
  } catch (err) {
    return handleApiError(err);
  }
}
