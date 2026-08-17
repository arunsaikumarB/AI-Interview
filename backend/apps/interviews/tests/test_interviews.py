"""Phase 3F interview background-queue tests. Live turns are not exercised here."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.tests.test_rbac import ORG_A, ORG_B, SETTINGS, mint
from services.interviews.repository import InterviewSessionRow

IV_SETTINGS = {
    **SETTINGS,
    "ROOT_URLCONF": "config.urls",
    "INTERVIEW_LOCK_TTL_SECONDS": 900,
    "INTERVIEW_STATUS_TTL_SECONDS": 86400,
}


class FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    def set(self, key, value, nx=False, ex=None, xx=False):
        if nx and key in self.store:
            return False
        self.store[key] = str(value)
        return True

    def get(self, key):
        return self.store.get(key)

    def delete(self, *keys):
        n = 0
        for key in keys:
            if self.store.pop(key, None) is not None:
                n += 1
        return n


def _row(**kwargs) -> InterviewSessionRow:
    data = dict(
        id="sess_1",
        organization_id=ORG_A,
        application_id="app_1",
        status="SCHEDULED",
        has_plan=True,
    )
    data.update(kwargs)
    return InterviewSessionRow(**data)


@override_settings(**IV_SETTINGS)
class InterviewQueueTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()
        self.redis = FakeRedis()
        patches = [
            patch("services.interviews.locks.redis_client", return_value=self.redis),
            patch("apps.interviews.tasks.generate_plan_task.apply_async", return_value=None),
            patch("apps.interviews.tasks.finalize_interview_task.apply_async", return_value=None),
            patch("apps.interviews.tasks.prefetch_tts_task.apply_async", return_value=None),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def auth(self, **kwargs):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {mint(**kwargs)}")

    def test_unauthorized_plan(self):
        self.assertEqual(
            self.client.post("/api/v1/interviews/plan/", {"session_id": "sess_1"}, format="json").status_code,
            401,
        )

    def test_candidate_forbidden(self):
        self.auth(role="CANDIDATE")
        self.assertEqual(
            self.client.post("/api/v1/interviews/plan/", {"session_id": "sess_1"}, format="json").status_code,
            403,
        )

    def test_interviewer_forbidden(self):
        self.auth(role="INTERVIEWER")
        self.assertEqual(
            self.client.post("/api/v1/interviews/plan/", {"session_id": "sess_1"}, format="json").status_code,
            403,
        )

    @patch("services.interviews.enqueue.get_session", return_value=_row())
    def test_plan_queued(self, _g):
        self.auth()
        res = self.client.post("/api/v1/interviews/plan/", {"session_id": "sess_1"}, format="json")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["status"], "queued")
        self.assertEqual(body["kind"], "plan")
        self.assertEqual(set(body.keys()), {"status", "task_id", "kind"})
        self.assertNotIn("openingQuestion", json.dumps(body))
        self.assertNotIn("topics", json.dumps(body))

    @patch("services.interviews.enqueue.get_session", return_value=_row())
    def test_plan_duplicate(self, _g):
        self.auth()
        first = self.client.post("/api/v1/interviews/plan/", {"session_id": "sess_1"}, format="json")
        second = self.client.post("/api/v1/interviews/plan/", {"session_id": "sess_1"}, format="json")
        self.assertEqual(second.json()["status"], "already_processing")
        self.assertEqual(second.json()["task_id"], first.json()["task_id"])

    @patch("services.interviews.enqueue.get_session", return_value=None)
    def test_cross_org_404(self, _g):
        self.auth(organization_id=ORG_B)
        self.assertEqual(
            self.client.post("/api/v1/interviews/plan/", {"session_id": "sess_1"}, format="json").status_code,
            404,
        )

    @patch(
        "services.interviews.enqueue.get_session",
        return_value=_row(status="IN_PROGRESS"),
    )
    def test_plan_rejects_in_progress(self, _g):
        self.auth()
        self.assertEqual(
            self.client.post("/api/v1/interviews/plan/", {"session_id": "sess_1"}, format="json").status_code,
            400,
        )

    @patch(
        "services.interviews.enqueue.get_session",
        return_value=_row(status="COMPLETED"),
    )
    def test_finalize_queued(self, _g):
        self.auth()
        res = self.client.post("/api/v1/interviews/finalize/", {"session_id": "sess_1"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["kind"], "finalize")

    @patch(
        "services.interviews.enqueue.get_session",
        return_value=_row(status="SCHEDULED"),
    )
    def test_finalize_rejects_scheduled(self, _g):
        self.auth()
        self.assertEqual(
            self.client.post("/api/v1/interviews/finalize/", {"session_id": "sess_1"}, format="json").status_code,
            400,
        )

    @patch("services.interviews.enqueue.question_belongs", return_value=True)
    @patch("services.interviews.enqueue.get_session", return_value=_row(status="IN_PROGRESS"))
    def test_tts_queued(self, _g, _q):
        self.auth()
        res = self.client.post(
            "/api/v1/interviews/tts/",
            {"session_id": "sess_1", "question_id": "q1"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["kind"], "tts")

    def test_python_has_no_proctoring_signals(self):
        root = Path(__file__).resolve().parents[3]
        banned = ("tab_blur", "multiple_faces", "copy_paste", "window_switch", "secondary camera")
        for rel in ("services/interviews", "apps/interviews"):
            for path in (root / rel).rglob("*.py"):
                if path.name.startswith("test_") or "__pycache__" in path.parts:
                    continue
                text = path.read_text(encoding="utf-8").lower()
                for word in banned:
                    self.assertNotIn(word, text, f"{path} {word}")
