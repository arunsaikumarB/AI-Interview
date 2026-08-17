"""Staff Job writes. No AI. No Celery. Unmanaged Prisma `"Job"`."""

from __future__ import annotations

import secrets
from datetime import datetime, timezone

from django.db import transaction
from rest_framework.exceptions import NotFound, ValidationError

from apps.jobs.models import Department, Job
from apps.jobs.querysets import scoped_jobs

JOB_STATUSES = frozenset(Job.Status.values)
EMPLOYMENT_TYPES = frozenset(Job.EmploymentType.values)

WRITE_KEYS = frozenset(
    {
        "title",
        "departmentId",
        "location",
        "description",
        "skills",
        "experienceMin",
        "experienceMax",
        "salaryMin",
        "salaryMax",
        "employmentType",
        "openings",
        "status",
        "screeningCriteria",
        "interviewStages",
    }
)


def new_cuid() -> str:
    return "c" + secrets.token_hex(12)


def write_now() -> datetime:
    return datetime.now(timezone.utc)


def extra_write_keys(data: dict) -> set[str]:
    return {k for k in data.keys() if k not in WRITE_KEYS}


def _require_str(value, *, field: str, min_len: int) -> str:
    if not isinstance(value, str) or len(value) < min_len:
        raise ValidationError("Validation failed")
    return value


def _opt_str(value, *, allow_null: bool = True) -> str | None:
    if value is None:
        if not allow_null:
            raise ValidationError("Validation failed")
        return None
    if not isinstance(value, str):
        raise ValidationError("Validation failed")
    return value


def _opt_int(value, *, min_value: int | None = None, allow_null: bool = False) -> int | None:
    if value is None:
        if allow_null:
            return None
        raise ValidationError("Validation failed")
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValidationError("Validation failed")
    if min_value is not None and value < min_value:
        raise ValidationError("Validation failed")
    return value


def _skills(value) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or any(not isinstance(s, str) for s in value):
        raise ValidationError("Validation failed")
    return list(value)


def _criteria(value):
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValidationError("Validation failed")
    out: dict = {}
    if "mustHave" in value:
        mh = value["mustHave"]
        if not isinstance(mh, list) or any(not isinstance(s, str) for s in mh):
            raise ValidationError("Validation failed")
        out["mustHave"] = list(mh)
    if "niceToHave" in value:
        nh = value["niceToHave"]
        if not isinstance(nh, list) or any(not isinstance(s, str) for s in nh):
            raise ValidationError("Validation failed")
        out["niceToHave"] = list(nh)
    return out


def _interview_stages(value):
    if value is None:
        return []
    return value


def assert_department(department_id: str | None, organization_id: str) -> str | None:
    if not department_id:
        return None
    dept = Department.objects.filter(id=department_id, organization_id=organization_id).first()
    if dept is None:
        raise ValidationError("Department not found in organization")
    return department_id


def create_job(*, organization_id: str, created_by_id: str, body: dict) -> Job:
    title = _require_str(body.get("title"), field="title", min_len=2)
    description = _require_str(body.get("description"), field="description", min_len=10)
    department_id = assert_department(body.get("departmentId"), organization_id)
    location = _opt_str(body.get("location")) if "location" in body else None
    skills = _skills(body.get("skills"))
    experience_min = (
        _opt_int(body.get("experienceMin"), min_value=0) if "experienceMin" in body else 0
    )
    experience_max = (
        _opt_int(body.get("experienceMax"), min_value=0, allow_null=True)
        if "experienceMax" in body
        else None
    )
    salary_min = (
        _opt_int(body.get("salaryMin"), allow_null=True) if "salaryMin" in body else None
    )
    salary_max = (
        _opt_int(body.get("salaryMax"), allow_null=True) if "salaryMax" in body else None
    )
    employment = body.get("employmentType", "FULL_TIME")
    if employment not in EMPLOYMENT_TYPES:
        raise ValidationError("Validation failed")
    openings = _opt_int(body.get("openings"), min_value=1) if "openings" in body else 1
    status = body.get("status", "DRAFT")
    if status not in JOB_STATUSES:
        raise ValidationError("Validation failed")
    now = write_now()
    with transaction.atomic():
        job = Job.objects.create(
            id=new_cuid(),
            organization_id=organization_id,
            department_id=department_id,
            title=title,
            description=description,
            location=location,
            experience_min=experience_min,
            experience_max=experience_max,
            skills=skills,
            salary_min=salary_min,
            salary_max=salary_max,
            employment_type=employment,
            openings=openings,
            status=status,
            interview_stages=_interview_stages(body.get("interviewStages")),
            screening_criteria=_criteria(body.get("screeningCriteria")),
            created_by_id=created_by_id,
            created_at=now,
            updated_at=now,
        )
    return job


def update_job(*, job_id: str, organization_id: str, body: dict) -> Job:
    with transaction.atomic():
        job = (
            Job.objects.select_for_update()
            .filter(id=job_id, organization_id=organization_id)
            .first()
        )
        if job is None:
            raise NotFound("Job not found")
        fields: dict = {}
        if "title" in body:
            fields["title"] = _require_str(body.get("title"), field="title", min_len=2)
        if "description" in body:
            fields["description"] = _require_str(
                body.get("description"), field="description", min_len=10
            )
        if "departmentId" in body:
            fields["department_id"] = assert_department(body.get("departmentId"), organization_id)
        if "location" in body:
            fields["location"] = _opt_str(body.get("location"))
        if "skills" in body:
            fields["skills"] = _skills(body.get("skills"))
        if "experienceMin" in body:
            fields["experience_min"] = _opt_int(body.get("experienceMin"), min_value=0)
        if "experienceMax" in body:
            fields["experience_max"] = _opt_int(
                body.get("experienceMax"), min_value=0, allow_null=True
            )
        if "salaryMin" in body:
            fields["salary_min"] = _opt_int(body.get("salaryMin"), allow_null=True)
        if "salaryMax" in body:
            fields["salary_max"] = _opt_int(body.get("salaryMax"), allow_null=True)
        if "employmentType" in body:
            if body.get("employmentType") not in EMPLOYMENT_TYPES:
                raise ValidationError("Validation failed")
            fields["employment_type"] = body.get("employmentType")
        if "openings" in body:
            fields["openings"] = _opt_int(body.get("openings"), min_value=1)
        if "status" in body:
            if body.get("status") not in JOB_STATUSES:
                raise ValidationError("Validation failed")
            fields["status"] = body.get("status")
        if "screeningCriteria" in body:
            fields["screening_criteria"] = _criteria(body.get("screeningCriteria"))
        if "interviewStages" in body:
            fields["interview_stages"] = _interview_stages(body.get("interviewStages"))
        if fields:
            fields["updated_at"] = write_now()
            Job.objects.filter(id=job.id).update(**fields)
            job.refresh_from_db()
        return job


def delete_job(*, job_id: str, organization_id: str) -> None:
    with transaction.atomic():
        job = (
            Job.objects.select_for_update()
            .filter(id=job_id, organization_id=organization_id)
            .first()
        )
        if job is None:
            raise NotFound("Job not found")
        job.delete()


def job_for_response(principal, job_id: str) -> Job:
    job = scoped_jobs(principal).filter(id=job_id).first()
    if job is None:
        raise NotFound("Job not found")
    return job
