import { prisma } from "@/lib/db";
import { withApiHandler } from "@/lib/api";
import {
  getLiveFrame,
  resolveSecondaryStatus,
} from "@/lib/secondary-camera";

type Ctx = { params: { token: string } };

/**
 * Host polls latest in-memory preview frame.
 * Auth: possession of interview accessToken (same as candidate room).
 * Denied when interview ended/cancelled/expired or secondary not live.
 */
export const GET = withApiHandler<Ctx>(async (_request, { params }) => {
  const session = await prisma.interviewSession.findUnique({
    where: { accessToken: params.token },
    select: {
      id: true,
      status: true,
      tokenExpiresAt: true,
      proctoringMode: true,
      proctoringEnabled: true,
      secondaryDeviceStatus: true,
      secondaryPairExpiresAt: true,
    },
  });
  if (!session) {
    return Response.json({ error: "Interview not found" }, { status: 404 });
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
  if (session.status === "COMPLETED" || session.status === "CANCELLED" || session.status === "TERMINATED") {
    return Response.json({ error: "Interview ended" }, { status: 410 });
  }
  if (!session.proctoringEnabled || session.proctoringMode !== "ENHANCED") {
    return Response.json({ error: "Not available" }, { status: 403 });
  }

  const status = resolveSecondaryStatus({
    stored: session.secondaryDeviceStatus,
    interviewStatus: session.status,
    pairExpiresAt: session.secondaryPairExpiresAt,
    sessionId: session.id,
  });

  // Allow STALE to serve last frame briefly; reject when disconnected/ended.
  if (
    status === "DISCONNECTED" ||
    status === "ENDED" ||
    status === "NONE" ||
    status === "WAITING"
  ) {
    return Response.json(
      { error: "Secondary camera connection unavailable." },
      { status: 404 },
    );
  }

  const frame = getLiveFrame(session.id);
  if (!frame) {
    return Response.json({ error: "No preview frame yet" }, { status: 404 });
  }

  return new Response(new Uint8Array(frame.data), {
    status: 200,
    headers: {
      "Content-Type": frame.mime,
      "Cache-Control": "no-store, no-cache, must-revalidate, private, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      "X-Secondary-Preview": "live-ephemeral",
    },
  });
});
