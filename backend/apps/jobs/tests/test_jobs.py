"""Phase 3A Jobs read API tests. SimpleTestCase — no test database, no Prisma writes."""

from __future__ import annotations

from unittest.mock import patch

from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.principals import HireOSPrincipal
from apps.accounts.roles import HireOSRole
from apps.accounts.tests.test_rbac import ORG_A, ORG_B, SETTINGS, mint
from apps.jobs.models import Job
from apps.jobs.querysets import ALLOWED_ORDERING, apply_job_filters, scoped_jobs
from apps.jobs.views import JobDetailView, JobListView

JOB_SETTINGS = {
    **SETTINGS,
    "ROOT_URLCONF": "config.urls",
}


@override_settings(**JOB_SETTINGS)
class JobRBACTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()

    def auth(self, **kwargs):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {mint(**kwargs)}")

    def test_invalid_token(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {mint(secret='wrong-secret')}")
        self.assertEqual(self.client.get("/api/v1/jobs/").status_code, 401)
        self.assertEqual(self.client.get("/api/v1/jobs/abc/").status_code, 401)

    def test_expired_token(self):
        from datetime import timedelta

        self.client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {mint(exp_delta=timedelta(hours=-1))}"
        )
        self.assertEqual(self.client.get("/api/v1/jobs/").status_code, 401)

    def test_candidate_forbidden(self):
        self.auth(sub="cand", role="CANDIDATE", email="c@example.com")
        self.assertEqual(self.client.get("/api/v1/jobs/").status_code, 403)
        self.assertEqual(self.client.get("/api/v1/jobs/any-id/").status_code, 403)

    @patch.object(JobListView, "get_queryset", return_value=[])
    def test_staff_roles_allowed_on_list(self, _qs):
        roles = [
            ("SUPER_ADMIN", "ADMIN"),
            ("HR_ADMIN", "HR"),
            ("RECRUITER", "RECRUITER"),
            ("HIRING_MANAGER", "HIRING_MANAGER"),
            ("INTERVIEWER", "INTERVIEWER"),
        ]
        for prisma_role, _label in roles:
            self.auth(sub=f"u_{prisma_role}", role=prisma_role, email=f"{prisma_role}@ex.com")
            res = self.client.get("/api/v1/jobs/")
            self.assertEqual(res.status_code, 200, prisma_role)
            body = res.json()
            self.assertIn("jobs", body)
            self.assertIn("page", body)
            self.assertIn("page_size", body)
            self.assertLessEqual(body["page_size"], 100)

    @patch.object(JobListView, "get_queryset", return_value=[])
    def test_page_size_capped(self, _qs):
        self.auth()
        res = self.client.get("/api/v1/jobs/", {"page_size": "100000"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["page_size"], 100)

    def test_missing_organization_forbidden(self):
        self.auth(organization_id=None)
        self.assertEqual(self.client.get("/api/v1/jobs/").status_code, 403)

    def test_cross_org_detail_is_404_not_leak(self):
        class EmptyScopedQS:
            model = Job

            def filter(self, *args, **kwargs):
                return self

            def distinct(self):
                return self

            def get(self, *args, **kwargs):
                raise Job.DoesNotExist("Job matching query does not exist.")

        with patch.object(JobDetailView, "get_queryset", return_value=EmptyScopedQS()):
            self.auth(organization_id=ORG_B)
            res = self.client.get("/api/v1/jobs/job-from-org-a/")
        self.assertEqual(res.status_code, 404)


@override_settings(**JOB_SETTINGS)
class JobQueryTests(SimpleTestCase):
    def test_scoped_sql_always_includes_organization(self):
        principal = HireOSPrincipal(
            id="u1",
            email="r@example.com",
            name="R",
            role=HireOSRole.RECRUITER,
            source_role="RECRUITER",
            organization_id=ORG_A,
        )
        sql = str(scoped_jobs(principal).query)
        self.assertIn(ORG_A, sql)
        self.assertIn("organizationId", sql)
        self.assertNotIn(ORG_B, sql)

    def test_status_and_search_are_sql_filters(self):
        principal = HireOSPrincipal(
            id="u1",
            email="r@example.com",
            name="R",
            role=HireOSRole.RECRUITER,
            source_role="RECRUITER",
            organization_id=ORG_A,
        )
        qs = apply_job_filters(
            scoped_jobs(principal),
            search="developer",
            status="OPEN",
            ordering="-created_at",
        )
        sql = str(qs.query)
        self.assertIn("OPEN", sql)
        self.assertIn("developer", sql.lower())
        self.assertTrue(any(token in ALLOWED_ORDERING for token in ["-created_at"]))

    def test_unknown_ordering_falls_back(self):
        principal = HireOSPrincipal(
            id="u1",
            email="r@example.com",
            name="R",
            role=HireOSRole.RECRUITER,
            source_role="RECRUITER",
            organization_id=ORG_A,
        )
        sql = str(apply_job_filters(scoped_jobs(principal), ordering="password").query)
        self.assertIn("createdAt", sql)
        self.assertNotIn("password", sql)
