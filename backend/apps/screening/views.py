from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import HireOSJWTAuthentication
from apps.accounts.permissions import RecruitmentStaff
from apps.accounts.scoping import require_organization_id
from services.screening import locks
from services.screening.enqueue import enqueue_screening
from services.screening.repository import get_application


class ScreeningEnqueueView(APIView):
    authentication_classes = [HireOSJWTAuthentication]
    permission_classes = [IsAuthenticated, RecruitmentStaff]

    def post(self, request):
        org_id = require_organization_id(request.user)
        application_id = ""
        if isinstance(request.data, dict):
            application_id = str(request.data.get("application_id") or "").strip()
        result = enqueue_screening(
            application_id=application_id,
            organization_id=org_id,
        )
        return Response({"status": result["status"], "task_id": result["task_id"]})


class ScreeningStatusView(APIView):
    authentication_classes = [HireOSJWTAuthentication]
    permission_classes = [IsAuthenticated, RecruitmentStaff]

    def get(self, request):
        org_id = require_organization_id(request.user)
        application_id = str(request.query_params.get("application_id") or "").strip()
        if not application_id:
            return Response({"detail": "application_id is required."}, status=400)
        row = get_application(application_id, org_id)
        if row is None:
            return Response({"detail": "Not found."}, status=404)
        status = locks.read_status(application_id) or {"status": "idle", "task_id": None}
        api_status = str(status.get("status") or "idle").upper()
        if api_status == "IDLE":
            api_status = "idle"
        return Response(
            {
                "status": api_status if api_status != "idle" else "idle",
                "task_id": status.get("task_id"),
                "error_class": status.get("error_class"),
                "evaluation_id": status.get("evaluation_id"),
                "kind": status.get("kind"),
                "recommendation": status.get("recommendation"),
                "overall": status.get("overall"),
                "model": status.get("model"),
            }
        )
