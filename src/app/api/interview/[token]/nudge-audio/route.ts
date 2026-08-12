import { createReadStream } from "fs";
import { access } from "fs/promises";
import { Readable } from "stream";
import { prisma } from "@/lib/db";
import { SpeechError, synthesizeSpeech } from "@/lib/speech";
import {
  interviewAudioRelPath,
  resolveStoragePath,
  saveInterviewAudio,
} from "@/lib/storage";

type Ctx = { params: { token: string } };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NUDGE_TEXT =
  "Please stay focused on the interview. Activity signals are shared with the recruiter.";

/**
 * Cached static focus-nudge TTS for VOICE proctored sessions.
 * Client-only UX — does not affect scores or prompts.
 */
export async function GET(_request: Request, { params }: Ctx) {
  const session = await prisma.interviewSession.findUnique({
    where: { accessToken: params.token },
  });

  if (!session) {
    return Response.json({ error: "Interview not found" }, { status: 404 });
  }
  if (!session.proctoringEnabled) {
    return Response.json({ error: "Proctoring not enabled" }, { status: 403 });
  }
  if (session.status !== "IN_PROGRESS") {
    return Response.json({ error: "Interview is not in progress" }, { status: 400 });
  }

  const fileName = "focus-nudge.wav";
  let relativePath = interviewAudioRelPath(session.id, fileName);
  const absolute = resolveStoragePath(relativePath);

  try {
    await access(absolute);
  } catch {
    let wav: Buffer;
    try {
      wav = await synthesizeSpeech(NUDGE_TEXT);
    } catch (err) {
      if (err instanceof SpeechError) {
        return Response.json(
          { error: err.message, speechDown: err.speechDown },
          { status: 503 },
        );
      }
      throw err;
    }
    const stored = await saveInterviewAudio({
      sessionId: session.id,
      fileName,
      data: wav,
    });
    relativePath = stored.relativePath;
  }

  const stream = createReadStream(resolveStoragePath(relativePath));
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Content-Type": "audio/wav",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
