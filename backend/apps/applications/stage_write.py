"""Human stage/decision writes. No AI. No Celery. Prisma `"Application"` + `"TimelineEvent"`."""

from __future__ import annotations

import secrets
from datetime import datetime, timezone

from django.db import transaction
from rest_framework.exceptions import NotFound, ValidationError

from apps.applications.models import PIPELINE_STAGES, TERMINAL_STAGES, Application, TimelineEvent

ADVISORY_NOTE = (
    "AI recommendations are advisory only. This stage change was made by a human."
)


def new_cuid() -> str:
    return "c" + secrets.token_hex(12)


def write_now() -> datetime:
    return datetime.now(timezone.utc)


def compute_status(to_stage: str, current_status: str) -> str:
    if to_stage == "SELECTED":
        return "HIRED"
    if to_stage == "REJECTED":
        return "REJECTED"
    if current_status in {"HIRED", "REJECTED"}:
        return "ACTIVE"
    return current_status


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.isoformat() + "Z"
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def application_public(app: Application) -> dict:
    return {
        "id": app.id,
        "candidateId": app.candidate_id,
        "jobId": app.job_id,
        "stage": app.stage,
        "status": app.status,
        "source": app.source,
        "coverNote": app.cover_note,
        "createdAt": _iso(app.created_at),
        "updatedAt": _iso(app.updated_at),
    }


def apply_stage(
    *,
    application_id: str,
    organization_id: str,
    to_stage: str,
    note: str | None,
    actor_id: str,
    actor_name: str,
) -> dict:
    application_id = (application_id or "").strip()
    to_stage = (to_stage or "").strip()
    if to_stage not in PIPELINE_STAGES:
        raise ValidationError("Validation failed")
    raw_note = note if isinstance(note, str) else None
    if to_stage in TERMINAL_STAGES:
        if not raw_note or len(raw_note.strip()) < 5:
            raise ValidationError("Final decisions require a human rationale (note)")

    with transaction.atomic():
        app = (
            Application.objects.select_related("job")
            .select_for_update()
            .filter(id=application_id)
            .first()
        )
        job = getattr(app, "job", None) if app is not None else None
        if app is None or job is None or job.organization_id != organization_id:
            raise NotFound("Application not found")

        new_status = compute_status(to_stage, app.status)
        if app.stage == to_stage and app.status == new_status:
            return {
                "application": application_public(app),
                "advisoryNote": ADVISORY_NOTE,
                "unchanged": True,
            }

        from_stage = app.stage
        now = write_now()
        Application.objects.filter(id=app.id).update(
            stage=to_stage,
            status=new_status,
            updated_at=now,
        )
        TimelineEvent.objects.create(
            id=new_cuid(),
            application_id=app.id,
            type="STAGE_CHANGED",
            payload={
                "from": from_stage,
                "to": to_stage,
                "note": raw_note,
                "actorId": actor_id,
                "actorName": actor_name,
                "humanDecision": True,
            },
            created_at=now,
        )
        app.refresh_from_db()
        return {
            "application": application_public(app),
            "advisoryNote": ADVISORY_NOTE,
            "unchanged": False,
        }
