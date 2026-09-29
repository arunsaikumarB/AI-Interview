-- Rollback for 20260929_v3_practical_assessment.sql.
-- DESTRUCTIVE for practical-assessment data only. Do not run without explicit approval.
-- Touches no pre-existing table, enum or row.

BEGIN;

DROP TRIGGER IF EXISTS "PracticalSubmission_immutable" ON "PracticalSubmission";
DROP FUNCTION IF EXISTS "practical_submission_immutable"();
DROP TABLE IF EXISTS "PracticalSubmission";
DROP TABLE IF EXISTS "PracticalAssessment";
DROP TYPE IF EXISTS "PracticalExecStatus";
DROP TYPE IF EXISTS "PracticalStatus";
DROP TYPE IF EXISTS "PracticalType";

COMMIT;
