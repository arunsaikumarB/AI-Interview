"""Live DB parity for stage writes. Designated test applications only. No AI. No Celery."""

from __future__ import annotations

import time

from django.core.management.base import BaseCommand
from django.db import connection
from rest_framework.exceptions import NotFound, ValidationError

from apps.applications.models import Application, TimelineEvent
from apps.applications.stage_write import apply_stage, compute_status


class Command(BaseCommand):
    help = (
        "Phase 4C.1: Django stage write on a TEST application (email contains needle), "
        "compare Next semantics, restore stage/status and delete parity timeline rows."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--email-substr",
            default="testcase",
            help="Only touch applications whose candidate email contains this (default: testcase)",
        )
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        needle = options["email_substr"]
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT a.id, a.stage, a.status, a."updatedAt",
                       j."organizationId", c.email
                FROM "Application" a
                JOIN "Job" j ON j.id = a."jobId"
                JOIN "Candidate" c ON c.id = a."candidateId"
                WHERE c.email ILIKE %s
                ORDER BY a."updatedAt" DESC
                LIMIT 1
                """,
                [f"%{needle}%"],
            )
            row = cursor.fetchone()
        if not row:
            self.stderr.write("no designated test application found")
            raise SystemExit(1)
        app_id, stage, status, updated_at, org_id, email = row
        self.stdout.write(
            f"TEST_APP id={app_id} email={email} stage={stage} status={status}"
        )
        if options["dry_run"]:
            return

        original_event_ids = set(
            TimelineEvent.objects.filter(application_id=app_id).values_list("id", flat=True)
        )
        mismatches = 0

        def fail(msg: str) -> None:
            nonlocal mismatches
            self.stderr.write(msg)
            mismatches += 1

        try:
            target = "SCREENING" if stage != "SCREENING" else "APPLIED"
            expected_status = compute_status(target, status)
            t0 = time.perf_counter()
            result = apply_stage(
                application_id=app_id,
                organization_id=org_id,
                to_stage=target,
                note="Phase 4C.1 parity move",
                actor_id="parity",
                actor_name="parity",
            )
            django_ms = (time.perf_counter() - t0) * 1000
            self.stdout.write(f"django_stage_write_ms={django_ms:.1f}")

            app = Application.objects.get(id=app_id)
            if app.stage != target:
                fail(f"stage mismatch {app.stage} != {target}")
            if app.status != expected_status:
                fail(f"status mismatch {app.status} != {expected_status}")
            new_events = TimelineEvent.objects.filter(application_id=app_id).exclude(
                id__in=original_event_ids
            )
            if new_events.count() != 1:
                fail(f"expected 1 new timeline, got {new_events.count()}")
            latest = new_events.filter(type="STAGE_CHANGED").first()
            if latest is None or latest.payload.get("to") != target:
                fail("timeline payload mismatch")
            if latest and latest.payload.get("humanDecision") is not True:
                fail("humanDecision missing")
            if latest and latest.payload.get("from") != stage:
                fail("timeline from mismatch")

            again = apply_stage(
                application_id=app_id,
                organization_id=org_id,
                to_stage=target,
                note="Phase 4C.1 parity move",
                actor_id="parity",
                actor_name="parity",
            )
            after_again = TimelineEvent.objects.filter(application_id=app_id).exclude(
                id__in=original_event_ids
            ).count()
            if after_again != 1:
                fail("duplicate timeline on same-stage replay")
            if not again.get("unchanged"):
                fail("same-stage should be unchanged")

            try:
                apply_stage(
                    application_id=app_id,
                    organization_id=org_id,
                    to_stage="REJECTED",
                    note="x",
                    actor_id="parity",
                    actor_name="parity",
                )
                fail("short reject note should fail")
            except ValidationError:
                pass

            reject = apply_stage(
                application_id=app_id,
                organization_id=org_id,
                to_stage="REJECTED",
                note="Human reject rationale for parity",
                actor_id="parity",
                actor_name="parity",
            )
            rejected = Application.objects.get(id=app_id)
            if rejected.stage != "REJECTED" or rejected.status != "REJECTED":
                fail("REJECTED mapping failed")
            if reject.get("unchanged"):
                fail("REJECTED should write")

            selected = apply_stage(
                application_id=app_id,
                organization_id=org_id,
                to_stage="SELECTED",
                note="Human select rationale for parity",
                actor_id="parity",
                actor_name="parity",
            )
            hired = Application.objects.get(id=app_id)
            if hired.stage != "SELECTED" or hired.status != "HIRED":
                fail("SELECTED mapping failed")
            if selected.get("unchanged"):
                fail("SELECTED should write")

            try:
                apply_stage(
                    application_id=app_id,
                    organization_id="org_does_not_exist",
                    to_stage="SHORTLISTED",
                    note="should 404",
                    actor_id="parity",
                    actor_name="parity",
                )
                fail("cross-org should 404")
            except NotFound:
                pass

            try:
                apply_stage(
                    application_id="missing-application-id",
                    organization_id=org_id,
                    to_stage="SCREENING",
                    note="missing",
                    actor_id="parity",
                    actor_name="parity",
                )
                fail("missing application should 404")
            except NotFound:
                pass

            self.stdout.write(f"result_keys={sorted(result['application'].keys())}")
            if django_ms >= 1000:
                self.stderr.write("warning: Django stage write was not sub-second")
        finally:
            extra = TimelineEvent.objects.filter(application_id=app_id).exclude(
                id__in=original_event_ids
            )
            extra_n = extra.count()
            extra.delete()
            Application.objects.filter(id=app_id).update(
                stage=stage,
                status=status,
                updated_at=updated_at,
            )
            restored = Application.objects.get(id=app_id)
            if restored.stage != stage or restored.status != status:
                fail("restore failed")
            leftover = TimelineEvent.objects.filter(application_id=app_id).exclude(
                id__in=original_event_ids
            ).count()
            if leftover:
                fail(f"leftover timeline rows {leftover}")
            self.stdout.write(f"parity_timeline_rows_removed={extra_n}")

        if mismatches:
            raise SystemExit(1)
        self.stdout.write(self.style.SUCCESS("stage_write_parity ok"))
