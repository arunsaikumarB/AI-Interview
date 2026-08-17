"""Phase 4C.2 Job writes — SimpleTestCase (no Django test database)."""

from __future__ import annotations

from datetime import timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, override_settings
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.test import APIClient

from apps.accounts.tests.test_rbac import SETTINGS, mint
from apps.jobs.job_write import extra_write_keys
from apps.jobs.models import Job

APP_SETTINGS = {
    **SETTINGS,
    "ROOT_URLCONF": "config.urls",
}


@override_settings(**APP_SETTINGS)
class JobWriteRBACTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()

    def auth(self, **kwargs):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {mint(**kwargs)}")

    def test_missing_auth_401(self):
        self.assertEqual(self.client.post("/api/v1/jobs/", {"title": "AB"}).status_code, 401)
        self.assertEqual(
            self.client.patch("/api/v1/jobs/j1/", {"title": "Hello"}).status_code, 401
        )
        self.assertEqual(self.client.delete("/api/v1/jobs/j1/").status_code, 401)

    def test_invalid_and_expired_401(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {mint(secret='wrong-secret')}")
        self.assertEqual(self.client.post("/api/v1/jobs/", {"title": "AB"}, format="json").status_code, 401)
        self.client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {mint(exp_delta=timedelta(hours=-1))}"
        )
        self.assertEqual(self.client.delete("/api/v1/jobs/j1/").status_code, 401)

    def test_candidate_and_interviewer_and_hm_403(self):
        for role, sub in (
            ("CANDIDATE", "cand"),
            ("INTERVIEWER", "int"),
            ("HIRING_MANAGER", "hm"),
        ):
            self.auth(role=role, email=f"{role}@ex.com", sub=sub)
            self.assertEqual(
                self.client.post(
                    "/api/v1/jobs/",
                    {"title": "Engineer", "description": "A long enough description"},
                    format="json",
                ).status_code,
                403,
                role,
            )

    def test_job_managers_reach_create(self):
        fake = MagicMock()
        fake.id = "job1"
        serialized = {
            "id": "job1",
            "title": "Engineer",
            "description": "A long enough description",
            "status": "DRAFT",
            "organizationId": "org_aaaaaaaaaaaaaaaaaaaaaaaa",
            "departmentId": None,
            "location": None,
            "experienceMin": 0,
            "experienceMax": None,
            "skills": [],
            "salaryMin": None,
            "salaryMax": None,
            "employmentType": "FULL_TIME",
            "openings": 1,
            "interviewStages": [],
            "screeningCriteria": {},
            "createdById": "u",
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-01T00:00:00Z",
            "applicationCount": 0,
            "organization": None,
            "department": None,
            "createdBy": None,
        }
        for role in ("SUPER_ADMIN", "HR_ADMIN", "RECRUITER"):
            self.auth(role=role, sub=f"u_{role}", email=f"{role}@ex.com")
            with (
                patch("apps.jobs.views.create_job", return_value=fake) as created,
                patch("apps.jobs.views.job_for_response", return_value=fake),
                patch("apps.jobs.views.JobSerializer") as ser,
            ):
                ser.return_value.data = serialized
                res = self.client.post(
                    "/api/v1/jobs/",
                    {"title": "Engineer", "description": "A long enough description"},
                    format="json",
                )
            self.assertEqual(res.status_code, 201, role)
            self.assertTrue(created.called)
            self.assertNotIn("organizationId", created.call_args.kwargs.get("body", {}))

    def test_unsupported_field_400(self):
        self.auth()
        res = self.client.post(
            "/api/v1/jobs/",
            {
                "title": "Engineer",
                "description": "A long enough description",
                "organizationId": "hack",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 400)

    def test_patch_missing_404(self):
        self.auth()
        with patch("apps.jobs.views.update_job", side_effect=NotFound("Job not found")):
            res = self.client.patch(
                "/api/v1/jobs/missing/",
                {"title": "Engineer role"},
                format="json",
            )
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.json().get("error"), "Job not found")

    def test_cross_org_department_400(self):
        self.auth()
        with patch(
            "apps.jobs.views.create_job",
            side_effect=ValidationError("Department not found in organization"),
        ):
            res = self.client.post(
                "/api/v1/jobs/",
                {
                    "title": "Engineer",
                    "description": "A long enough description",
                    "departmentId": "dept-other-org",
                },
                format="json",
            )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json().get("error"), "Department not found in organization")

    def test_delete_ok(self):
        self.auth()
        with patch("apps.jobs.views.delete_job"):
            res = self.client.delete("/api/v1/jobs/job1/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"ok": True})

    def test_write_module_has_no_ai(self):
        from apps.jobs import job_write

        text = Path(job_write.__file__).read_text(encoding="utf-8")
        self.assertNotIn("ollama", text.lower())
        self.assertNotIn("from celery", text)
        self.assertNotIn("screenApplication", text)

    def test_extra_keys(self):
        self.assertTrue(extra_write_keys({"title": "x", "id": "no"}))
        self.assertFalse(extra_write_keys({"title": "x", "status": "OPEN"}))


class JobStatusEnumTests(SimpleTestCase):
    def test_prisma_statuses_only(self):
        self.assertEqual(
            set(Job.Status.values),
            {"DRAFT", "OPEN", "PAUSED", "CLOSED"},
        )
