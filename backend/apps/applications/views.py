from django.db.models import Count
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.generics import ListAPIView, RetrieveAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import HireOSJWTAuthentication
from apps.accounts.permissions import RecruitmentStaff, StaffOnly
from apps.applications.models import PIPELINE_STAGES
from apps.applications.pagination import ApplicationPagination
from apps.applications.querysets import (
    apply_application_filters,
    scoped_application_base,
    scoped_applications,
)
from apps.applications.serializers import ApplicationSerializer
from apps.accounts.scoping import require_organization_id
from apps.applications.stage_write import apply_stage


class ApplicationListView(ListAPIView):
    authentication_classes = [HireOSJWTAuthentication]
    permission_classes = [IsAuthenticated, StaffOnly]
    serializer_class = ApplicationSerializer
    pagination_class = ApplicationPagination

    def get_queryset(self):
        qs = scoped_applications(self.request.user)
        params = self.request.query_params
        stage = params.get("stage")
        return apply_application_filters(
            qs,
            search=params.get("search") or params.get("q"),
            stage=stage if stage in PIPELINE_STAGES else None,
            job_id=params.get("jobId") or params.get("job_id"),
            sort=params.get("sort") or params.get("ordering"),
        )

    def list(self, request, *args, **kwargs):
        stage = request.query_params.get("stage")
        if stage and stage not in PIPELINE_STAGES:
            return Response({"error": "Invalid stage"}, status=400)
        return super().list(request, *args, **kwargs)


class ApplicationDetailView(RetrieveAPIView):
    authentication_classes = [HireOSJWTAuthentication]
    permission_classes = [IsAuthenticated, StaffOnly]
    serializer_class = ApplicationSerializer
    lookup_field = "id"
    lookup_url_kwarg = "id"

    def get_queryset(self):
        return scoped_applications(self.request.user)

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        return Response({"application": self.get_serializer(instance).data})


class ApplicationPipelineCountsView(APIView):
    """Read-only stage histogram for board parity. No nested AI payloads."""

    authentication_classes = [HireOSJWTAuthentication]
    permission_classes = [IsAuthenticated, StaffOnly]

    def get(self, request):
        qs = scoped_application_base(request.user)
        job_id = request.query_params.get("jobId") or request.query_params.get("job_id")
        if job_id:
            qs = qs.filter(job_id=job_id)
        counted = {
            row["stage"]: row["n"]
            for row in qs.values("stage").annotate(n=Count("id"))
        }
        counts = {stage: int(counted.get(stage, 0)) for stage in PIPELINE_STAGES}
        return Response({"counts": counts, "stages": list(PIPELINE_STAGES)})


class ApplicationStageView(APIView):
    """Human stage/decision write. Whitelist: toStage, note. No AI. No Celery."""

    authentication_classes = [HireOSJWTAuthentication]
    permission_classes = [IsAuthenticated, RecruitmentStaff]

    def post(self, request, id: str):
        org_id = require_organization_id(request.user)
        data = request.data if isinstance(request.data, dict) else {}
        extra = {k for k in data.keys() if k not in {"toStage", "note", "to_stage"}}
        if extra:
            return Response({"error": "Unsupported fields"}, status=400)
        to_stage = data.get("toStage") or data.get("to_stage")
        note = data.get("note") if "note" in data else None
        try:
            result = apply_stage(
                application_id=id,
                organization_id=org_id,
                to_stage=str(to_stage or ""),
                note=note if note is None or isinstance(note, str) else str(note),
                actor_id=request.user.id,
                actor_name=getattr(request.user, "name", "") or "",
            )
        except ValidationError as exc:
            detail = exc.detail
            if isinstance(detail, list) and detail:
                message = str(detail[0])
            elif isinstance(detail, str):
                message = detail
            else:
                message = "Validation failed"
            return Response({"error": message}, status=400)
        except NotFound:
            return Response({"error": "Application not found"}, status=404)
        body = {
            "application": result["application"],
            "advisoryNote": result["advisoryNote"],
        }
        return Response(body)
