from __future__ import annotations

from services.interviews import engine, locks
from services.interviews.errors import PermanentInterviewError
from services.interviews.logging import interview_log
from services.interviews.repository import get_session, session_status


def _run(
    *,
    kind: str,
    session_id: str,
    organization_id: str,
    task_id: str,
    lock_id: str,
    fn,
) -> dict:
    interview_log(
        session_id=session_id,
        organization_id=organization_id,
        task_id=task_id,
        kind=kind,
        stage="started",
        success=True,
    )
    row = get_session(session_id, organization_id)
    if row is None:
        raise PermanentInterviewError("invalid_session")
    payload = fn()
    locks.write_status(
        kind,
        lock_id,
        {
            "status": "COMPLETED",
            "task_id": task_id,
            "kind": kind,
            "organization_id": organization_id,
            **{k: payload.get(k) for k in ("model", "evaluation_id", "overall", "recommendation", "topic_count", "has_tts_path") if k in payload},
        },
    )
    interview_log(
        session_id=session_id,
        organization_id=organization_id,
        task_id=task_id,
        kind=kind,
        stage="completed",
        success=True,
    )
    locks.release_lock(kind, lock_id, task_id)
    return {"ok": True, "kind": kind, **payload}


def process_plan(session_id: str, organization_id: str, task_id: str) -> dict:
    return _run(
        kind="plan",
        session_id=session_id,
        organization_id=organization_id,
        task_id=task_id,
        lock_id=session_id,
        fn=lambda: engine.generate_plan(session_id, organization_id),
    )


def process_finalize(session_id: str, organization_id: str, task_id: str) -> dict:
    before = session_status(session_id)
    result = _run(
        kind="finalize",
        session_id=session_id,
        organization_id=organization_id,
        task_id=task_id,
        lock_id=session_id,
        fn=lambda: engine.finalize_interview(session_id, organization_id),
    )
    after = session_status(session_id)
    if before != after:
        raise PermanentInterviewError("pipeline_mutated")
    return result


def process_tts(session_id: str, organization_id: str, question_id: str, task_id: str) -> dict:
    return _run(
        kind="tts",
        session_id=session_id,
        organization_id=organization_id,
        task_id=task_id,
        lock_id=question_id,
        fn=lambda: engine.prefetch_tts(session_id, organization_id, question_id),
    )


def fail_job(*, kind: str, lock_id: str, session_id: str, organization_id: str, task_id: str, error_class: str, release: bool, retrying: bool = False) -> None:
    interview_log(
        session_id=session_id,
        organization_id=organization_id,
        task_id=task_id,
        kind=kind,
        stage="retrying" if retrying else "failed",
        success=False,
        error_class=error_class,
    )
    locks.write_status(
        kind,
        lock_id,
        {
            "status": "PROCESSING" if retrying else "FAILED",
            "task_id": task_id,
            "kind": kind,
            "error_class": error_class,
        },
    )
    if release:
        locks.release_lock(kind, lock_id, task_id)
