"""Candidate querysets — always organization-scoped for staff APIs."""

from __future__ import annotations

from django.db.models import Count, Q, QuerySet

from apps.accounts.principals import HireOSPrincipal
from apps.accounts.scoping import require_organization_id
from apps.candidates.models import Candidate

ALLOWED_SORT = frozenset(
    {
        "created_at",
        "-created_at",
        "updated_at",
        "-updated_at",
        "first_name",
        "-first_name",
        "last_name",
        "-last_name",
        "email",
        "-email",
        "experience",
        "-experience",
    }
)

DEFAULT_SORT = "-updated_at"


def scoped_candidates(principal: HireOSPrincipal) -> QuerySet[Candidate]:
    org_id = require_organization_id(principal)
    return (
        Candidate.objects.filter(organization_id=org_id)
        .select_related("organization")
        .annotate(application_count=Count("application_refs"))
    )


def apply_candidate_filters(
    qs: QuerySet[Candidate],
    *,
    search: str | None = None,
    sort: str | None = None,
) -> QuerySet[Candidate]:
    term = (search or "").strip()
    if term:
        qs = qs.filter(
            Q(first_name__icontains=term)
            | Q(last_name__icontains=term)
            | Q(email__icontains=term)
            | Q(skills__overlap=[term])
        )
    order = sort if sort in ALLOWED_SORT else DEFAULT_SORT
    return qs.order_by(order)
