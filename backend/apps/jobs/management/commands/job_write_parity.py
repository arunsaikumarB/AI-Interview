"""Live Job write parity on TEST jobs only. Creates then deletes a 4C.2 TESTCASE job."""

from __future__ import annotations

import time

from django.core.management.base import BaseCommand
from django.db import connection

from apps.jobs.job_write import create_job, delete_job, update_job
from apps.jobs.models import Job


class Command(BaseCommand):
    help = "Phase 4C.2: create/edit/status/delete a TEST job; restore by deleting it."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT j."organizationId", j."createdById"
                FROM "Job" j
                JOIN "Application" a ON a."jobId" = j.id
                JOIN "Candidate" c ON c.id = a."candidateId"
                WHERE c.email ILIKE %s
                LIMIT 1
                """,
                ["%testcase%"],
            )
            row = cursor.fetchone()
        if not row:
            self.stderr.write("no testcase org found")
            raise SystemExit(1)
        org_id, creator_id = row
        self.stdout.write(f"org={org_id} createdBy={creator_id}")
        if options["dry_run"]:
            return

        before_jobs = Job.objects.filter(organization_id=org_id).count()
        mismatches = 0

        def fail(msg: str) -> None:
            nonlocal mismatches
            self.stderr.write(msg)
            mismatches += 1

        samples_create: list[float] = []
        samples_edit: list[float] = []
        job = None
        try:
            body = {
                "title": "4C.2 TESTCASE write parity",
                "description": "Parity description for job writes.",
                "skills": ["Python", "Django"],
                "experienceMin": 1,
                "experienceMax": 3,
                "status": "DRAFT",
                "screeningCriteria": {"mustHave": ["SQL"], "niceToHave": ["Redis"]},
                "location": "Remote",
            }
            t0 = time.perf_counter()
            job = create_job(organization_id=org_id, created_by_id=creator_id, body=body)
            samples_create.append((time.perf_counter() - t0) * 1000)
            loaded = Job.objects.get(id=job.id)
            if loaded.title != body["title"] or loaded.status != "DRAFT":
                fail("create field mismatch")
            if loaded.organization_id != org_id or loaded.created_by_id != creator_id:
                fail("org/createdBy mismatch")
            if loaded.screening_criteria != body["screeningCriteria"]:
                fail("screeningCriteria mismatch")
            if list(loaded.skills) != body["skills"]:
                fail("skills mismatch")

            t0 = time.perf_counter()
            update_job(
                job_id=job.id,
                organization_id=org_id,
                body={"title": "4C.2 TESTCASE write parity edited", "description": body["description"]},
            )
            samples_edit.append((time.perf_counter() - t0) * 1000)
            loaded.refresh_from_db()
            if loaded.title != "4C.2 TESTCASE write parity edited":
                fail("edit title mismatch")

            for _ in range(6):
                t0 = time.perf_counter()
                update_job(job_id=job.id, organization_id=org_id, body={"status": "OPEN"})
                samples_edit.append((time.perf_counter() - t0) * 1000)
            loaded.refresh_from_db()
            if loaded.status != "OPEN":
                fail("status mismatch")

            try:
                update_job(
                    job_id=job.id,
                    organization_id="org_does_not_exist",
                    body={"title": "nope"},
                )
                fail("cross-org should 404")
            except Exception:
                pass

            other_jobs = Job.objects.filter(organization_id=org_id).exclude(id=job.id).count()
            if other_jobs != before_jobs:
                fail("unrelated jobs changed during create/edit")

            t0 = time.perf_counter()
            delete_job(job_id=job.id, organization_id=org_id)
            delete_ms = (time.perf_counter() - t0) * 1000
            if Job.objects.filter(id=job.id).exists():
                fail("delete failed")
            job = None
            after = Job.objects.filter(organization_id=org_id).count()
            if after != before_jobs:
                fail(f"job count {after} != {before_jobs}")

            def pct(xs: list[float], p: float) -> float:
                if not xs:
                    return 0
                xs = sorted(xs)
                k = int(round((p / 100) * (len(xs) - 1)))
                return xs[k]

            self.stdout.write(
                f"create_ms={samples_create[0]:.1f} "
                f"edit_n={len(samples_edit)} edit_p50={pct(samples_edit,50):.1f} "
                f"edit_p95={pct(samples_edit,95):.1f} delete_ms={delete_ms:.1f}"
            )
        except Exception:
            if job is not None:
                Job.objects.filter(id=job.id).delete()
            raise

        if mismatches:
            raise SystemExit(1)
        self.stdout.write(self.style.SUCCESS("job_write_parity ok"))
