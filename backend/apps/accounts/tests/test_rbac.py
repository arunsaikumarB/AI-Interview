"""Phase 2 RBAC tests — SimpleTestCase so Django does not create a test database."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt
from django.test import SimpleTestCase, override_settings
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APIClient

from apps.accounts.principals import HireOSPrincipal
from apps.accounts.roles import HireOSRole
from apps.accounts.scoping import assert_same_organization, require_organization_id

TEST_SECRET = "phase2-test-auth-secret-not-production"
ORG_A = "org_aaaaaaaaaaaaaaaaaaaaaaaa"
ORG_B = "org_bbbbbbbbbbbbbbbbbbbbbbbb"


def mint(
    *,
    sub: str = "user_recruiter_a",
    email: str = "recruiter-a@example.com",
    name: str = "Recruiter A",
    role: str = "RECRUITER",
    organization_id: str | None = ORG_A,
    secret: str = TEST_SECRET,
    exp_delta: timedelta | None = None,
    extra: dict | None = None,
) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": sub,
        "email": email,
        "name": name,
        "role": role,
        "organizationId": organization_id,
        "iat": int(now.timestamp()),
        "exp": int((now + (exp_delta or timedelta(hours=12))).timestamp()),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, secret, algorithm="HS256")


SETTINGS = dict(
    AUTH_SECRET=TEST_SECRET,
    AUTH_COOKIE_NAME="aros_session",
    HIREOS_ENFORCE_PRISMA_USER_STATUS=False,
    HIREOS_IDENTITY_DIRECTORY="apps.accounts.directory.TrustJwtDirectory",
    ROOT_URLCONF="apps.accounts.tests.urls",
    ALLOWED_HOSTS=["127.0.0.1", "localhost", "testserver"],
)


@override_settings(**SETTINGS)
class AccountsRBACTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()

    def auth(self, token: str) -> None:
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    def test_valid_authenticated_user(self):
        token = mint()
        self.auth(token)
        res = self.client.get("/api/v1/accounts/me/")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["external_user_id"], "user_recruiter_a")
        self.assertEqual(body["email"], "recruiter-a@example.com")
        self.assertEqual(body["role"], "RECRUITER")
        self.assertEqual(body["organization_id"], ORG_A)
        self.assertNotIn("password", body)
        self.assertNotIn("passwordHash", body)

    def test_invalid_token(self):
        token = mint(secret="wrong-secret")
        self.auth(token)
        res = self.client.get("/api/v1/accounts/me/")
        self.assertEqual(res.status_code, 401)

    def test_expired_token(self):
        token = mint(exp_delta=timedelta(hours=-1))
        self.auth(token)
        res = self.client.get("/api/v1/accounts/me/")
        self.assertEqual(res.status_code, 401)

    def test_malformed_token(self):
        self.auth("not-a-jwt")
        res = self.client.get("/api/v1/accounts/me/")
        self.assertEqual(res.status_code, 401)
        self.auth("aaa.bbb")
        res = self.client.get("/api/v1/accounts/me/")
        self.assertEqual(res.status_code, 401)

    def test_admin_access(self):
        self.auth(mint(sub="u_admin", role="SUPER_ADMIN", email="admin@example.com"))
        self.assertEqual(self.client.get("/api/v1/accounts/me/").json()["role"], "ADMIN")
        self.assertEqual(self.client.get("/api/v1/accounts/probe/admin/").status_code, 200)
        self.assertEqual(self.client.get("/api/v1/accounts/probe/staff/").status_code, 200)
        self.assertEqual(self.client.get("/api/v1/accounts/probe/candidate/").status_code, 403)

    def test_hr_access(self):
        self.auth(mint(sub="u_hr", role="HR_ADMIN", email="hr@example.com"))
        self.assertEqual(self.client.get("/api/v1/accounts/me/").json()["role"], "HR")
        self.assertEqual(self.client.get("/api/v1/accounts/probe/hr/").status_code, 200)
        self.assertEqual(self.client.get("/api/v1/accounts/probe/admin/").status_code, 403)
        self.assertEqual(self.client.get("/api/v1/accounts/probe/recruiter-or-hr/").status_code, 200)

    def test_recruiter_access(self):
        self.auth(mint(role="RECRUITER"))
        self.assertEqual(self.client.get("/api/v1/accounts/probe/recruiter/").status_code, 200)
        self.assertEqual(self.client.get("/api/v1/accounts/probe/admin/").status_code, 403)
        self.assertEqual(self.client.get("/api/v1/accounts/probe/recruitment-staff/").status_code, 200)
        self.assertEqual(self.client.get("/api/v1/accounts/probe/candidate/").status_code, 403)

    def test_hiring_manager_access(self):
        self.auth(
            mint(
                sub="u_hm",
                role="HIRING_MANAGER",
                email="hm@example.com",
            )
        )
        self.assertEqual(self.client.get("/api/v1/accounts/probe/hiring-manager/").status_code, 200)
        self.assertEqual(self.client.get("/api/v1/accounts/probe/recruiter/").status_code, 403)
        self.assertEqual(self.client.get("/api/v1/accounts/probe/recruitment-staff/").status_code, 200)

    def test_interviewer_access(self):
        self.auth(
            mint(
                sub="u_int",
                role="INTERVIEWER",
                email="int@example.com",
            )
        )
        self.assertEqual(self.client.get("/api/v1/accounts/probe/interviewer/").status_code, 200)
        self.assertEqual(self.client.get("/api/v1/accounts/probe/staff/").status_code, 200)
        self.assertEqual(self.client.get("/api/v1/accounts/probe/recruitment-staff/").status_code, 403)
        self.assertEqual(self.client.get("/api/v1/accounts/probe/admin/").status_code, 403)

    def test_candidate_access(self):
        self.auth(
            mint(
                sub="u_cand",
                role="CANDIDATE",
                email="cand@example.com",
            )
        )
        self.assertEqual(self.client.get("/api/v1/accounts/me/").json()["role"], "CANDIDATE")
        self.assertEqual(self.client.get("/api/v1/accounts/probe/candidate/").status_code, 200)
        self.assertEqual(self.client.get("/api/v1/accounts/probe/staff/").status_code, 403)
        self.assertEqual(self.client.get("/api/v1/accounts/probe/admin/").status_code, 403)

    def test_organization_isolation(self):
        self.auth(mint(organization_id=ORG_A))
        res_ok = self.client.get("/api/v1/accounts/probe/org-scope/", {"organization_id": ORG_A})
        self.assertEqual(res_ok.status_code, 200)
        self.assertEqual(res_ok.json()["organization_id"], ORG_A)
        res_b = self.client.get("/api/v1/accounts/probe/org-scope/", {"organization_id": ORG_B})
        self.assertEqual(res_b.status_code, 403)

        principal_a = HireOSPrincipal(
            id="user_a",
            email="a@example.com",
            name="A",
            role=HireOSRole.RECRUITER,
            source_role="RECRUITER",
            organization_id=ORG_A,
        )
        with self.assertRaises(PermissionDenied):
            assert_same_organization(principal_a, ORG_B)
        self.assertEqual(require_organization_id(principal_a), ORG_A)

        admin = HireOSPrincipal(
            id="admin",
            email="admin@example.com",
            name="Admin",
            role=HireOSRole.ADMIN,
            source_role="SUPER_ADMIN",
            organization_id=ORG_A,
        )
        with self.assertRaises(PermissionDenied):
            require_organization_id(admin, ORG_B)

    def test_missing_organization(self):
        self.auth(mint(sub="u_noorg", organization_id=None, role="RECRUITER"))
        me = self.client.get("/api/v1/accounts/me/")
        self.assertEqual(me.status_code, 200)
        self.assertIsNone(me.json()["organization_id"])
        scoped = self.client.get("/api/v1/accounts/probe/org-scope/")
        self.assertEqual(scoped.status_code, 403)

    def test_cookie_auth_same_as_bearer(self):
        token = mint()
        self.client.cookies["aros_session"] = token
        res = self.client.get("/api/v1/accounts/me/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["email"], "recruiter-a@example.com")


@override_settings(
    **{
        **SETTINGS,
        "HIREOS_ENFORCE_PRISMA_USER_STATUS": True,
        "HIREOS_IDENTITY_DIRECTORY": "apps.accounts.tests.fakes.InactiveDirectory",
    }
)
class InactiveUserTests(SimpleTestCase):
    def test_inactive_user(self):
        client = APIClient()
        token = mint()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        res = client.get("/api/v1/accounts/me/")
        self.assertEqual(res.status_code, 401)


@override_settings(
    **{
        **SETTINGS,
        "HIREOS_ENFORCE_PRISMA_USER_STATUS": True,
        "HIREOS_IDENTITY_DIRECTORY": "apps.accounts.tests.fakes.MissingUserDirectory",
    }
)
class UnknownUserTests(SimpleTestCase):
    def test_unknown_prisma_user(self):
        client = APIClient()
        token = mint(sub="does-not-exist")
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        res = client.get("/api/v1/accounts/me/")
        self.assertEqual(res.status_code, 401)
