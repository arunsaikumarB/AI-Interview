import { prisma } from "@/lib/db";
import { synthesizeSpeech } from "@/lib/speech";
import { saveInterviewAudio } from "@/lib/storage";

const inflight = new Map<string, Promise<string>>();

/**
 * Synthesize + cache question TTS once (local speech-service).
 * Safe to call from turn processing and from GET /question-audio.
 */
export async function ensureQuestionTts(params: {
  sessionId: string;
  questionId: string;
  sequence: number;
  text: string;
  existingPath?: string | null;
}): Promise<string> {
  if (params.existingPath) return params.existingPath;

  const existing = inflight.get(params.questionId);
  if (existing) return existing;

  const work = (async () => {
    const fresh = await prisma.interviewQuestion.findUnique({
      where: { id: params.questionId },
      select: { ttsPath: true },
    });
    if (fresh?.ttsPath) return fresh.ttsPath;

    const wav = await synthesizeSpeech(params.text);
    const stored = await saveInterviewAudio({
      sessionId: params.sessionId,
      fileName: `q${params.sequence}.wav`,
      data: wav,
    });
    await prisma.interviewQuestion.update({
      where: { id: params.questionId },
      data: { ttsPath: stored.relativePath },
    });
    return stored.relativePath;
  })().finally(() => {
    inflight.delete(params.questionId);
  });

  inflight.set(params.questionId, work);
  return work;
}

/** Best-effort prefetch so the candidate is not waiting on first play. */
export function prefetchQuestionTts(params: {
  sessionId: string;
  questionId: string;
  sequence: number;
  text: string;
}): void {
  void ensureQuestionTts(params).catch((err) => {
    console.warn(
      "[question-tts] prefetch failed:",
      err instanceof Error ? err.message : err,
    );
  });
}
