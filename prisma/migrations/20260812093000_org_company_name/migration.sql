-- AlterTable
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "companyName" TEXT NOT NULL DEFAULT '';

-- Backfill from name where empty
UPDATE "Organization" SET "companyName" = "name" WHERE "companyName" = '';
