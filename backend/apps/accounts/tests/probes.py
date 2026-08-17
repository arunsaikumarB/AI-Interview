from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import HireOSJWTAuthentication
from apps.accounts.permissions import (
    AdminOnly,
    IsAdmin,
    IsCandidate,
    IsHiringManager,
    IsHR,
    IsInterviewer,
    IsRecruiter,
    RecruitmentStaff,
    RecruiterOrHR,
    StaffOnly,
)
from apps.accounts.scoping import require_organization_id


class _Probe(APIView):
    authentication_classes = [HireOSJWTAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({"ok": True, "role": request.user.role.value})


class AdminProbe(_Probe):
    permission_classes = [IsAuthenticated, IsAdmin]


class AdminOnlyProbe(_Probe):
    permission_classes = [IsAuthenticated, AdminOnly]


class HRProbe(_Probe):
    permission_classes = [IsAuthenticated, IsHR]


class RecruiterProbe(_Probe):
    permission_classes = [IsAuthenticated, IsRecruiter]


class HiringManagerProbe(_Probe):
    permission_classes = [IsAuthenticated, IsHiringManager]


class InterviewerProbe(_Probe):
    permission_classes = [IsAuthenticated, IsInterviewer]


class CandidateProbe(_Probe):
    permission_classes = [IsAuthenticated, IsCandidate]


class StaffProbe(_Probe):
    permission_classes = [IsAuthenticated, StaffOnly]


class RecruitmentStaffProbe(_Probe):
    permission_classes = [IsAuthenticated, RecruitmentStaff]


class RecruiterOrHRProbe(_Probe):
    permission_classes = [IsAuthenticated, RecruiterOrHR]


class OrgScopeProbe(APIView):
    authentication_classes = [HireOSJWTAuthentication]
    permission_classes = [IsAuthenticated, StaffOnly]

    def get(self, request):
        explicit = request.query_params.get("organization_id")
        org_id = require_organization_id(request.user, explicit)
        return Response({"organization_id": org_id})
