-- HireOS V3.0 — PracticalSubmission immutability trigger, for a FRESH database built with `prisma db push`.
--
-- `prisma db push` creates every V3/V3.1 enum, table, index and foreign key from prisma/schema.prisma,
-- but Prisma cannot express triggers, so this database-level integrity guarantee must be added afterwards.
-- Function body and trigger are identical to prisma/manual/20260929_v3_practical_assessment.sql (lines 66-88).
-- This file creates no enum, table, index or constraint, and drops nothing.
--
-- Apply (see docs/DEPLOYMENT-DATABASE-V3.1.md):
--   npx prisma db execute --file prisma/manual/20260930_v3_production_trigger.sql --schema prisma/schema.prisma
--
-- Re-running is safe: CREATE OR REPLACE converges on this exact definition (PostgreSQL 14+ for the trigger).
-- Fails, and changes nothing, if the "PracticalSubmission" table does not exist yet.

BEGIN;

-- Submission integrity enforced by the database, not only by application code:
-- frozen fields can never change, and a recorded result can never be overwritten.
CREATE OR REPLACE FUNCTION "practical_submission_immutable"() RETURNS trigger AS $$
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

CREATE OR REPLACE TRIGGER "PracticalSubmission_immutable"
  BEFORE UPDATE ON "PracticalSubmission"
  FOR EACH ROW EXECUTE FUNCTION "practical_submission_immutable"();

COMMIT;
