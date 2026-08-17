"""Phase 4C.3 admin writes — SimpleTestCase."""

from __future__ import annotations

from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.test import APIClient

from apps.accounts.admin_write import extra_keys, USER_WRITE_KEYS
from apps.accounts.tests.test_rbac import SETTINGS, mint

APP_SETTINGS = {**SETTINGS, "ROOT_URLCONF": "config.urls"}


@override_settings(**APP_SETTINGS)
class AdminWriteRBACTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()

    def auth(self, **kwargs):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {mint(**kwargs)}")

    def test_missing_invalid_expired_401(self):
        self.assertEqual(self.client.post("/api/v1/admin/users/").status_code, 401)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {mint(secret='wrong')}")
        self.assertEqual(self.client.patch("/api/v1/admin/org/", {}, format="json").status_code, 401)
        self.client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {mint(exp_delta=timedelta(hours=-1))}"
        )
        self.assertEqual(self.client.post("/api/v1/admin/departments/").status_code, 401)

    def test_non_admin_403(self):
        for role in ("RECRUITER", "HIRING_MANAGER", "INTERVIEWER", "CANDIDATE"):
            self.auth(role=role, sub=f"u_{role}", email=f"{role}@ex.com")
            self.assertEqual(
                self.client.post(
                    "/api/v1/admin/users/",
                    {"name": "A", "email": "a@ex.com", "role": "RECRUITER"},
                    format="json",
                ).status_code,
                403,
                role,
            )

    def test_hr_can_create_not_super_admin(self):
        self.auth(role="HR_ADMIN", sub="hr1", email="hr@ex.com")
        with patch(
            "apps.accounts.admin_views.create_staff_user",
            side_effect=PermissionDenied("Only Super Admin can create Super Admin users"),
        ):
            res = self.client.post(
                "/api/v1/admin/users/",
                {"name": "Boss", "email": "boss@ex.com", "role": "SUPER_ADMIN"},
                format="json",
            )
        self.assertEqual(res.status_code, 403)

    def test_hr_cannot_change_role(self):
        self.auth(role="HR_ADMIN", sub="hr1", email="hr@ex.com")
        with patch(
            "apps.accounts.admin_views.update_staff_user",
            side_effect=PermissionDenied("Only Super Admin can change roles"),
        ):
            res = self.client.patch(
                "/api/v1/admin/users/u1/",
                {"role": "RECRUITER"},
                format="json",
            )
        self.assertEqual(res.status_code, 403)

    def test_create_ok_no_password_hash(self):
        self.auth(role="HR_ADMIN", sub="hr1", email="hr@ex.com")
        fake = {
            "user": {
                "id": "u1",
                "name": "Pat",
                "email": "pat@example.com",
                "role": "RECRUITER",
                "isActive": True,
                "departmentId": None,
                "department": None,
            },
            "temporaryPassword": "tmpPass12ab",
        }
        with patch("apps.accounts.admin_views.create_staff_user", return_value=fake):
            res = self.client.post(
                "/api/v1/admin/users/",
                {"name": "Pat", "email": "pat@example.com", "role": "RECRUITER"},
                format="json",
            )
        self.assertEqual(res.status_code, 201)
        body = res.json()
        self.assertIn("temporaryPassword", body)
        self.assertNotIn("passwordHash", body)
        self.assertNotIn("passwordHash", body["user"])

    def test_extra_org_id_rejected(self):
        self.auth(role="HR_ADMIN")
        res = self.client.post(
            "/api/v1/admin/users/",
            {
                "name": "Pat",
                "email": "pat@example.com",
                "role": "RECRUITER",
                "organizationId": "other",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 400)

    def test_user_404(self):
        self.auth(role="HR_ADMIN")
        with patch(
            "apps.accounts.admin_views.update_staff_user",
            side_effect=NotFound("User not found"),
        ):
            res = self.client.patch(
                "/api/v1/admin/users/missing/",
                {"isActive": False},
                format="json",
            )
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.json().get("error"), "User not found")

    def test_duplicate_email_409(self):
        self.auth(role="HR_ADMIN")
        with patch(
            "apps.accounts.admin_views.create_staff_user",
            side_effect=ValidationError("Email already in use"),
        ):
            res = self.client.post(
                "/api/v1/admin/users/",
                {"name": "Pat", "email": "pat@example.com", "role": "RECRUITER"},
                format="json",
            )
        self.assertEqual(res.status_code, 409)

    def test_module_no_ai_no_password_log(self):
        from apps.accounts import admin_write

        text = Path(admin_write.__file__).read_text(encoding="utf-8")
        self.assertNotIn("ollama", text.lower())
        self.assertNotIn("from celery", text)
        self.assertNotIn("print(temp", text)
        self.assertNotIn("logger", text)

    def test_whitelist(self):
        self.assertTrue(extra_keys({"organizationId": "x"}, USER_WRITE_KEYS))
        self.assertFalse(extra_keys({"name": "a", "email": "b", "role": "RECRUITER"}, USER_WRITE_KEYS))
