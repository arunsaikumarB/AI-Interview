"""Queue one screening Celery task per application (Redis NX lock)."""

from __future__ import annotations

from uuid import uuid4

from rest_framework.exceptions import NotFound, ValidationError

from services.screening import locks
from services.screening.repository import get_application


def enqueue_screening(*, application_id: str, organization_id: str) -> dict:
    application_id = (application_id or "").strip()
    if not application_id:
        raise ValidationError({"application_id": "This field is required."})

    row = get_application(application_id, organization_id)
    if row is None:
        raise NotFound()
    if row.resume_chars <= 0:
        raise ValidationError({"detail": "missing_resume"})
    if row.description_chars <= 0:
        raise ValidationError({"detail": "missing_job_description"})

    existing_task = locks.get_lock_task_id(application_id)
    if existing_task:
        status = locks.read_status(application_id) or {}
        return {
            "status": "already_processing",
            "task_id": existing_task,
            "stage": status.get("stage") or "PROCESSING",
        }

    task_id = str(uuid4())
    if not locks.acquire_lock(application_id, task_id):
        raced = locks.get_lock_task_id(application_id) or task_id
        status = locks.read_status(application_id) or {}
        return {
            "status": "already_processing",
            "task_id": raced,
            "stage": status.get("stage") or "PROCESSING",
        }

    from apps.screening.tasks import screen_application

    try:
        screen_application.apply_async(
            args=[application_id, organization_id],
            task_id=task_id,
        )
    except Exception:
        locks.release_lock(application_id, task_id)
        raise

    locks.write_status(
        application_id,
        {
            "status": "QUEUED",
            "stage": "QUEUED",
            "task_id": task_id,
            "organization_id": organization_id,
            "error_class": None,
        },
    )
    return {"status": "queued", "task_id": task_id, "stage": "QUEUED"}
