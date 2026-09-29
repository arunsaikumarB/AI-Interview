-- HireOS V3.1 — read-only verification of the database objects V3/V3.1 depend on.
-- Prints one row per check with PASS or FAIL. Runs inside a READ ONLY transaction and ends with
-- ROLLBACK, so it cannot modify anything. See docs/DEPLOYMENT-DATABASE-V3.1.md.
--
--   psql "<DATABASE_URL without ?schema=public>" -v ON_ERROR_STOP=1 -f prisma/manual/20260930_v31_verify_readonly.sql

BEGIN READ ONLY;

WITH checks(ord, name, ok) AS (
  VALUES
  (1, 'extension vector installed',
      EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')),
  (2, 'table PracticalAssessment exists',
      to_regclass('public."PracticalAssessment"') IS NOT NULL),
  (3, 'table PracticalSubmission exists',
      to_regclass('public."PracticalSubmission"') IS NOT NULL),
  (4, 'table CandidateAssessmentLink exists',
      to_regclass('public."CandidateAssessmentLink"') IS NOT NULL),
  (5, 'enum PracticalType = CODING,SQL',
      (SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'PracticalType')
      = ARRAY['CODING','SQL']),
  (6, 'enum PracticalStatus has all 9 values',
      (SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'PracticalStatus')
      = ARRAY['NOT_STARTED','STARTED','IN_PROGRESS','SUBMITTED','EXECUTING','COMPLETED','EXECUTION_FAILED','TIMEOUT','CANCELLED']),
  (7, 'enum PracticalExecStatus has all 5 values',
      (SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'PracticalExecStatus')
      = ARRAY['PENDING','EXECUTING','COMPLETED','EXECUTION_FAILED','TIMEOUT']),
  (8, 'function practical_submission_immutable() exists',
      to_regprocedure('public."practical_submission_immutable"()') IS NOT NULL),
  (9, 'trigger PracticalSubmission_immutable: BEFORE UPDATE FOR EACH ROW, enabled, on PracticalSubmission',
      EXISTS (SELECT 1 FROM pg_trigger tg
               WHERE tg.tgname = 'PracticalSubmission_immutable'
                 AND tg.tgrelid = to_regclass('public."PracticalSubmission"')
                 AND tg.tgfoid = to_regprocedure('public."practical_submission_immutable"()')
                 AND tg.tgtype = 19            -- ROW (1) + BEFORE (2) + UPDATE (16)
                 AND tg.tgenabled = 'O'
                 AND NOT tg.tgisinternal)),
  (10, 'unique PracticalAssessment_accessTokenHash_key',
      to_regclass('public."PracticalAssessment_accessTokenHash_key"') IS NOT NULL),
  (11, 'unique PracticalSubmission_assessmentId_key (one submission per assessment)',
      to_regclass('public."PracticalSubmission_assessmentId_key"') IS NOT NULL),
  (12, 'unique CandidateAssessmentLink_applicationId_key',
      to_regclass('public."CandidateAssessmentLink_applicationId_key"') IS NOT NULL),
  (13, 'unique CandidateAssessmentLink_accessTokenHash_key',
      to_regclass('public."CandidateAssessmentLink_accessTokenHash_key"') IS NOT NULL),
  (14, 'foreign keys: 3 on PracticalAssessment/PracticalSubmission, 2 on CandidateAssessmentLink',
      (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND conname IN (
         'PracticalAssessment_applicationId_fkey', 'PracticalAssessment_createdById_fkey',
         'PracticalSubmission_assessmentId_fkey',
         'CandidateAssessmentLink_applicationId_fkey', 'CandidateAssessmentLink_createdById_fkey')) = 5)
)
SELECT ord, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name
  FROM checks ORDER BY ord;

ROLLBACK;
