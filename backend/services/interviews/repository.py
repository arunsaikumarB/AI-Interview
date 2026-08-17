from __future__ import annotations

from dataclasses import dataclass

from django.db import connection


@dataclass(frozen=True)
class InterviewSessionRow:
    id: str
    organization_id: str
    application_id: str
    status: str
    has_plan: bool


def get_session(session_id: str, organization_id: str) -> InterviewSessionRow | None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT s.id, j."organizationId", s."applicationId", s.status,
                   CASE WHEN s.plan IS NULL THEN 0 ELSE 1 END
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
    return InterviewSessionRow(
        id=row[0],
        organization_id=row[1],
        application_id=row[2],
        status=row[3],
        has_plan=bool(row[4]),
    )


def question_belongs(session_id: str, question_id: str, organization_id: str) -> bool:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT 1
            FROM "InterviewQuestion" q
            INNER JOIN "InterviewSession" s ON s.id = q."sessionId"
            INNER JOIN "Application" a ON a.id = s."applicationId"
            INNER JOIN "Job" j ON j.id = a."jobId"
            WHERE q.id = %s AND s.id = %s AND j."organizationId" = %s
            """,
            [question_id, session_id, organization_id],
        )
        return cursor.fetchone() is not None


def session_status(session_id: str) -> str | None:
    with connection.cursor() as cursor:
        cursor.execute('SELECT status FROM "InterviewSession" WHERE id = %s', [session_id])
        row = cursor.fetchone()
    return str(row[0]) if row else None
