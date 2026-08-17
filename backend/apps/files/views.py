from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import HireOSJWTAuthentication
from apps.accounts.permissions import RecruitmentStaff
from apps.accounts.scoping import require_organization_id
from services.resume import locks
from services.resume.enqueue import enqueue_resume_process
from services.resume.repository import get_candidate


class ResumeProcessView(APIView):
    authentication_classes = [HireOSJWTAuthentication]
    permission_classes = [IsAuthenticated, RecruitmentStaff]

    def post(self, request):
        org_id = require_organization_id(request.user)
        candidate_id = ""
        if isinstance(request.data, dict):
            candidate_id = str(request.data.get("candidate_id") or "").strip()
        result = enqueue_resume_process(
            candidate_id=candidate_id,
            organization_id=org_id,
        )
        body = {"status": result["status"], "task_id": result["task_id"]}
        return Response(body)


class ResumeProcessStatusView(APIView):
    authentication_classes = [HireOSJWTAuthentication]
    permission_classes = [IsAuthenticated, RecruitmentStaff]

    def get(self, request):
        org_id = require_organization_id(request.user)
        candidate_id = str(request.query_params.get("candidate_id") or "").strip()
        if not candidate_id:
            return Response({"detail": "candidate_id is required."}, status=400)
        row = get_candidate(candidate_id, org_id)
        if row is None:
            return Response({"detail": "Not found."}, status=404)
        status = locks.read_status(candidate_id) or {"status": "idle", "task_id": None}
        return Response(
            {
                "status": status.get("status") or "idle",
                "task_id": status.get("task_id"),
                "stage": status.get("stage"),
                "error_class": status.get("error_class"),
                "resume_text_length": status.get("resume_text_length"),
                "embedding_dims": status.get("embedding_dims"),
            }
        )
