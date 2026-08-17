from rest_framework.generics import ListAPIView, RetrieveAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.exceptions import NotFound, ValidationError

from apps.accounts.authentication import HireOSJWTAuthentication
from apps.accounts.permissions import JobManagers, StaffOnly
from apps.accounts.scoping import require_organization_id
from apps.jobs.job_write import (
    create_job,
    delete_job,
    extra_write_keys,
    job_for_response,
    update_job,
)
from apps.jobs.models import Job
from apps.jobs.pagination import JobPagination
from apps.jobs.querysets import apply_job_filters, scoped_jobs
from apps.jobs.serializers import JobSerializer

JOB_STATUSES = frozenset(Job.Status.values)


def _error_response(exc):
    if isinstance(exc, ValidationError):
        detail = exc.detail
        if isinstance(detail, list) and detail:
            message = str(detail[0])
        elif isinstance(detail, str):
            message = detail
        else:
            message = "Validation failed"
        return Response({"error": message}, status=400)
    if isinstance(exc, NotFound):
        return Response({"error": "Job not found"}, status=404)
    raise exc


class JobListView(ListAPIView):
    authentication_classes = [HireOSJWTAuthentication]
    serializer_class = JobSerializer
    pagination_class = JobPagination

    def get_permissions(self):
        if self.request.method == "POST":
            return [IsAuthenticated(), JobManagers()]
        return [IsAuthenticated(), StaffOnly()]

    def get_queryset(self):
        qs = scoped_jobs(self.request.user)
        status = self.request.query_params.get("status")
        if status and status not in JOB_STATUSES:
            status = None
        return apply_job_filters(
            qs,
            search=self.request.query_params.get("search")
            or self.request.query_params.get("q"),
            status=status,
            ordering=self.request.query_params.get("ordering"),
        )

    def post(self, request):
        org_id = require_organization_id(request.user)
        data = request.data if isinstance(request.data, dict) else {}
        extra = extra_write_keys(data)
        if extra:
            return Response({"error": "Unsupported fields"}, status=400)
        try:
            job = create_job(
                organization_id=org_id,
                created_by_id=request.user.id,
                body=data,
            )
            job = job_for_response(request.user, job.id)
        except (ValidationError, NotFound) as exc:
            return _error_response(exc)
        return Response({"job": JobSerializer(job).data}, status=201)


class JobDetailView(RetrieveAPIView):
    authentication_classes = [HireOSJWTAuthentication]
    serializer_class = JobSerializer
    lookup_field = "id"
    lookup_url_kwarg = "id"

    def get_permissions(self):
        if self.request.method in {"PATCH", "DELETE"}:
            return [IsAuthenticated(), JobManagers()]
        return [IsAuthenticated(), StaffOnly()]

    def get_queryset(self):
        return scoped_jobs(self.request.user)

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        return Response({"job": self.get_serializer(instance).data})

    def patch(self, request, *args, **kwargs):
        org_id = require_organization_id(request.user)
        data = request.data if isinstance(request.data, dict) else {}
        extra = extra_write_keys(data)
        if extra:
            return Response({"error": "Unsupported fields"}, status=400)
        try:
            update_job(job_id=kwargs["id"], organization_id=org_id, body=data)
            job = job_for_response(request.user, kwargs["id"])
        except (ValidationError, NotFound) as exc:
            return _error_response(exc)
        return Response({"job": JobSerializer(job).data})

    def delete(self, request, *args, **kwargs):
        org_id = require_organization_id(request.user)
        try:
            delete_job(job_id=kwargs["id"], organization_id=org_id)
        except (ValidationError, NotFound) as exc:
            return _error_response(exc)
        return Response({"ok": True})
