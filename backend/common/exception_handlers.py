"""DRF exception handling for infrastructure outages.

The enqueue endpoints touch Redis twice: once for the NX lock/status keys and
once when Celery hands the task to the broker. When Redis is down both raise
plain connection errors, which DRF does not recognise, so the request escaped
as an unhandled 500 — and with DEBUG on that 500 is a full Django traceback
page exposing settings, file paths and the Redis URL.

Losing the queue is an availability problem, not a client error, so it is
reported as a clean 503 with a fixed message. The exception text is never
echoed back: it routinely embeds the broker host, port and credentials.
"""

from __future__ import annotations

import logging

from django.http import Http404
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

logger = logging.getLogger("hireos.api")

DEPENDENCY_UNAVAILABLE_DETAIL = "Background task service unavailable"
DEPENDENCY_UNAVAILABLE_CODE = "dependency_unavailable"


def _broker_outage_types() -> tuple[type[BaseException], ...]:
    """Connection-level failures for Redis and the Celery broker.

    Deliberately narrow: command-level Redis errors (ResponseError and friends)
    are bugs, not outages, and must keep surfacing as 500 so they get noticed.
    Imports are defensive so a missing optional dependency cannot break error
    handling itself.
    """
    types: list[type[BaseException]] = []

    try:
        from redis import exceptions as redis_exceptions

        # BusyLoadingError subclasses ConnectionError, so it is covered too.
        types.append(redis_exceptions.ConnectionError)
        types.append(redis_exceptions.TimeoutError)
    except Exception:  # pragma: no cover - redis is a hard dependency in practice
        pass

    try:
        from kombu import exceptions as kombu_exceptions

        types.append(kombu_exceptions.OperationalError)
    except Exception:  # pragma: no cover
        pass

    return tuple(types)


BROKER_OUTAGE_TYPES = _broker_outage_types()


def hireos_exception_handler(exc, context):
    """Map broker/Redis outages to 503; defer everything else to DRF."""
    if BROKER_OUTAGE_TYPES and isinstance(exc, BROKER_OUTAGE_TYPES):
        view = context.get("view") if isinstance(context, dict) else None
        # Log the class only. The message carries connection details.
        logger.error(
            "dependency_unavailable view=%s exc=%s",
            type(view).__name__ if view is not None else "unknown",
            type(exc).__name__,
        )
        return Response(
            {
                "detail": DEPENDENCY_UNAVAILABLE_DETAIL,
                "code": DEPENDENCY_UNAVAILABLE_CODE,
            },
            status=503,
        )

    response = drf_exception_handler(exc, context)

    # Preserve existing behaviour for everything DRF already understands.
    if response is not None:
        return response

    # Http404 / PermissionDenied are always handled by DRF above; anything else
    # returning None here is a genuine server bug and must keep its 500.
    if isinstance(exc, (Http404, PermissionDenied)):  # pragma: no cover
        return None

    return None
