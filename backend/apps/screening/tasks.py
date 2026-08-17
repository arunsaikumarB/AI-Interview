"""Celery AI screening. Next.js POST /api/applications/[id]/screen remains live."""

from __future__ import annotations

from celery import shared_task
from celery.exceptions import MaxRetriesExceededError, SoftTimeLimitExceeded
from django.conf import settings

from services.screening.errors import PermanentScreeningError, TransientScreeningError
from services.screening.pipeline import fail_screening, process_application_screening


@shared_task(
    bind=True,
    name="screening.screen_application",
    max_retries=3,
    acks_late=True,
    track_started=True,
    time_limit=600,
    soft_time_limit=570,
)
def screen_application(self, application_id: str, organization_id: str) -> dict:
    task_id = str(self.request.id or "")
    try:
        return process_application_screening(
            application_id=application_id,
            organization_id=organization_id,
            task_id=task_id,
        )
    except PermanentScreeningError as exc:
        if exc.error_class == "duplicate_execution":
            return {"ok": False, "error_class": "duplicate_execution", "retryable": False}
        fail_screening(
            application_id=application_id,
            organization_id=organization_id,
            task_id=task_id,
            error_class=exc.error_class,
            release=True,
        )
        return {"ok": False, "error_class": exc.error_class, "retryable": False}
    except (TransientScreeningError, SoftTimeLimitExceeded, TimeoutError, OSError) as exc:
        error_class = getattr(exc, "error_class", None) or type(exc).__name__
        fail_screening(
            application_id=application_id,
            organization_id=organization_id,
            task_id=task_id,
            error_class=error_class,
            release=False,
            status="retrying",
        )
        countdown = min(60, 5 * (2 ** int(self.request.retries or 0)))
        max_retries = int(getattr(settings, "SCREENING_PROCESS_MAX_RETRIES", 3))
        try:
            raise self.retry(exc=exc, countdown=countdown, max_retries=max_retries)
        except MaxRetriesExceededError:
            fail_screening(
                application_id=application_id,
                organization_id=organization_id,
                task_id=task_id,
                error_class="retries_exhausted",
                release=True,
            )
            return {"ok": False, "error_class": "retries_exhausted", "retryable": False}
