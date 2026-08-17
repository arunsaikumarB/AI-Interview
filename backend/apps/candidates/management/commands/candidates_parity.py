from django.core.management.base import BaseCommand
from django.db import connection

from apps.accounts.principals import HireOSPrincipal
from apps.accounts.roles import HireOSRole
from apps.candidates.models import Candidate
from apps.candidates.querysets import scoped_candidates
from apps.candidates.serializers import CandidateSerializer


class Command(BaseCommand):
    help = "Read-only Candidate field parity: Prisma SQL vs Django serializer."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=5)

    def handle(self, *args, **options):
        limit = options["limit"]
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, email, "firstName", "lastName", phone, "linkedIn",
                       location, summary, skills, experience, education,
                       certifications, "resumeUrl", "resumeText",
                       "organizationId", "userId", "createdAt", "updatedAt"
                FROM "Candidate"
                ORDER BY "updatedAt" DESC
                LIMIT %s
                """,
                [limit],
            )
            columns = [col[0] for col in cursor.description]
            rows = [dict(zip(columns, row)) for row in cursor.fetchall()]

        mismatches = 0
        for raw in rows:
            cand = (
                Candidate.objects.select_related("organization")
                .filter(id=raw["id"])
                .first()
            )
            if cand is None:
                self.stderr.write(self.style.ERROR(f"Django miss id={raw['id']}"))
                mismatches += 1
                continue
            cand.application_count = cand.application_refs.count()
            data = CandidateSerializer(cand).data
            checks = {
                "id": (data["id"], raw["id"]),
                "email": (data["email"], raw["email"]),
                "firstName": (data["firstName"], raw["firstName"]),
                "lastName": (data["lastName"], raw["lastName"]),
                "phone": (data["phone"], raw["phone"]),
                "linkedIn": (data["linkedIn"], raw["linkedIn"]),
                "location": (data["location"], raw["location"]),
                "summary": (data["summary"], raw["summary"]),
                "skills": (list(data["skills"] or []), list(raw["skills"] or [])),
                "experience": (float(data["experience"]), float(raw["experience"])),
                "organizationId": (data["organizationId"], raw["organizationId"]),
                "userId": (data["userId"], raw["userId"]),
                "resumeUrl": (data["resumeUrl"], raw["resumeUrl"]),
                "resumeText": (data["resumeText"], raw["resumeText"]),
            }
            row_ok = True
            for key, (left, right) in checks.items():
                if left != right:
                    self.stderr.write(
                        f"  MISMATCH {raw['id']} {key}: django={left!r} prisma={right!r}"
                    )
                    row_ok = False
                    mismatches += 1
            if "embedding" in data:
                self.stderr.write(f"  embedding leaked on {raw['id']}")
                mismatches += 1
                row_ok = False
            if row_ok:
                self.stdout.write(
                    self.style.SUCCESS(
                        f"OK {raw['id']} {raw['firstName']} {raw['lastName']} {raw['email']}"
                    )
                )

        if rows:
            principal = HireOSPrincipal(
                id="parity",
                email="parity@example.com",
                name="parity",
                role=HireOSRole.RECRUITER,
                source_role="RECRUITER",
                organization_id=rows[0]["organizationId"],
            )
            sql = str(scoped_candidates(principal).query)
            self.stdout.write("SCOPED_SQL " + " ".join(sql.split()))
            if "embedding" in sql.lower():
                self.stderr.write(self.style.ERROR("SQL selects embedding"))
                mismatches += 1
            if "organizationId" not in sql:
                self.stderr.write(self.style.ERROR("scoped SQL missing organizationId"))
                mismatches += 1

        if mismatches:
            raise SystemExit(1)
        self.stdout.write(self.style.SUCCESS(f"parity ok rows={len(rows)}"))
