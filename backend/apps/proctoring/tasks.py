"""Background post-session proctoring. Does not ingest live signals."""

from __future__ import annotations

from celery import shared_task
from celery.exceptions import MaxRetriesExceededError, SoftTimeLimitExceeded
from django.conf import settings

from services.proctoring.errors import PermanentProctoringError, TransientProctoringError
from services.proctoring.pipeline import fail_job, process_assemble, process_report, process_session


def _wrap(self, *, kind: str, session_id: str, organization_id: str, runner):
    task_id = str(self.request.id or "")
    try:
        return runner(task_id)
    except PermanentProctoringError as exc:
        fail_job(
            kind=kind,
            lock_id=session_id,
            session_id=session_id,
            organization_id=organization_id,
            task_id=task_id,
            error_class=exc.error_class,
            release=True,
        )
        return {"ok": False, "error_class": exc.error_class, "retryable": False}
    except (TransientProctoringError, SoftTimeLimitExceeded, TimeoutError, OSError) as exc:
        error_class = getattr(exc, "error_class", None) or type(exc).__name__
        fail_job(
            kind=kind,
            lock_id=session_id,
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
                max_retries=int(getattr(settings, "PROCTORING_PROCESS_MAX_RETRIES", 3)),
            )
        except MaxRetriesExceededError:
            fail_job(
                kind=kind,
                lock_id=session_id,
                session_id=session_id,
                organization_id=organization_id,
                task_id=task_id,
                error_class="retries_exhausted",
                release=True,
            )
            return {"ok": False, "error_class": "retries_exhausted", "retryable": False}


@shared_task(
    bind=True,
    name="proctoring.assemble_recording",
    max_retries=3,
    acks_late=True,
    time_limit=240,
    soft_time_limit=210,
)
def assemble_recording_task(self, session_id: str, organization_id: str) -> dict:
    return _wrap(
        self,
        kind="assemble",
        session_id=session_id,
        organization_id=organization_id,
        runner=lambda tid: process_assemble(session_id, organization_id, tid),
    )


@shared_task(
    bind=True,
    name="proctoring.package_report",
    max_retries=3,
    acks_late=True,
    time_limit=120,
    soft_time_limit=100,
)
def package_report_task(self, session_id: str, organization_id: str) -> dict:
    return _wrap(
        self,
        kind="report",
        session_id=session_id,
        organization_id=organization_id,
        runner=lambda tid: process_report(session_id, organization_id, tid),
    )


@shared_task(
    bind=True,
    name="proctoring.process_session",
    max_retries=3,
    acks_late=True,
    time_limit=300,
    soft_time_limit=270,
)
def process_session_task(self, session_id: str, organization_id: str) -> dict:
    return _wrap(
        self,
        kind="process",
        session_id=session_id,
        organization_id=organization_id,
        runner=lambda tid: process_session(session_id, organization_id, tid),
    )
