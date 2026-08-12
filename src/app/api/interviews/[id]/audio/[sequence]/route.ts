import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import {
  AuthError,
  canManagePipeline,
  requireStaff,
} from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api";
import { resolveStoragePath } from "@/lib/storage";

type Ctx = { params: { id: string; sequence: string } };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Recruiter-only: stream candidate answer audio for a session question.
 * Never exposes raw /storage paths to the client.
 */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const sessionUser = await getSession();
    const user = requireStaff(sessionUser);
    if (!canManagePipeline(user.role)) {
      throw new AuthError("Insufficient permissions", 403);
    }

    const sequence = Number(params.sequence);
    if (!Number.isInteger(sequence) || sequence < 1) {
      return Response.json({ error: "Invalid sequence" }, { status: 400 });
    }

    const interview = await prisma.interviewSession.findUnique({
      where: { id: params.id },
      include: {
        application: {
          include: { job: { select: { organizationId: true } } },
        },
        questions: {
          where: { sequence },
          take: 1,
          include: { answer: true },
        },
      },
    });

    if (!interview) {
      return Response.json({ error: "Interview not found" }, { status: 404 });
    }
    if (
      user.role !== "SUPER_ADMIN" &&
      user.organizationId &&
      interview.application.job.organizationId !== user.organizationId
    ) {
      throw new AuthError("Insufficient permissions", 403);
    }

    const audioPath = interview.questions[0]?.answer?.audioPath;
    if (!audioPath) {
      return Response.json({ error: "No audio for this answer" }, { status: 404 });
    }

    const absolute = resolveStoragePath(audioPath);
    const st = await stat(absolute);
    const nodeStream = createReadStream(absolute);
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
    const mime = audioPath.endsWith(".wav") ? "audio/wav" : "audio/webm";

    return new Response(webStream, {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(st.size),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
