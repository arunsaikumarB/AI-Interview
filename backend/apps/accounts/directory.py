"""Read-only lookup of Prisma User status. Never writes. Never selects passwordHash."""

from __future__ import annotations

import importlib
from dataclasses import dataclass
from typing import Protocol

from django.conf import settings
from django.db import connection
from django.db.utils import OperationalError


@dataclass(frozen=True)
class IdentityRecord:
    id: str
    email: str
    is_active: bool
    organization_id: str | None
    source_role: str


class IdentityDirectory(Protocol):
    def get(self, external_user_id: str) -> IdentityRecord | None: ...


class TrustJwtDirectory:
    """JWT-only (tests). Does not query Postgres."""

    def get(self, external_user_id: str) -> IdentityRecord | None:
        return IdentityRecord(
            id=external_user_id,
            email="",
            is_active=True,
            organization_id=None,
            source_role="",
        )


class PrismaUserDirectory:
    def get(self, external_user_id: str) -> IdentityRecord | None:
        try:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT id, email, role, "isActive", "organizationId"
                    FROM "User"
                    WHERE id = %s
                    """,
                    [external_user_id],
                )
                row = cursor.fetchone()
        except OperationalError:
            return None
        if row is None:
            return None
        org = row[4]
        return IdentityRecord(
            id=row[0],
            email=row[1],
            source_role=row[2],
            is_active=bool(row[3]),
            organization_id=org if isinstance(org, str) and org else None,
        )


def directory_from_settings() -> IdentityDirectory:
    path = getattr(
        settings,
        "HIREOS_IDENTITY_DIRECTORY",
        "apps.accounts.directory.PrismaUserDirectory",
    )
    module_name, _, class_name = path.rpartition(".")
    module = importlib.import_module(module_name)
    return getattr(module, class_name)()
