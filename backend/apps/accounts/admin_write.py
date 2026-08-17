"""Admin user/department/organization writes. No AI. No Celery. Unmanaged Prisma tables.

passwordHash is written only via parameterized SQL on create. It is never selected
into serializers or JSON. Temporary passwords are returned once and not logged.
"""

from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone

import bcrypt
from django.db import IntegrityError, connection, transaction
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from apps.accounts.models import HireOSUser, Organization
from apps.jobs.models import Department

STAFF_ROLES = frozenset(
    {"SUPER_ADMIN", "HR_ADMIN", "RECRUITER", "HIRING_MANAGER", "INTERVIEWER"}
)
USER_WRITE_KEYS = frozenset({"name", "email", "role", "departmentId", "isActive"})
DEPT_WRITE_KEYS = frozenset({"name"})
ORG_WRITE_KEYS = frozenset({"name", "companyName"})
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def new_cuid() -> str:
    return "c" + secrets.token_hex(12)


def write_now() -> datetime:
    return datetime.now(timezone.utc)


def extra_keys(data: dict, allowed: frozenset[str]) -> set[str]:
    return {k for k in data.keys() if k not in allowed}


def _temp_password() -> str:
    return secrets.token_urlsafe(9)[:12]


def _hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def _require_name(value) -> str:
    if not isinstance(value, str) or not (1 <= len(value) <= 120):
        raise ValidationError("Validation failed")
    return value


def staff_user_public(user_id: str) -> dict | None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT u.id, u.name, u.email, u.role, u."isActive", u."departmentId",
                   d.id, d.name
            FROM "User" u
            LEFT JOIN "Department" d ON d.id = u."departmentId"
            WHERE u.id = %s
            """,
            [user_id],
        )
        row = cursor.fetchone()
    if row is None:
        return None
    dept = {"id": row[6], "name": row[7]} if row[6] else None
    return {
        "id": row[0],
        "name": row[1],
        "email": row[2],
        "role": row[3],
        "isActive": bool(row[4]),
        "departmentId": row[5],
        "department": dept,
    }


def _assert_department(department_id: str | None, organization_id: str) -> str | None:
    if not department_id:
        return None
    dept = Department.objects.filter(id=department_id, organization_id=organization_id).first()
    if dept is None:
        raise ValidationError("Department not found")
    return department_id


def create_staff_user(*, organization_id: str, actor_source_role: str, body: dict) -> dict:
    name = _require_name(body.get("name"))
    email_raw = body.get("email")
    if not isinstance(email_raw, str) or not EMAIL_RE.match(email_raw):
        raise ValidationError("Validation failed")
    email = email_raw.lower()
    role = body.get("role")
    if role not in STAFF_ROLES:
        raise ValidationError("Validation failed")
    if role == "SUPER_ADMIN" and actor_source_role != "SUPER_ADMIN":
        raise PermissionDenied("Only Super Admin can create Super Admin users")
    department_id = _assert_department(body.get("departmentId"), organization_id)

    with connection.cursor() as cursor:
        cursor.execute('SELECT id FROM "User" WHERE email = %s', [email])
        if cursor.fetchone():
            err = ValidationError("Email already in use")
            err.status_code = 409
            raise err

    temp = _temp_password()
    password_hash = _hash_password(temp)
    user_id = new_cuid()
    now = write_now()
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO "User" (
                    id, email, "passwordHash", name, role, "isActive",
                    "organizationId", "departmentId", "createdAt", "updatedAt"
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                [
                    user_id,
                    email,
                    password_hash,
                    name,
                    role,
                    True,
                    organization_id,
                    department_id,
                    now,
                    now,
                ],
            )
    public = staff_user_public(user_id)
    if public is None:
        raise ValidationError("Validation failed")
    return {"user": public, "temporaryPassword": temp}


def update_staff_user(
    *,
    user_id: str,
    organization_id: str,
    actor_id: str,
    actor_source_role: str,
    body: dict,
) -> dict:
    if body.get("role") is not None and actor_source_role != "SUPER_ADMIN":
        raise PermissionDenied("Only Super Admin can change roles")
    with transaction.atomic():
        target = (
            HireOSUser.objects.select_for_update()
            .filter(id=user_id, organization_id=organization_id)
            .exclude(role="CANDIDATE")
            .first()
        )
        if target is None:
            raise NotFound("User not found")
        if body.get("role") == "SUPER_ADMIN" and actor_source_role != "SUPER_ADMIN":
            raise PermissionDenied("Insufficient permissions")
        if target.id == actor_id and body.get("isActive") is False:
            raise ValidationError("Cannot deactivate your own account")
        fields: dict = {}
        if "name" in body:
            fields["name"] = _require_name(body.get("name"))
        if "isActive" in body:
            if not isinstance(body.get("isActive"), bool):
                raise ValidationError("Validation failed")
            fields["is_active"] = body["isActive"]
        if "role" in body:
            if body.get("role") not in STAFF_ROLES:
                raise ValidationError("Validation failed")
            fields["role"] = body["role"]
        if "departmentId" in body:
            fields["department_id"] = _assert_department(
                body.get("departmentId"), organization_id
            )
        if fields:
            fields["updated_at"] = write_now()
            HireOSUser.objects.filter(id=target.id).update(**fields)
    public = staff_user_public(user_id)
    if public is None:
        raise NotFound("User not found")
    return {"user": public}


def create_department(*, organization_id: str, name) -> dict:
    if not isinstance(name, str):
        raise ValidationError("Validation failed")
    name = name.strip()
    if not (1 <= len(name) <= 120):
        raise ValidationError("Validation failed")
    now = write_now()
    try:
        with transaction.atomic():
            dept = Department.objects.create(
                id=new_cuid(),
                organization_id=organization_id,
                name=name,
                created_at=now,
                updated_at=now,
            )
    except IntegrityError as exc:
        raise ValidationError("Validation failed") from exc
    return {
        "id": dept.id,
        "organizationId": dept.organization_id,
        "name": dept.name,
        "createdAt": dept.created_at,
        "updatedAt": dept.updated_at,
    }


def rename_department(*, department_id: str, organization_id: str, name) -> dict:
    if not isinstance(name, str):
        raise ValidationError("Validation failed")
    name = name.strip()
    if not (1 <= len(name) <= 120):
        raise ValidationError("Validation failed")
    with transaction.atomic():
        dept = (
            Department.objects.select_for_update()
            .filter(id=department_id, organization_id=organization_id)
            .first()
        )
        if dept is None:
            raise NotFound("Department not found")
        try:
            Department.objects.filter(id=dept.id).update(name=name, updated_at=write_now())
        except IntegrityError as exc:
            raise ValidationError("Validation failed") from exc
        dept.refresh_from_db()
    return {
        "id": dept.id,
        "organizationId": dept.organization_id,
        "name": dept.name,
        "createdAt": dept.created_at,
        "updatedAt": dept.updated_at,
    }


def delete_department(*, department_id: str, organization_id: str) -> None:
    with transaction.atomic():
        dept = (
            Department.objects.select_for_update()
            .filter(id=department_id, organization_id=organization_id)
            .first()
        )
        if dept is None:
            raise NotFound("Department not found")
        with connection.cursor() as cursor:
            cursor.execute('SELECT COUNT(*) FROM "User" WHERE "departmentId" = %s', [dept.id])
            users_n = cursor.fetchone()[0]
            cursor.execute('SELECT COUNT(*) FROM "Job" WHERE "departmentId" = %s', [dept.id])
            jobs_n = cursor.fetchone()[0]
        if users_n > 0 or jobs_n > 0:
            raise ValidationError("Department still has users or jobs — reassign first")
        dept.delete()


def update_organization(*, organization_id: str, body: dict) -> dict:
    org = Organization.objects.filter(id=organization_id).first()
    if org is None:
        raise NotFound("Organization not found")
    fields: dict = {}
    if "name" in body:
        name = body.get("name")
        if not isinstance(name, str) or not (1 <= len(name.strip()) <= 120):
            raise ValidationError("Validation failed")
        fields["name"] = name.strip()
    if "companyName" in body:
        company = body.get("companyName")
        if not isinstance(company, str) or len(company) > 120:
            raise ValidationError("Validation failed")
        fields["company_name"] = company.strip()
    if fields:
        fields["updated_at"] = write_now()
        Organization.objects.filter(id=org.id).update(**fields)
        org.refresh_from_db()
    return {
        "id": org.id,
        "name": org.name,
        "slug": org.slug,
        "companyName": org.company_name,
    }
