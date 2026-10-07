-- Careers site sync (WordPress live-applications API): remember which HireOS job and application
-- came from which careers job / application, so nothing is imported twice.
--
-- Additive only: four nullable columns and two unique indexes. Existing rows get NULL and are
-- unaffected (PostgreSQL treats NULLs as distinct in unique indexes). Safe to run more than once.
-- Names match what `prisma db push` would create for prisma/schema.prisma.
--
-- Run once on an existing database (e.g. the company server), after a backup:
--   npx prisma db execute --file prisma/manual/20261007_careers_sync.sql --schema prisma/schema.prisma

BEGIN;

ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "externalSource" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "Application" ADD COLUMN IF NOT EXISTS "externalSource" TEXT;
ALTER TABLE "Application" ADD COLUMN IF NOT EXISTS "externalId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Job_organizationId_externalSource_externalId_key"
  ON "Job"("organizationId", "externalSource", "externalId");
CREATE UNIQUE INDEX IF NOT EXISTS "Application_jobId_externalSource_externalId_key"
  ON "Application"("jobId", "externalSource", "externalId");

COMMIT;
