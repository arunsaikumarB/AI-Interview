"""Celery resume processing. Next.js upload remains synchronous and unchanged."""

from __future__ import annotations

from celery import shared_task
from celery.exceptions import MaxRetriesExceededError, SoftTimeLimitExceeded
from django.conf import settings

from services.resume.errors import PermanentResumeError, TransientResumeError
from services.resume.pipeline import fail_processing, process_candidate_resume


@shared_task(
    bind=True,
    name="files.process_resume",
    max_retries=4,
    acks_late=True,
    track_started=True,
    time_limit=360,
    soft_time_limit=330,
)
def process_resume(self, candidate_id: str, organization_id: str) -> dict:
    task_id = str(self.request.id or "")
    try:
        return process_candidate_resume(
            candidate_id=candidate_id,
            organization_id=organization_id,
            task_id=task_id,
        )
    except PermanentResumeError as exc:
        if exc.error_class == "duplicate_execution":
            return {"ok": False, "error_class": "duplicate_execution", "retryable": False}
        fail_processing(
            candidate_id=candidate_id,
            organization_id=organization_id,
            task_id=task_id,
            error_class=exc.error_class,
            release=True,
        )
        return {"ok": False, "error_class": exc.error_class, "retryable": False}
    except (TransientResumeError, SoftTimeLimitExceeded, TimeoutError, OSError) as exc:
        error_class = getattr(exc, "error_class", None) or type(exc).__name__
        fail_processing(
            candidate_id=candidate_id,
            organization_id=organization_id,
            task_id=task_id,
            error_class=error_class,
            release=False,
            status="retrying",
        )
        countdown = min(60, 5 * (2 ** int(self.request.retries or 0)))
        max_retries = int(getattr(settings, "RESUME_PROCESS_MAX_RETRIES", 4))
        try:
            raise self.retry(exc=exc, countdown=countdown, max_retries=max_retries)
        except MaxRetriesExceededError:
            fail_processing(
                candidate_id=candidate_id,
                organization_id=organization_id,
                task_id=task_id,
                error_class="retries_exhausted",
                release=True,
            )
            return {"ok": False, "error_class": "retries_exhausted", "retryable": False}
