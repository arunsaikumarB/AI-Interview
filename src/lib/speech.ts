/**
 * Client for the local speech-service (STT/TTS).
 * Never calls cloud speech APIs.
 */

export class SpeechError extends Error {
  readonly code: "SPEECH_UNREACHABLE" | "SPEECH_HTTP" | "TRANSCRIPT_FAILED";
  readonly speechDown: boolean;

  constructor(
    code: SpeechError["code"],
    message: string,
    speechDown = code === "SPEECH_UNREACHABLE" || code === "SPEECH_HTTP",
  ) {
    super(message);
    this.name = "SpeechError";
    this.code = code;
    this.speechDown = speechDown;
  }
}

export function speechServiceUrl(): string {
  return (process.env.SPEECH_SERVICE_URL ?? "http://localhost:8001").replace(
    /\/$/,
    "",
  );
}

/** Whisper avg_logprob below this → switch the candidate to typing (no re-record). */
export const AVG_LOGPROB_MIN = -1.2;

export type TranscribeResult = {
  text: string;
  durationSec: number;
  language: string;
  avgLogprob: number;
};

export async function speechHealth(): Promise<{
  ok: boolean;
  device?: string;
  whisperModel?: string;
  voice?: string | null;
  error?: string;
}> {
  const base = speechServiceUrl();
  try {
    const res = await fetch(`${base}/health`, { cache: "no-store" });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as {
      ok?: boolean;
      device?: string;
      whisperModel?: string;
      voice?: string | null;
    };
    return {
      ok: Boolean(data.ok),
      device: data.device,
      whisperModel: data.whisperModel,
      voice: data.voice,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unreachable",
    };
  }
}

export async function transcribeAudio(
  audio: Buffer,
  filename: string,
  contentType: string,
): Promise<TranscribeResult> {
  const base = speechServiceUrl();
  const form = new FormData();
  const blob = new Blob([new Uint8Array(audio)], {
    type: contentType || "audio/webm",
  });
  form.append("audio", blob, filename);

  const timeoutMs = Number(process.env.SPEECH_STT_TIMEOUT_MS ?? 60_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${base}/transcribe`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new SpeechError(
        "SPEECH_UNREACHABLE",
        `Speech transcription timed out after ${Math.round(timeoutMs / 1000)}s`,
      );
    }
    throw new SpeechError(
      "SPEECH_UNREACHABLE",
      `Speech service unreachable at ${base}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SpeechError(
      "SPEECH_HTTP",
      `Transcribe failed (${res.status}): ${text || res.statusText}`,
    );
  }

  return res.json() as Promise<TranscribeResult>;
}

export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const base = speechServiceUrl();
  let res: Response;
  try {
    res = await fetch(`${base}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    throw new SpeechError(
      "SPEECH_UNREACHABLE",
      `Speech service unreachable at ${base}`,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new SpeechError(
      "SPEECH_HTTP",
      `Synthesize failed (${res.status}): ${body || res.statusText}`,
    );
  }

  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}
