import { z } from "zod";
import type { ProctoringSignalType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { asJson } from "@/lib/ai/interview-session";

type Ctx = { params: { token: string } };

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

const eventSchema = z.object({
  type: z.enum(SIGNAL_TYPES),
  timestamp: z.string().datetime(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

const bodySchema = z.object({
  events: z.array(eventSchema).min(1).max(50),
});

/** In-memory batch timestamps for rate limit: 20 batches / minute / session. */
const batchLog = new Map<string, number[]>();
const capLogged = new Set<string>();

const MAX_EVENTS_PER_SESSION = 2000;
const MAX_BATCHES_PER_MINUTE = 20;

/**
 * Token-scoped proctoring SIGNAL ingest.
 * Requires proctoringEnabled + consent. Never touches Application.stage.
 */
export async function POST(request: Request, { params }: Ctx) {
  const session = await prisma.interviewSession.findUnique({
    where: { accessToken: params.token },
    select: {
      id: true,
      status: true,
      tokenExpiresAt: true,
      proctoringEnabled: true,
      proctoringConsentAt: true,
      _count: { select: { proctoring: true } },
    },
  });

  if (!session) {
    return Response.json({ error: "Interview not found" }, { status: 404 });
  }
  if (session.tokenExpiresAt && session.tokenExpiresAt < new Date()) {
    return Response.json({ error: "This interview link has expired" }, { status: 410 });
  }
  if (!session.proctoringEnabled) {
    return Response.json(
      { error: "Proctoring is not enabled for this session" },
      { status: 403 },
    );
  }
  if (!session.proctoringConsentAt) {
    return Response.json(
      { error: "Proctoring consent required before signals are accepted" },
      { status: 403 },
    );
  }
  if (session.status !== "IN_PROGRESS") {
    return Response.json(
      { error: "Interview is not in progress" },
      { status: 400 },
    );
  }

  const now = Date.now();
  const recent = (batchLog.get(session.id) ?? []).filter(
    (t) => now - t < 60_000,
  );
  if (recent.length >= MAX_BATCHES_PER_MINUTE) {
    batchLog.set(session.id, recent);
    return Response.json(
      { error: "Proctoring rate limit exceeded", retryable: true },
      { status: 429 },
    );
  }
  recent.push(now);
  batchLog.set(session.id, recent);

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json(
        { error: "Validation failed", issues: err.issues },
        { status: 400 },
      );
    }
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const existing = session._count.proctoring;
  if (existing >= MAX_EVENTS_PER_SESSION) {
    if (!capLogged.has(session.id)) {
      console.warn(
        `[proctoring] session ${session.id} hit ${MAX_EVENTS_PER_SESSION} event cap — dropping batches`,
      );
      capLogged.add(session.id);
    }
    return Response.json({ ok: true, stored: 0, capped: true });
  }

  const room = MAX_EVENTS_PER_SESSION - existing;
  const toStore = body.events.slice(0, room);

  if (toStore.length === 0) {
    return Response.json({ ok: true, stored: 0, capped: true });
  }

  await prisma.proctoringEvent.createMany({
    data: toStore.map((e) => ({
      sessionId: session.id,
      type: e.type,
      timestamp: new Date(e.timestamp),
      meta: asJson({
        ...(e.meta ?? {}),
        signalOnly: true,
        noAutoVerdict: true,
      }),
    })),
  });

  if (body.events.length > toStore.length && !capLogged.has(session.id)) {
    console.warn(
      `[proctoring] session ${session.id} reached event cap mid-batch`,
    );
    capLogged.add(session.id);
  }

  return Response.json({
    ok: true,
    stored: toStore.length,
    capped: existing + toStore.length >= MAX_EVENTS_PER_SESSION,
  });
}
