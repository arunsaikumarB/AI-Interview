"""Phase 3C Applications read API tests. SimpleTestCase — no Prisma writes."""

from __future__ import annotations

from datetime import timedelta
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.principals import HireOSPrincipal
from apps.accounts.roles import HireOSRole
from apps.accounts.tests.test_rbac import ORG_A, ORG_B, SETTINGS, mint
from apps.applications.models import Application
from apps.applications.querysets import apply_application_filters, scoped_applications
from apps.applications.views import ApplicationDetailView, ApplicationListView

APP_SETTINGS = {
    **SETTINGS,
    "ROOT_URLCONF": "config.urls",
}


@override_settings(**APP_SETTINGS)
class ApplicationRBACTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()

    def auth(self, **kwargs):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {mint(**kwargs)}")

    def test_invalid_token(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {mint(secret='wrong-secret')}")
        self.assertEqual(self.client.get("/api/v1/applications/").status_code, 401)

    def test_expired_token(self):
        self.client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {mint(exp_delta=timedelta(hours=-1))}"
        )
        self.assertEqual(self.client.get("/api/v1/applications/").status_code, 401)

    def test_candidate_forbidden(self):
        self.auth(sub="cand", role="CANDIDATE", email="c@example.com")
        self.assertEqual(self.client.get("/api/v1/applications/").status_code, 403)
        self.assertEqual(self.client.get("/api/v1/applications/any/").status_code, 403)

    @patch.object(ApplicationListView, "get_queryset", return_value=[])
    def test_staff_roles_allowed(self, _qs):
        for role in (
            "SUPER_ADMIN",
            "HR_ADMIN",
            "RECRUITER",
            "HIRING_MANAGER",
            "INTERVIEWER",
        ):
            self.auth(sub=f"u_{role}", role=role, email=f"{role}@ex.com")
            res = self.client.get("/api/v1/applications/")
            self.assertEqual(res.status_code, 200, role)

    @patch.object(ApplicationListView, "get_queryset", return_value=[])
    def test_page_size_capped(self, _qs):
        self.auth()
        res = self.client.get("/api/v1/applications/", {"page_size": "100000"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["page_size"], 100)

    @patch.object(ApplicationListView, "get_queryset", return_value=[])
    def test_invalid_stage_filter(self, _qs):
        self.auth()
        res = self.client.get("/api/v1/applications/", {"stage": "NOT_A_STAGE"})
        self.assertEqual(res.status_code, 400)

    @patch.object(ApplicationListView, "get_queryset", return_value=[])
    def test_invalid_sort_falls_back(self, _qs):
        self.auth()
        res = self.client.get("/api/v1/applications/", {"sort": "passwordHash"})
        self.assertEqual(res.status_code, 200)

    def test_missing_organization_forbidden(self):
        self.auth(organization_id=None)
        self.assertEqual(self.client.get("/api/v1/applications/").status_code, 403)

    def test_invalid_application_id_404(self):
        class EmptyScopedQS:
            model = Application

            def filter(self, *args, **kwargs):
                return self

            def distinct(self):
                return self

            def get(self, *args, **kwargs):
                raise Application.DoesNotExist("Application matching query does not exist.")

        with patch.object(
            ApplicationDetailView, "get_queryset", return_value=EmptyScopedQS()
        ):
            self.auth()
            res = self.client.get("/api/v1/applications/does-not-exist/")
        self.assertEqual(res.status_code, 404)

    def test_cross_org_detail_404(self):
        class EmptyScopedQS:
            model = Application

            def filter(self, *args, **kwargs):
                return self

            def distinct(self):
                return self

            def get(self, *args, **kwargs):
                raise Application.DoesNotExist("Application matching query does not exist.")

        with patch.object(
            ApplicationDetailView, "get_queryset", return_value=EmptyScopedQS()
        ):
            self.auth(organization_id=ORG_B)
            res = self.client.get("/api/v1/applications/app-from-org-a/")
        self.assertEqual(res.status_code, 404)


@override_settings(
    **{
        **APP_SETTINGS,
        "HIREOS_ENFORCE_PRISMA_USER_STATUS": True,
        "HIREOS_IDENTITY_DIRECTORY": "apps.accounts.tests.fakes.InactiveDirectory",
    }
)
class InactiveApplicationTests(SimpleTestCase):
    def test_inactive_user(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {mint()}")
        self.assertEqual(client.get("/api/v1/applications/").status_code, 401)


@override_settings(**APP_SETTINGS)
class ApplicationQueryTests(SimpleTestCase):
    def test_scoped_sql_uses_job_organization(self):
        principal = HireOSPrincipal(
            id="u1",
            email="r@example.com",
            name="R",
            role=HireOSRole.RECRUITER,
            source_role="RECRUITER",
            organization_id=ORG_A,
        )
        sql = str(scoped_applications(principal).query)
        self.assertIn(ORG_A, sql)
        self.assertNotIn(ORG_B, sql)
        self.assertNotIn("resumeText", sql)
        self.assertNotIn("embedding", sql.lower())

    def test_search_and_stage_are_sql(self):
        principal = HireOSPrincipal(
            id="u1",
            email="r@example.com",
            name="R",
            role=HireOSRole.RECRUITER,
            source_role="RECRUITER",
            organization_id=ORG_A,
        )
        sql = str(
            apply_application_filters(
                scoped_applications(principal),
                search="arun",
                stage="SCREENING",
                job_id="job_abc",
                sort="-created_at",
            ).query
        )
        self.assertIn("arun", sql.lower())
        self.assertIn("SCREENING", sql)
        self.assertIn("job_abc", sql)
        self.assertIn("createdAt", sql)
