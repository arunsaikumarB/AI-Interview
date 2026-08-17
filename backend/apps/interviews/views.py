from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import HireOSJWTAuthentication
from apps.accounts.permissions import RecruitmentStaff
from apps.accounts.scoping import require_organization_id
from services.interviews import locks
from services.interviews.enqueue import enqueue_finalize, enqueue_plan, enqueue_tts
from services.interviews.repository import get_session


def _safe_enqueue_body(result: dict) -> dict:
    return {"status": result["status"], "task_id": result["task_id"], "kind": result["kind"]}


class InterviewPlanView(APIView):
    authentication_classes = [HireOSJWTAuthentication]
    permission_classes = [IsAuthenticated, RecruitmentStaff]

    def post(self, request):
        org_id = require_organization_id(request.user)
        session_id = str((request.data or {}).get("session_id") or "").strip()
        return Response(_safe_enqueue_body(enqueue_plan(session_id=session_id, organization_id=org_id)))


class InterviewFinalizeView(APIView):
    authentication_classes = [HireOSJWTAuthentication]
    permission_classes = [IsAuthenticated, RecruitmentStaff]

    def post(self, request):
        org_id = require_organization_id(request.user)
        session_id = str((request.data or {}).get("session_id") or "").strip()
        return Response(
            _safe_enqueue_body(enqueue_finalize(session_id=session_id, organization_id=org_id))
        )


class InterviewTtsView(APIView):
    authentication_classes = [HireOSJWTAuthentication]
    permission_classes = [IsAuthenticated, RecruitmentStaff]

    def post(self, request):
        org_id = require_organization_id(request.user)
        data = request.data or {}
        return Response(
            _safe_enqueue_body(
                enqueue_tts(
                    session_id=str(data.get("session_id") or "").strip(),
                    question_id=str(data.get("question_id") or "").strip(),
                    organization_id=org_id,
                )
            )
        )


class InterviewTaskStatusView(APIView):
    authentication_classes = [HireOSJWTAuthentication]
    permission_classes = [IsAuthenticated, RecruitmentStaff]

    def get(self, request):
        org_id = require_organization_id(request.user)
        session_id = str(request.query_params.get("session_id") or "").strip()
        kind = str(request.query_params.get("kind") or "plan").strip()
        if kind not in {"plan", "finalize", "tts"}:
            return Response({"detail": "kind must be plan, finalize, or tts."}, status=400)
        if not session_id:
            return Response({"detail": "session_id is required."}, status=400)
        row = get_session(session_id, org_id)
        if row is None:
            return Response({"detail": "Not found."}, status=404)
        target = str(request.query_params.get("question_id") or session_id).strip()
        status = locks.read_status(kind, target) or {"status": "idle", "task_id": None}
        return Response(
            {
                "status": status.get("status") or "idle",
                "task_id": status.get("task_id"),
                "kind": kind,
                "error_class": status.get("error_class"),
                "model": status.get("model"),
                "evaluation_id": status.get("evaluation_id"),
            }
        )
