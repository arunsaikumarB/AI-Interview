"""Redis lock/status for post-session proctoring jobs."""

from __future__ import annotations

import json
from typing import Any

import redis
from django.conf import settings

PREFIX = {
    "assemble": "proctoring:assemble:",
    "report": "proctoring:report:",
    "process": "proctoring:process:",
}
STATUS_PREFIX = "hireos:proctoring:status:"


def redis_client() -> redis.Redis:
    return redis.from_url(settings.REDIS_URL, decode_responses=True)


def lock_key(kind: str, target_id: str) -> str:
    return f"{PREFIX[kind]}{target_id}"


def status_key(kind: str, target_id: str) -> str:
    return f"{STATUS_PREFIX}{kind}:{target_id}"


def acquire_lock(kind: str, target_id: str, task_id: str) -> bool:
    r = redis_client()
    return bool(
        r.set(
            lock_key(kind, target_id),
            task_id,
            nx=True,
            ex=settings.PROCTORING_LOCK_TTL_SECONDS,
        )
    )


def release_lock(kind: str, target_id: str, task_id: str) -> None:
    r = redis_client()
    if r.get(lock_key(kind, target_id)) == task_id:
        r.delete(lock_key(kind, target_id))


def get_lock_task_id(kind: str, target_id: str) -> str | None:
    value = redis_client().get(lock_key(kind, target_id))
    return str(value) if value else None


def write_status(kind: str, target_id: str, payload: dict[str, Any]) -> None:
    redis_client().set(
        status_key(kind, target_id),
        json.dumps(payload),
        ex=settings.PROCTORING_STATUS_TTL_SECONDS,
    )


def read_status(kind: str, target_id: str) -> dict[str, Any] | None:
    raw = redis_client().get(status_key(kind, target_id))
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None
