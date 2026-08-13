import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { AuthError, canManagePipeline, requireStaff } from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { recordingStatusLabel } from "@/lib/secondary-recording-labels";

type Ctx = { params: { id: string } };

async function loadAuthorizedInterview(id: string) {
  const session = await getSession();
  const user = requireStaff(session);
  if (!canManagePipeline(user.role)) {
    throw new AuthError("Insufficient permissions", 403);
  }
  const interview = await prisma.interviewSession.findUnique({
    where: { id },
    include: {
      application: {
        include: { job: { select: { organizationId: true } } },
      },
    },
  });
  if (!interview) return { user, interview: null as null };
  if (
    user.role !== "SUPER_ADMIN" &&
    user.organizationId &&
    interview.application.job.organizationId !== user.organizationId
  ) {
    throw new AuthError("Insufficient permissions", 403);
  }
  return { user, interview };
}

/** Staff metadata for secondary recording (review only). */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { interview } = await loadAuthorizedInterview(params.id);
    if (!interview) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return jsonOk({
      status: interview.secondaryRecordingStatus,
      label: recordingStatusLabel(interview.secondaryRecordingStatus),
      hasRecording: Boolean(interview.secondaryRecordingPath),
      durationMs: interview.secondaryRecordingDurationMs,
      interruptedMs: interview.secondaryRecordingInterruptedMs,
      hasGap: interview.secondaryRecordingHasGap,
      mime: interview.secondaryRecordingMime,
      startedAt: interview.secondaryRecordingStartedAt,
      endedAt: interview.secondaryRecordingEndedAt,
      reviewOnly: true,
      noAiInput: true,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
