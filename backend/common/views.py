from __future__ import annotations

import json
from typing import Any

from django.conf import settings
from django.db import connection
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from common.tasks import health_check_task
from services.ai.ollama import OllamaClient
from services.speech.client import SpeechServiceClient


def _postgres() -> dict[str, Any]:
    try:
        connection.ensure_connection()
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        return {"ok": True}
    except Exception as exc:  # noqa: BLE001 — health must never 500 on a down dependency
        return {"ok": False, "error": str(exc)}


def _redis() -> dict[str, Any]:
    try:
        from redis import Redis

        client = Redis.from_url(settings.REDIS_URL, socket_connect_timeout=2)
        pong = client.ping()
        client.close()
        return {"ok": bool(pong)}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


def _celery() -> dict[str, Any]:
    try:
        from config.celery import app

        inspector = app.control.inspect(timeout=1.0)
        ping = inspector.ping() if inspector else None
        if ping:
            return {"ok": True, "workers": list(ping.keys())}
        return {
            "ok": False,
            "error": "no workers responded (start: celery -A config worker)",
        }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


def _public(state: dict[str, Any]) -> dict[str, Any]:
    """R-2: reduce a dependency probe to a bare verdict.

    The raw probes carry exception text — psycopg reports the host and port it
    tried, redis reports the broker address, celery reports worker hostnames.
    A readiness probe needs none of that, and this endpoint is unauthenticated.
    """
    return {"ok": state.get("ok") is True}


class HealthView(APIView):
    """Unauthenticated readiness probe. Booleans only, by design.

    Detailed diagnostics are deliberately NOT reachable over HTTP at all —
    ``manage.py hireos_probes`` (see :func:`run_probe_bundle`) is the operator
    path, so there is no query parameter or header that can widen this
    response.
    """

    authentication_classes: list = []
    permission_classes = [AllowAny]

    def get(self, request: Request) -> Response:
        postgres = _postgres()
        redis_status = _redis()
        celery_status = _celery()
        payload = {
            "ok": postgres.get("ok") is True and redis_status.get("ok") is True,
            "django": {"ok": True},
            "postgres": _public(postgres),
            "redis": _public(redis_status),
            "celery": _public(celery_status),
        }
        http_ok = postgres.get("ok") is True
        return Response(payload, status=200 if http_ok else 503)


def run_probe_bundle() -> dict[str, Any]:
    """Used by `manage.py hireos_probes` — not exposed as extra HTTP APIs."""
    ollama = OllamaClient.from_settings().health()
    speech = SpeechServiceClient.from_settings().health()
    celery_eager = health_check_task.apply().get()
    return {
        "ollama": ollama,
        "speech": speech,
        "health_check_task_eager": celery_eager,
    }


def dumps(data: dict[str, Any]) -> str:
    return json.dumps(data, indent=2)
