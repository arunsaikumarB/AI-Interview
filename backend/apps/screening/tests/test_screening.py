"""Phase 3E screening queue tests. SimpleTestCase — no test database."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from unittest.mock import patch

from celery.exceptions import MaxRetriesExceededError
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.tests.test_rbac import ORG_A, ORG_B, SETTINGS, mint
from apps.screening.tasks import screen_application
from services.screening.errors import PermanentScreeningError, TransientScreeningError
from services.screening.pipeline import process_application_screening
from services.screening.repository import ScreeningApplicationRow

SCREEN_SETTINGS = {
    **SETTINGS,
    "ROOT_URLCONF": "config.urls",
    "SCREENING_LOCK_TTL_SECONDS": 900,
    "SCREENING_STATUS_TTL_SECONDS": 86400,
    "SCREENING_PROCESS_MAX_RETRIES": 3,
}


class FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    def set(self, key, value, nx=False, ex=None, xx=False):
        if nx and key in self.store:
            return False
        if xx and key not in self.store:
            return False
        self.store[key] = str(value)
        return True

    def get(self, key):
        return self.store.get(key)

    def delete(self, *keys):
        n = 0
        for key in keys:
            if key in self.store:
                del self.store[key]
                n += 1
        return n


def _row(**kwargs) -> ScreeningApplicationRow:
    data = dict(
        application_id="app_1",
        organization_id=ORG_A,
        candidate_id="cand_1",
        job_id="job_1",
        stage="APPLIED",
        status="ACTIVE",
        resume_chars=120,
        description_chars=400,
    )
    data.update(kwargs)
    return ScreeningApplicationRow(**data)


class CaptureHandler(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.records: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(self.format(record))


@override_settings(**SCREEN_SETTINGS)
class ScreeningQueueRBACTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()
        self.redis = FakeRedis()
        self.patches = [
            patch("services.screening.locks.redis_client", return_value=self.redis),
            patch("apps.screening.tasks.screen_application.apply_async", return_value=None),
        ]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)

    def auth(self, **kwargs):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {mint(**kwargs)}")

    def post(self, application_id="app_1"):
        return self.client.post(
            "/api/v1/screening/",
            {"application_id": application_id},
            format="json",
        )

    def test_unauthorized(self):
        self.assertEqual(self.post().status_code, 401)

    def test_expired_token(self):
        from datetime import timedelta

        self.client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {mint(exp_delta=timedelta(hours=-1))}"
        )
        self.assertEqual(self.post().status_code, 401)

    def test_invalid_token(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {mint(secret='wrong-secret')}")
        self.assertEqual(self.post().status_code, 401)

    def test_candidate_forbidden(self):
        self.auth(role="CANDIDATE")
        self.assertEqual(self.post().status_code, 403)

    def test_interviewer_forbidden(self):
        self.auth(role="INTERVIEWER")
        self.assertEqual(self.post().status_code, 403)

    @patch("services.screening.enqueue.get_application", return_value=_row())
    def test_valid_queue(self, _get):
        self.auth()
        res = self.post()
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["status"], "queued")
        self.assertTrue(body["task_id"])
        dumped = json.dumps(body)
        self.assertNotIn("resume", dumped.lower())
        self.assertNotIn("reasoning", dumped)
        self.assertEqual(set(body.keys()), {"status", "task_id"})

    @patch("services.screening.enqueue.get_application", return_value=None)
    def test_missing_application(self, _get):
        self.auth()
        self.assertEqual(self.post("missing").status_code, 404)

    @patch("services.screening.enqueue.get_application", return_value=None)
    def test_cross_organization(self, _get):
        self.auth(organization_id=ORG_B)
        self.assertEqual(self.post("app_1").status_code, 404)

    @patch(
        "services.screening.enqueue.get_application",
        return_value=_row(resume_chars=0),
    )
    def test_missing_resume(self, _get):
        self.auth()
        self.assertEqual(self.post().status_code, 400)

    @patch("services.screening.enqueue.get_application", return_value=_row())
    def test_duplicate_processing(self, _get):
        self.auth()
        first = self.post()
        second = self.post()
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["status"], "already_processing")
        self.assertEqual(second.json()["task_id"], first.json()["task_id"])

    @patch("services.screening.enqueue.get_application", return_value=_row())
    def test_recruitment_roles_allowed(self, _get):
        for role in ("SUPER_ADMIN", "HR_ADMIN", "RECRUITER", "HIRING_MANAGER"):
            self.redis.store.clear()
            self.auth(role=role, sub=f"u_{role}")
            self.assertEqual(self.post().status_code, 200, role)


@override_settings(**SCREEN_SETTINGS)
class ScreeningPipelineUnitTests(SimpleTestCase):
    def setUp(self):
        self.redis = FakeRedis()
        p = patch("services.screening.locks.redis_client", return_value=self.redis)
        p.start()
        self.addCleanup(p.stop)

    def test_success_does_not_expose_reasoning(self):
        engine_payload = {
            "ok": True,
            "evaluation_id": "eval_1",
            "kind": "RESUME_SCREEN",
            "recommendation": "MAYBE",
            "overall": 61,
            "model": "qwen2.5:7b",
            "stage_unchanged": True,
            "status_unchanged": True,
        }
        with (
            patch("services.screening.pipeline.get_application", return_value=_row()),
            patch(
                "services.screening.pipeline.run_existing_screen_engine",
                return_value=engine_payload,
            ),
            patch(
                "services.screening.pipeline.application_stage_status",
                return_value=("APPLIED", "ACTIVE"),
            ),
        ):
            result = process_application_screening(
                application_id="app_1",
                organization_id=ORG_A,
                task_id="task-1",
            )
        self.assertTrue(result["ok"])
        self.assertEqual(result["kind"], "RESUME_SCREEN")
        self.assertEqual(result["recommendation"], "MAYBE")
        self.assertNotIn("reasoning", result)
        self.assertNotIn("scores", result)

    def test_ollama_unavailable_is_transient(self):
        with (
            patch("services.screening.pipeline.get_application", return_value=_row()),
            patch(
                "services.screening.pipeline.run_existing_screen_engine",
                side_effect=TransientScreeningError("ollama_unavailable"),
            ),
        ):
            with self.assertRaises(TransientScreeningError):
                process_application_screening(
                    application_id="app_1",
                    organization_id=ORG_A,
                    task_id="task-1",
                )

    def test_malformed_output_is_permanent(self):
        with (
            patch("services.screening.pipeline.get_application", return_value=_row()),
            patch(
                "services.screening.pipeline.run_existing_screen_engine",
                side_effect=PermanentScreeningError("malformed_model_output"),
            ),
        ):
            with self.assertRaises(PermanentScreeningError) as ctx:
                process_application_screening(
                    application_id="app_1",
                    organization_id=ORG_A,
                    task_id="task-1",
                )
        self.assertEqual(ctx.exception.error_class, "malformed_model_output")

    def test_permanent_does_not_retry(self):
        with (
            patch(
                "apps.screening.tasks.process_application_screening",
                side_effect=PermanentScreeningError("missing_resume"),
            ),
            patch("apps.screening.tasks.fail_screening") as fail,
            patch.object(screen_application, "retry") as retry,
        ):
            screen_application.push_request(id="tid", retries=0)
            try:
                result = screen_application.run("app_1", ORG_A)
            finally:
                screen_application.pop_request()
        retry.assert_not_called()
        fail.assert_called_once()
        self.assertEqual(result["error_class"], "missing_resume")

    def test_retries_then_stops(self):
        with (
            patch(
                "apps.screening.tasks.process_application_screening",
                side_effect=TransientScreeningError("ollama_unavailable"),
            ),
            patch("apps.screening.tasks.fail_screening"),
            patch.object(
                screen_application,
                "retry",
                side_effect=MaxRetriesExceededError(),
            ),
        ):
            screen_application.push_request(id="tid", retries=3)
            try:
                result = screen_application.run("app_1", ORG_A)
            finally:
                screen_application.pop_request()
        self.assertEqual(result["error_class"], "retries_exhausted")

    def test_logs_omit_resume_and_reasoning(self):
        handler = CaptureHandler()
        handler.setFormatter(logging.Formatter("%(message)s"))
        log = logging.getLogger("hireos.screening")
        log.addHandler(handler)
        log.setLevel(logging.INFO)
        self.addCleanup(lambda: log.removeHandler(handler))
        with (
            patch("services.screening.pipeline.get_application", return_value=_row()),
            patch(
                "services.screening.pipeline.run_existing_screen_engine",
                return_value={
                    "ok": True,
                    "evaluation_id": "eval_1",
                    "kind": "RESUME_SCREEN",
                    "recommendation": "YES",
                    "overall": 80,
                    "model": "qwen2.5:7b",
                    "stage_unchanged": True,
                    "status_unchanged": True,
                },
            ),
            patch(
                "services.screening.pipeline.application_stage_status",
                return_value=("APPLIED", "ACTIVE"),
            ),
        ):
            process_application_screening(
                application_id="app_1",
                organization_id=ORG_A,
                task_id="task-1",
            )
        joined = "\n".join(handler.records)
        self.assertNotIn("SECRET_RESUME", joined)
        self.assertNotIn("reasoning", joined)
        self.assertIn("application_id=app_1", joined)

    def test_screening_python_has_no_proctoring(self):
        root = Path(__file__).resolve().parents[3]
        banned = (
            "proctoring",
            "proctoringevent",
            "secondary camera",
            "tab switching",
            "multiple faces",
        )
        for rel in ("services/screening", "apps/screening"):
            folder = root / rel
            for path in folder.rglob("*.py"):
                if "__pycache__" in path.parts or path.name.startswith("test_"):
                    continue
                text = path.read_text(encoding="utf-8").lower()
                for word in banned:
                    self.assertNotIn(word, text, f"{path} contains {word}")
