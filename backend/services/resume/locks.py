"""Redis lock + Celery-adjacent status for resume processing. No new Prisma table."""

from __future__ import annotations

import json
from typing import Any

import redis
from django.conf import settings

LOCK_PREFIX = "hireos:resume:lock:"
STATUS_PREFIX = "hireos:resume:status:"


def redis_client() -> redis.Redis:
    return redis.from_url(settings.REDIS_URL, decode_responses=True)


def lock_key(candidate_id: str) -> str:
    return f"{LOCK_PREFIX}{candidate_id}"


def status_key(candidate_id: str) -> str:
    return f"{STATUS_PREFIX}{candidate_id}"


def acquire_lock(candidate_id: str, task_id: str, client: redis.Redis | None = None) -> bool:
    r = client or redis_client()
    return bool(
        r.set(
            lock_key(candidate_id),
            task_id,
            nx=True,
            ex=settings.RESUME_LOCK_TTL_SECONDS,
        )
    )


def refresh_lock(candidate_id: str, task_id: str, client: redis.Redis | None = None) -> bool:
    r = client or redis_client()
    current = r.get(lock_key(candidate_id))
    if current != task_id:
        return False
    r.set(lock_key(candidate_id), task_id, ex=settings.RESUME_LOCK_TTL_SECONDS)
    return True


def release_lock(candidate_id: str, task_id: str, client: redis.Redis | None = None) -> None:
    r = client or redis_client()
    current = r.get(lock_key(candidate_id))
    if current == task_id:
        r.delete(lock_key(candidate_id))


def get_lock_task_id(candidate_id: str, client: redis.Redis | None = None) -> str | None:
    r = client or redis_client()
    value = r.get(lock_key(candidate_id))
    return str(value) if value else None


def write_status(
    candidate_id: str,
    payload: dict[str, Any],
    client: redis.Redis | None = None,
) -> None:
    r = client or redis_client()
    r.set(
        status_key(candidate_id),
        json.dumps(payload),
        ex=settings.RESUME_STATUS_TTL_SECONDS,
    )


def read_status(candidate_id: str, client: redis.Redis | None = None) -> dict[str, Any] | None:
    r = client or redis_client()
    raw = r.get(status_key(candidate_id))
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None
