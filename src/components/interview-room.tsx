"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { VoiceDeviceCheck } from "@/components/voice-device-check";
import { ProctoringConsent } from "@/components/proctoring-consent";
import { CandidateQuestions } from "@/components/candidate-questions";
import {
  createProctoringCollector,
  type ProctoringClientType,
  type ProctoringCollector,
} from "@/lib/proctoring";
import { cn } from "@/lib/utils";

const FOCUS_NUDGE_COPY =
  "Please stay focused on the interview — activity signals are shared with the recruiter.";
const MAX_FOCUS_NUDGES = 2;
const FOCUS_GAP_MS = 3000;

type Turn = {
  sequence: number;
  question: string;
  answerText: string | null;
};

type Info = {
  status: string;
  jobTitle: string;
  candidateFirstName: string;
  maxQuestions: number;
  instructions: string;
  concluded: boolean;
  mode: "TEXT" | "VOICE";
  proctoringEnabled?: boolean;
  proctoringConsentAt?: string | null;
};

type AnswerMode = "voice" | "text";

export function InterviewRoom({ token }: { token: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [current, setCurrent] = useState<{ sequence: number; question: string } | null>(
    null,
  );
  const [concluded, setConcluded] = useState(false);
  const [pendingProcessing, setPendingProcessing] = useState(false);
  const [answer, setAnswer] = useState("");
  const [thinking, setThinking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [deviceReady, setDeviceReady] = useState(false);
  const [preferText, setPreferText] = useState(false);
  const [answerMode, setAnswerMode] = useState<AnswerMode>("voice");
  const [recording, setRecording] = useState(false);
  const [recordLevel, setRecordLevel] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [transcriptFailed, setTranscriptFailed] = useState(false);
  const [heardLabel, setHeardLabel] = useState<string | null>(null);
  const [proctoringConsented, setProctoringConsented] = useState(false);
  const [cameraAllowed, setCameraAllowed] = useState(false);
  const [focusNudge, setFocusNudge] = useState<string | null>(null);
  const [postPhase, setPostPhase] = useState<"questions" | "thanks" | null>(null);
  const startedAt = useRef<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mediaRec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const levelRaf = useRef(0);
  const questionAudioRef = useRef<HTMLAudioElement | null>(null);
  const proctorRef = useRef<ProctoringCollector | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const hiddenSinceRef = useRef<number | null>(null);
  const nudgeCountRef = useRef(0);
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceModeRef = useRef(false);

  const sessionIsVoice = info?.mode === "VOICE" && !preferText;
  const useVoiceUi = sessionIsVoice && answerMode === "voice";
  voiceModeRef.current = Boolean(info?.mode === "VOICE");

  const finishToThanks = useCallback(() => {
    try {
      sessionStorage.setItem(`cq-done-${token}`, "1");
    } catch {
      /* ignore */
    }
    setPostPhase("thanks");
  }, [token]);

  const handleProctorEvent = useCallback(
    (type: ProctoringClientType, meta?: Record<string, unknown>) => {
      if (type === "TAB_BLUR" || (type === "WINDOW_SWITCH" && meta?.kind === "blur")) {
        hiddenSinceRef.current = Date.now();
        return;
      }
      const isFocusReturn =
        type === "TAB_FOCUS" ||
        (type === "WINDOW_SWITCH" && meta?.kind === "focus");
      if (!isFocusReturn || hiddenSinceRef.current == null) return;

      const gap = Date.now() - hiddenSinceRef.current;
      hiddenSinceRef.current = null;
      if (gap <= FOCUS_GAP_MS) return;
      if (nudgeCountRef.current >= MAX_FOCUS_NUDGES) return;

      nudgeCountRef.current += 1;
      setFocusNudge(FOCUS_NUDGE_COPY);
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
      nudgeTimerRef.current = setTimeout(() => setFocusNudge(null), 8000);

      if (voiceModeRef.current) {
        const audio = new Audio(`/api/interview/${token}/nudge-audio`);
        audio.play().catch(() => {
          /* TTS optional — banner still shown */
        });
      }
    },
    [token],
  );

  const loadState = useCallback(async () => {
    const res = await fetch(`/api/interview/${token}/state`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Could not load interview");
      return;
    }
    setTurns(data.turns ?? []);
    setCurrent(data.currentQuestion);
    setConcluded(Boolean(data.concluded));
    setPendingProcessing(Boolean(data.pendingProcessing));
    if (data.pendingProcessing) {
      setError(
        "AI is still processing your last answer — your text was saved. Retry when ready.",
      );
    } else {
      setError((prev) =>
        prev?.includes("saved") || prev?.includes("processing") ? null : prev,
      );
    }
    setInfo((prev) =>
      prev
        ? {
            ...prev,
            status: data.status,
            mode: data.mode === "VOICE" ? "VOICE" : "TEXT",
            jobTitle: data.jobTitle,
            candidateFirstName: data.candidateFirstName,
            maxQuestions: data.maxQuestions,
            concluded: data.concluded,
          }
        : {
            status: data.status,
            mode: data.mode === "VOICE" ? "VOICE" : "TEXT",
            jobTitle: data.jobTitle,
            candidateFirstName: data.candidateFirstName,
            maxQuestions: data.maxQuestions,
            instructions: "",
            concluded: data.concluded,
          },
    );
  }, [token]);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/interview/${token}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Interview not found");
        return;
      }
      setInfo({
        ...data,
        mode: data.mode === "VOICE" ? "VOICE" : "TEXT",
        proctoringEnabled: Boolean(data.proctoringEnabled),
        proctoringConsentAt: data.proctoringConsentAt ?? null,
      });
      setConcluded(Boolean(data.concluded));
      if (data.proctoringConsentAt) {
        setProctoringConsented(true);
        if (typeof data.cameraConsent === "boolean") {
          setCameraAllowed(data.cameraConsent);
        }
      }
      if (data.mode !== "VOICE") {
        setDeviceReady(true);
        setPreferText(true);
        setAnswerMode("text");
      }
      if (data.status === "IN_PROGRESS" || data.status === "COMPLETED") {
        if (data.mode === "VOICE") setDeviceReady(true);
        await loadState();
      }
      if (data.status === "COMPLETED" || data.concluded) {
        try {
          const done = sessionStorage.getItem(`cq-done-${token}`);
          setPostPhase(done ? "thanks" : "questions");
        } catch {
          setPostPhase("questions");
        }
      }
    })();
  }, [token, loadState]);

  useEffect(() => {
    if (!concluded) return;
    setPostPhase((prev) => {
      if (prev === "thanks") return prev;
      try {
        if (sessionStorage.getItem(`cq-done-${token}`)) return "thanks";
      } catch {
        /* ignore */
      }
      return "questions";
    });
  }, [concluded, token]);

  // Start / stop proctoring collectors while IN_PROGRESS
  useEffect(() => {
    if (
      !info?.proctoringEnabled ||
      !proctoringConsented ||
      info.status !== "IN_PROGRESS" ||
      concluded
    ) {
      return;
    }
    const collector = createProctoringCollector({
      token,
      cameraAllowed,
      onEvent: handleProctorEvent,
    });
    proctorRef.current = collector;
    collector.start();
    collector.watchPasteTarget(textareaRef.current);

    let cancelled = false;
    (async () => {
      if (!cameraAllowed) return;
      try {
        const cam = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        if (cancelled) {
          cam.getTracks().forEach((t) => t.stop());
          return;
        }
        camStreamRef.current = cam;
        await collector.enableCamera(cam);
      } catch {
        /* camera optional — tab/paste still run */
      }
    })();

    return () => {
      cancelled = true;
      collector.stop();
      proctorRef.current = null;
      camStreamRef.current?.getTracks().forEach((t) => t.stop());
      camStreamRef.current = null;
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    };
  }, [
    info?.proctoringEnabled,
    info?.status,
    proctoringConsented,
    cameraAllowed,
    token,
    concluded,
    handleProctorEvent,
  ]);

  useEffect(() => {
    proctorRef.current?.watchPasteTarget(textareaRef.current);
  }, [answerMode, current?.sequence]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, current, thinking, heardLabel]);

  const timerKey = current?.sequence ?? turns.find((t) => t.answerText == null)?.sequence;

  useEffect(() => {
    if (timerKey == null || thinking || recording) {
      if (!recording) {
        startedAt.current = null;
        setElapsed(0);
      }
      return;
    }
    startedAt.current = Date.now();
    const id = setInterval(() => {
      if (startedAt.current) {
        setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [timerKey, thinking, recording]);

  const activeSequence = current?.sequence;
  const activeQuestionText = current?.question;

  // Auto-play question TTS in voice mode
  useEffect(() => {
    if (!useVoiceUi || activeSequence == null || thinking) return;
    const url = `/api/interview/${token}/question-audio/${activeSequence}`;
    const audio = new Audio(url);
    questionAudioRef.current = audio;
    audio.play().catch(() => {
      /* autoplay may be blocked — user can press Replay */
    });
    return () => {
      audio.pause();
      questionAudioRef.current = null;
    };
  }, [useVoiceUi, activeSequence, activeQuestionText, token, thinking]);

  async function recordConsent(cameraConsent: boolean) {
    const res = await fetch(`/api/interview/${token}/proctoring/consent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        acknowledged: true,
        cameraConsent,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error ?? "Consent failed");
    }
    setCameraAllowed(Boolean(data.cameraConsent));
    setProctoringConsented(true);
    setInfo((prev) =>
      prev
        ? {
            ...prev,
            proctoringConsentAt: data.consentedAt ?? new Date().toISOString(),
          }
        : prev,
    );
  }

  async function start() {
    setThinking(true);
    setError(null);
    const res = await fetch(`/api/interview/${token}/start`, { method: "POST" });
    const data = await res.json();
    setThinking(false);
    if (!res.ok) {
      setError(data.error ?? "Could not start");
      return;
    }
    await loadState();
  }

  async function continueTurn() {
    setThinking(true);
    setError(null);
    const res = await fetch(`/api/interview/${token}/continue`, { method: "POST" });
    const data = await res.json();
    setThinking(false);
    if (!res.ok) {
      // No answer saved yet (e.g. speech was down) — refresh room, don't look like an outage.
      if (res.status === 400 && data.code === "VALIDATION") {
        setPendingProcessing(false);
        setError(
          data.error === "No answered turns to process"
            ? "Answer the current question first (type or record). Speech service must be running for voice."
            : (data.error ?? "Nothing to continue yet"),
        );
        await loadState();
        return;
      }
      setError(data.error ?? "Still processing — retry shortly");
      return;
    }
    if (data.concluded) {
      setConcluded(true);
      setCurrent(null);
      await loadState();
      return;
    }
    setCurrent(data.nextQuestion);
    setAnswer("");
    setHeardLabel(null);
    await loadState();
  }

  async function submitText() {
    const open =
      current ??
      (() => {
        const t = turns.find((x) => x.answerText == null);
        return t ? { sequence: t.sequence, question: t.question } : null;
      })();
    if (!answer.trim() || !open) return;
    setThinking(true);
    setError(null);
    setTranscriptFailed(false);
    const durationSec = elapsed;
    const res = await fetch(`/api/interview/${token}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answerText: answer.trim(), durationSec }),
    });
    const data = await res.json();
    setThinking(false);

    if (res.status === 503 && data.retryable) {
      setError(
        data.ollamaDown
          ? "AI is offline — your answer was saved. Retry when ready."
          : "AI is busy — your answer was saved. Retry processing.",
      );
      await loadState();
      return;
    }
    if (!res.ok) {
      setError(data.error ?? "Submit failed");
      return;
    }
    if (data.concluded) {
      setConcluded(true);
      setCurrent(null);
      setAnswer("");
      await loadState();
      return;
    }
    setTurns((prev) => [
      ...prev.filter((t) => t.sequence !== open.sequence),
      {
        sequence: open.sequence,
        question: open.question,
        answerText: answer.trim(),
      },
    ]);
    setCurrent(data.nextQuestion);
    setAnswer("");
    setHeardLabel(null);
  }

  async function ensureMic(): Promise<MediaStream> {
    if (streamRef.current) return streamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => {
      t.addEventListener("ended", () => {
        proctorRef.current?.noteOther({ kind: "mic_track_ended" });
      });
    });
    streamRef.current = stream;
    return stream;
  }

  async function startRecording() {
    setTranscriptFailed(false);
    setPreviewUrl(null);
    setPreviewBlob(null);
    setHeardLabel(null);
    chunks.current = [];
    const stream = await ensureMic();
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setRecordLevel(Math.min(1, avg / 80));
      levelRaf.current = requestAnimationFrame(tick);
    };
    tick();

    const rec = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm",
    });
    mediaRec.current = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data);
    };
    startedAt.current = Date.now();
    setElapsed(0);
    const id = setInterval(() => {
      if (startedAt.current) {
        setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
      }
    }, 250);
    rec.onstop = () => {
      clearInterval(id);
      cancelAnimationFrame(levelRaf.current);
      setRecordLevel(0);
      const blob = new Blob(chunks.current, { type: "audio/webm" });
      setPreviewBlob(blob);
      setPreviewUrl(URL.createObjectURL(blob));
      setRecording(false);
    };
    rec.start();
    setRecording(true);
  }

  function stopRecording() {
    if (mediaRec.current?.state === "recording") {
      mediaRec.current.stop();
    }
  }

  function rerecord() {
    setPreviewUrl(null);
    setPreviewBlob(null);
    setTranscriptFailed(false);
  }

  async function sendAudio() {
    if (!previewBlob || !current) return;
    setThinking(true);
    setError(null);
    setTranscriptFailed(false);
    const form = new FormData();
    form.append("audio", previewBlob, `a${current.sequence}.webm`);
    const res = await fetch(`/api/interview/${token}/answer-audio`, {
      method: "POST",
      body: form,
    });
    const data = await res.json();
    setThinking(false);

    if (res.status === 503 && data.speechDown) {
      setError("Speech service is offline. Switch to typing or retry shortly.");
      return;
    }

    if (data.transcriptFailed) {
      setTranscriptFailed(true);
      setPreviewUrl(null);
      setPreviewBlob(null);
      return;
    }

    if (res.status === 503 && data.retryable) {
      setHeardLabel(data.transcript ?? null);
      setError(
        data.ollamaDown
          ? "AI is offline — your answer was saved. Retry when ready."
          : "AI is busy — your answer was saved. Retry processing.",
      );
      setPreviewUrl(null);
      setPreviewBlob(null);
      await loadState();
      return;
    }

    if (!res.ok) {
      setError(data.error ?? "Send failed");
      return;
    }

    const heard = data.transcript as string;
    setHeardLabel(heard);
    setPreviewUrl(null);
    setPreviewBlob(null);

    if (data.concluded) {
      setConcluded(true);
      setCurrent(null);
      await loadState();
      return;
    }

    setTurns((prev) => [
      ...prev.filter((t) => t.sequence !== current.sequence),
      {
        sequence: current.sequence,
        question: current.question,
        answerText: heard,
      },
    ]);
    setCurrent(data.nextQuestion);
    setHeardLabel(null);
  }

  function replayQuestion() {
    if (!current) return;
    const audio = new Audio(
      `/api/interview/${token}/question-audio/${current.sequence}`,
    );
    audio.play().catch(() => setError("Could not play question audio"));
  }

  if (error && !info) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-900">
        <p className="font-medium">Unable to open interview</p>
        <p className="mt-2 text-sm">{error}</p>
      </div>
    );
  }

  if (!info) {
    return <p className="text-center text-sm text-slate-500">Loading interview…</p>;
  }

  if (concluded || info.status === "COMPLETED") {
    if (postPhase === "questions" || postPhase == null) {
      return (
        <CandidateQuestions token={token} onDone={finishToThanks} />
      );
    }
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="font-display text-3xl text-slate-900">Thank you</h1>
        <p className="mt-3 text-slate-600">
          Your interview for <strong>{info.jobTitle}</strong> is complete. The team will get
          back to you.
        </p>
        <p className="mt-6 text-sm text-slate-400">You can close this tab.</p>
      </div>
    );
  }

  if (
    info.proctoringEnabled &&
    !proctoringConsented &&
    info.status !== "COMPLETED" &&
    info.status !== "CANCELLED"
  ) {
    return (
      <ProctoringConsent
        onContinue={async (allowCamera) => {
          await recordConsent(allowCamera);
        }}
      />
    );
  }

  if (
    info.mode === "VOICE" &&
    !deviceReady &&
    info.status === "SCHEDULED"
  ) {
    return (
      <VoiceDeviceCheck
        onContinue={() => {
          setDeviceReady(true);
          setAnswerMode("voice");
        }}
        onUseText={() => {
          setPreferText(true);
          setDeviceReady(true);
          setAnswerMode("text");
        }}
      />
    );
  }

  const answeredTurns = turns.filter((t) => t.answerText != null);
  const unansweredFromState = turns.find((t) => t.answerText == null);
  const activeQuestion =
    current ??
    (unansweredFromState
      ? {
          sequence: unansweredFromState.sequence,
          question: unansweredFromState.question,
        }
      : null);

  if (info.status === "SCHEDULED" && !activeQuestion) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm uppercase tracking-wide text-slate-400">
          {info.mode === "VOICE" ? "Voice interview" : "Text interview"}
        </p>
        <h1 className="mt-2 font-display text-3xl text-slate-900">{info.jobTitle}</h1>
        <p className="mt-4 text-slate-600">
          Hi {info.candidateFirstName}. You&apos;ll get about {info.maxQuestions} questions.
          {info.mode === "VOICE"
            ? " Answer by voice — typing is always available."
            : " Answer in text — take your time."}
        </p>
        <p className="mt-2 text-sm text-slate-500">{info.instructions}</p>
        {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
        <Button className="mt-6 w-full" onClick={start} disabled={thinking}>
          {thinking ? "Starting…" : "Start interview"}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-2xl flex-col">
      {focusNudge ? (
        <div
          role="status"
          className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
        >
          {focusNudge}
        </div>
      ) : null}
      <header className="mb-4 border-b border-slate-200 pb-3">
        <p className="text-xs uppercase tracking-wide text-slate-400">{info.jobTitle}</p>
        <p className="text-sm text-slate-500">
          Question {activeQuestion?.sequence ?? answeredTurns.length} of ~{info.maxQuestions}
          {info.mode === "VOICE" ? ` · ${useVoiceUi ? "Voice" : "Typing"}` : ""}
        </p>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto pb-4">
        {answeredTurns.map((t) => (
          <div key={`seq-${t.sequence}`} className="space-y-2">
            <Bubble side="ai" text={t.question} />
            {t.answerText ? (
              <Bubble
                side="me"
                text={
                  info.mode === "VOICE" && t.answerText
                    ? `Heard: ${t.answerText}`
                    : t.answerText
                }
              />
            ) : null}
          </div>
        ))}
        {activeQuestion ? (
          <div key={`seq-${activeQuestion.sequence}-current`} className="space-y-2">
            <Bubble side="ai" text={activeQuestion.question} />
            {useVoiceUi ? (
              <Button size="sm" variant="outline" type="button" onClick={replayQuestion}>
                Replay question
              </Button>
            ) : null}
            {heardLabel && thinking ? (
              <Bubble side="me" text={`Heard: ${heardLabel}`} />
            ) : null}
          </div>
        ) : null}
        {thinking ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span className="inline-flex gap-1">
              <Dot />
              <Dot delay="150ms" />
              <Dot delay="300ms" />
            </span>
            AI is thinking… (10–40s)
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {error || pendingProcessing ? (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p>
            {error ??
              "AI is still processing your last answer — your text was saved. Retry when ready."}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={continueTurn}
              disabled={thinking}
            >
              {thinking ? "Retrying…" : "Retry AI (answer already saved)"}
            </Button>
            {info.mode === "VOICE" && error?.toLowerCase().includes("speech") ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAnswerMode("text");
                  setError(null);
                }}
              >
                Switch to typing
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {transcriptFailed ? (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p>We couldn&apos;t hear that clearly, please re-record or type your answer</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={rerecord}>
              Re-record
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAnswerMode("text");
                setTranscriptFailed(false);
              }}
            >
              Type answer
            </Button>
          </div>
        </div>
      ) : null}

      {activeQuestion && !thinking && !pendingProcessing ? (
        <div className="sticky bottom-0 space-y-2 border-t border-slate-200 bg-[radial-gradient(ellipse_at_top,_#e8eef7_0%,_#f7f5f1_50%)] pt-3">
          {info.mode === "VOICE" ? (
            <div className="flex justify-end">
              <button
                type="button"
                className="text-xs text-slate-500 underline"
                onClick={() =>
                  setAnswerMode((m) => (m === "voice" ? "text" : "voice"))
                }
              >
                {useVoiceUi ? "Switch to typing" : "Switch to voice"}
              </button>
            </div>
          ) : null}

          {useVoiceUi ? (
            <>
              <div className="flex justify-between text-xs text-slate-400">
                <span>
                  {recording ? `Recording ${formatElapsed(elapsed)}` : "Press to record"}
                </span>
                <span>No hard time limit</span>
              </div>
              {recording ? (
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-rose-500 transition-[width]"
                    style={{ width: `${Math.round(recordLevel * 100)}%` }}
                  />
                </div>
              ) : null}
              {!previewUrl ? (
                <Button
                  className="w-full"
                  variant={recording ? "destructive" : "default"}
                  onClick={recording ? stopRecording : startRecording}
                >
                  {recording ? "Stop recording" : "Press to record"}
                </Button>
              ) : (
                <div className="space-y-2">
                  <audio src={previewUrl} controls className="w-full" />
                  <div className="flex gap-2">
                    <Button className="flex-1" onClick={sendAudio}>
                      Send
                    </Button>
                    <Button className="flex-1" variant="outline" onClick={rerecord}>
                      Re-record
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex justify-between text-xs text-slate-400">
                <span>Elapsed {formatElapsed(elapsed)}</span>
                <span>No hard time limit</span>
              </div>
              <Textarea
                ref={textareaRef}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={4}
                placeholder="Type your answer…"
                disabled={thinking}
              />
              <Button
                className="w-full"
                onClick={submitText}
                disabled={!answer.trim() || thinking}
              >
                Submit answer
              </Button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Bubble({ side, text }: { side: "ai" | "me"; text: string }) {
  return (
    <div
      className={cn(
        "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
        side === "ai"
          ? "mr-auto bg-white text-slate-800 shadow-sm ring-1 ring-slate-200"
          : "ml-auto bg-slate-900 text-white",
      )}
    >
      {text}
    </div>
  );
}

function Dot({ delay }: { delay?: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
      style={{ animationDelay: delay }}
    />
  );
}

function formatElapsed(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
