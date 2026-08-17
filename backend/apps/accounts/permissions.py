"""Reusable HireOS RBAC permission classes."""

from rest_framework.permissions import BasePermission

from apps.accounts.roles import (
    JOB_MANAGER_ROLES,
    ORG_ADMIN_ROLES,
    RECRUITER_OR_HR_ROLES,
    RECRUITMENT_STAFF_ROLES,
    STAFF_ROLES,
    HireOSRole,
)


def _principal_role(request):
    user = getattr(request, "user", None)
    if user is None or not getattr(user, "is_authenticated", False):
        return None
    return getattr(user, "role", None)


class _RoleAllowed(BasePermission):
    allowed: frozenset = frozenset()
    message = "Insufficient permissions"

    def has_permission(self, request, view) -> bool:
        role = _principal_role(request)
        if role is None:
            return False
        return role in self.allowed


class IsAdmin(_RoleAllowed):
    allowed = frozenset({HireOSRole.ADMIN})


class AdminOnly(IsAdmin):
    """Alias of IsAdmin (HireOS ADMIN / Prisma SUPER_ADMIN)."""


class IsHR(_RoleAllowed):
    allowed = frozenset({HireOSRole.HR})


class IsRecruiter(_RoleAllowed):
    allowed = frozenset({HireOSRole.RECRUITER})


class IsHiringManager(_RoleAllowed):
    allowed = frozenset({HireOSRole.HIRING_MANAGER})


class IsInterviewer(_RoleAllowed):
    allowed = frozenset({HireOSRole.INTERVIEWER})


class IsCandidate(_RoleAllowed):
    allowed = frozenset({HireOSRole.CANDIDATE})


class StaffOnly(_RoleAllowed):
    allowed = STAFF_ROLES


class RecruitmentStaff(_RoleAllowed):
    """Pipeline managers — not Interviewer, not Candidate."""

    allowed = RECRUITMENT_STAFF_ROLES


class RecruiterOrHR(_RoleAllowed):
    allowed = RECRUITER_OR_HR_ROLES


class JobManagers(_RoleAllowed):
    """Next.js canManageJobs — not Hiring Manager, not Interviewer."""

    allowed = JOB_MANAGER_ROLES


class IsAdminOrHR(_RoleAllowed):
    """Next.js requireAdmin: SUPER_ADMIN + HR_ADMIN."""

    allowed = ORG_ADMIN_ROLES


# Back-compat names from Phase 1 stubs
IsHireOSStaff = StaffOnly
IsHireOSCandidate = IsCandidate
role_from_request = _principal_role
