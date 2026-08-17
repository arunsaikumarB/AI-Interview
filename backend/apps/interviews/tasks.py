"""Background interview tasks. Does not handle live candidate turns."""

from __future__ import annotations

from celery import shared_task
from celery.exceptions import MaxRetriesExceededError, SoftTimeLimitExceeded
from django.conf import settings

from services.interviews.errors import PermanentInterviewError, TransientInterviewError
from services.interviews.pipeline import fail_job, process_finalize, process_plan, process_tts


def _wrap(self, *, kind: str, lock_id: str, session_id: str, organization_id: str, runner):
    task_id = str(self.request.id or "")
    try:
        return runner(task_id)
    except PermanentInterviewError as exc:
        fail_job(
            kind=kind,
            lock_id=lock_id,
            session_id=session_id,
            organization_id=organization_id,
            task_id=task_id,
            error_class=exc.error_class,
            release=True,
        )
        return {"ok": False, "error_class": exc.error_class, "retryable": False}
    except (TransientInterviewError, SoftTimeLimitExceeded, TimeoutError, OSError) as exc:
        error_class = getattr(exc, "error_class", None) or type(exc).__name__
        fail_job(
            kind=kind,
            lock_id=lock_id,
            session_id=session_id,
            organization_id=organization_id,
            task_id=task_id,
            error_class=error_class,
            release=False,
            retrying=True,
        )
        countdown = min(60, 5 * (2 ** int(self.request.retries or 0)))
        try:
            raise self.retry(
                exc=exc,
                countdown=countdown,
                max_retries=int(getattr(settings, "INTERVIEW_PROCESS_MAX_RETRIES", 3)),
            )
        except MaxRetriesExceededError:
            fail_job(
                kind=kind,
                lock_id=lock_id,
                session_id=session_id,
                organization_id=organization_id,
                task_id=task_id,
                error_class="retries_exhausted",
                release=True,
            )
            return {"ok": False, "error_class": "retries_exhausted", "retryable": False}


@shared_task(bind=True, name="interviews.generate_plan", max_retries=3, acks_late=True, time_limit=360, soft_time_limit=330)
def generate_plan_task(self, session_id: str, organization_id: str) -> dict:
    return _wrap(
        self,
        kind="plan",
        lock_id=session_id,
        session_id=session_id,
        organization_id=organization_id,
        runner=lambda tid: process_plan(session_id, organization_id, tid),
    )


@shared_task(bind=True, name="interviews.finalize_interview", max_retries=3, acks_late=True, time_limit=360, soft_time_limit=330)
def finalize_interview_task(self, session_id: str, organization_id: str) -> dict:
    return _wrap(
        self,
        kind="finalize",
        lock_id=session_id,
        session_id=session_id,
        organization_id=organization_id,
        runner=lambda tid: process_finalize(session_id, organization_id, tid),
    )


@shared_task(bind=True, name="interviews.prefetch_question_tts", max_retries=3, acks_late=True, time_limit=120, soft_time_limit=100)
def prefetch_tts_task(self, session_id: str, organization_id: str, question_id: str) -> dict:
    return _wrap(
        self,
        kind="tts",
        lock_id=question_id,
        session_id=session_id,
        organization_id=organization_id,
        runner=lambda tid: process_tts(session_id, organization_id, question_id, tid),
    )
