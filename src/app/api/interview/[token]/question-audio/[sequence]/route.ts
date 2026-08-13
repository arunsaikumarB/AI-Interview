import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import { prisma } from "@/lib/db";
import { SpeechError } from "@/lib/speech";
import { ensureQuestionTts } from "@/lib/question-tts";
import { resolveStoragePath } from "@/lib/storage";

type Ctx = { params: { token: string; sequence: string } };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lazily synthesize question TTS via local speech-service, cache under /storage,
 * stream audio/wav. Token-scoped (no auth session).
 */
export async function GET(_request: Request, { params }: Ctx) {
  const sequence = Number(params.sequence);
  if (!Number.isInteger(sequence) || sequence < 1) {
    return Response.json({ error: "Invalid sequence" }, { status: 400 });
  }

  const session = await prisma.interviewSession.findUnique({
    where: { accessToken: params.token },
    include: {
      questions: {
        where: { sequence },
        take: 1,
      },
    },
  });

  if (!session) {
    return Response.json({ error: "Interview not found" }, { status: 404 });
  }
  if (session.tokenExpiresAt && session.tokenExpiresAt < new Date()) {
    return Response.json({ error: "This interview link has expired. Please contact the recruiter." }, { status: 410 });
  }

  const question = session.questions[0];
  if (!question) {
    return Response.json({ error: "Question not found" }, { status: 404 });
  }

  let relativePath = question.ttsPath;

  if (!relativePath) {
    try {
      relativePath = await ensureQuestionTts({
        sessionId: session.id,
        questionId: question.id,
        sequence,
        text: question.question,
        existingPath: question.ttsPath,
      });
    } catch (err) {
      if (err instanceof SpeechError) {
        return Response.json(
          {
            error: err.message,
            speechDown: err.speechDown,
          },
          { status: 503 },
        );
      }
      throw err;
    }
  }

  const absolute = resolveStoragePath(relativePath);
  try {
    const st = await stat(absolute);
    const nodeStream = createReadStream(absolute);
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;

    return new Response(webStream, {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(st.size),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return Response.json({ error: "Audio file missing" }, { status: 404 });
  }
}
