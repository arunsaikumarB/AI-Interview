-- Step 6: Enhanced secondary recording metadata (local /storage only)
ALTER TABLE "InterviewSession"
  ADD COLUMN IF NOT EXISTS "secondaryRecordingConsentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "secondaryRecordingId" TEXT,
  ADD COLUMN IF NOT EXISTS "secondaryRecordingStatus" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "secondaryRecordingPath" TEXT,
  ADD COLUMN IF NOT EXISTS "secondaryRecordingMime" TEXT,
  ADD COLUMN IF NOT EXISTS "secondaryRecordingStartedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "secondaryRecordingEndedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "secondaryRecordingDurationMs" INTEGER,
  ADD COLUMN IF NOT EXISTS "secondaryRecordingInterruptedMs" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "secondaryRecordingHasGap" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "secondaryRecordingLastChunkIndex" INTEGER NOT NULL DEFAULT -1;
