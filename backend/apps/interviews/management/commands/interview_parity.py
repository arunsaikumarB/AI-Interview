"""Interview plan prompt fingerprints. Does not print resume or plan text."""

from __future__ import annotations

import json

from django.core.management.base import BaseCommand
from django.db import connection

from services.interviews.engine import fingerprint_plan


class Command(BaseCommand):
    help = "Fingerprint existing generatePlan prompts for designated sessions."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=3)

    def handle(self, *args, **options):
        limit = max(1, options["limit"])
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT s.id, j."organizationId", s.status
                FROM "InterviewSession" s
                JOIN "Application" a ON a.id = s."applicationId"
                JOIN "Job" j ON j.id = a."jobId"
                JOIN "Candidate" c ON c.id = a."candidateId"
                WHERE c.email LIKE '%%@local.dev'
                   OR c.email LIKE '%%@example.com'
                   OR c.email LIKE '%%testcase%%'
                ORDER BY s."updatedAt" DESC
                LIMIT %s
                """,
                [limit],
            )
            rows = cursor.fetchall()
        if not rows:
            self.stderr.write("No designated interview sessions found.")
            return
        failed = 0
        for session_id, org_id, status in rows:
            fp1 = fingerprint_plan(session_id, org_id)
            fp2 = fingerprint_plan(session_id, org_id)
            stable = fp1.get("prompt_sha256") == fp2.get("prompt_sha256")
            item = {
                "ok": bool(fp1.get("ok") and stable),
                "session_id": session_id,
                "status": status,
                "prompt_stable": stable,
                "prompt_sha256": fp1.get("prompt_sha256"),
                "existing_topic_count": fp1.get("existing_topic_count"),
            }
            if not item["ok"]:
                failed += 1
            self.stdout.write(json.dumps(item))
        self.stdout.write(f"checked={len(rows)} failed={failed}")
        if failed:
            raise SystemExit(1)
