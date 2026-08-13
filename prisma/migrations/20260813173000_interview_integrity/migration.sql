-- Step 5: Interview integrity (Strict mode) — browser-observable signals only
ALTER TYPE "InterviewStatus" ADD VALUE IF NOT EXISTS 'TERMINATED';

ALTER TABLE "InterviewSession"
  ADD COLUMN IF NOT EXISTS "integrityMode" TEXT NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN IF NOT EXISTS "integrityConsentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "integrityViolationCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "integrityPasteCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "integrityTerminatedReason" TEXT;
