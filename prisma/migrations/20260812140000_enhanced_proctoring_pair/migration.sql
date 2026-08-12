-- Enhanced proctoring: mode + secondary device pairing (no recording)
ALTER TABLE "InterviewSession" ADD COLUMN "proctoringMode" TEXT NOT NULL DEFAULT 'OFF';
ALTER TABLE "InterviewSession" ADD COLUMN "secondaryPairToken" TEXT;
ALTER TABLE "InterviewSession" ADD COLUMN "secondaryPairExpiresAt" TIMESTAMP(3);
ALTER TABLE "InterviewSession" ADD COLUMN "secondaryDeviceStatus" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "InterviewSession" ADD COLUMN "secondaryDeviceLastSeenAt" TIMESTAMP(3);
ALTER TABLE "InterviewSession" ADD COLUMN "secondaryPlacementConfirmedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "InterviewSession_secondaryPairToken_key" ON "InterviewSession"("secondaryPairToken");
