"""Compare Prisma SQL vs Django serializers for Phase 4A staff reads.

Does not write. Does not change expected values to force a pass.
Optional --measure times live HTTP (Django and Next.js if reachable).
"""

from __future__ import annotations

import statistics
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

import jwt
from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import connection
from django.db.models import Count

from apps.applications.models import PIPELINE_STAGES, Application
from apps.applications.serializers import ApplicationSerializer
from apps.candidates.models import Candidate
from apps.candidates.serializers import CandidateSerializer
from apps.jobs.models import Job
from apps.jobs.serializers import JobSerializer


def _pct(values: list[float], p: float) -> float | None:
    if len(values) < 2:
        return None
    k = int(round((p / 100) * (len(values) - 1)))
    return sorted(values)[k]


class Command(BaseCommand):
    help = "Phase 4A read parity: jobs, candidates, applications, pipeline counts."

    def add_arguments(self, parser):
        parser.add_argument("--jobs", type=int, default=5)
        parser.add_argument("--candidates", type=int, default=5)
        parser.add_argument("--applications", type=int, default=10)
        parser.add_argument("--measure", type=int, default=0, help="HTTP samples per endpoint")
        parser.add_argument("--django-url", default="http://127.0.0.1:8000")
        parser.add_argument("--next-url", default="http://127.0.0.1:3000")
        parser.add_argument("--email", default="recruiter@local.dev")

    def handle(self, *args, **options):
        mismatches = 0
        mismatches += self._jobs(options["jobs"])
        mismatches += self._candidates(options["candidates"])
        mismatches += self._applications(options["applications"])
        mismatches += self._pipeline_counts()

        if mismatches:
            self.stderr.write(self.style.ERROR(f"parity FAILED mismatches={mismatches}"))
            raise SystemExit(1)

        self.stdout.write(self.style.SUCCESS("parity ok: 0 ID mismatches, 0 relevant field mismatches"))
        self.stdout.write(
            "Phase 4A does NOT optimize Ollama. AI screening latency is unchanged."
        )

        if options["measure"]:
            self._measure(options)

    def _jobs(self, limit: int) -> int:
        mismatches = 0
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, title, status, "organizationId", "departmentId",
                       description, skills, "experienceMin", "experienceMax",
                       location, "employmentType", openings, "createdById"
                FROM "Job"
                ORDER BY "createdAt" DESC
                LIMIT %s
                """,
                [limit],
            )
            columns = [col[0] for col in cursor.description]
            rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
        self.stdout.write(f"JOBS n={len(rows)}")
        for raw in rows:
            job = (
                Job.objects.select_related("organization", "department", "created_by")
                .filter(id=raw["id"])
                .first()
            )
            if job is None:
                self.stderr.write(f"JOB missing {raw['id']}")
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
            mismatches += self._compare(raw["id"], checks)
        return mismatches

    def _candidates(self, limit: int) -> int:
        mismatches = 0
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, email, "firstName", "lastName", "organizationId",
                       experience, skills, "userId"
                FROM "Candidate"
                ORDER BY "updatedAt" DESC
                LIMIT %s
                """,
                [limit],
            )
            columns = [col[0] for col in cursor.description]
            rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
        self.stdout.write(f"CANDIDATES n={len(rows)}")
        for raw in rows:
            cand = Candidate.objects.filter(id=raw["id"]).first()
            if cand is None:
                self.stderr.write(f"CANDIDATE missing {raw['id']}")
                mismatches += 1
                continue
            cand.application_count = cand.application_refs.count()
            data = CandidateSerializer(cand).data
            checks = {
                "id": (data["id"], raw["id"]),
                "email": (data["email"], raw["email"]),
                "firstName": (data["firstName"], raw["firstName"]),
                "lastName": (data["lastName"], raw["lastName"]),
                "organizationId": (data["organizationId"], raw["organizationId"]),
                "experience": (float(data["experience"]), float(raw["experience"])),
                "skills": (list(data["skills"] or []), list(raw["skills"] or [])),
                "userId": (data["userId"], raw["userId"]),
            }
            mismatches += self._compare(raw["id"], checks)
        return mismatches

    def _applications(self, limit: int) -> int:
        mismatches = 0
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, stage, status, source, "candidateId", "jobId", "coverNote"
                FROM "Application"
                ORDER BY "updatedAt" DESC
                LIMIT %s
                """,
                [limit],
            )
            columns = [col[0] for col in cursor.description]
            rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
        self.stdout.write(f"APPLICATIONS n={len(rows)}")
        for raw in rows:
            app = (
                Application.objects.select_related("job", "candidate")
                .filter(id=raw["id"])
                .first()
            )
            if app is None:
                self.stderr.write(f"APPLICATION missing {raw['id']}")
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
            mismatches += self._compare(raw["id"], checks)
            if data["candidate"]["id"] != raw["candidateId"]:
                self.stderr.write(f"  MISMATCH {raw['id']} nested candidate id")
                mismatches += 1
            if data["job"]["id"] != raw["jobId"]:
                self.stderr.write(f"  MISMATCH {raw['id']} nested job id")
                mismatches += 1
        return mismatches

    def _pipeline_counts(self) -> int:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT j."organizationId"
                FROM "Application" a
                JOIN "Job" j ON j.id = a."jobId"
                LIMIT 1
                """
            )
            row = cursor.fetchone()
        if not row:
            self.stdout.write("PIPELINE_COUNTS skipped (no applications)")
            return 0
        org_id = row[0]
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT a.stage, COUNT(*)::int AS n
                FROM "Application" a
                JOIN "Job" j ON j.id = a."jobId"
                WHERE j."organizationId" = %s
                GROUP BY a.stage
                """,
                [org_id],
            )
            sql_counts = {r[0]: r[1] for r in cursor.fetchall()}
        orm = {
            r["stage"]: r["n"]
            for r in Application.objects.filter(job__organization_id=org_id)
            .values("stage")
            .annotate(n=Count("id"))
        }
        mismatches = 0
        self.stdout.write(f"PIPELINE_COUNTS org={org_id}")
        for stage in PIPELINE_STAGES:
            left = int(orm.get(stage, 0))
            right = int(sql_counts.get(stage, 0))
            self.stdout.write(f"  {stage} django={left} prisma={right}")
            if left != right:
                self.stderr.write(f"  MISMATCH pipeline {stage}: django={left} prisma={right}")
                mismatches += 1
        return mismatches

    def _compare(self, row_id: str, checks: dict) -> int:
        mismatches = 0
        for key, (left, right) in checks.items():
            if left != right:
                self.stderr.write(
                    f"  MISMATCH {row_id} {key}: django={left!r} prisma={right!r}"
                )
                mismatches += 1
        return mismatches

    def _measure(self, options: dict) -> None:
        token = self._mint_staff_token(options["email"])
        if not token:
            self.stdout.write("measure skipped: no staff user for JWT")
            return
        samples = options["measure"]
        django = options["django_url"].rstrip("/")
        nxt = options["next_url"].rstrip("/")
        pairs = [
            ("django jobs", f"{django}/api/v1/jobs/?page_size=100"),
            ("django candidates", f"{django}/api/v1/candidates/?page_size=100"),
            ("django applications", f"{django}/api/v1/applications/?page_size=100"),
            ("next jobs", f"{nxt}/api/jobs"),
            ("next candidates", f"{nxt}/api/candidates"),
            ("next applications", f"{nxt}/api/applications"),
        ]
        cookie = getattr(settings, "AUTH_COOKIE_NAME", "aros_session")
        self.stdout.write("PERFORMANCE_MS (does not include Ollama)")
        for label, url in pairs:
            times: list[float] = []
            sizes: list[int] = []
            err = None
            for _ in range(samples):
                req = urllib.request.Request(
                    url,
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Cookie": f"{cookie}={token}",
                        "Accept": "application/json",
                    },
                    method="GET",
                )
                started = time.perf_counter()
                try:
                    with urllib.request.urlopen(req, timeout=30) as resp:
                        body = resp.read()
                        times.append((time.perf_counter() - started) * 1000)
                        sizes.append(len(body))
                except urllib.error.URLError as exc:
                    err = str(exc)
                    break
            if err:
                self.stdout.write(f"  {label}: SKIPPED ({err})")
                continue
            avg = statistics.mean(times)
            p50 = _pct(times, 50)
            p95 = _pct(times, 95)
            size = int(statistics.mean(sizes)) if sizes else 0
            self.stdout.write(
                f"  {label}: avg={avg:.1f}ms p50={p50} p95={p95} bytes={size} n={len(times)}"
            )

    def _mint_staff_token(self, email: str) -> str | None:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, email, name, role, "organizationId"
                FROM "User"
                WHERE email = %s
                LIMIT 1
                """,
                [email],
            )
            row = cursor.fetchone()
        if not row:
            return None
        user_id, user_email, name, role, org_id = row
        now = datetime.now(timezone.utc)
        payload = {
            "sub": user_id,
            "email": user_email,
            "name": name or "",
            "role": role,
            "organizationId": org_id,
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(hours=12)).timestamp()),
        }
        return jwt.encode(payload, settings.AUTH_SECRET, algorithm="HS256")
