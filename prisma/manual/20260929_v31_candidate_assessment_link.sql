-- HireOS V3.1 — candidate assessment hub link.
-- Additive only: one new table, its indexes and FKs. No existing table, enum or row is touched.
-- Applied manually with `npx prisma db execute --file <this> --schema prisma/schema.prisma`
-- because the R-4 migration baseline is open (no migrate deploy / db push, ledger untouched).
-- Rollback: 20260929_v31_candidate_assessment_link_rollback.sql (drops only this table).

BEGIN;

CREATE TABLE "CandidateAssessmentLink" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "accessTokenHash" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateAssessmentLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CandidateAssessmentLink_applicationId_key" ON "CandidateAssessmentLink"("applicationId");
CREATE UNIQUE INDEX "CandidateAssessmentLink_accessTokenHash_key" ON "CandidateAssessmentLink"("accessTokenHash");

ALTER TABLE "CandidateAssessmentLink" ADD CONSTRAINT "CandidateAssessmentLink_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CandidateAssessmentLink" ADD CONSTRAINT "CandidateAssessmentLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
