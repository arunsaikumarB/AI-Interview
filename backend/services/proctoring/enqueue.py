from __future__ import annotations

from uuid import uuid4

from rest_framework.exceptions import NotFound, ValidationError

from services.proctoring import locks
from services.proctoring.repository import TERMINAL_STATUSES, get_session

KINDS = frozenset({"assemble", "report", "process"})


def enqueue(*, session_id: str, organization_id: str, kind: str) -> dict:
    session_id = (session_id or "").strip()
    kind = (kind or "process").strip()
    if not session_id:
        raise ValidationError({"session_id": "This field is required."})
    if kind not in KINDS:
        raise ValidationError({"kind": "kind must be assemble, report, or process."})
    row = get_session(session_id, organization_id)
    if row is None:
        raise NotFound()
    if row.status not in TERMINAL_STATUSES:
        raise ValidationError({"detail": "session_not_terminal"})

    existing = locks.get_lock_task_id(kind, session_id)
    if existing:
        return {"status": "already_processing", "task_id": existing, "kind": kind}

    task_id = str(uuid4())
    if not locks.acquire_lock(kind, session_id, task_id):
        raced = locks.get_lock_task_id(kind, session_id) or task_id
        return {"status": "already_processing", "task_id": raced, "kind": kind}

    from apps.proctoring.tasks import assemble_recording_task, package_report_task, process_session_task

    task = {
        "assemble": assemble_recording_task,
        "report": package_report_task,
        "process": process_session_task,
    }[kind]
    try:
        task.apply_async(args=[session_id, organization_id], task_id=task_id)
    except Exception:
        locks.release_lock(kind, session_id, task_id)
        raise
    locks.write_status(
        kind,
        session_id,
        {
            "status": "QUEUED",
            "task_id": task_id,
            "kind": kind,
            "organization_id": organization_id,
        },
    )
    return {"status": "queued", "task_id": task_id, "kind": kind}
