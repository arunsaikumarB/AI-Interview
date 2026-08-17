"""Read existing Prisma Application/Job/Candidate for screening. No stage writes."""

from __future__ import annotations

from dataclasses import dataclass

from django.db import connection


@dataclass(frozen=True)
class ScreeningApplicationRow:
    application_id: str
    organization_id: str
    candidate_id: str
    job_id: str
    stage: str
    status: str
    resume_chars: int
    description_chars: int


def get_application(application_id: str, organization_id: str) -> ScreeningApplicationRow | None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT a.id, j."organizationId", a."candidateId", a."jobId",
                   a.stage, a.status,
                   COALESCE(char_length(c."resumeText"), 0),
                   COALESCE(char_length(j.description), 0),
                   c."organizationId"
            FROM "Application" a
            INNER JOIN "Job" j ON j.id = a."jobId"
            INNER JOIN "Candidate" c ON c.id = a."candidateId"
            WHERE a.id = %s
            """,
            [application_id],
        )
        row = cursor.fetchone()
    if not row:
        return None
    job_org, cand_org = row[1], row[8]
    if job_org != organization_id or cand_org != organization_id:
        return None
    return ScreeningApplicationRow(
        application_id=row[0],
        organization_id=job_org,
        candidate_id=row[2],
        job_id=row[3],
        stage=row[4],
        status=row[5],
        resume_chars=int(row[6] or 0),
        description_chars=int(row[7] or 0),
    )


def application_stage_status(application_id: str) -> tuple[str, str] | None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT stage, status FROM "Application" WHERE id = %s
            """,
            [application_id],
        )
        row = cursor.fetchone()
    if not row:
        return None
    return str(row[0]), str(row[1])


def latest_resume_screen(application_id: str) -> dict | None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, kind, recommendation, model, scores, "createdAt"
            FROM "AIEvaluation"
            WHERE "applicationId" = %s AND kind = 'RESUME_SCREEN'
            ORDER BY "createdAt" DESC
            LIMIT 1
            """,
            [application_id],
        )
        row = cursor.fetchone()
    if not row:
        return None
    scores = row[4]
    overall = None
    if isinstance(scores, dict):
        overall = scores.get("overall")
    return {
        "id": row[0],
        "kind": row[1],
        "recommendation": row[2],
        "model": row[3],
        "overall": overall,
        "created_at": row[5],
    }
