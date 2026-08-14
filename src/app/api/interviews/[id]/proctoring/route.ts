import { z } from "zod";
import type { ProctoringSignalType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { requireStaff } from "@/lib/auth/rbac";
import { handleApiError, jsonCreated, jsonOk } from "@/lib/api";

const SIGNAL_TYPES = [
  "TAB_BLUR",
  "TAB_FOCUS",
  "FULLSCREEN_EXIT",
  "MULTIPLE_FACES",
  "NO_FACE",
  "LOOKING_AWAY",
  "AUDIO_ANOMALY",
  "COPY_PASTE",
  "WINDOW_SWITCH",
  "NETWORK_DROP",
  "OTHER",
] as const satisfies readonly ProctoringSignalType[];

const bodySchema = z.object({
  type: z.enum(SIGNAL_TYPES),
  observedAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

type Ctx = { params: { id: string } };

/**
 * Staff review of proctoring signals. Candidates use /api/interview/[token]/proctoring.
 * CANDIDATE JWT → 403.
 */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    requireStaff(session);
    const body = bodySchema.parse(await request.json());

    const interview = await prisma.interviewSession.findUnique({
      where: { id: params.id },
    });

    if (!interview) {
      return Response.json({ error: "Interview not found" }, { status: 404 });
    }

    const event = await prisma.proctoringEvent.create({
      data: {
        sessionId: params.id,
        type: body.type,
        timestamp: new Date(body.observedAt),
        meta: {
          ...(body.payload ?? {}),
          signalOnly: true,
          noAutoVerdict: true,
        },
      },
    });

    return jsonCreated({
      event,
      note: "Signal recorded. No automatic pass/fail verdict applied.",
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    requireStaff(session);

    const interview = await prisma.interviewSession.findUnique({
      where: { id: params.id },
    });

    if (!interview) {
      return Response.json({ error: "Interview not found" }, { status: 404 });
    }

    const events = await prisma.proctoringEvent.findMany({
      where: { sessionId: params.id },
      orderBy: { timestamp: "asc" },
    });

    return jsonOk({
      events,
      interviewStatus: interview.status,
      secondaryDeviceStatus: interview.secondaryDeviceStatus,
      advisoryNote:
        "These are timestamped signals for human review — not automatic verdicts.",
    });
  } catch (err) {
    return handleApiError(err);
  }
}
