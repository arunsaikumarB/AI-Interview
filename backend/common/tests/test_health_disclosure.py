"""R-2 — the public health endpoint must not describe the deployment.

Before this change ``/api/v1/health/`` was ``AllowAny`` and echoed the raw
psycopg / redis exception text on failure, which includes the host and port it
tried to reach. Readiness probes need a verdict, not a topology map.
"""

from __future__ import annotations

import json
from unittest import mock

from django.test import TestCase
from django.urls import reverse

HEALTH = "/api/v1/health/"

# Substrings that must never reach an unauthenticated caller.
FORBIDDEN = (
    "localhost",
    "127.0.0.1",
    "5432",
    "55432",
    "6379",
    "redis://",
    "postgres://",
    "postgresql://",
    "Traceback",
    "psycopg",
    "DESKTOP-",
)


def assert_no_disclosure(testcase: TestCase, body: str) -> None:
    lowered = body.lower()
    for needle in FORBIDDEN:
        testcase.assertNotIn(
            needle.lower(), lowered, f"public health leaked {needle!r}: {body}"
        )


class PublicHealthDisclosureTests(TestCase):
    def test_healthy_response_is_boolean_only(self) -> None:
        res = self.client.get(HEALTH)
        self.assertEqual(res.status_code, 200)
        body = res.json()
        assert_no_disclosure(self, json.dumps(body))
        self.assertEqual(
            sorted(body.keys()), ["celery", "django", "ok", "postgres", "redis"]
        )
        for key in ("django", "postgres", "redis", "celery"):
            self.assertEqual(
                list(body[key].keys()), ["ok"], f"{key} must expose only 'ok'"
            )

    def test_ok_field_present_for_probes(self) -> None:
        body = self.client.get(HEALTH).json()
        self.assertIn("ok", body)
        self.assertIsInstance(body["ok"], bool)

    def test_postgres_failure_hides_the_connection_string(self) -> None:
        boom = Exception(
            "connection failed: connection to server at "
            '"localhost" (127.0.0.1), port 55432 failed'
        )
        with mock.patch("common.views._postgres", return_value={"ok": False, "error": str(boom)}):
            res = self.client.get(HEALTH)
        self.assertEqual(res.status_code, 503, "an unready app must say so")
        assert_no_disclosure(self, res.content.decode())
        self.assertFalse(res.json()["postgres"]["ok"])
        self.assertNotIn("error", res.json()["postgres"])

    def test_redis_failure_hides_the_broker_url(self) -> None:
        with mock.patch(
            "common.views._redis",
            return_value={"ok": False, "error": "Error 10061 connecting to localhost:6379"},
        ):
            res = self.client.get(HEALTH)
        assert_no_disclosure(self, res.content.decode())
        self.assertFalse(res.json()["redis"]["ok"])

    def test_celery_worker_names_are_not_public(self) -> None:
        with mock.patch(
            "common.views._celery",
            return_value={"ok": True, "workers": ["celery@DESKTOP-9177HSA"]},
        ):
            res = self.client.get(HEALTH)
        assert_no_disclosure(self, res.content.decode())
        self.assertNotIn("workers", res.json()["celery"])
        self.assertTrue(res.json()["celery"]["ok"])

    def test_readiness_status_code_still_tracks_postgres(self) -> None:
        with mock.patch("common.views._postgres", return_value={"ok": True}):
            self.assertEqual(self.client.get(HEALTH).status_code, 200)
        with mock.patch("common.views._postgres", return_value={"ok": False, "error": "x"}):
            self.assertEqual(self.client.get(HEALTH).status_code, 503)

    def test_endpoint_stays_reachable_without_credentials(self) -> None:
        """Docker/monitoring probes must not need a session."""
        res = self.client.get(HEALTH)
        self.assertIn(res.status_code, (200, 503))

    def test_detail_query_parameter_cannot_unlock_internals(self) -> None:
        """No unauthenticated escape hatch, however it is spelled."""
        for suffix in ("?detail=1", "?detail=true", "?verbose=1", "?full=1"):
            res = self.client.get(HEALTH + suffix)
            assert_no_disclosure(self, res.content.decode())
