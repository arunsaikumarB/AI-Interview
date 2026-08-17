"""Application querysets — always scoped via Job.organizationId."""

from __future__ import annotations

from django.db.models import Q, QuerySet

from apps.accounts.principals import HireOSPrincipal
from apps.accounts.scoping import require_organization_id
from apps.applications.models import Application

ALLOWED_SORT = frozenset(
    {
        "created_at",
        "-created_at",
        "updated_at",
        "-updated_at",
        "stage",
        "-stage",
    }
)

# Next.js GET /api/applications uses updatedAt desc.
DEFAULT_SORT = "-updated_at"

CANDIDATE_DEFER = (
    "candidate__resume_text",
    "candidate__education",
    "candidate__certifications",
    "candidate__summary",
    "candidate__phone",
    "candidate__linkedin",
    "job__description",
    "job__screening_criteria",
    "job__interview_stages",
    "job__skills",
)


def scoped_application_base(principal: HireOSPrincipal) -> QuerySet[Application]:
    org_id = require_organization_id(principal)
    return Application.objects.filter(job__organization_id=org_id)


def scoped_applications(principal: HireOSPrincipal) -> QuerySet[Application]:
    return (
        scoped_application_base(principal)
        .select_related("job", "job__department", "candidate")
        .defer(*CANDIDATE_DEFER)
    )


def apply_application_filters(
    qs: QuerySet[Application],
    *,
    search: str | None = None,
    stage: str | None = None,
    job_id: str | None = None,
    sort: str | None = None,
) -> QuerySet[Application]:
    if stage:
        qs = qs.filter(stage=stage)
    if job_id:
        qs = qs.filter(job_id=job_id)
    term = (search or "").strip()
    if term:
        qs = qs.filter(
            Q(candidate__first_name__icontains=term)
            | Q(candidate__last_name__icontains=term)
            | Q(candidate__email__icontains=term)
            | Q(job__title__icontains=term)
        )
    order = sort if sort in ALLOWED_SORT else DEFAULT_SORT
    return qs.order_by(order)
