"""Read/write existing Prisma Candidate rows. No Django migrations. No ORM vector field."""

from __future__ import annotations

from dataclasses import dataclass

from django.db import connection

from apps.candidates.models import Candidate
from services.resume.errors import PermanentResumeError


@dataclass(frozen=True)
class CandidateResumeRow:
    id: str
    organization_id: str
    resume_url: str | None
    summary: str | None
    skills: list[str]
    experience: float


def get_candidate(candidate_id: str, organization_id: str) -> CandidateResumeRow | None:
    row = (
        Candidate.objects.filter(id=candidate_id, organization_id=organization_id)
        .values("id", "organization_id", "resume_url", "summary", "skills", "experience")
        .first()
    )
    if not row:
        return None
    skills = row.get("skills") or []
    if not isinstance(skills, list):
        skills = []
    return CandidateResumeRow(
        id=row["id"],
        organization_id=row["organization_id"],
        resume_url=row.get("resume_url"),
        summary=row.get("summary"),
        skills=[str(s) for s in skills],
        experience=float(row.get("experience") or 0),
    )


def update_resume_text(
    *,
    candidate_id: str,
    organization_id: str,
    resume_text: str,
) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE "Candidate"
            SET "resumeText" = %s, "updatedAt" = NOW()
            WHERE id = %s AND "organizationId" = %s
            """,
            [resume_text, candidate_id, organization_id],
        )
        if cursor.rowcount != 1:
            raise PermanentResumeError("candidate_update_mismatch")


def update_embedding(
    *,
    candidate_id: str,
    organization_id: str,
    vector: list[float],
) -> None:
    literal = "[" + ",".join(str(float(x)) for x in vector) + "]"
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE "Candidate"
            SET embedding = %s::vector, "updatedAt" = NOW()
            WHERE id = %s AND "organizationId" = %s
            """,
            [literal, candidate_id, organization_id],
        )
        if cursor.rowcount != 1:
            raise PermanentResumeError("candidate_update_mismatch")


def embedding_dims(candidate_id: str, organization_id: str) -> int | None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT CASE WHEN embedding IS NULL THEN NULL ELSE vector_dims(embedding) END
            FROM "Candidate"
            WHERE id = %s AND "organizationId" = %s
            """,
            [candidate_id, organization_id],
        )
        row = cursor.fetchone()
    if not row:
        return None
    value = row[0]
    return int(value) if value is not None else None
