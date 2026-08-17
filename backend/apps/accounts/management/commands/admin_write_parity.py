"""Live admin write parity on TEST users/departments only. Restores org name."""

from __future__ import annotations

import time

import bcrypt
from django.core.management.base import BaseCommand
from django.db import connection

from apps.accounts.admin_write import (
    create_department,
    create_staff_user,
    delete_department,
    rename_department,
    update_organization,
    update_staff_user,
)
from apps.accounts.models import HireOSUser, Organization
from apps.jobs.models import Department


class Command(BaseCommand):
    help = "Phase 4C.3 parity on TESTCASE user/dept; restores organization name."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT u.id, u."organizationId", u.role
                FROM "User" u
                WHERE u.email = %s
                """,
                ["hr@local.dev"],
            )
            row = cursor.fetchone()
        if not row:
            self.stderr.write("hr@local.dev not found")
            raise SystemExit(1)
        actor_id, org_id, actor_role = row
        self.stdout.write(f"org={org_id} actor={actor_id}")
        if options["dry_run"]:
            return

        mismatches = 0

        def fail(msg: str) -> None:
            nonlocal mismatches
            self.stderr.write(msg)
            mismatches += 1

        org = Organization.objects.get(id=org_id)
        original_name = org.name
        original_company = org.company_name
        created_user_id = None
        created_dept_id = None
        samples: list[float] = []
        try:
            t0 = time.perf_counter()
            created = create_staff_user(
                organization_id=org_id,
                actor_source_role="HR_ADMIN",
                body={
                    "name": "4C.3 TESTCASE user",
                    "email": "4c3.testcase.admin@example.com",
                    "role": "INTERVIEWER",
                },
            )
            samples.append((time.perf_counter() - t0) * 1000)
            created_user_id = created["user"]["id"]
            if "passwordHash" in created["user"]:
                fail("passwordHash leaked")
            temp = created["temporaryPassword"]
            if not temp or len(temp) < 8:
                fail("temp password missing")
            with connection.cursor() as cursor:
                cursor.execute(
                    'SELECT "passwordHash", "isActive" FROM "User" WHERE id = %s',
                    [created_user_id],
                )
                hashed, active = cursor.fetchone()
            if not bcrypt.checkpw(temp.encode("utf-8"), hashed.encode("utf-8")):
                fail("bcrypt verify failed")
            if hashed.lower().find("password") != -1:
                fail("hash looks like plaintext")
            if not active:
                fail("new user should be active")

            t0 = time.perf_counter()
            updated = update_staff_user(
                user_id=created_user_id,
                organization_id=org_id,
                actor_id=actor_id,
                actor_source_role="HR_ADMIN",
                body={"name": "4C.3 TESTCASE user edited", "isActive": False},
            )
            samples.append((time.perf_counter() - t0) * 1000)
            if updated["user"]["name"] != "4C.3 TESTCASE user edited":
                fail("name edit failed")
            if updated["user"]["isActive"] is not False:
                fail("deactivate failed")

            try:
                update_staff_user(
                    user_id=created_user_id,
                    organization_id=org_id,
                    actor_id=actor_id,
                    actor_source_role="HR_ADMIN",
                    body={"role": "RECRUITER"},
                )
                fail("HR should not change roles")
            except Exception:
                pass

            t0 = time.perf_counter()
            update_staff_user(
                user_id=created_user_id,
                organization_id=org_id,
                actor_id=actor_id,
                actor_source_role="SUPER_ADMIN",
                body={"role": "RECRUITER", "isActive": True},
            )
            samples.append((time.perf_counter() - t0) * 1000)
            u = HireOSUser.objects.get(id=created_user_id)
            if u.role != "RECRUITER" or not u.is_active:
                fail("super role/activate failed")

            try:
                update_staff_user(
                    user_id=created_user_id,
                    organization_id="org_does_not_exist",
                    actor_id=actor_id,
                    actor_source_role="HR_ADMIN",
                    body={"name": "nope"},
                )
                fail("cross-org should 404")
            except Exception:
                pass

            t0 = time.perf_counter()
            dept = create_department(organization_id=org_id, name="4C.3 TESTCASE Dept")
            samples.append((time.perf_counter() - t0) * 1000)
            created_dept_id = dept["id"]
            renamed = rename_department(
                department_id=created_dept_id,
                organization_id=org_id,
                name="4C.3 TESTCASE Dept 2",
            )
            if renamed["name"] != "4C.3 TESTCASE Dept 2":
                fail("dept rename failed")
            delete_department(department_id=created_dept_id, organization_id=org_id)
            created_dept_id = None
            if Department.objects.filter(id=dept["id"]).exists():
                fail("dept delete failed")

            t0 = time.perf_counter()
            update_organization(
                organization_id=org_id,
                body={"name": original_name, "companyName": original_company},
            )
            samples.append((time.perf_counter() - t0) * 1000)

            xs = sorted(samples)
            p50 = xs[len(xs) // 2]
            p95 = xs[int(round(0.95 * (len(xs) - 1)))]
            self.stdout.write(
                f"samples={len(xs)} p50_ms={p50:.1f} p95_ms={p95:.1f} times={['%.1f' % t for t in xs]}"
            )
        finally:
            update_organization(
                organization_id=org_id,
                body={"name": original_name, "companyName": original_company},
            )
            if created_dept_id:
                Department.objects.filter(id=created_dept_id).delete()
            if created_user_id:
                with connection.cursor() as cursor:
                    cursor.execute('DELETE FROM "User" WHERE id = %s', [created_user_id])
            leftover = HireOSUser.objects.filter(
                email="4c3.testcase.admin@example.com"
            ).exists()
            if leftover:
                fail("test user leftover")

        if mismatches:
            raise SystemExit(1)
        self.stdout.write(self.style.SUCCESS("admin_write_parity ok"))
