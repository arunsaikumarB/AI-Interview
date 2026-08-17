import { randomBytes } from "crypto";
import { z } from "zod";
import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import {
  requireAdmin,
  requireOrganizationId,
  AuthError,
} from "@/lib/auth/rbac";
import { handleApiError, jsonCreated, jsonOk } from "@/lib/api";
import { djangoPostJson } from "@/lib/staff-reads/django-client";
import { djangoReadToResponse } from "@/lib/staff-reads/errors";
import { useDjangoAdminWrites } from "@/lib/staff-writes/flag";

const STAFF_CREATE_ROLES = [
  "SUPER_ADMIN",
  "HR_ADMIN",
  "RECRUITER",
  "HIRING_MANAGER",
  "INTERVIEWER",
] as const satisfies readonly Role[];

const createSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  role: z.enum(STAFF_CREATE_ROLES),
  departmentId: z.string().optional().nullable(),
  organizationId: z.string().optional(),
});

export async function GET() {
  try {
    const session = await getSession();
    const user = requireAdmin(session);
    const orgId =
      user.role === "SUPER_ADMIN"
        ? user.organizationId
        : requireOrganizationId(user);

    const users = await prisma.user.findMany({
      where: {
        role: { not: "CANDIDATE" },
        ...(orgId ? { organizationId: orgId } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        departmentId: true,
        department: { select: { id: true, name: true } },
        createdAt: true,
      },
    });

    return jsonOk({ users });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    const actor = requireAdmin(session);
    const body = createSchema.parse(await request.json());

    if (useDjangoAdminWrites()) {
      if (body.role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") {
        throw new AuthError("Only Super Admin can create Super Admin users", 403);
      }
      const { organizationId: _ignored, ...forward } = body;
      try {
        const data = await djangoPostJson<{
          user: unknown;
          temporaryPassword?: string;
        }>("/api/v1/admin/users/", forward as Record<string, unknown>, { request });
        return jsonCreated({
          user: data.user,
          temporaryPassword: data.temporaryPassword,
        });
      } catch (err) {
        const mapped = djangoReadToResponse(err);
        if (mapped) return mapped;
        throw err;
      }
    }

    if (body.role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") {
      throw new AuthError("Only Super Admin can create Super Admin users", 403);
    }

    const organizationId = requireOrganizationId(actor, body.organizationId);
    const email = body.email.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return Response.json({ error: "Email already in use" }, { status: 409 });
    }

    if (body.departmentId) {
      const dept = await prisma.department.findFirst({
        where: { id: body.departmentId, organizationId },
      });
      if (!dept) {
        return Response.json({ error: "Department not found" }, { status: 400 });
      }
    }

    const tempPassword = randomBytes(9).toString("base64url").slice(0, 12);
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const created = await prisma.user.create({
      data: {
        name: body.name,
        email,
        role: body.role,
        passwordHash,
        organizationId,
        departmentId: body.departmentId ?? null,
        isActive: true,
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

    return jsonCreated({ user: created, temporaryPassword: tempPassword });
  } catch (err) {
    return handleApiError(err);
  }
}
