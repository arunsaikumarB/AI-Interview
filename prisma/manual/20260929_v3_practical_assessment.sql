-- HireOS V3.0 — practical assessment runtime (coding + SQL).
-- Additive only: new enums, new tables, new indexes/FKs, one integrity trigger.
-- Applied manually with `npx prisma db execute --file <this> --schema prisma/schema.prisma`
-- because the R-4 migration baseline is open (no migrate deploy / db push, ledger untouched).
-- Rollback: 20260929_v3_practical_assessment_rollback.sql (drops only these objects).

BEGIN;

CREATE TYPE "PracticalType" AS ENUM ('CODING', 'SQL');
CREATE TYPE "PracticalStatus" AS ENUM ('NOT_STARTED', 'STARTED', 'IN_PROGRESS', 'SUBMITTED', 'EXECUTING', 'COMPLETED', 'EXECUTION_FAILED', 'TIMEOUT', 'CANCELLED');
CREATE TYPE "PracticalExecStatus" AS ENUM ('PENDING', 'EXECUTING', 'COMPLETED', 'EXECUTION_FAILED', 'TIMEOUT');

CREATE TABLE "PracticalAssessment" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "type" "PracticalType" NOT NULL,
    "taskKey" TEXT NOT NULL,
    "taskVersion" INTEGER NOT NULL,
    "competency" TEXT NOT NULL,
    "difficulty" "QuestionDifficulty" NOT NULL,
    "provenance" JSONB NOT NULL,
    "accessTokenHash" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "timeLimitMinutes" INTEGER NOT NULL,
    "status" "PracticalStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "draftLanguage" TEXT,
    "draftSource" TEXT,
    "draftSavedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PracticalAssessment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PracticalSubmission" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceSha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "taskVersion" INTEGER NOT NULL,
    "runnerVersion" TEXT NOT NULL,
    "execStatus" "PracticalExecStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "PracticalSubmission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PracticalAssessment_accessTokenHash_key" ON "PracticalAssessment"("accessTokenHash");
CREATE INDEX "PracticalAssessment_applicationId_idx" ON "PracticalAssessment"("applicationId");
CREATE INDEX "PracticalAssessment_status_idx" ON "PracticalAssessment"("status");
CREATE UNIQUE INDEX "PracticalSubmission_assessmentId_key" ON "PracticalSubmission"("assessmentId");
CREATE INDEX "PracticalSubmission_execStatus_idx" ON "PracticalSubmission"("execStatus");

ALTER TABLE "PracticalAssessment" ADD CONSTRAINT "PracticalAssessment_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PracticalAssessment" ADD CONSTRAINT "PracticalAssessment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PracticalSubmission" ADD CONSTRAINT "PracticalSubmission_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "PracticalAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Submission integrity enforced by the database, not only by application code:
-- frozen fields can never change, and a recorded result can never be overwritten.
CREATE FUNCTION "practical_submission_immutable"() RETURNS trigger AS $$
BEGIN
  IF NEW."assessmentId" IS DISTINCT FROM OLD."assessmentId"
     OR NEW."language" IS DISTINCT FROM OLD."language"
     OR NEW."source" IS DISTINCT FROM OLD."source"
     OR NEW."sourceSha256" IS DISTINCT FROM OLD."sourceSha256"
     OR NEW."sizeBytes" IS DISTINCT FROM OLD."sizeBytes"
     OR NEW."taskVersion" IS DISTINCT FROM OLD."taskVersion"
     OR NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt" THEN
    RAISE EXCEPTION 'practical submission frozen fields are immutable';
  END IF;
  IF OLD."execStatus" IN ('COMPLETED', 'EXECUTION_FAILED', 'TIMEOUT') THEN
    RAISE EXCEPTION 'practical submission result is already recorded';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PracticalSubmission_immutable"
  BEFORE UPDATE ON "PracticalSubmission"
  FOR EACH ROW EXECUTE FUNCTION "practical_submission_immutable"();

COMMIT;
