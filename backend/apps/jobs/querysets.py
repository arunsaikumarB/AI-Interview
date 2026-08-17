"""Job querysets — always organization-scoped for staff APIs."""

from __future__ import annotations

from django.db.models import Count, Q, QuerySet

from apps.accounts.principals import HireOSPrincipal
from apps.accounts.scoping import require_organization_id
from apps.jobs.models import Job

ALLOWED_ORDERING = frozenset(
    {
        "created_at",
        "-created_at",
        "updated_at",
        "-updated_at",
        "title",
        "-title",
        "status",
        "-status",
    }
)

DEFAULT_ORDERING = "-created_at"


def scoped_jobs(principal: HireOSPrincipal) -> QuerySet[Job]:
    org_id = require_organization_id(principal)
    return (
        Job.objects.filter(organization_id=org_id)
        .select_related("organization", "department", "created_by")
        .annotate(application_count=Count("application_refs"))
    )


def apply_job_filters(
    qs: QuerySet[Job],
    *,
    search: str | None = None,
    status: str | None = None,
    ordering: str | None = None,
) -> QuerySet[Job]:
    if status:
        qs = qs.filter(status=status)
    term = (search or "").strip()
    if term:
        qs = qs.filter(
            Q(title__icontains=term)
            | Q(description__icontains=term)
            | Q(location__icontains=term)
            | Q(department__name__icontains=term)
        )
    order = ordering if ordering in ALLOWED_ORDERING else DEFAULT_ORDERING
    return qs.order_by(order)
