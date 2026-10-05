"""Phase 3B Candidates read API tests. SimpleTestCase — no Prisma writes."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.principals import HireOSPrincipal
from apps.accounts.roles import HireOSRole
from apps.accounts.tests.test_rbac import ORG_A, ORG_B, SETTINGS, mint
from apps.candidates.models import Candidate
from apps.candidates.querysets import apply_candidate_filters, scoped_candidates
from apps.candidates.serializers import (
    CandidateListSerializer,
    CandidateSerializer,
    public_resume_text,
)
from apps.candidates.views import CandidateDetailView, CandidateListView

CAND_SETTINGS = {
    **SETTINGS,
    "ROOT_URLCONF": "config.urls",
}


@override_settings(**CAND_SETTINGS)
class CandidateRBACTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()

    def auth(self, **kwargs):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {mint(**kwargs)}")

    def test_invalid_token(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {mint(secret='wrong-secret')}")
        self.assertEqual(self.client.get("/api/v1/candidates/").status_code, 401)

    def test_expired_token(self):
        self.client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {mint(exp_delta=timedelta(hours=-1))}"
        )
        self.assertEqual(self.client.get("/api/v1/candidates/").status_code, 401)

    def test_candidate_forbidden(self):
        self.auth(sub="cand", role="CANDIDATE", email="c@example.com")
        self.assertEqual(self.client.get("/api/v1/candidates/").status_code, 403)
        self.assertEqual(self.client.get("/api/v1/candidates/any-id/").status_code, 403)

    @patch.object(CandidateListView, "get_queryset", return_value=[])
    def test_staff_roles_allowed_on_list(self, _qs):
        for prisma_role in (
            "SUPER_ADMIN",
            "HR_ADMIN",
            "RECRUITER",
            "HIRING_MANAGER",
            "INTERVIEWER",
        ):
            self.auth(sub=f"u_{prisma_role}", role=prisma_role, email=f"{prisma_role}@ex.com")
            res = self.client.get("/api/v1/candidates/")
            self.assertEqual(res.status_code, 200, prisma_role)
            body = res.json()
            self.assertIn("candidates", body)
            self.assertLessEqual(body["page_size"], 100)

    @patch.object(CandidateListView, "get_queryset", return_value=[])
    def test_page_size_capped(self, _qs):
        self.auth()
        res = self.client.get("/api/v1/candidates/", {"page_size": "100000"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["page_size"], 100)

    def test_missing_organization_forbidden(self):
        self.auth(organization_id=None)
        self.assertEqual(self.client.get("/api/v1/candidates/").status_code, 403)

    def test_cross_org_detail_is_404(self):
        class EmptyScopedQS:
            model = Candidate

            def filter(self, *args, **kwargs):
                return self

            def distinct(self):
                return self

            def get(self, *args, **kwargs):
                raise Candidate.DoesNotExist("Candidate matching query does not exist.")

        with patch.object(
            CandidateDetailView, "get_queryset", return_value=EmptyScopedQS()
        ):
            self.auth(organization_id=ORG_B)
            res = self.client.get("/api/v1/candidates/cand-from-org-a/")
        self.assertEqual(res.status_code, 404)


@override_settings(
    **{
        **CAND_SETTINGS,
        "HIREOS_ENFORCE_PRISMA_USER_STATUS": True,
        "HIREOS_IDENTITY_DIRECTORY": "apps.accounts.tests.fakes.InactiveDirectory",
    }
)
class InactiveStaffCandidateTests(SimpleTestCase):
    def test_inactive_user_rejected(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {mint()}")
        res = client.get("/api/v1/candidates/")
        # HireOS treats inactive as unauthenticated (Next /api/auth/me → 401), not 403.
        self.assertEqual(res.status_code, 401)


@override_settings(**CAND_SETTINGS)
class CandidateQueryTests(SimpleTestCase):
    def test_scoped_sql_always_includes_organization(self):
        principal = HireOSPrincipal(
            id="u1",
            email="r@example.com",
            name="R",
            role=HireOSRole.RECRUITER,
            source_role="RECRUITER",
            organization_id=ORG_A,
        )
        sql = str(scoped_candidates(principal).query)
        self.assertIn(ORG_A, sql)
        self.assertIn("organizationId", sql)
        self.assertNotIn(ORG_B, sql)
        self.assertNotIn("embedding", sql.lower())

    def test_search_is_sql_filter(self):
        principal = HireOSPrincipal(
            id="u1",
            email="r@example.com",
            name="R",
            role=HireOSRole.RECRUITER,
            source_role="RECRUITER",
            organization_id=ORG_A,
        )
        sql = str(
            apply_candidate_filters(
                scoped_candidates(principal),
                search="alex",
                sort="-updated_at",
            ).query
        )
        self.assertIn("alex", sql.lower())
        self.assertIn("updatedAt", sql)

    def test_list_query_skips_resume_text_and_orders_deterministically(self):
        principal = HireOSPrincipal(
            id="u1",
            email="r@example.com",
            name="R",
            role=HireOSRole.RECRUITER,
            source_role="RECRUITER",
            organization_id=ORG_A,
        )
        view = CandidateListView()
        view.request = SimpleNamespace(user=principal, query_params={"sort": "-created_at"})
        sql = str(view.get_queryset().query)
        self.assertNotIn("resumeText", sql)
        self.assertIn('"createdAt" DESC', sql)
        self.assertIn('"id" DESC', sql)


class CandidateListSerializerTests(SimpleTestCase):
    def test_list_row_has_no_contact_or_resume_content(self):
        cand = Candidate(
            id="c1",
            organization_id=ORG_A,
            email="a@example.com",
            first_name="Ada",
            last_name="Lovelace",
            phone="+1 555 0100",
            location=None,
            summary="summary",
            skills=["python"],
            experience=2,
            education=[],
            certifications=[],
            resume_url="resumes/a.pdf",
            resume_text="secret resume text",
            created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            updated_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
        )
        cand.application_count = 2
        data = CandidateListSerializer(cand).data
        self.assertEqual(
            sorted(data.keys()),
            sorted(
                [
                    "id",
                    "email",
                    "firstName",
                    "lastName",
                    "location",
                    "skills",
                    "experience",
                    "createdAt",
                    "updatedAt",
                    "applicationCount",
                    "hasResume",
                ]
            ),
        )
        self.assertTrue(data["hasResume"])
        self.assertEqual(data["applicationCount"], 2)

    def test_detail_resume_text_has_no_pdf_page_markers(self):
        self.assertEqual(
            public_resume_text("Ada Lovelace\n\n-- 1 of 2 --\n\nPython\n-- 2 of 2 --"),
            "Ada Lovelace\n\nPython",
        )
        self.assertIsNone(public_resume_text("-- 1 of 1 --"))
        self.assertIsNone(public_resume_text(None))
        cand = Candidate(id="c1", organization_id=ORG_A, resume_text="Ada\n-- 1 of 1 --")
        self.assertEqual(CandidateSerializer().get_resumeText(cand), "Ada")
