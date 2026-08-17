"""Phase 4C.1 stage write — SimpleTestCase (no Django test database)."""

from __future__ import annotations

from datetime import timedelta
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.tests.test_rbac import SETTINGS, mint
from apps.applications.stage_write import compute_status
from rest_framework.exceptions import NotFound, ValidationError

APP_SETTINGS = {
    **SETTINGS,
    "ROOT_URLCONF": "config.urls",
}


class ComputeStatusTests(SimpleTestCase):
    def test_selected_hired(self):
        self.assertEqual(compute_status("SELECTED", "ACTIVE"), "HIRED")

    def test_rejected(self):
        self.assertEqual(compute_status("REJECTED", "ACTIVE"), "REJECTED")

    def test_reopen_clears_terminal_status(self):
        self.assertEqual(compute_status("SCREENING", "HIRED"), "ACTIVE")
        self.assertEqual(compute_status("SCREENING", "REJECTED"), "ACTIVE")

    def test_preserves_on_hold(self):
        self.assertEqual(compute_status("SCREENING", "ON_HOLD"), "ON_HOLD")


@override_settings(**APP_SETTINGS)
class ApplicationStageRBACTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()

    def auth(self, **kwargs):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {mint(**kwargs)}")

    def test_missing_auth_401(self):
        self.assertEqual(
            self.client.post("/api/v1/applications/app1/stage/", {"toStage": "SCREENING"}).status_code,
            401,
        )

    def test_invalid_token_401(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {mint(secret='wrong-secret')}")
        self.assertEqual(
            self.client.post("/api/v1/applications/app1/stage/", {"toStage": "SCREENING"}).status_code,
            401,
        )

    def test_expired_token_401(self):
        self.client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {mint(exp_delta=timedelta(hours=-1))}"
        )
        self.assertEqual(
            self.client.post("/api/v1/applications/app1/stage/", {"toStage": "SCREENING"}).status_code,
            401,
        )

    def test_candidate_403(self):
        self.auth(role="CANDIDATE", email="c@example.com", sub="cand")
        self.assertEqual(
            self.client.post("/api/v1/applications/app1/stage/", {"toStage": "SCREENING"}).status_code,
            403,
        )

    def test_interviewer_403(self):
        self.auth(role="INTERVIEWER", email="i@example.com", sub="int")
        self.assertEqual(
            self.client.post("/api/v1/applications/app1/stage/", {"toStage": "SCREENING"}).status_code,
            403,
        )

    def test_pipeline_roles_reach_write(self):
        fake = {
            "application": {"id": "app1", "stage": "SCREENING", "status": "ACTIVE"},
            "advisoryNote": "AI recommendations are advisory only. This stage change was made by a human.",
            "unchanged": False,
        }
        for role in ("SUPER_ADMIN", "HR_ADMIN", "RECRUITER", "HIRING_MANAGER"):
            self.auth(role=role, sub=f"u_{role}", email=f"{role}@ex.com")
            with patch(
                "apps.applications.views.apply_stage", return_value=fake
            ) as mocked:
                res = self.client.post(
                    "/api/v1/applications/app1/stage/",
                    {"toStage": "SCREENING"},
                    format="json",
                )
            self.assertEqual(res.status_code, 200, role)
            self.assertIn("advisoryNote", res.json())
            self.assertTrue(mocked.called)
            self.assertNotIn("organizationId", mocked.call_args.kwargs)

    def test_unsupported_field_400(self):
        self.auth()
        res = self.client.post(
            "/api/v1/applications/app1/stage/",
            {"toStage": "SCREENING", "candidateId": "hack"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)

    def test_missing_application_404(self):
        self.auth()
        with patch(
            "apps.applications.views.apply_stage", side_effect=NotFound()
        ):
            res = self.client.post(
                "/api/v1/applications/missing/stage/",
                {"toStage": "SCREENING"},
                format="json",
            )
        self.assertEqual(res.status_code, 404)

    def test_short_terminal_note_400(self):
        self.auth()
        with patch(
            "apps.applications.views.apply_stage",
            side_effect=ValidationError("Final decisions require a human rationale (note)"),
        ):
            res = self.client.post(
                "/api/v1/applications/app1/stage/",
                {"toStage": "SELECTED", "note": "no"},
                format="json",
            )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(
            res.json().get("error"),
            "Final decisions require a human rationale (note)",
        )

    def test_cross_org_404_body(self):
        self.auth()
        with patch("apps.applications.views.apply_stage", side_effect=NotFound("Application not found")):
            res = self.client.post(
                "/api/v1/applications/app-other-org/stage/",
                {"toStage": "SCREENING"},
                format="json",
            )
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.json().get("error"), "Application not found")
        self.assertNotIn("candidate", res.json())

    def test_stage_write_module_has_no_ai_or_celery(self):
        from pathlib import Path

        from apps.applications import stage_write

        text = Path(stage_write.__file__).read_text(encoding="utf-8")
        self.assertNotIn("ollama", text.lower())
        self.assertNotIn("from celery", text)
        self.assertNotIn("screenApplication", text)
        self.assertNotIn("ProctoringEvent", text)
