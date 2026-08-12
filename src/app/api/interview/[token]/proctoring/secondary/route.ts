import { z } from "zod";
import { prisma } from "@/lib/db";
import { jsonOk, withApiHandler } from "@/lib/api";
import {
  clearLiveFrame,
  clearSecondaryRuntime,
  createSecondaryPairToken,
  getRuntimeDiagnostics,
  pairExpiresAt,
  resolveSecondaryStatus,
  secondaryStatusLabel,
  sweepSecondaryRuntime,
} from "@/lib/secondary-camera";
import { signalSecondaryTransition } from "@/lib/secondary-camera-lifecycle";

type Ctx = { params: { token: string } };

async function loadEnhancedSession(accessToken: string) {
  return prisma.interviewSession.findUnique({
    where: { accessToken },
    select: {
      id: true,
      applicationId: true,
      status: true,
      tokenExpiresAt: true,
      proctoringEnabled: true,
      proctoringMode: true,
      proctoringConsentAt: true,
      secondaryPairToken: true,
      secondaryPairExpiresAt: true,
      secondaryDeviceStatus: true,
      secondaryDeviceLastSeenAt: true,
      secondaryPlacementConfirmedAt: true,
    },
  });
}

function gate(
  session: NonNullable<Awaited<ReturnType<typeof loadEnhancedSession>>>,
) {
  if (session.tokenExpiresAt && session.tokenExpiresAt < new Date()) {
    return Response.json(
      {
        error:
          "This interview link has expired. Please contact the recruiter.",
      },
      { status: 410 },
    );
  }
  if (session.status === "CANCELLED" || session.status === "COMPLETED") {
    return Response.json({ error: "Interview is not available" }, { status: 400 });
  }
  if (!session.proctoringEnabled || session.proctoringMode !== "ENHANCED") {
    return Response.json(
      { error: "Enhanced proctoring is not enabled for this interview" },
      { status: 400 },
    );
  }
  if (!session.proctoringConsentAt) {
    return Response.json(
      { error: "Proctoring consent is required first" },
      { status: 400 },
    );
  }
  return null;
}

/** Host: secondary camera pairing status (human-readable labels). */
export const GET = withApiHandler<Ctx>(async (request, { params }) => {
  sweepSecondaryRuntime();
  const session = await loadEnhancedSession(params.token);
  if (!session) {
    return Response.json({ error: "Interview not found" }, { status: 404 });
  }
  const blocked = gate(session);
  if (blocked) return blocked;

  const status = resolveSecondaryStatus({
    stored: session.secondaryDeviceStatus,
    interviewStatus: session.status,
    pairExpiresAt: session.secondaryPairExpiresAt,
    sessionId: session.id,
  });

  await signalSecondaryTransition({
    sessionId: session.id,
    applicationId: session.applicationId,
    next: status,
  });

  const url = new URL(request.url);
  const diag =
    url.searchParams.get("diag") === "1" &&
    process.env.NODE_ENV !== "production";

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const pairUrl = session.secondaryPairToken
    ? `${appUrl.replace(/\/$/, "")}/interview/secondary/${session.secondaryPairToken}`
    : null;

  return jsonOk({
    status,
    label: secondaryStatusLabel(status),
    pairToken: session.secondaryPairToken,
    pairExpiresAt: session.secondaryPairExpiresAt?.toISOString() ?? null,
    pairUrl,
    placementConfirmed: Boolean(session.secondaryPlacementConfirmedAt),
    livePreviewAvailable: status === "CONNECTED",
    ...(diag
      ? { diagnostics: getRuntimeDiagnostics(session.id) }
      : {}),
  });
});

const postSchema = z.object({
  action: z.enum(["mint", "confirm_placement", "disconnect", "reset_placement"]),
});

export const POST = withApiHandler<Ctx>(async (request, { params }) => {
  const session = await loadEnhancedSession(params.token);
  if (!session) {
    return Response.json({ error: "Interview not found" }, { status: 404 });
  }
  const blocked = gate(session);
  if (blocked) return blocked;

  const body = postSchema.parse(await request.json());

  if (body.action === "mint") {
    const token = createSecondaryPairToken();
    const expires = pairExpiresAt();
    clearSecondaryRuntime(session.id);
    await prisma.interviewSession.update({
      where: { id: session.id },
      data: {
        secondaryPairToken: token,
        secondaryPairExpiresAt: expires,
        secondaryDeviceStatus: "WAITING",
        secondaryDeviceLastSeenAt: null,
        secondaryPlacementConfirmedAt: null,
      },
    });
    const origin =
      request.headers.get("x-forwarded-host") &&
      request.headers.get("x-forwarded-proto")
        ? `${request.headers.get("x-forwarded-proto")}://${request.headers.get("x-forwarded-host")}`
        : null;
    const appUrl =
      origin ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const pairUrl = `${appUrl.replace(/\/$/, "")}/interview/secondary/${token}`;

    return jsonOk({
      status: "WAITING" as const,
      label: secondaryStatusLabel("WAITING"),
      pairToken: token,
      pairExpiresAt: expires.toISOString(),
      pairUrl,
      placementConfirmed: false,
    });
  }

  if (body.action === "confirm_placement") {
    const status = resolveSecondaryStatus({
      stored: session.secondaryDeviceStatus,
      interviewStatus: session.status,
      pairExpiresAt: session.secondaryPairExpiresAt,
      sessionId: session.id,
    });
    if (status !== "CONNECTED") {
      return Response.json(
        { error: "Secondary camera is not connected" },
        { status: 400 },
      );
    }
    await prisma.interviewSession.update({
      where: { id: session.id },
      data: { secondaryPlacementConfirmedAt: new Date() },
    });
    return jsonOk({ placementConfirmed: true, status, label: secondaryStatusLabel(status) });
  }

  if (body.action === "reset_placement") {
    await prisma.interviewSession.update({
      where: { id: session.id },
      data: { secondaryPlacementConfirmedAt: null },
    });
    return jsonOk({ placementConfirmed: false });
  }

  clearLiveFrame(session.id);
  await prisma.interviewSession.update({
    where: { id: session.id },
    data: {
      secondaryDeviceStatus: "DISCONNECTED",
      secondaryDeviceLastSeenAt: null,
      secondaryPlacementConfirmedAt: null,
    },
  });
  await signalSecondaryTransition({
    sessionId: session.id,
    applicationId: session.applicationId,
    next: "DISCONNECTED",
  });
  return jsonOk({
    status: "DISCONNECTED" as const,
    label: secondaryStatusLabel("DISCONNECTED"),
    placementConfirmed: false,
  });
});
