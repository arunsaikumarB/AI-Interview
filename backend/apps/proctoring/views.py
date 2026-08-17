from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import HireOSJWTAuthentication
from apps.accounts.permissions import RecruitmentStaff
from apps.accounts.scoping import require_organization_id
from services.proctoring import locks
from services.proctoring.enqueue import enqueue
from services.proctoring.repository import get_session


class ProctoringProcessView(APIView):
    authentication_classes = [HireOSJWTAuthentication]
    permission_classes = [IsAuthenticated, RecruitmentStaff]

    def post(self, request):
        org_id = require_organization_id(request.user)
        data = request.data or {}
        result = enqueue(
            session_id=str(data.get("session_id") or "").strip(),
            organization_id=org_id,
            kind=str(data.get("kind") or "process").strip(),
        )
        return Response(
            {"status": result["status"], "task_id": result["task_id"], "kind": result["kind"]}
        )


class ProctoringStatusView(APIView):
    authentication_classes = [HireOSJWTAuthentication]
    permission_classes = [IsAuthenticated, RecruitmentStaff]

    def get(self, request):
        org_id = require_organization_id(request.user)
        session_id = str(request.query_params.get("session_id") or "").strip()
        kind = str(request.query_params.get("kind") or "process").strip()
        if kind not in {"assemble", "report", "process"}:
            return Response({"detail": "kind must be assemble, report, or process."}, status=400)
        if not session_id:
            return Response({"detail": "session_id is required."}, status=400)
        row = get_session(session_id, org_id)
        if row is None:
            return Response({"detail": "Not found."}, status=404)
        status = locks.read_status(kind, session_id) or {"status": "idle", "task_id": None}
        body = {
            "status": status.get("status") or "idle",
            "task_id": status.get("task_id"),
            "kind": kind,
            "error_class": status.get("error_class"),
            "outcome": status.get("outcome"),
            "recording_present": status.get("recording_present"),
            "has_report": status.get("has_report"),
            "event_count": status.get("event_count"),
            "orientation_corrected": status.get("orientation_corrected"),
            "chunks_preserved": status.get("chunks_preserved"),
        }
        return Response(body)
