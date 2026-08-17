"""Queue a single resume-processing Celery task per candidate (Redis NX lock)."""

from __future__ import annotations

from uuid import uuid4

from rest_framework.exceptions import NotFound, ValidationError

from services.resume import locks
from services.resume.errors import PermanentResumeError
from services.resume.files import assert_processable_file, resolve_resume_file
from services.resume.repository import get_candidate


def enqueue_resume_process(*, candidate_id: str, organization_id: str) -> dict:
    candidate_id = (candidate_id or "").strip()
    if not candidate_id:
        raise ValidationError({"candidate_id": "This field is required."})

    row = get_candidate(candidate_id, organization_id)
    if row is None:
        raise NotFound()
    if not row.resume_url:
        raise ValidationError({"detail": "Candidate has no stored resume."})

    try:
        path = resolve_resume_file(row.resume_url)
        assert_processable_file(path)
    except PermanentResumeError as exc:
        raise ValidationError({"detail": exc.error_class}) from exc

    existing_task = locks.get_lock_task_id(candidate_id)
    if existing_task:
        status = locks.read_status(candidate_id) or {}
        return {
            "status": "already_processing",
            "task_id": existing_task,
            "stage": status.get("stage") or "processing",
        }

    task_id = str(uuid4())
    if not locks.acquire_lock(candidate_id, task_id):
        raced = locks.get_lock_task_id(candidate_id) or task_id
        status = locks.read_status(candidate_id) or {}
        return {
            "status": "already_processing",
            "task_id": raced,
            "stage": status.get("stage") or "processing",
        }

    from apps.files.tasks import process_resume

    try:
        process_resume.apply_async(
            args=[candidate_id, organization_id],
            task_id=task_id,
        )
    except Exception:
        locks.release_lock(candidate_id, task_id)
        raise

    locks.write_status(
        candidate_id,
        {
            "status": "queued",
            "stage": "queued",
            "task_id": task_id,
            "organization_id": organization_id,
            "error_class": None,
        },
    )
    return {"status": "queued", "task_id": task_id, "stage": "queued"}
