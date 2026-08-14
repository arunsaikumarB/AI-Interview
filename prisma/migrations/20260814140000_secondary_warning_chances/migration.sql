-- 3 staying warnings for Enhanced secondary-camera integrity (ack before continue).
ALTER TABLE "InterviewSession" ADD COLUMN IF NOT EXISTS "integrityPendingWarningKind" TEXT;
