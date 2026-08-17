"""Celery screening steps. Never writes Application.stage/status."""

from __future__ import annotations

from services.screening import locks
from services.screening.engine import run_existing_screen_engine
from services.screening.errors import PermanentScreeningError
from services.screening.logging import screening_log
from services.screening.repository import application_stage_status, get_application


def process_application_screening(
    *,
    application_id: str,
    organization_id: str,
    task_id: str,
) -> dict:
    if not locks.refresh_lock(application_id, task_id):
        held = locks.get_lock_task_id(application_id)
        if held and held != task_id:
            raise PermanentScreeningError("duplicate_execution")
        if not locks.acquire_lock(application_id, task_id):
            raise PermanentScreeningError("duplicate_execution")

    def stage(name: str, *, ok: bool, error_class: str | None = None) -> None:
        screening_log(
            application_id=application_id,
            organization_id=organization_id,
            task_id=task_id,
            stage=name,
            success=ok,
            error_class=error_class,
        )
        locks.write_status(
            application_id,
            {
                "status": "PROCESSING" if ok else "FAILED",
                "stage": name,
                "task_id": task_id,
                "organization_id": organization_id,
                "error_class": error_class,
            },
        )

    stage("started", ok=True)
    row = get_application(application_id, organization_id)
    if row is None:
        raise PermanentScreeningError("invalid_application")
    if row.resume_chars <= 0:
        raise PermanentScreeningError("missing_resume")
    if row.description_chars <= 0:
        raise PermanentScreeningError("missing_job_description")
    before = (row.stage, row.status)
    stage("validated", ok=True)

    payload = run_existing_screen_engine(application_id, organization_id)

    after = application_stage_status(application_id)
    if after != before:
        raise PermanentScreeningError("pipeline_mutated")

    safe = {
        "ok": True,
        "application_id": application_id,
        "evaluation_id": payload.get("evaluation_id"),
        "kind": payload.get("kind"),
        "recommendation": payload.get("recommendation"),
        "overall": payload.get("overall"),
        "model": payload.get("model"),
        "stage_unchanged": True,
        "status_unchanged": True,
    }
    locks.write_status(
        application_id,
        {
            "status": "COMPLETED",
            "stage": "completed",
            "task_id": task_id,
            "organization_id": organization_id,
            "error_class": None,
            "evaluation_id": safe["evaluation_id"],
            "kind": safe["kind"],
            "recommendation": safe["recommendation"],
            "overall": safe["overall"],
            "model": safe["model"],
        },
    )
    screening_log(
        application_id=application_id,
        organization_id=organization_id,
        task_id=task_id,
        stage="completed",
        success=True,
    )
    locks.release_lock(application_id, task_id)
    return safe


def fail_screening(
    *,
    application_id: str,
    organization_id: str,
    task_id: str,
    error_class: str,
    release: bool,
    status: str = "FAILED",
) -> None:
    retrying = status in {"retrying", "PROCESSING"}
    api_status = "PROCESSING" if retrying else "FAILED"
    stage = "retrying" if retrying else "failed"
    screening_log(
        application_id=application_id,
        organization_id=organization_id,
        task_id=task_id,
        stage=stage,
        success=False,
        error_class=error_class,
    )
    locks.write_status(
        application_id,
        {
            "status": api_status,
            "stage": stage,
            "task_id": task_id,
            "organization_id": organization_id,
            "error_class": error_class,
        },
    )
    if release:
        locks.release_lock(application_id, task_id)
