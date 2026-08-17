"""Background resume processing steps. Identifiers only — no untrusted filesystem paths."""

from __future__ import annotations

from django.conf import settings

from services.resume import locks
from services.resume.embeddings import build_candidate_embed_text, embed_text
from services.resume.errors import PermanentResumeError, TransientResumeError
from services.resume.files import assert_processable_file, resolve_resume_file
from services.resume.logging import resume_log
from services.resume.parser import extract_resume_text
from services.resume.repository import (
    embedding_dims,
    get_candidate,
    update_embedding,
    update_resume_text,
)


def process_candidate_resume(
    *,
    candidate_id: str,
    organization_id: str,
    task_id: str,
) -> dict:
    if not locks.refresh_lock(candidate_id, task_id):
        held = locks.get_lock_task_id(candidate_id)
        if held and held != task_id:
            raise PermanentResumeError("duplicate_execution")
        if not locks.acquire_lock(candidate_id, task_id):
            raise PermanentResumeError("duplicate_execution")

    def stage(name: str, *, ok: bool, error_class: str | None = None) -> None:
        resume_log(
            candidate_id=candidate_id,
            organization_id=organization_id,
            task_id=task_id,
            stage=name,
            success=ok,
            error_class=error_class,
        )
        locks.write_status(
            candidate_id,
            {
                "status": "processing" if ok else "failed",
                "stage": name,
                "task_id": task_id,
                "organization_id": organization_id,
                "error_class": error_class,
            },
        )

    stage("started", ok=True)
    row = get_candidate(candidate_id, organization_id)
    if row is None:
        raise PermanentResumeError("invalid_candidate")
    if not row.resume_url:
        raise PermanentResumeError("missing_resume")

    path = resolve_resume_file(row.resume_url)
    assert_processable_file(path)
    stage("file_validated", ok=True)

    text = extract_resume_text(path)
    stage("text_extracted", ok=True)

    try:
        update_resume_text(
            candidate_id=candidate_id,
            organization_id=organization_id,
            resume_text=text,
        )
    except Exception as exc:
        if isinstance(exc, PermanentResumeError):
            raise
        raise TransientResumeError("database_unavailable") from exc
    stage("resume_text_saved", ok=True)

    blob = build_candidate_embed_text(
        summary=row.summary,
        skills=row.skills,
        experience=row.experience,
        resume_text=text,
    )
    vector = embed_text(blob)
    try:
        update_embedding(
            candidate_id=candidate_id,
            organization_id=organization_id,
            vector=vector,
        )
    except PermanentResumeError:
        raise
    except Exception as exc:
        raise TransientResumeError("database_unavailable") from exc

    dims = embedding_dims(candidate_id, organization_id)
    if dims != settings.RESUME_EMBED_DIMS:
        raise PermanentResumeError("embedding_dimension_mismatch")

    locks.write_status(
        candidate_id,
        {
            "status": "completed",
            "stage": "completed",
            "task_id": task_id,
            "organization_id": organization_id,
            "error_class": None,
            "resume_text_length": len(text),
            "embedding_dims": dims,
        },
    )
    resume_log(
        candidate_id=candidate_id,
        organization_id=organization_id,
        task_id=task_id,
        stage="completed",
        success=True,
    )
    locks.release_lock(candidate_id, task_id)
    return {
        "ok": True,
        "candidate_id": candidate_id,
        "resume_text_length": len(text),
        "embedding_dims": dims,
    }


def fail_processing(
    *,
    candidate_id: str,
    organization_id: str,
    task_id: str,
    error_class: str,
    release: bool,
    status: str = "failed",
) -> None:
    stage = "retrying" if status == "retrying" else "failed"
    resume_log(
        candidate_id=candidate_id,
        organization_id=organization_id,
        task_id=task_id,
        stage=stage,
        success=False,
        error_class=error_class,
    )
    locks.write_status(
        candidate_id,
        {
            "status": status,
            "stage": stage,
            "task_id": task_id,
            "organization_id": organization_id,
            "error_class": error_class,
        },
    )
    if release:
        locks.release_lock(candidate_id, task_id)
