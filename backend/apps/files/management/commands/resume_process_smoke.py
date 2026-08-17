from django.core.management.base import BaseCommand
from django.db import connection

from services.resume.enqueue import enqueue_resume_process
from services.resume.files import assert_processable_file, resolve_resume_file
from services.resume.repository import embedding_dims, get_candidate


class Command(BaseCommand):
    help = (
        "Enqueue Celery resume processing for a designated local seed candidate. "
        "Does not print resume text."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--email",
            default="candidate@local.dev",
            help="Designated test candidate email (default: candidate@local.dev).",
        )
        parser.add_argument("--candidate-id", default="")
        parser.add_argument("--wait", action="store_true", help="Wait for Celery result.")

    def handle(self, *args, **options):
        email = options["email"]
        candidate_id = options["candidate_id"]
        with connection.cursor() as cursor:
            if candidate_id:
                cursor.execute(
                    """
                    SELECT id, "organizationId", email, "resumeUrl",
                           char_length("resumeText")
                    FROM "Candidate" WHERE id = %s
                    """,
                    [candidate_id],
                )
            else:
                cursor.execute(
                    """
                    SELECT id, "organizationId", email, "resumeUrl",
                           char_length("resumeText")
                    FROM "Candidate" WHERE email = %s
                    LIMIT 1
                    """,
                    [email],
                )
            row = cursor.fetchone()
        if not row:
            self.stderr.write("No designated test candidate found.")
            return
        cid, org_id, found_email, resume_url, text_len = row
        self.stdout.write(
            f"candidate_id={cid} email={found_email} resume_url_set={bool(resume_url)} "
            f"resume_text_chars={text_len or 0}"
        )
        if resume_url:
            path = resolve_resume_file(resume_url)
            try:
                assert_processable_file(path)
                self.stdout.write(f"file_exists=true extension={path.suffix}")
            except Exception as exc:  # noqa: BLE001
                self.stderr.write(f"stored_file_unusable error_class={getattr(exc, 'error_class', type(exc).__name__)}")
                return
        else:
            self.stderr.write("Candidate has no resumeUrl; not inventing an upload in this command.")
            return

        import time

        started = time.perf_counter()
        queued = enqueue_resume_process(candidate_id=cid, organization_id=org_id)
        elapsed_ms = (time.perf_counter() - started) * 1000
        self.stdout.write(
            f"enqueue_status={queued['status']} task_id={queued['task_id']} "
            f"enqueue_ms={elapsed_ms:.1f}"
        )
        if elapsed_ms > 2000:
            self.stderr.write("WARNING: enqueue took more than 2s (should return without embedding).")

        if not options["wait"]:
            self.stdout.write("Pass --wait to block on the Celery result.")
            return

        from celery.result import AsyncResult

        result = AsyncResult(queued["task_id"])
        payload = result.get(timeout=300)
        self.stdout.write(f"celery_ready={result.ready()} payload_ok={payload.get('ok')}")
        if payload.get("error_class"):
            self.stdout.write(f"error_class={payload['error_class']}")
        dims = embedding_dims(cid, org_id)
        self.stdout.write(f"db_embedding_dims={dims}")
        row = get_candidate(cid, org_id)
        self.stdout.write(f"candidate_still_org={row.organization_id if row else None}")
