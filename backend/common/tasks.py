"""Celery tasks — Phase 1 test task only. No screening or interview jobs."""

from celery import shared_task


@shared_task(name="common.health_check_task")
def health_check_task() -> dict[str, str]:
    return {"status": "ok", "task": "health_check_task"}
