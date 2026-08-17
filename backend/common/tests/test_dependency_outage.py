"""F-04 regression — Redis/broker outages must return a clean 503.

Before the fix, stopping Redis made the enqueue endpoints raise a bare
redis.exceptions.ConnectionError. DRF did not recognise it, so it escaped as an
unhandled 500 — rendered by Django as a full DEBUG traceback page containing
settings, file paths and the Redis URL.

These tests pin both halves of the contract:
  * the status code is 503, not 500;
  * the body is small, JSON, and free of traceback/connection detail.

SimpleTestCase — no test database.
"""

from __future__ import annotations

from unittest.mock import patch

import redis
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.tests.test_rbac import SETTINGS, mint
from common.exception_handlers import (
    DEPENDENCY_UNAVAILABLE_CODE,
    DEPENDENCY_UNAVAILABLE_DETAIL,
    hireos_exception_handler,
)

OUTAGE_SETTINGS = {
    **SETTINGS,
    "ROOT_URLCONF": "config.urls",
    "SCREENING_LOCK_TTL_SECONDS": 900,
    "SCREENING_STATUS_TTL_SECONDS": 86400,
    "RESUME_LOCK_TTL_SECONDS": 600,
    "RESUME_STATUS_TTL_SECONDS": 86400,
    "INTERVIEW_LOCK_TTL_SECONDS": 900,
    "INTERVIEW_STATUS_TTL_SECONDS": 86400,
    "PROCTORING_LOCK_TTL_SECONDS": 900,
    "PROCTORING_STATUS_TTL_SECONDS": 86400,
}

# The real message redis-py raises when the server is not listening. It embeds
# host and port, which is exactly what must not reach the client.
REAL_REDIS_ERROR = redis.exceptions.ConnectionError(
    "Error 10061 connecting to 127.0.0.1:6379. "
    "No connection could be made because the target machine actively refused it."
)


def _boom(*_args, **_kwargs):
    raise REAL_REDIS_ERROR


@override_settings(**OUTAGE_SETTINGS)
class RedisOutageResponseTests(SimpleTestCase):
    """End-to-end through the real URLconf, view and exception handler."""

    def setUp(self):
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {mint()}")

    @patch("services.screening.enqueue.get_application")
    @patch("services.screening.locks.redis_client", side_effect=_boom)
    def test_screening_enqueue_returns_503(self, _redis, get_application):
        from services.screening.repository import ScreeningApplicationRow

        get_application.return_value = ScreeningApplicationRow(
            application_id="app_1",
            organization_id="org_a",
            candidate_id="cand_1",
            job_id="job_1",
            stage="APPLIED",
            status="ACTIVE",
            resume_chars=500,
            description_chars=500,
        )

        res = self.client.post(
            "/api/v1/screening/", {"application_id": "app_1"}, format="json"
        )

        self.assertEqual(res.status_code, 503)

    @patch("services.screening.enqueue.get_application")
    @patch("services.screening.locks.redis_client", side_effect=_boom)
    def test_response_is_clean_json_without_internals(self, _redis, get_application):
        from services.screening.repository import ScreeningApplicationRow

        get_application.return_value = ScreeningApplicationRow(
            application_id="app_1",
            organization_id="org_a",
            candidate_id="cand_1",
            job_id="job_1",
            stage="APPLIED",
            status="ACTIVE",
            resume_chars=500,
            description_chars=500,
        )

        res = self.client.post(
            "/api/v1/screening/", {"application_id": "app_1"}, format="json"
        )
        body = res.content.decode("utf-8", errors="replace")

        self.assertEqual(res.status_code, 503)
        self.assertEqual(
            res.json(),
            {"detail": DEPENDENCY_UNAVAILABLE_DETAIL, "code": DEPENDENCY_UNAVAILABLE_CODE},
        )

        # No Django debug page, no stack, no connection string.
        for leaked in (
            "Traceback",
            "<!DOCTYPE",
            "Django Version",
            "6379",
            "127.0.0.1",
            "ConnectionError",
            "site-packages",
            "settings",
        ):
            self.assertNotIn(
                leaked, body, f"503 body must not contain {leaked!r}: {body[:200]}"
            )

    @patch("services.screening.enqueue.get_application")
    @patch("services.screening.locks.redis_client", side_effect=_boom)
    def test_outage_is_not_mistaken_for_client_error(self, _redis, get_application):
        from services.screening.repository import ScreeningApplicationRow

        get_application.return_value = ScreeningApplicationRow(
            application_id="app_1",
            organization_id="org_a",
            candidate_id="cand_1",
            job_id="job_1",
            stage="APPLIED",
            status="ACTIVE",
            resume_chars=500,
            description_chars=500,
        )

        res = self.client.post(
            "/api/v1/screening/", {"application_id": "app_1"}, format="json"
        )

        # A queue outage is the server's fault; 4xx would tell the caller to
        # change the request, and 200 would silently drop the job.
        self.assertGreaterEqual(res.status_code, 500)
        self.assertEqual(res.status_code, 503)

    @patch("services.screening.locks.redis_client", side_effect=_boom)
    def test_auth_still_enforced_during_an_outage(self, _redis):
        """An outage must not become an authentication bypass."""
        anon = APIClient()
        res = anon.post("/api/v1/screening/", {"application_id": "app_1"}, format="json")
        self.assertEqual(res.status_code, 401)

        candidate = APIClient()
        candidate.credentials(HTTP_AUTHORIZATION=f"Bearer {mint(role='CANDIDATE')}")
        res = candidate.post(
            "/api/v1/screening/", {"application_id": "app_1"}, format="json"
        )
        self.assertEqual(res.status_code, 403)


class ExceptionHandlerUnitTests(SimpleTestCase):
    """Direct handler behaviour, independent of any one endpoint."""

    def test_redis_connection_error_maps_to_503(self):
        res = hireos_exception_handler(REAL_REDIS_ERROR, {"view": None})
        self.assertIsNotNone(res)
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.data["code"], DEPENDENCY_UNAVAILABLE_CODE)

    def test_redis_timeout_maps_to_503(self):
        res = hireos_exception_handler(
            redis.exceptions.TimeoutError("Timeout connecting to server"), {"view": None}
        )
        self.assertIsNotNone(res)
        self.assertEqual(res.status_code, 503)

    def test_busy_loading_maps_to_503(self):
        res = hireos_exception_handler(
            redis.exceptions.BusyLoadingError("Redis is loading the dataset in memory"),
            {"view": None},
        )
        self.assertIsNotNone(res)
        self.assertEqual(res.status_code, 503)

    def test_celery_broker_operational_error_maps_to_503(self):
        from kombu import exceptions as kombu_exceptions

        res = hireos_exception_handler(
            kombu_exceptions.OperationalError("cannot reach broker"), {"view": None}
        )
        self.assertIsNotNone(res)
        self.assertEqual(res.status_code, 503)

    def test_detail_never_echoes_the_exception_message(self):
        res = hireos_exception_handler(REAL_REDIS_ERROR, {"view": None})
        rendered = str(res.data)
        self.assertNotIn("6379", rendered)
        self.assertNotIn("127.0.0.1", rendered)

    def test_redis_command_errors_are_not_masked_as_outages(self):
        """A ResponseError is a bug, not an outage — it must keep its 500."""
        res = hireos_exception_handler(
            redis.exceptions.ResponseError("WRONGTYPE Operation against a key"),
            {"view": None},
        )
        self.assertIsNone(res)

    def test_unrelated_exceptions_still_reach_drf(self):
        from rest_framework.exceptions import NotFound, ValidationError

        not_found = hireos_exception_handler(NotFound(), {"view": None})
        self.assertIsNotNone(not_found)
        self.assertEqual(not_found.status_code, 404)

        invalid = hireos_exception_handler(
            ValidationError({"application_id": "required"}), {"view": None}
        )
        self.assertIsNotNone(invalid)
        self.assertEqual(invalid.status_code, 400)

    def test_generic_server_bug_is_not_downgraded_to_503(self):
        self.assertIsNone(hireos_exception_handler(RuntimeError("bug"), {"view": None}))
