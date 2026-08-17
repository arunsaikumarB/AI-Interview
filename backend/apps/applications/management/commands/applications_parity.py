from django.core.management.base import BaseCommand
from django.db import connection
from django.db.models import Count

from apps.accounts.principals import HireOSPrincipal
from apps.accounts.roles import HireOSRole
from apps.applications.models import PIPELINE_STAGES, Application
from apps.applications.querysets import scoped_application_base, scoped_applications
from apps.applications.serializers import ApplicationSerializer


class Command(BaseCommand):
    help = "Read-only Application parity vs Prisma SQL (no writes)."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=10)
        parser.add_argument("--organization-id", dest="org_id", default=None)

    def handle(self, *args, **options):
        limit = options["limit"]
        org_id = options["org_id"]
        with connection.cursor() as cursor:
            if org_id:
                cursor.execute(
                    """
                    SELECT a.id, a.stage, a.status, a.source, a."candidateId", a."jobId",
                           a."coverNote", a."createdAt", a."updatedAt"
                    FROM "Application" a
                    JOIN "Job" j ON j.id = a."jobId"
                    WHERE j."organizationId" = %s
                    ORDER BY a."updatedAt" DESC
                    LIMIT %s
                    """,
                    [org_id, limit],
                )
            else:
                cursor.execute(
                    """
                    SELECT a.id, a.stage, a.status, a.source, a."candidateId", a."jobId",
                           a."coverNote", a."createdAt", a."updatedAt"
                    FROM "Application" a
                    ORDER BY a."updatedAt" DESC
                    LIMIT %s
                    """,
                    [limit],
                )
            columns = [col[0] for col in cursor.description]
            rows = [dict(zip(columns, row)) for row in cursor.fetchall()]

        if not rows:
            self.stdout.write("no applications")
            return

        if not org_id:
            first = Application.objects.select_related("job").filter(id=rows[0]["id"]).first()
            org_id = first.job.organization_id if first else None

        mismatches = 0
        for raw in rows:
            app = (
                Application.objects.select_related("job", "candidate")
                .filter(id=raw["id"])
                .first()
            )
            if app is None:
                self.stderr.write(self.style.ERROR(f"missing {raw['id']}"))
                mismatches += 1
                continue
            data = ApplicationSerializer(app).data
            checks = {
                "id": (data["id"], raw["id"]),
                "stage": (data["stage"], raw["stage"]),
                "status": (data["status"], raw["status"]),
                "source": (data["source"], raw["source"]),
                "candidateId": (data["candidateId"], raw["candidateId"]),
                "jobId": (data["jobId"], raw["jobId"]),
                "coverNote": (data["coverNote"], raw["coverNote"]),
            }
            ok = True
            for key, (left, right) in checks.items():
                if left != right:
                    self.stderr.write(f"  MISMATCH {raw['id']} {key}")
                    ok = False
                    mismatches += 1
            if data["candidate"]["id"] != raw["candidateId"]:
                self.stderr.write(f"  candidate nest mismatch {raw['id']}")
                mismatches += 1
                ok = False
            if data["job"]["id"] != raw["jobId"]:
                self.stderr.write(f"  job nest mismatch {raw['id']}")
                mismatches += 1
                ok = False
            if "aiEvaluations" in data or "timeline" in data:
                self.stderr.write("  leaked nested AI/timeline")
                mismatches += 1
                ok = False
            if ok:
                self.stdout.write(self.style.SUCCESS(f"OK {raw['id']} {raw['stage']}"))

        principal = HireOSPrincipal(
            id="parity",
            email="parity@example.com",
            name="parity",
            role=HireOSRole.RECRUITER,
            source_role="RECRUITER",
            organization_id=org_id,
        )
        sql = str(scoped_applications(principal).query)
        self.stdout.write("SCOPED_SQL " + " ".join(sql.split())[:500] + "...")
        if "resumeText" in sql or "embedding" in sql.lower():
            self.stderr.write(self.style.ERROR("SQL selected resumeText/embedding"))
            mismatches += 1

        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT a.stage, COUNT(*)
                FROM "Application" a
                JOIN "Job" j ON j.id = a."jobId"
                WHERE j."organizationId" = %s
                GROUP BY a.stage
                """,
                [org_id],
            )
            sql_counts = {row[0]: int(row[1]) for row in cursor.fetchall()}

        dj_counts = {
            row["stage"]: row["n"]
            for row in scoped_application_base(principal)
            .values("stage")
            .annotate(n=Count("id"))
        }
        self.stdout.write("PIPELINE")
        for stage in PIPELINE_STAGES:
            s = int(sql_counts.get(stage, 0))
            d = int(dj_counts.get(stage, 0))
            mark = "OK" if s == d else "MISMATCH"
            if s != d:
                mismatches += 1
            self.stdout.write(f"  {mark} {stage} prisma={s} django={d}")

        if mismatches:
            raise SystemExit(1)
        self.stdout.write(self.style.SUCCESS(f"parity ok rows={len(rows)}"))
