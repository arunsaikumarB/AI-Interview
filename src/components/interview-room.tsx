"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PreInterviewSystemCheck } from "@/components/pre-interview-system-check";
import { ProctoringConsent } from "@/components/proctoring-consent";
import { EnhancedProctoringSetup } from "@/components/enhanced-proctoring-setup";
import { IntegrityNotice } from "@/components/integrity-notice";
import {
  FullscreenRequiredGate,
  IntegrityTerminatedScreen,
  IntegrityWarningDialog,
} from "@/components/integrity-ui";
import { CandidateQuestions } from "@/components/candidate-questions";
import {
  createProctoringCollector,
  type ProctoringClientType,
  type ProctoringCollector,
} from "@/lib/proctoring";
import {
  createIntegrityEpisodeController,
  type IntegrityEpisodeController,
} from "@/lib/integrity-episode";
import { STRICT_POLICY } from "@/lib/integrity";
import { BrandLogo } from "@/components/brand-logo";
import { AIInterviewOrb } from "@/components/interview/ai-interview-orb";
import { InterviewMessages, type InterviewChatMessage } from "@/components/interview/interview-messages";
import { InterviewMicControl } from "@/components/interview/interview-mic-control";
import { useOrbState, usePrefersReducedMotion } from "@/components/interview/orb-state";

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
  durationMinutes?: number | null;
  endsAt?: string | null;
  instructions: string;
  concluded: boolean;
  mode: "TEXT" | "VOICE";
  proctoringEnabled?: boolean;
  proctoringMode?: string;
  proctoringConsentAt?: string | null;
  secondaryPlacementConfirmed?: boolean;
  integrityMode?: "STANDARD" | "STRICT";
  integrityConsentAt?: string | null;
};

function formatRemaining(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

type AnswerMode = "voice" | "text";

function buildInterviewMessages(opts: {
  answeredTurns: Turn[];
  activeQuestion: { sequence: number; question: string } | null;
  heardLabel: string | null;
  thinking: boolean;
  voiceMode: boolean;
}): InterviewChatMessage[] {
  const out: InterviewChatMessage[] = [];
  for (const t of opts.answeredTurns) {
    out.push({
      id: `ai-${t.sequence}`,
      role: "ai",
      text: t.question,
      sequence: t.sequence,
      isCurrentQuestion: false,
      isLiveAnswer: false,
    });
    if (t.answerText) {
      out.push({
        id: `me-${t.sequence}`,
        role: "candidate",
        text: opts.voiceMode ? `Heard: ${t.answerText}` : t.answerText,
        sequence: t.sequence,
        isCurrentQuestion: false,
        isLiveAnswer: false,
      });
    }
  }
  if (opts.activeQuestion) {
    out.push({
      id: `ai-${opts.activeQuestion.sequence}`,
      role: "ai",
      text: opts.activeQuestion.question,
      sequence: opts.activeQuestion.sequence,
      isCurrentQuestion: true,
      isLiveAnswer: false,
    });
    if (opts.heardLabel && opts.thinking) {
      out.push({
        id: `me-live-${opts.activeQuestion.sequence}`,
        role: "candidate",
        text: `Heard: ${opts.heardLabel}`,
        sequence: opts.activeQuestion.sequence,
        isCurrentQuestion: false,
        isLiveAnswer: true,
      });
    }
  }
  return out;
}

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
  const [systemCheckReady, setSystemCheckReady] = useState(false);
  const [enhancedSetupReady, setEnhancedSetupReady] = useState(false);
  const [preferText, setPreferText] = useState(false);
  const [answerMode, setAnswerMode] = useState<AnswerMode>("voice");
  const [recording, setRecording] = useState(false);
  const [, setRecordLevel] = useState(0);
  const [transcriptFailed, setTranscriptFailed] = useState(false);
  const [heardLabel, setHeardLabel] = useState<string | null>(null);
  const [proctoringConsented, setProctoringConsented] = useState(false);
  const [integrityConsented, setIntegrityConsented] = useState(false);
  const [fullscreenReady, setFullscreenReady] = useState(false);
  const [integrityWarning, setIntegrityWarning] = useState<{
    message: string;
    warningNumber: number;
    warningOf: number;
    source: "strict" | "secondary";
  } | null>(null);
  const [integrityTerminated, setIntegrityTerminated] = useState(false);
  const [cameraAllowed, setCameraAllowed] = useState(false);
  const [focusNudge, setFocusNudge] = useState<string | null>(null);
  const [postPhase, setPostPhase] = useState<"questions" | "thanks" | null>(null);
  const [remainingLabel, setRemainingLabel] = useState<string | null>(null);
  const [timeUp, setTimeUp] = useState(false);
  const startedAt = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mediaRec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const levelRaf = useRef(0);
  const questionAudioRef = useRef<HTMLAudioElement | null>(null);
  const proctorRef = useRef<ProctoringCollector | null>(null);
  const integrityRef = useRef<IntegrityEpisodeController | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const hiddenSinceRef = useRef<number | null>(null);
  const nudgeCountRef = useRef(0);
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceModeRef = useRef(false);
  const currentRef = useRef(current);
  currentRef.current = current;

  const sessionIsVoice = info?.mode === "VOICE" && !preferText;
  const useVoiceUi = sessionIsVoice && answerMode === "voice";
  voiceModeRef.current = Boolean(info?.mode === "VOICE");

  const visualQuestion =
    current ??
    (() => {
      const open = turns.find((t) => t.answerText == null);
      return open ? { sequence: open.sequence, question: open.question } : null;
    })();
  const reducedMotion = usePrefersReducedMotion();
  const { orbState, statusLabel } = useOrbState({
    concluded: concluded || info?.status === "COMPLETED",
    status: info?.status,
    thinking,
    pendingProcessing,
    recording,
    hasActiveQuestion: visualQuestion != null,
    hasError: Boolean(error),
    questionSequence: visualQuestion?.sequence ?? null,
    answeredCount: turns.filter((t) => t.answerText != null).length,
  });

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
      const strict = info?.integrityMode === "STRICT";
      const episode = integrityRef.current;

      if (strict && episode) {
        if (type === "TAB_BLUR" || (type === "WINDOW_SWITCH" && meta?.kind === "blur")) {
          episode.onLoss();
          return;
        }
        if (
          type === "TAB_FOCUS" ||
          (type === "WINDOW_SWITCH" && meta?.kind === "focus")
        ) {
          episode.onReturn();
          return;
        }
        if (type === "FULLSCREEN_EXIT") {
          episode.reportImmediate("FULLSCREEN_EXIT");
          return;
        }
        if (type === "COPY_PASTE") {
          const len =
            typeof meta?.pastedLength === "number" ? meta.pastedLength : 0;
          episode.reportImmediate("PASTE", { pastedLength: len });
          return;
        }
        return;
      }

      // STANDARD: soft nudge only — never terminate from the client.
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
    [token, info?.integrityMode],
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
            durationMinutes: data.durationMinutes ?? prev.durationMinutes,
            endsAt: data.endsAt ?? prev.endsAt,
            concluded: data.concluded,
          }
        : {
            status: data.status,
            mode: data.mode === "VOICE" ? "VOICE" : "TEXT",
            jobTitle: data.jobTitle,
            candidateFirstName: data.candidateFirstName,
            maxQuestions: data.maxQuestions,
            durationMinutes: data.durationMinutes ?? null,
            endsAt: data.endsAt ?? null,
            instructions: "",
            concluded: data.concluded,
          },
    );
    if (data.terminated || data.status === "TERMINATED") {
      setIntegrityTerminated(true);
    }
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
        proctoringMode: data.proctoringMode ?? "OFF",
        proctoringConsentAt: data.proctoringConsentAt ?? null,
        secondaryPlacementConfirmed: Boolean(data.secondaryPlacementConfirmed),
        integrityMode: data.integrityMode === "STRICT" ? "STRICT" : "STANDARD",
        integrityConsentAt: data.integrityConsentAt ?? null,
      });
      setConcluded(Boolean(data.concluded));
      if (data.terminated || data.status === "TERMINATED") {
        setIntegrityTerminated(true);
        setSystemCheckReady(true);
        setEnhancedSetupReady(true);
        setIntegrityConsented(true);
        setFullscreenReady(true);
      } else if (data.pendingIntegrityWarning) {
        setIntegrityWarning({
          message: data.pendingIntegrityWarning.message,
          warningNumber: data.pendingIntegrityWarning.warningNumber,
          warningOf: data.pendingIntegrityWarning.warningOf,
          source: "secondary",
        });
      }
      if (data.proctoringConsentAt) {
        setProctoringConsented(true);
        if (typeof data.cameraConsent === "boolean") {
          setCameraAllowed(data.cameraConsent);
        }
      }
      if (data.integrityConsentAt) {
        setIntegrityConsented(true);
      }
      if (data.secondaryPlacementConfirmed) {
        setEnhancedSetupReady(true);
      }
      if (data.mode !== "VOICE") {
        setPreferText(true);
        setAnswerMode("text");
      }
      // Resume / completed: skip system check (session already underway).
      if (
        data.status === "IN_PROGRESS" ||
        data.status === "COMPLETED" ||
        data.status === "TERMINATED"
      ) {
        setSystemCheckReady(true);
        setEnhancedSetupReady(true);
        setFullscreenReady(true);
        if (data.status === "IN_PROGRESS" || data.status === "COMPLETED") {
          await loadState();
        }
      } else {
        try {
          if (sessionStorage.getItem(`aros-syscheck-${token}`) === "1") {
            setSystemCheckReady(true);
          }
          if (sessionStorage.getItem(`aros-enhanced-${token}`) === "1") {
            setEnhancedSetupReady(true);
          }
        } catch {
          /* ignore */
        }
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

  // Strict integrity episode controller (server-authoritative warnings / terminate)
  useEffect(() => {
    if (
      info?.integrityMode !== "STRICT" ||
      !integrityConsented ||
      info.status !== "IN_PROGRESS" ||
      integrityTerminated ||
      concluded
    ) {
      integrityRef.current?.dispose();
      integrityRef.current = null;
      return;
    }

    const controller = createIntegrityEpisodeController({
      token,
      enabled: true,
      onResult: (result) => {
        if (result.terminated) {
          setIntegrityTerminated(true);
          setInfo((prev) =>
            prev ? { ...prev, status: "TERMINATED" } : prev,
          );
          setIntegrityWarning(null);
          return;
        }
        if (result.showWarning) {
          const message =
            result.kind === "PASTE"
              ? "External paste was detected in the interview window."
              : result.kind === "FULLSCREEN_EXIT"
                ? "Fullscreen was exited."
                : "Your interview window lost focus.";
          setIntegrityWarning({
            message,
            warningNumber: result.warningNumber,
            warningOf: result.warningOf,
            source: "strict",
          });
        }
      },
    });
    integrityRef.current = controller;
    return () => {
      controller.dispose();
      integrityRef.current = null;
    };
  }, [
    info?.integrityMode,
    info?.status,
    integrityConsented,
    integrityTerminated,
    concluded,
    token,
  ]);

  // Poll server status while interview is active (Strict + Enhanced terminate / warnings)
  useEffect(() => {
    if (info?.status !== "IN_PROGRESS" || integrityTerminated) {
      return;
    }
    const tick = async () => {
      try {
        const res = await fetch(`/api/interview/${token}`);
        const data = await res.json();
        if (data.status === "TERMINATED" || data.terminated) {
          setIntegrityTerminated(true);
          setInfo((prev) =>
            prev ? { ...prev, status: "TERMINATED" } : prev,
          );
          setIntegrityWarning(null);
          return;
        }
        const pending = data.pendingIntegrityWarning as
          | {
              message: string;
              warningNumber: number;
              warningOf: number;
            }
          | null
          | undefined;
        if (pending) {
          setIntegrityWarning({
            message: pending.message,
            warningNumber: pending.warningNumber,
            warningOf: pending.warningOf,
            source: "secondary",
          });
        } else {
          setIntegrityWarning((prev) =>
            prev?.source === "secondary" ? null : prev,
          );
        }
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = setInterval(
      () => void tick(),
      info?.proctoringMode === "ENHANCED" ? 2_000 : 8_000,
    );
    return () => clearInterval(id);
  }, [info?.status, info?.proctoringMode, integrityTerminated, token]);

  // Start / stop proctoring collectors while IN_PROGRESS
  useEffect(() => {
    if (
      !info?.proctoringEnabled ||
      !proctoringConsented ||
      info.status !== "IN_PROGRESS" ||
      concluded ||
      integrityTerminated
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
    integrityTerminated,
    handleProctorEvent,
  ]);

  useEffect(() => {
    proctorRef.current?.watchPasteTarget(textareaRef.current);
  }, [answerMode, current?.sequence]);

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

  useEffect(() => {
    if (!info?.endsAt || concluded) {
      setRemainingLabel(null);
      return;
    }
    const tick = () => {
      const ms = new Date(info.endsAt!).getTime() - Date.now();
      setRemainingLabel(formatRemaining(ms));
      setTimeUp(ms <= 0);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [info?.endsAt, concluded]);

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

  async function recordIntegrityConsent() {
    const res = await fetch(`/api/interview/${token}/integrity/consent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acknowledged: true }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error ?? "Consent failed");
    }
    setIntegrityConsented(true);
    setInfo((prev) =>
      prev
        ? {
            ...prev,
            integrityConsentAt: data.consentedAt ?? new Date().toISOString(),
          }
        : prev,
    );
  }

  async function recordConsent(
    cameraConsent: boolean,
    recordingConsent = false,
  ) {
    const res = await fetch(`/api/interview/${token}/proctoring/consent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        acknowledged: true,
        cameraConsent,
        ...(info?.proctoringMode === "ENHANCED" || recordingConsent
          ? { recordingConsent: true }
          : {}),
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
      if (data.terminated || res.status === 410) {
        setIntegrityTerminated(true);
        setInfo((prev) =>
          prev ? { ...prev, status: "TERMINATED" } : prev,
        );
        return;
      }
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
      if (data.terminated || data.status === "TERMINATED") {
        setIntegrityTerminated(true);
        await loadState();
        return;
      }
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
      setRecording(false);
      void sendAudioBlob(blob);
    };
    rec.start();
    setRecording(true);
  }

  function stopRecording() {
    if (mediaRec.current?.state === "recording") {
      mediaRec.current.stop();
    }
  }

  async function sendAudioBlob(blob: Blob) {
    const q = currentRef.current;
    if (!blob || !q) return;
    setThinking(true);
    setError(null);
    setTranscriptFailed(false);
    const form = new FormData();
    form.append("audio", blob, `a${q.sequence}.webm`);
    const res = await fetch(`/api/interview/${token}/answer-audio`, {
      method: "POST",
      body: form,
    });
    const data = await res.json();
    setThinking(false);

    if (res.status === 503 && data.speechDown) {
      setAnswerMode("text");
      setError("Speech service is offline. Continue by typing your answer.");
      return;
    }

    if (data.transcriptFailed) {
      setAnswerMode("text");
      setTranscriptFailed(true);
      return;
    }

    if (res.status === 503 && data.retryable) {
      setHeardLabel(data.transcript ?? null);
      setError(
        data.ollamaDown
          ? "AI is offline — your answer was saved. Retry when ready."
          : "AI is busy — your answer was saved. Retry processing.",
      );
      await loadState();
      return;
    }

    if (!res.ok) {
      setError(data.error ?? "Send failed");
      return;
    }

    const heard = data.transcript as string;
    setHeardLabel(heard);

    if (data.concluded) {
      setConcluded(true);
      setCurrent(null);
      await loadState();
      return;
    }

    setTurns((prev) => [
      ...prev.filter((t) => t.sequence !== q.sequence),
      {
        sequence: q.sequence,
        question: q.question,
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
      <div className="mx-auto max-w-lg rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-destructive">
        <div className="mb-3 text-foreground">
          <BrandLogo size="header" />
        </div>
        <p className="font-medium">Unable to open interview</p>
        <p className="mt-2 text-sm">{error}</p>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="mx-auto max-w-lg space-y-3 p-6 text-center">
        <BrandLogo size="header" />
        <p className="text-sm text-muted-foreground">Loading interview…</p>
      </div>
    );
  }

  if (integrityTerminated || info.status === "TERMINATED") {
    return <IntegrityTerminatedScreen />;
  }

  if (concluded || info.status === "COMPLETED") {
    if (postPhase === "questions" || postPhase == null) {
      return (
        <CandidateQuestions token={token} onDone={finishToThanks} />
      );
    }
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <BrandLogo size="header" />
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Thank you</h1>
        <p className="mt-3 text-muted-foreground">
          Your interview for <strong>{info.jobTitle}</strong> is complete. The team will get
          back to you.
        </p>
        <p className="mt-6 text-sm text-muted-foreground">You can close this tab.</p>
      </div>
    );
  }

  // Pre-interview system check before consent / start (SCHEDULED only).
  if (!systemCheckReady && info.status === "SCHEDULED") {
    return (
      <PreInterviewSystemCheck
        mode={info.mode}
        proctoringEnabled={Boolean(info.proctoringEnabled)}
        onContinue={() => {
          try {
            sessionStorage.setItem(`aros-syscheck-${token}`, "1");
          } catch {
            /* ignore */
          }
          setSystemCheckReady(true);
          if (info.mode === "VOICE") setAnswerMode("voice");
        }}
        onUseText={
          info.mode === "VOICE"
            ? () => {
                try {
                  sessionStorage.setItem(`aros-syscheck-${token}`, "1");
                } catch {
                  /* ignore */
                }
                setPreferText(true);
                setSystemCheckReady(true);
                setAnswerMode("text");
              }
            : undefined
        }
      />
    );
  }

  if (
    info.proctoringEnabled &&
    !proctoringConsented &&
    info.status !== "COMPLETED" &&
    info.status !== "CANCELLED" &&
    info.status !== "TERMINATED"
  ) {
    return (
      <ProctoringConsent
        enhanced={info.proctoringMode === "ENHANCED"}
        onContinue={async (allowCamera, recordingConsent) => {
          await recordConsent(allowCamera, recordingConsent);
        }}
      />
    );
  }

  if (
    info.integrityMode === "STRICT" &&
    !integrityConsented &&
    info.status !== "COMPLETED" &&
    info.status !== "CANCELLED" &&
    info.status !== "TERMINATED"
  ) {
    return <IntegrityNotice onContinue={recordIntegrityConsent} />;
  }

  if (
    info.proctoringMode === "ENHANCED" &&
    !enhancedSetupReady &&
    info.status === "SCHEDULED"
  ) {
    return (
      <EnhancedProctoringSetup
        token={token}
        onReady={() => {
          try {
            sessionStorage.setItem(`aros-enhanced-${token}`, "1");
          } catch {
            /* ignore */
          }
          setEnhancedSetupReady(true);
        }}
      />
    );
  }

  if (
    info.integrityMode === "STRICT" &&
    STRICT_POLICY.requireFullscreen &&
    !fullscreenReady &&
    info.status === "SCHEDULED"
  ) {
    return (
      <FullscreenRequiredGate
        onEntered={() => {
          setFullscreenReady(true);
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
      <div className="mx-auto max-w-lg rounded-2xl border border-border bg-card p-8 shadow-sm">
        <BrandLogo size="header" />
        <p className="mt-2 text-sm uppercase tracking-wide text-muted-foreground">
          {info.mode === "VOICE" ? "Voice interview" : "Text interview"}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{info.jobTitle}</h1>
        <p className="mt-4 text-muted-foreground">
          Hi {info.candidateFirstName}. You&apos;ll get about {info.maxQuestions} questions
          {info.durationMinutes ? ` within ${info.durationMinutes} minutes` : ""}.
          {info.mode === "VOICE"
            ? " Answer by voice. You may switch to typing once — you cannot switch back to voice, and you cannot re-record."
            : " Answer in text — take your time."}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">{info.instructions}</p>
        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        <Button className="mt-6 w-full" onClick={start} disabled={thinking}>
          {thinking ? "Starting…" : "Start interview"}
        </Button>
      </div>
    );
  }

  const chatMessages = buildInterviewMessages({
    answeredTurns,
    activeQuestion,
    heardLabel,
    thinking,
    voiceMode: info.mode === "VOICE",
  });
  const interviewCode = String(
    activeQuestion?.sequence ?? Math.max(answeredTurns.length, 1),
  ).padStart(2, "0");

  return (
    <div className="relative mx-auto flex h-[calc(100dvh-2rem)] min-h-0 w-full max-w-3xl flex-col overflow-hidden md:h-[calc(100dvh-1.5rem)]">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-20 size-64 -translate-x-1/2 rounded-full bg-[#2563EB]/[0.06]"
      />
      <IntegrityWarningDialog
        open={integrityWarning != null}
        warningNumber={integrityWarning?.warningNumber ?? 1}
        warningOf={integrityWarning?.warningOf ?? 3}
        message={
          integrityWarning?.message ?? "Your interview window lost focus."
        }
        stayHint={
          integrityWarning?.source === "secondary"
            ? "This stays on screen until you fix it and confirm. You have 3 chances."
            : "Please remain on the interview screen for the rest of the interview."
        }
        onDismiss={() => {
          if (integrityWarning?.source === "secondary") {
            void fetch(`/api/interview/${token}/integrity/ack`, {
              method: "POST",
            });
          }
          setIntegrityWarning(null);
        }}
      />
      {focusNudge ? (
        <div
          role="status"
          className="relative z-10 mb-2 shrink-0 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground"
        >
          {focusNudge}
        </div>
      ) : null}

      <header className="relative z-10 flex shrink-0 items-start justify-between gap-4 pb-2">
        <div className="min-w-0">
          <BrandLogo size="mark" />
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            {info.jobTitle}
          </p>
        </div>
        <div className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          <p>
            Interview {interviewCode}
            {info.mode === "VOICE" ? ` · ${useVoiceUi ? "Voice" : "Typing"}` : ""}
          </p>
          {remainingLabel != null ? (
            <p className="mt-0.5">{remainingLabel}</p>
          ) : null}
        </div>
      </header>
      {timeUp && !concluded ? (
        <p className="relative z-10 mb-2 shrink-0 text-sm text-warning">
          Time is up — submit your current answer to finish the interview.
        </p>
      ) : null}

      <div className="relative z-10 flex shrink-0 justify-center py-1 md:py-2">
        <AIInterviewOrb
          state={orbState}
          reducedMotion={reducedMotion}
          statusLabel={statusLabel}
        />
      </div>

      <InterviewMessages
        messages={chatMessages}
        reducedMotion={reducedMotion}
        resumeHistory={answeredTurns.length > 0}
        replayButton={
          useVoiceUi && activeQuestion ? (
            <Button size="sm" variant="outline" type="button" onClick={replayQuestion}>
              Replay question
            </Button>
          ) : undefined
        }
      />

      {error || pendingProcessing ? (
        <div className="relative z-10 mb-2 shrink-0 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground">
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
        <div className="relative z-10 mb-2 shrink-0 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground">
          <p>
            We couldn&apos;t hear that clearly. Continue by typing your answer —
            re-recording is not available.
          </p>
        </div>
      ) : null}

      {activeQuestion && !thinking && !pendingProcessing ? (
        <div className="relative z-10 mt-2 shrink-0 space-y-3 rounded-2xl p-4">
          {info.mode === "VOICE" && useVoiceUi ? (
            <div className="flex justify-end">
              <button
                type="button"
                className="text-xs text-muted-foreground underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setAnswerMode("text")}
              >
                Switch to typing
              </button>
            </div>
          ) : null}

          {useVoiceUi ? (
            <div className="flex flex-col items-center gap-2">
              <InterviewMicControl
                recording={recording}
                thinking={thinking}
                reducedMotion={reducedMotion}
                elapsedLabel={formatElapsed(elapsed)}
                onToggle={recording ? stopRecording : startRecording}
              />
              <p className="text-[11px] text-muted-foreground">No hard time limit</p>
            </div>
          ) : (
            <div className="glass-panel space-y-3 rounded-2xl p-4">
              <div className="flex justify-between text-xs text-muted-foreground">
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
                className="min-h-28 resize-y"
              />
              <Button
                className="h-11 w-full"
                onClick={submitText}
                disabled={!answer.trim() || thinking}
              >
                Submit answer
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function formatElapsed(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
