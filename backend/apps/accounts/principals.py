"""Authenticated HireOS principal. Not django.contrib.auth.User."""

from __future__ import annotations

from dataclasses import dataclass

from apps.accounts.roles import HireOSRole


@dataclass(frozen=True)
class HireOSPrincipal:
    id: str
    email: str
    name: str
    role: HireOSRole
    source_role: str
    organization_id: str | None
    is_active: bool = True

    @property
    def is_authenticated(self) -> bool:
        return True

    @property
    def is_anonymous(self) -> bool:
        return False

    @property
    def pk(self) -> str:
        return self.id

    @property
    def hireos_role(self) -> HireOSRole:
        return self.role
