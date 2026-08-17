from django.core.management.base import BaseCommand
from django.db import connection

from apps.jobs.models import Job
from apps.jobs.querysets import scoped_jobs
from apps.jobs.serializers import JobSerializer
from apps.accounts.principals import HireOSPrincipal
from apps.accounts.roles import HireOSRole


class Command(BaseCommand):
    help = "Read-only Job field parity: Prisma SQL vs Django serializer (no writes)."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=5)

    def handle(self, *args, **options):
        limit = options["limit"]
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, title, status, "organizationId", "departmentId",
                       description, skills, "experienceMin", "experienceMax",
                       location, "employmentType", openings, "createdById",
                       "createdAt", "updatedAt", "salaryMin", "salaryMax",
                       "interviewStages", "screeningCriteria"
                FROM "Job"
                ORDER BY "createdAt" DESC
                LIMIT %s
                """,
                [limit],
            )
            columns = [col[0] for col in cursor.description]
            rows = [dict(zip(columns, row)) for row in cursor.fetchall()]

        mismatches = 0
        for raw in rows:
            job = (
                Job.objects.select_related("organization", "department", "created_by")
                .filter(id=raw["id"])
                .first()
            )
            if job is None:
                self.stderr.write(self.style.ERROR(f"Django miss id={raw['id']}"))
                mismatches += 1
                continue
            job.application_count = job.application_refs.count()
            data = JobSerializer(job).data
            checks = {
                "id": (data["id"], raw["id"]),
                "title": (data["title"], raw["title"]),
                "status": (data["status"], raw["status"]),
                "organizationId": (data["organizationId"], raw["organizationId"]),
                "departmentId": (data["departmentId"], raw["departmentId"]),
                "description": (data["description"], raw["description"]),
                "skills": (list(data["skills"] or []), list(raw["skills"] or [])),
                "experienceMin": (data["experienceMin"], raw["experienceMin"]),
                "experienceMax": (data["experienceMax"], raw["experienceMax"]),
                "location": (data["location"], raw["location"]),
                "employmentType": (data["employmentType"], raw["employmentType"]),
                "openings": (data["openings"], raw["openings"]),
                "createdById": (data["createdById"], raw["createdById"]),
            }
            row_ok = True
            for key, (left, right) in checks.items():
                if left != right:
                    self.stderr.write(f"  MISMATCH {raw['id']} {key}: django={left!r} prisma={right!r}")
                    row_ok = False
                    mismatches += 1
            if row_ok:
                self.stdout.write(self.style.SUCCESS(f"OK {raw['id']} {raw['title']!r} {raw['status']}"))

        if rows:
            principal = HireOSPrincipal(
                id="parity",
                email="parity@example.com",
                name="parity",
                role=HireOSRole.RECRUITER,
                source_role="RECRUITER",
                organization_id=rows[0]["organizationId"],
            )
            sql = str(scoped_jobs(principal).query)
            self.stdout.write("SCOPED_SQL " + " ".join(sql.split()))
            if '"organizationId"' not in sql and "organizationId" not in sql:
                self.stderr.write(self.style.ERROR("scoped SQL missing organizationId"))
                mismatches += 1

        if mismatches:
            raise SystemExit(1)
        self.stdout.write(self.style.SUCCESS(f"parity ok rows={len(rows)}"))
