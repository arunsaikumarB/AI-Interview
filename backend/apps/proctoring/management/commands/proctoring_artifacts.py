from django.core.management.base import BaseCommand
from django.db import connection

from services.proctoring.paths import storage_root, stored_file_ok


class Command(BaseCommand):
    help = "Audit SAVED secondary recordings against files on STORAGE_ROOT. Does not print paths to clients."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=20)
        parser.add_argument(
            "--fix",
            action="store_true",
            help="Set FAILED and clear path when SAVED but the file is missing.",
        )

    def handle(self, *args, **options):
        limit = max(1, options["limit"])
        fix = bool(options["fix"])
        self.stdout.write(f"storage_root={storage_root()}")
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT s.id, s.status, s."secondaryRecordingStatus",
                       s."secondaryRecordingPath", s."secondaryRecordingId",
                       j."organizationId"
                FROM "InterviewSession" s
                JOIN "Application" a ON a.id = s."applicationId"
                JOIN "Job" j ON j.id = a."jobId"
                WHERE s."secondaryRecordingStatus" = 'SAVED'
                ORDER BY s."updatedAt" DESC
                LIMIT %s
                """,
                [limit],
            )
            rows = cursor.fetchall()
        missing = 0
        ok = 0
        for session_id, status, rec_status, rec_path, rec_id, org_id in rows:
            present = stored_file_ok(rec_path)
            if present:
                ok += 1
                self.stdout.write(f"ok session={session_id} interview={status}")
                continue
            missing += 1
            self.stdout.write(
                f"MISSING_ARTIFACT session={session_id} interview={status} has_recording_id={bool(rec_id)}"
            )
            if fix:
                from services.proctoring.repository import mark_recording_artifact_missing

                mark_recording_artifact_missing(session_id=session_id, organization_id=org_id)
                self.stdout.write(f"fixed_to_FAILED session={session_id}")
        self.stdout.write(f"checked={len(rows)} ok={ok} missing={missing}")
        if missing:
            raise SystemExit(1)
