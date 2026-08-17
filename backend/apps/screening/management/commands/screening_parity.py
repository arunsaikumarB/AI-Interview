"""Compare screening contract on designated test applications. Does not print resume/reasoning."""

from __future__ import annotations

import json
import time

from django.core.management.base import BaseCommand
from django.db import connection

from services.screening.engine import fingerprint_prompt, run_existing_screen_engine
from services.screening.repository import application_stage_status, latest_resume_screen

ALLOWED_RECS = {"YES", "MAYBE", "NO"}


class Command(BaseCommand):
    help = "Screening parity fingerprints (+ optional live engine run). No PII in output."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=3)
        parser.add_argument(
            "--execute",
            action="store_true",
            help="Call the existing Node screenApplication engine (creates a new AIEvaluation).",
        )

    def handle(self, *args, **options):
        limit = max(1, options["limit"])
        rows = self._pick_applications(limit)
        if len(rows) < 1:
            self.stderr.write("No designated test applications with resume text.")
            return
        results = []
        for row in rows:
            item = self._one(row, execute=options["execute"])
            results.append(item)
            self.stdout.write(json.dumps(item, default=str))
        failed = [r for r in results if not r.get("ok")]
        self.stdout.write(f"checked={len(results)} failed={len(failed)}")
        if failed:
            raise SystemExit(1)

    def _pick_applications(self, limit: int) -> list[tuple]:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT a.id, a."jobId", a."candidateId", c.email, j."organizationId",
                       a.stage, a.status
                FROM "Application" a
                JOIN "Candidate" c ON c.id = a."candidateId"
                JOIN "Job" j ON j.id = a."jobId"
                WHERE char_length(COALESCE(c."resumeText", '')) > 0
                  AND char_length(COALESCE(j.description, '')) > 0
                  AND (
                    c.email LIKE '%%@local.dev'
                    OR c.email LIKE '%%@example.com'
                    OR c.email LIKE '%%testcase%%'
                    OR c.email LIKE 'phase9-%%'
                  )
                ORDER BY a."updatedAt" DESC
                LIMIT %s
                """,
                [limit],
            )
            return cursor.fetchall()

    def _one(self, row: tuple, *, execute: bool) -> dict:
        app_id, job_id, cand_id, email, org_id, stage, status = row
        existing = latest_resume_screen(app_id)
        fp1 = fingerprint_prompt(app_id, org_id)
        fp2 = fingerprint_prompt(app_id, org_id)
        prompt_stable = fp1.get("prompt_sha256") == fp2.get("prompt_sha256")
        out = {
            "ok": bool(fp1.get("ok") and prompt_stable),
            "application_id": app_id,
            "job_id": job_id,
            "candidate_id": cand_id,
            "email_kind": "test" if "local.dev" in email or "example.com" in email or "testcase" in email or email.startswith("phase9-") else "other",
            "prompt_stable": prompt_stable,
            "prompt_sha256": fp1.get("prompt_sha256"),
            "existing_kind": existing.get("kind") if existing else None,
            "existing_recommendation": existing.get("recommendation") if existing else None,
            "existing_overall": existing.get("overall") if existing else None,
            "existing_model": existing.get("model") if existing else None,
            "stage": stage,
            "status": status,
        }
        if not prompt_stable:
            out["error_class"] = "prompt_fingerprint_unstable"
            return out
        if not execute:
            return out

        before = application_stage_status(app_id)
        t0 = time.perf_counter()
        payload = run_existing_screen_engine(app_id, org_id)
        elapsed_ms = (time.perf_counter() - t0) * 1000
        after = application_stage_status(app_id)
        rec = payload.get("recommendation")
        kind_ok = payload.get("kind") == "RESUME_SCREEN"
        rec_ok = rec in ALLOWED_RECS
        overall = payload.get("overall")
        overall_ok = isinstance(overall, (int, float)) and 0 <= float(overall) <= 100
        pipeline_ok = before == after
        score_delta = None
        rec_match = None
        if existing and existing.get("overall") is not None and overall is not None:
            score_delta = float(overall) - float(existing["overall"])
            rec_match = rec == existing.get("recommendation")
        out.update(
            {
                "new_kind": payload.get("kind"),
                "new_recommendation": rec,
                "new_overall": overall,
                "new_model": payload.get("model"),
                "new_evaluation_id": payload.get("evaluation_id"),
                "score_difference": score_delta,
                "recommendation_difference": (
                    None
                    if rec_match is None
                    else (None if rec_match else f"{existing.get('recommendation')}->{rec}")
                ),
                "engine_ms": round(elapsed_ms, 1),
                "pipeline_unchanged": pipeline_ok,
                "ok": kind_ok and rec_ok and overall_ok and pipeline_ok and bool(payload.get("model")),
            }
        )
        if not out["ok"]:
            out["error_class"] = "parity_contract_failed"
        return out
