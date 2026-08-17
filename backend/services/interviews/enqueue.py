from __future__ import annotations

from uuid import uuid4

from rest_framework.exceptions import NotFound, ValidationError

from services.interviews import locks
from services.interviews.repository import get_session, question_belongs


def _enqueue(kind: str, target_id: str, organization_id: str, celery_args: list) -> dict:
    existing = locks.get_lock_task_id(kind, target_id)
    if existing:
        return {"status": "already_processing", "task_id": existing, "kind": kind}

    task_id = str(uuid4())
    if not locks.acquire_lock(kind, target_id, task_id):
        raced = locks.get_lock_task_id(kind, target_id) or task_id
        return {"status": "already_processing", "task_id": raced, "kind": kind}

    from apps.interviews.tasks import finalize_interview_task, generate_plan_task, prefetch_tts_task

    task = {
        "plan": generate_plan_task,
        "finalize": finalize_interview_task,
        "tts": prefetch_tts_task,
    }[kind]
    try:
        task.apply_async(args=celery_args, task_id=task_id)
    except Exception:
        locks.release_lock(kind, target_id, task_id)
        raise
    locks.write_status(
        kind,
        target_id,
        {
            "status": "QUEUED",
            "task_id": task_id,
            "kind": kind,
            "organization_id": organization_id,
        },
    )
    return {"status": "queued", "task_id": task_id, "kind": kind}


def enqueue_plan(*, session_id: str, organization_id: str) -> dict:
    session_id = (session_id or "").strip()
    if not session_id:
        raise ValidationError({"session_id": "This field is required."})
    row = get_session(session_id, organization_id)
    if row is None:
        raise NotFound()
    if row.status != "SCHEDULED":
        raise ValidationError({"detail": "session_not_scheduled"})
    return _enqueue("plan", session_id, organization_id, [session_id, organization_id])


def enqueue_finalize(*, session_id: str, organization_id: str) -> dict:
    session_id = (session_id or "").strip()
    if not session_id:
        raise ValidationError({"session_id": "This field is required."})
    row = get_session(session_id, organization_id)
    if row is None:
        raise NotFound()
    if row.status != "COMPLETED":
        raise ValidationError({"detail": "session_not_completed"})
    return _enqueue("finalize", session_id, organization_id, [session_id, organization_id])


def enqueue_tts(*, session_id: str, question_id: str, organization_id: str) -> dict:
    session_id = (session_id or "").strip()
    question_id = (question_id or "").strip()
    if not session_id or not question_id:
        raise ValidationError({"detail": "session_id and question_id are required."})
    row = get_session(session_id, organization_id)
    if row is None:
        raise NotFound()
    if not question_belongs(session_id, question_id, organization_id):
        raise NotFound()
    return _enqueue(
        "tts",
        question_id,
        organization_id,
        [session_id, organization_id, question_id],
    )
