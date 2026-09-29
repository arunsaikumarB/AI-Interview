-- Rollback for 20260929_v31_candidate_assessment_link.sql.
-- DESTRUCTIVE for hub links only (candidates would need a new link). Do not run without explicit approval.
-- Touches no pre-existing table, enum or row.

BEGIN;

DROP TABLE IF EXISTS "CandidateAssessmentLink";

COMMIT;
