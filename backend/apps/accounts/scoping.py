"""Organization scoping. Phase 2: no global staff access — every staff principal is locked to JWT organizationId."""

from __future__ import annotations

from rest_framework.exceptions import PermissionDenied

from apps.accounts.principals import HireOSPrincipal


def require_organization_id(
    principal: HireOSPrincipal,
    explicit_org_id: str | None = None,
) -> str:
    if not principal.organization_id:
        raise PermissionDenied("User is not assigned to an organization")
    if explicit_org_id and explicit_org_id != principal.organization_id:
        raise PermissionDenied("Cannot access another organization")
    return principal.organization_id


def org_scope_filter(principal: HireOSPrincipal) -> dict[str, str]:
    return {"organization_id": require_organization_id(principal)}


def assert_same_organization(principal: HireOSPrincipal, resource_org_id: str) -> None:
    scoped = require_organization_id(principal)
    if resource_org_id != scoped:
        raise PermissionDenied("Cannot access another organization")
