import { prisma } from "@/lib/db";
import { AIError } from "@/lib/ai/ollama";
import {
  mapAnswerProcessError,
  submitInterviewAnswer,
} from "@/lib/ai/submit-interview-answer";
import {
  releaseSessionLock,
  tryAcquireSessionLock,
} from "@/lib/ai/interview-session";
import {
  AVG_LOGPROB_MIN,
  SpeechError,
  transcribeAudio,
} from "@/lib/speech";
import { saveInterviewAudio } from "@/lib/storage";

type Ctx = { params: { token: string } };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * VOICE answer: upload audio → local STT → same submit path as /answer.
 * Returns { nextQuestion | concluded } plus transcript for the room.
 * Never leaks scores. Speech down → 503 { speechDown: true }.
 */
export async function POST(request: Request, { params }: Ctx) {
  const session = await prisma.interviewSession.findUnique({
    where: { accessToken: params.token },
    include: {
      questions: {
        orderBy: { sequence: "asc" },
        include: { answer: true },
      },
    },
  });

  if (!session) {
    return Response.json({ error: "Interview not found" }, { status: 404 });
  }
  if (session.tokenExpiresAt && session.tokenExpiresAt < new Date()) {
    return Response.json({ error: "This interview link has expired" }, { status: 410 });
  }
  if (session.status !== "IN_PROGRESS") {
    return Response.json({ error: "Interview is not in progress" }, { status: 400 });
  }

  if (!tryAcquireSessionLock(session.id)) {
    return Response.json(
      { error: "Another answer is already being processed", retryable: true },
      { status: 429 },
    );
  }

  try {
    const current = session.questions.find((q) => !q.answer);
    if (!current) {
      return Response.json(
        { error: "No open question to answer", concluded: false },
        { status: 400 },
      );
    }

    const existingAnswer = await prisma.interviewAnswer.findUnique({
      where: { questionId: current.id },
    });
    if (existingAnswer) {
      return Response.json(
        { error: "This question was already answered", retryable: false },
        { status: 409 },
      );
    }

    const form = await request.formData();
    const file = form.get("audio");
    if (!(file instanceof File)) {
      return Response.json({ error: "audio file required" }, { status: 400 });
    }
    if (file.size <= 0 || file.size > MAX_BYTES) {
      return Response.json(
        { error: "Audio must be between 1 byte and 25MB" },
        { status: 400 },
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const ext = file.name?.toLowerCase().endsWith(".wav") ? "wav" : "webm";
    const audioRel = `a${current.sequence}.${ext}`;

    const stored = await saveInterviewAudio({
      sessionId: session.id,
      fileName: audioRel,
      data: bytes,
    });

    let transcript: {
      text: string;
      durationSec: number;
      language: string;
      avgLogprob: number;
    };
    try {
      transcript = await transcribeAudio(
        bytes,
        file.name || `a${current.sequence}.${ext}`,
        file.type || (ext === "wav" ? "audio/wav" : "audio/webm"),
      );
    } catch (err) {
      if (err instanceof SpeechError) {
        return Response.json(
          {
            error: err.message,
            speechDown: err.speechDown,
            retryable: true,
          },
          { status: 503 },
        );
      }
      throw err;
    }

    const text = transcript.text?.trim() ?? "";
    if (!text || transcript.avgLogprob < AVG_LOGPROB_MIN) {
      // Do NOT save an answer — candidate may re-record.
      return Response.json({
        transcriptFailed: true,
        avgLogprob: transcript.avgLogprob,
        message:
          "We couldn't hear that clearly, please re-record or type your answer",
      });
    }

    try {
      const result = await submitInterviewAnswer({
        sessionId: session.id,
        questionId: current.id,
        answerText: text,
        durationSec: Math.round(transcript.durationSec) || null,
        audioPath: stored.relativePath,
        transcriptConfidence: transcript.avgLogprob,
      });

      if (result.concluded) {
        return Response.json({
          concluded: true,
          transcript: text,
        });
      }
      return Response.json({
        concluded: false,
        nextQuestion: result.nextQuestion,
        transcript: text,
      });
    } catch (err) {
      if (err instanceof AIError) {
        return mapAnswerProcessError(err);
      }
      return mapAnswerProcessError(err);
    }
  } catch (err) {
    console.error(err);
    return Response.json(
      {
        error: err instanceof Error ? err.message : "Audio answer failed",
        retryable: true,
      },
      { status: 503 },
    );
  } finally {
    releaseSessionLock(session.id);
  }
}
