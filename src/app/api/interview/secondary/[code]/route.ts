import { prisma } from "@/lib/db";
import { jsonOk, withApiHandler } from "@/lib/api";
import {
  resolveSecondaryStatus,
  secondaryStatusLabel,
} from "@/lib/secondary-camera";
import { pendingSecondaryWarningDto } from "@/lib/integrity";

type Ctx = { params: { code: string } };

/** Secondary device: safe session metadata for pairing page (no org/email in URL). */
export const GET = withApiHandler<Ctx>(async (_request, { params }) => {
  const session = await prisma.interviewSession.findUnique({
    where: { secondaryPairToken: params.code },
    include: {
      application: {
        include: {
          job: { select: { title: true } },
          candidate: { select: { firstName: true } },
        },
      },
    },
  });

  if (!session) {
    return Response.json({ error: "Pairing code not found" }, { status: 404 });
  }
  if (session.tokenExpiresAt && session.tokenExpiresAt < new Date()) {
    return Response.json(
      {
        error:
          "This interview link has expired. Please contact the recruiter.",
      },
      { status: 410 },
    );
  }
  if (session.status === "CANCELLED") {
    return Response.json({ error: "Interview ended" }, { status: 410 });
  }
  if (
    !session.secondaryPairExpiresAt ||
    session.secondaryPairExpiresAt < new Date()
  ) {
    return Response.json(
      { error: "This pairing code has expired. Ask for a new QR code." },
      { status: 410 },
    );
  }
  if (session.proctoringMode !== "ENHANCED" || !session.proctoringEnabled) {
    return Response.json(
      { error: "Secondary camera connection unavailable." },
      { status: 400 },
    );
  }

  const status = resolveSecondaryStatus({
    stored: session.secondaryDeviceStatus,
    interviewStatus: session.status,
    pairExpiresAt: session.secondaryPairExpiresAt,
    sessionId: session.id,
  });

  return jsonOk({
    jobTitle: session.application.job.title,
    candidateFirstName: session.application.candidate.firstName,
    status,
    label: secondaryStatusLabel(status),
    pairExpiresAt: session.secondaryPairExpiresAt.toISOString(),
    interviewStatus: session.status,
    placementConfirmed: Boolean(session.secondaryPlacementConfirmedAt),
    recordingConsent: Boolean(session.secondaryRecordingConsentAt),
    recordingStatus: session.secondaryRecordingStatus,
    recordingId: session.secondaryRecordingId,
    pendingIntegrityWarning: pendingSecondaryWarningDto(session),
    shouldRecord:
      session.status === "IN_PROGRESS" &&
      Boolean(session.secondaryPlacementConfirmedAt) &&
      Boolean(session.secondaryRecordingConsentAt) &&
      session.secondaryRecordingStatus !== "SAVED" &&
      session.secondaryRecordingStatus !== "FAILED",
    message:
      "This secondary camera records the interview environment (video + room audio) for human review. Keep the phone still. Only the candidate should be in frame. Look at the laptop camera, not this phone. The recording is not used for AI scoring.",
  });
});
