"""HireOS roles as used by Django RBAC.

Prisma/JWT source names remain SUPER_ADMIN and HR_ADMIN.
Phase 2 API names: ADMIN and HR. Mapping is one-to-one and lossless.
"""

from enum import Enum


class HireOSRole(str, Enum):
    ADMIN = "ADMIN"
    HR = "HR"
    RECRUITER = "RECRUITER"
    HIRING_MANAGER = "HIRING_MANAGER"
    INTERVIEWER = "INTERVIEWER"
    CANDIDATE = "CANDIDATE"


class PrismaRole(str, Enum):
    SUPER_ADMIN = "SUPER_ADMIN"
    HR_ADMIN = "HR_ADMIN"
    RECRUITER = "RECRUITER"
    HIRING_MANAGER = "HIRING_MANAGER"
    INTERVIEWER = "INTERVIEWER"
    CANDIDATE = "CANDIDATE"


NEXTJS_ROLE_TO_HIREOS = {
    PrismaRole.SUPER_ADMIN.value: HireOSRole.ADMIN,
    PrismaRole.HR_ADMIN.value: HireOSRole.HR,
    PrismaRole.RECRUITER.value: HireOSRole.RECRUITER,
    PrismaRole.HIRING_MANAGER.value: HireOSRole.HIRING_MANAGER,
    PrismaRole.INTERVIEWER.value: HireOSRole.INTERVIEWER,
    PrismaRole.CANDIDATE.value: HireOSRole.CANDIDATE,
}

HIREOS_TO_PRISMA = {v: k for k, v in NEXTJS_ROLE_TO_HIREOS.items()}

STAFF_ROLES = frozenset(
    {
        HireOSRole.ADMIN,
        HireOSRole.HR,
        HireOSRole.RECRUITER,
        HireOSRole.HIRING_MANAGER,
        HireOSRole.INTERVIEWER,
    }
)

# Next.js canManagePipeline
RECRUITMENT_STAFF_ROLES = frozenset(
    {
        HireOSRole.ADMIN,
        HireOSRole.HR,
        HireOSRole.RECRUITER,
        HireOSRole.HIRING_MANAGER,
    }
)

# Next.js canManageJobs: SUPER_ADMIN, HR_ADMIN, RECRUITER (not Hiring Manager)
JOB_MANAGER_ROLES = frozenset(
    {
        HireOSRole.ADMIN,
        HireOSRole.HR,
        HireOSRole.RECRUITER,
    }
)

# Next.js requireAdmin
ORG_ADMIN_ROLES = frozenset({HireOSRole.ADMIN, HireOSRole.HR})

RECRUITER_OR_HR_ROLES = frozenset({HireOSRole.HR, HireOSRole.RECRUITER})


def hireos_role_from_jwt(source_role: str) -> HireOSRole | None:
    return NEXTJS_ROLE_TO_HIREOS.get(source_role)
