from __future__ import annotations

from services.proctoring import assemble as assemble_mod
from services.proctoring import locks
from services.proctoring import report as report_mod
from services.proctoring.errors import PermanentProctoringError
from services.proctoring.logging import proctoring_log
from services.proctoring.repository import (
    TERMINAL_STATUSES,
    application_pipeline,
    clear_pair_token,
    get_session,
)

STATUS_KEYS = (
    "outcome",
    "recording_present",
    "chunk_count",
    "missing_count",
    "chunks_preserved",
    "has_audio",
    "has_video",
    "ffmpeg_available",
    "orientation_corrected",
    "event_count",
    "has_report",
    "pair_token_cleared",
    "application_stage_untouched",
)


def _safe_status(payload: dict) -> dict:
    return {k: payload[k] for k in STATUS_KEYS if k in payload}


def _run(*, kind: str, session_id: str, organization_id: str, task_id: str, fn) -> dict:
    proctoring_log(
        session_id=session_id,
        organization_id=organization_id,
        task_id=task_id,
        kind=kind,
        stage="started",
        success=True,
    )
    row = get_session(session_id, organization_id)
    if row is None:
        raise PermanentProctoringError("invalid_session")
    if row.status not in TERMINAL_STATUSES:
        raise PermanentProctoringError("session_not_terminal")
    before = application_pipeline(session_id)
    payload = fn()
    after = application_pipeline(session_id)
    if before != after:
        raise PermanentProctoringError("pipeline_mutated")
    payload["application_stage_untouched"] = True
    locks.write_status(
        kind,
        session_id,
        {
            "status": "COMPLETED" if payload.get("outcome") != "incomplete" else "INCOMPLETE",
            "task_id": task_id,
            "kind": kind,
            "organization_id": organization_id,
            **_safe_status(payload),
        },
    )
    proctoring_log(
        session_id=session_id,
        organization_id=organization_id,
        task_id=task_id,
        kind=kind,
        stage="completed",
        success=True,
    )
    locks.release_lock(kind, session_id, task_id)
    return {"ok": True, "kind": kind, **payload}


def process_assemble(session_id: str, organization_id: str, task_id: str) -> dict:
    return _run(
        kind="assemble",
        session_id=session_id,
        organization_id=organization_id,
        task_id=task_id,
        fn=lambda: assemble_mod.assemble_recording(session_id, organization_id),
    )


def process_report(session_id: str, organization_id: str, task_id: str) -> dict:
    return _run(
        kind="report",
        session_id=session_id,
        organization_id=organization_id,
        task_id=task_id,
        fn=lambda: report_mod.package_report(session_id, organization_id),
    )


def process_session(session_id: str, organization_id: str, task_id: str) -> dict:
    def run():
        assembled = assemble_mod.assemble_recording(session_id, organization_id)
        packaged = report_mod.package_report(session_id, organization_id)
        pair_cleared = False
        artifact_ok = bool(assembled.get("recording_present")) and assembled.get(
            "outcome"
        ) in {"assembled", "already_completed"}
        never_recorded = assembled.get("outcome") == "no_recording"
        if artifact_ok or never_recorded:
            pair_cleared = clear_pair_token(session_id=session_id, organization_id=organization_id)
        return {
            "outcome": assembled.get("outcome"),
            "recording_present": assembled.get("recording_present"),
            "chunk_count": assembled.get("chunk_count"),
            "missing_count": assembled.get("missing_count"),
            "chunks_preserved": assembled.get("chunks_preserved", True),
            "has_audio": assembled.get("has_audio"),
            "has_video": assembled.get("has_video"),
            "ffmpeg_available": assembled.get("ffmpeg_available"),
            "orientation_corrected": False,
            "event_count": packaged.get("event_count"),
            "has_report": packaged.get("has_report"),
            "pair_token_cleared": pair_cleared,
        }

    return _run(
        kind="process",
        session_id=session_id,
        organization_id=organization_id,
        task_id=task_id,
        fn=run,
    )


def fail_job(
    *,
    kind: str,
    lock_id: str,
    session_id: str,
    organization_id: str,
    task_id: str,
    error_class: str,
    release: bool,
    retrying: bool = False,
) -> None:
    proctoring_log(
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
