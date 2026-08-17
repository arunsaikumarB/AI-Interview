from __future__ import annotations

from dataclasses import dataclass

from django.db import connection

TERMINAL_STATUSES = frozenset({"COMPLETED", "TERMINATED", "CANCELLED", "NO_SHOW"})


@dataclass(frozen=True)
class ProctoringSessionRow:
    id: str
    organization_id: str
    application_id: str
    job_id: str
    candidate_id: str
    status: str
    started_at: object
    ended_at: object
    duration_minutes: int | None
    proctoring_enabled: bool
    proctoring_mode: str
    proctoring_consent_at: object
    secondary_recording_consent_at: object
    integrity_terminated_reason: str | None
    secondary_device_status: str
    secondary_pair_token_present: bool
    recording_id: str | None
    recording_status: str
    recording_path: str | None
    recording_mime: str | None
    last_chunk_index: int
    has_gap: bool
    interrupted_ms: int
    application_stage: str
    application_status: str


def get_session(session_id: str, organization_id: str) -> ProctoringSessionRow | None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT
              s.id, j."organizationId", s."applicationId", a."jobId", a."candidateId",
              s.status, s."startedAt", s."endedAt", s."durationMinutes",
              s."proctoringEnabled", s."proctoringMode", s."proctoringConsentAt",
              s."secondaryRecordingConsentAt", s."integrityTerminatedReason",
              s."secondaryDeviceStatus",
              CASE WHEN s."secondaryPairToken" IS NULL THEN 0 ELSE 1 END,
              s."secondaryRecordingId", s."secondaryRecordingStatus",
              s."secondaryRecordingPath", s."secondaryRecordingMime",
              s."secondaryRecordingLastChunkIndex", s."secondaryRecordingHasGap",
              s."secondaryRecordingInterruptedMs",
              a.stage, a.status
            FROM "InterviewSession" s
            INNER JOIN "Application" a ON a.id = s."applicationId"
            INNER JOIN "Job" j ON j.id = a."jobId"
            WHERE s.id = %s
            """,
            [session_id],
        )
        row = cursor.fetchone()
    if not row or row[1] != organization_id:
        return None
    return ProctoringSessionRow(
        id=row[0],
        organization_id=row[1],
        application_id=row[2],
        job_id=row[3],
        candidate_id=row[4],
        status=row[5],
        started_at=row[6],
        ended_at=row[7],
        duration_minutes=row[8],
        proctoring_enabled=bool(row[9]),
        proctoring_mode=row[10] or "OFF",
        proctoring_consent_at=row[11],
        secondary_recording_consent_at=row[12],
        integrity_terminated_reason=row[13],
        secondary_device_status=row[14] or "NONE",
        secondary_pair_token_present=bool(row[15]),
        recording_id=row[16],
        recording_status=row[17] or "NONE",
        recording_path=row[18],
        recording_mime=row[19],
        last_chunk_index=int(row[20] if row[20] is not None else -1),
        has_gap=bool(row[21]),
        interrupted_ms=int(row[22] or 0),
        application_stage=row[23],
        application_status=row[24],
    )


def list_events(session_id: str) -> list[tuple]:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, type, timestamp, meta
            FROM "ProctoringEvent"
            WHERE "sessionId" = %s
            ORDER BY timestamp ASC
            """,
            [session_id],
        )
        return list(cursor.fetchall())


def mark_recording_artifact_missing(*, session_id: str, organization_id: str) -> None:
    """DB claimed SAVED but the file is gone. Do not keep advertising it."""
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE "InterviewSession" AS s
            SET "secondaryRecordingStatus" = 'FAILED',
                "secondaryRecordingPath" = NULL,
                "updatedAt" = NOW()
            FROM "Application" a
            INNER JOIN "Job" j ON j.id = a."jobId"
            WHERE s.id = %s
              AND s."applicationId" = a.id
              AND j."organizationId" = %s
              AND s.status IN ('COMPLETED', 'TERMINATED', 'CANCELLED', 'NO_SHOW')
              AND s."secondaryRecordingStatus" = 'SAVED'
            """,
            [session_id, organization_id],
        )


def mark_recording_saved(
    *,
    session_id: str,
    organization_id: str,
    relative_path: str,
    mime: str | None,
    has_gap: bool,
) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE "InterviewSession" AS s
            SET "secondaryRecordingStatus" = 'SAVED',
                "secondaryRecordingPath" = %s,
                "secondaryRecordingMime" = COALESCE(s."secondaryRecordingMime", %s),
                "secondaryRecordingEndedAt" = COALESCE(s."secondaryRecordingEndedAt", NOW()),
                "secondaryRecordingHasGap" = s."secondaryRecordingHasGap" OR %s,
                "updatedAt" = NOW()
            FROM "Application" a
            INNER JOIN "Job" j ON j.id = a."jobId"
            WHERE s.id = %s
              AND s."applicationId" = a.id
              AND j."organizationId" = %s
              AND s.status IN ('COMPLETED', 'TERMINATED', 'CANCELLED', 'NO_SHOW')
            """,
            [relative_path, mime, has_gap, session_id, organization_id],
        )


def clear_pair_token(*, session_id: str, organization_id: str) -> bool:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE "InterviewSession" AS s
            SET "secondaryPairToken" = NULL,
                "secondaryPairExpiresAt" = NULL,
                "updatedAt" = NOW()
            FROM "Application" a
            INNER JOIN "Job" j ON j.id = a."jobId"
            WHERE s.id = %s
              AND s."applicationId" = a.id
              AND j."organizationId" = %s
              AND s.status IN ('COMPLETED', 'TERMINATED', 'CANCELLED', 'NO_SHOW')
            """,
            [session_id, organization_id],
        )
        return cursor.rowcount > 0


def application_pipeline(session_id: str) -> tuple[str, str] | None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT a.stage, a.status
            FROM "InterviewSession" s
            INNER JOIN "Application" a ON a.id = s."applicationId"
            WHERE s.id = %s
            """,
            [session_id],
        )
        row = cursor.fetchone()
    if not row:
        return None
    return str(row[0]), str(row[1])
