import type { Role } from "@prisma/client";
import { STAFF_ROLES } from "@/lib/constants";
import type { SessionUser } from "@/lib/auth/session";

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

export function requireUser(user: SessionUser | null): SessionUser {
  if (!user) {
    throw new AuthError("Authentication required", 401);
  }
  return user;
}

export function requireRoles(user: SessionUser | null, allowed: Role[]): SessionUser {
  const u = requireUser(user);
  if (!allowed.includes(u.role)) {
    throw new AuthError("Insufficient permissions", 403);
  }
  return u;
}

export function requireStaff(user: SessionUser | null): SessionUser {
  return requireRoles(user, STAFF_ROLES);
}

/** Who may move candidates through the pipeline / make final decisions. */
export function canManagePipeline(role: Role): boolean {
  return (
    role === "SUPER_ADMIN" ||
    role === "HR_ADMIN" ||
    role === "RECRUITER" ||
    role === "HIRING_MANAGER"
  );
}

export function canViewAllApplications(role: Role): boolean {
  return canManagePipeline(role) || role === "INTERVIEWER";
}

export function canAdministerUsers(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "HR_ADMIN";
}

/** SUPER_ADMIN + HR_ADMIN — admin console / org settings. RECRUITER → 403. */
export function requireAdmin(user: SessionUser | null): SessionUser {
  return requireRoles(user, ["SUPER_ADMIN", "HR_ADMIN"]);
}

export function requireCandidate(user: SessionUser | null): SessionUser {
  return requireRoles(user, ["CANDIDATE"]);
}

export function canManageJobs(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "HR_ADMIN" || role === "RECRUITER";
}

/** Org scope for staff. SUPER_ADMIN may pass ?organizationId= or see all. */
export function requireOrganizationId(
  user: SessionUser,
  explicitOrgId?: string | null,
): string {
  if (user.role === "SUPER_ADMIN") {
    const id = explicitOrgId ?? user.organizationId;
    if (!id) {
      throw new AuthError("organizationId is required for this action", 400);
    }
    return id;
  }
  if (!user.organizationId) {
    throw new AuthError("User is not assigned to an organization", 403);
  }
  if (explicitOrgId && explicitOrgId !== user.organizationId) {
    throw new AuthError("Cannot access another organization", 403);
  }
  return user.organizationId;
}

export function orgScopeWhere(user: SessionUser): { organizationId?: string } {
  if (user.role === "SUPER_ADMIN") return {};
  if (!user.organizationId) {
    throw new AuthError("User is not assigned to an organization", 403);
  }
  return { organizationId: user.organizationId };
}
