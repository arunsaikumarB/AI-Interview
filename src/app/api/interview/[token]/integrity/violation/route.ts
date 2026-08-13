import { z } from "zod";
import { prisma } from "@/lib/db";
import { handleApiError, jsonOk } from "@/lib/api";
import { recordIntegrityViolation } from "@/lib/integrity-server";
import { parseIntegrityMode } from "@/lib/integrity";

type Ctx = { params: { token: string } };

const bodySchema = z.object({
  kind: z.enum(["FOCUS_LOSS", "FULLSCREEN_EXIT", "PASTE"]),
  timestamp: z.string().datetime(),
  episodeId: z.string().min(1).max(80).optional(),
  /** Paste length only — never content. */
  pastedLength: z.number().int().min(0).max(1_000_000).optional(),
});

/**
 * Candidate integrity violation report (Strict mode authority).
 * Server increments counters / may TERMINATE. Never changes Application.stage.
 * Never feeds AI.
 */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const session = await prisma.interviewSession.findUnique({
      where: { accessToken: params.token },
      select: {
        id: true,
        status: true,
        tokenExpiresAt: true,
        integrityMode: true,
        integrityConsentAt: true,
      },
    });

    if (!session) {
      return Response.json({ error: "Interview not found" }, { status: 404 });
    }
    if (session.tokenExpiresAt && session.tokenExpiresAt < new Date()) {
      return Response.json(
        { error: "This interview link has expired." },
        { status: 410 },
      );
    }

    if (session.status === "TERMINATED") {
      return jsonOk({
        ok: true,
        mode: parseIntegrityMode(session.integrityMode),
        recorded: false,
        terminated: true,
        status: "TERMINATED",
        showWarning: false,
      });
    }

    if (session.status !== "IN_PROGRESS") {
      return Response.json(
        { error: "Interview is not in progress" },
        { status: 400 },
      );
    }

    if (parseIntegrityMode(session.integrityMode) !== "STRICT") {
      return jsonOk({
        ok: true,
        mode: "STANDARD" as const,
        recorded: false,
        terminated: false,
        status: session.status,
        showWarning: false,
      });
    }

    if (!session.integrityConsentAt) {
      return Response.json(
        { error: "Integrity consent required" },
        { status: 403 },
      );
    }

    const body = bodySchema.parse(await request.json());

    const result = await recordIntegrityViolation({
      sessionId: session.id,
      kind: body.kind,
      timestamp: new Date(body.timestamp),
      episodeId: body.episodeId,
      meta:
        body.kind === "PASTE"
          ? { pastedLength: body.pastedLength ?? 0 }
          : body.kind === "FULLSCREEN_EXIT"
            ? { kind: "fullscreen_exit" }
            : { kind: "blur" },
    });

    return jsonOk(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json(
        { error: "Validation failed", issues: err.issues },
        { status: 400 },
      );
    }
    if (err instanceof Error && err.message === "SESSION_NOT_FOUND") {
      return Response.json({ error: "Interview not found" }, { status: 404 });
    }
    return handleApiError(err);
  }
}
