"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { InterviewMicControl } from "@/components/interview/interview-mic-control";
import { useInterviewThinkingOrb, usePrefersReducedMotion } from "@/components/interview/orb-state";
import { PrimaryCameraPanel } from "@/components/interview/primary-camera-preview";
import { InterviewStatusRail } from "@/components/interview/interview-status-rail";
import { usePrimaryCamera } from "@/components/interview/use-primary-camera";
import { readStoredPrimaryDeviceId } from "@/lib/primary-camera";
import { postFormDataWithUploadLifecycle } from "@/lib/interview-answer-upload";
import { Shield, HelpCircle, Mic, LogOut } from "lucide-react";

const FOCUS_NUDGE_COPY =
  "Please stay focused on the interview â€” activity signals are shared with the recruiter.";
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
  departmentName?: string | null;
  experienceLabel?: string | null;
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
  /** True while question TTS / replay audio is playing (drives orb breathing). */
  const [aiSpeaking, setAiSpeaking] = useState(false);
  /** True from voice submit until upload body completes (orb composing). */
  const [voiceSubmitting, setVoiceSubmitting] = useState(false);
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
  const [primaryCameraDone, setPrimaryCameraDone] = useState(false);
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
  const wasInProgressRef = useRef(false);
  const hiddenSinceRef = useRef<number | null>(null);
  const nudgeCountRef = useRef(0);
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceModeRef = useRef(false);
  const currentRef = useRef(current);
  currentRef.current = current;

  const sessionIsVoice = info?.mode === "VOICE" && !preferText;
  const useVoiceUi = sessionIsVoice && answerMode === "voice";
  voiceModeRef.current = Boolean(info?.mode === "VOICE");

  const preferredPrimaryDeviceId = useMemo(
    () => readStoredPrimaryDeviceId(token),
    [token],
  );

  useEffect(() => {
    if (info?.status === "IN_PROGRESS") wasInProgressRef.current = true;
  }, [info?.status]);

  const finishingInterview =
    concluded || info?.status === "COMPLETED";
  const primaryCameraEnabled =
    Boolean(cameraAllowed) &&
    !integrityTerminated &&
    !primaryCameraDone &&
    (info?.status === "IN_PROGRESS" ||
      (wasInProgressRef.current && finishingInterview));

  const {
    stream: primaryCameraStream,
    cameraStatus: primaryCameraStatus,
    recordingStatus: primaryRecordingStatus,
    retry: retryPrimaryCamera,
    dismissCamera: dismissPrimaryCamera,
    finalizeRecording: finalizePrimaryCameraRecording,
  } = usePrimaryCamera({
    enabled: primaryCameraEnabled,
    token,
    preferredDeviceId: preferredPrimaryDeviceId,
    record: Boolean(cameraAllowed),
  });

  useEffect(() => {
    if (!finishingInterview || !wasInProgressRef.current || primaryCameraDone) {
      return;
    }
    let cancelled = false;
    void (async () => {
      await finalizePrimaryCameraRecording();
      if (!cancelled) setPrimaryCameraDone(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    finishingInterview,
    primaryCameraDone,
    finalizePrimaryCameraRecording,
  ]);

  const reducedMotion = usePrefersReducedMotion();
  const { orbState, statusLabel, heading, guidance, phase } =
    useInterviewThinkingOrb({
      aiSpeaking,
      candidateRecording: recording,
      voiceSubmitting,
      processing: Boolean(thinking || pendingProcessing) && !voiceSubmitting,
      concluded: concluded || info?.status === "COMPLETED",
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

      // STANDARD: soft nudge only â€” never terminate from the client.
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
          /* TTS optional â€” banner still shown */
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
        "AI is still processing your last answer â€” your text was saved. Retry when ready.",
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
            departmentName: data.departmentName ?? prev.departmentName,
            experienceLabel: data.experienceLabel ?? prev.experienceLabel,
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
            departmentName: data.departmentName ?? null,
            experienceLabel: data.experienceLabel ?? null,
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

    return () => {
      collector.stop();
      proctorRef.current = null;
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

  // Share the primary camera stream with face-signal sampling (no second getUserMedia).
  useEffect(() => {
    const collector = proctorRef.current;
    if (!collector || !cameraAllowed || !primaryCameraStream) return;
    void collector.enableCamera(primaryCameraStream);
  }, [cameraAllowed, primaryCameraStream]);

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

  // Auto-play question TTS in voice mode — orb breathing tracks real playback.
  useEffect(() => {
    if (!useVoiceUi || activeSequence == null || thinking || voiceSubmitting) {
      return;
    }
    const url = `/api/interview/${token}/question-audio/${activeSequence}`;
    const audio = new Audio(url);
    questionAudioRef.current = audio;

    const markSpeaking = () => setAiSpeaking(true);
    const markSilent = () => setAiSpeaking(false);

    audio.addEventListener("play", markSpeaking);
    audio.addEventListener("playing", markSpeaking);
    audio.addEventListener("ended", markSilent);
    audio.addEventListener("pause", () => {
      if (audio.ended || audio.currentTime === 0) markSilent();
    });
    audio.addEventListener("error", markSilent);

    void audio.play().then(markSpeaking).catch(markSilent);

    return () => {
      audio.removeEventListener("play", markSpeaking);
      audio.removeEventListener("playing", markSpeaking);
      audio.removeEventListener("ended", markSilent);
      audio.removeEventListener("error", markSilent);
      audio.pause();
      questionAudioRef.current = null;
      setAiSpeaking(false);
    };
  }, [useVoiceUi, activeSequence, activeQuestionText, token, thinking, voiceSubmitting]);

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
      // No answer saved yet (e.g. speech was down) â€” refresh room, don't look like an outage.
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
      setError(data.error ?? "Still processing â€” retry shortly");
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
          ? "AI is offline â€” your answer was saved. Retry when ready."
          : "AI is busy â€” your answer was saved. Retry processing.",
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
      // Candidate submitted — switch orb to composing before upload starts.
      setVoiceSubmitting(true);
      setAiSpeaking(false);
      mediaRec.current.stop();
    }
  }

  async function sendAudioBlob(blob: Blob) {
    const q = currentRef.current;
    if (!blob || !q) return;
    // Immediate: candidate submitted → composing (until upload body finishes).
    setVoiceSubmitting(true);
    setAiSpeaking(false);
    setThinking(true);
    setError(null);
    setTranscriptFailed(false);
    const form = new FormData();
    form.append("audio", blob, `a${q.sequence}.webm`);

    let data: Record<string, unknown> = {};
    let resOk = false;
    let resStatus = 0;
    try {
      const result = await postFormDataWithUploadLifecycle(
        `/api/interview/${token}/answer-audio`,
        form,
        () => {
          // Upload finished — server is transcribing / understanding → connecting.
          setVoiceSubmitting(false);
        },
      );
      resOk = result.ok;
      resStatus = result.status;
      data = result.data;
    } catch {
      setVoiceSubmitting(false);
      setThinking(false);
      setError("Send failed");
      return;
    }

    // Stay in connecting (thinking) while we apply the response / next question.
    setVoiceSubmitting(false);

    if (resStatus === 503 && data.speechDown) {
      setThinking(false);
      setAnswerMode("text");
      setError("Speech service is offline. Continue by typing your answer.");
      return;
    }

    if (data.transcriptFailed) {
      setThinking(false);
      setAnswerMode("text");
      setTranscriptFailed(true);
      return;
    }

    if (resStatus === 503 && data.retryable) {
      setHeardLabel((data.transcript as string) ?? null);
      setError(
        data.ollamaDown
          ? "AI is offline — your answer was saved. Retry when ready."
          : "AI is busy — your answer was saved. Retry processing.",
      );
      setThinking(false);
      await loadState();
      return;
    }

    if (!resOk) {
      setThinking(false);
      setError((data.error as string) ?? "Send failed");
      return;
    }

    const heard = data.transcript as string;
    setHeardLabel(heard);

    if (data.concluded) {
      setThinking(false);
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
    setCurrent(data.nextQuestion as { sequence: number; question: string });
    setHeardLabel(null);
    setThinking(false);
  }

  function replayQuestion() {
    if (!current) return;
    questionAudioRef.current?.pause();
    const audio = new Audio(
      `/api/interview/${token}/question-audio/${current.sequence}`,
    );
    questionAudioRef.current = audio;
    const markSpeaking = () => setAiSpeaking(true);
    const markSilent = () => setAiSpeaking(false);
    audio.addEventListener("playing", markSpeaking);
    audio.addEventListener("ended", markSilent);
    audio.addEventListener("error", markSilent);
    void audio.play().then(markSpeaking).catch(() => {
      markSilent();
      setError("Could not play question audio");
    });
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
        <p className="text-sm text-muted-foreground">Loading interviewâ€¦</p>
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
        token={token}
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
            ? " Answer by voice. You may switch to typing once â€” you cannot switch back to voice, and you cannot re-record."
            : " Answer in text â€” take your time."}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">{info.instructions}</p>
        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        <Button className="mt-6 w-full" onClick={start} disabled={thinking}>
          {thinking ? "Startingâ€¦" : "Start interview"}
        </Button>
      </div>
    );
  }

  const interviewCode = String(
    activeQuestion?.sequence ?? Math.max(answeredTurns.length, 1),
  ).padStart(2, "0");
  const answeredCount = answeredTurns.length;
  const progressPct = Math.min(
    100,
    Math.round((answeredCount / Math.max(info.maxQuestions, 1)) * 100),
  );
  const micDisabled =
    aiSpeaking || voiceSubmitting || thinking || pendingProcessing;
  const canAnswer =
    Boolean(activeQuestion) && !micDisabled && !transcriptFailed;

  function leaveInterview() {
    if (
      typeof window !== "undefined" &&
      window.confirm(
        "Leave this interview? You can return later with the same link if it is still open.",
      )
    ) {
      window.location.href = "/";
    }
  }

  return (
    <div className="relative mx-auto flex h-[100dvh] min-h-0 w-full max-w-[1400px] flex-col overflow-hidden px-3 py-3 text-zinc-100 md:px-5 md:py-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_rgba(56,89,180,0.18),_transparent_55%),radial-gradient(ellipse_at_bottom_right,_rgba(88,60,160,0.12),_transparent_45%)]"
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
            ? "Please remain focused on the interview. Return to your normal position, then continue."
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

      {/* Header — compact single-row: brand left, interview meta + leave right */}
      <header className="relative z-10 mb-2 flex shrink-0 items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#0b101a]/85 px-3 py-2 backdrop-blur sm:px-4 sm:py-2.5 md:px-5">
        <div className="min-w-0 shrink">
          <BrandLogo
            size="nav"
            className="h-8 w-[min(100%,10.5rem)] justify-start sm:h-9 sm:w-[min(100%,12rem)]"
          />
          <p className="mt-0.5 hidden text-[10px] leading-tight text-zinc-500 sm:block sm:text-[11px]">
            AI-Powered Interview Platform
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3 md:gap-4">
          <div className="min-w-0 text-right">
            <p className="flex items-center justify-end gap-1.5 text-[15px] font-semibold leading-tight tracking-tight text-zinc-100 sm:text-base">
              <Mic
                className="hidden size-3.5 shrink-0 text-sky-400/90 sm:inline"
                aria-hidden
              />
              <span className="truncate">
                Interview {interviewCode}
                <span className="font-normal text-zinc-500">
                  {" "}
                  ·{" "}
                  {info.mode === "VOICE"
                    ? useVoiceUi
                      ? "Voice"
                      : "Typing"
                    : "Text"}
                </span>
              </span>
            </p>
            {remainingLabel != null ? (
              <p className="mt-0.5 text-[13px] tabular-nums leading-tight text-zinc-400 sm:text-sm">
                {remainingLabel}
              </p>
            ) : (
              <p className="mt-0.5 text-[13px] leading-tight text-zinc-500 sm:text-sm">
                In progress
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={leaveInterview}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 text-xs font-medium text-zinc-200 outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-sky-400 sm:h-10 sm:gap-2 sm:px-3 sm:text-sm"
          >
            <LogOut className="size-3.5 shrink-0 sm:size-4" aria-hidden />
            <span className="whitespace-nowrap">Leave Interview</span>
          </button>
        </div>
      </header>

      {focusNudge ? (
        <div
          role="status"
          className="relative z-10 mb-2 shrink-0 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-50"
        >
          {focusNudge}
        </div>
      ) : null}
      {timeUp && !concluded ? (
        <p className="relative z-10 mb-2 shrink-0 text-sm text-amber-200">
          Time is up — submit your current answer to finish the interview.
        </p>
      ) : null}

      <div className="relative z-10 grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,32%)]">
        {/* LEFT */}
        <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
          {/* Context bar */}
          <div className="grid shrink-0 gap-3 sm:grid-cols-[1.2fr_1fr]">
            <div className="rounded-2xl border border-white/10 bg-[#0d121c]/90 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                Role
              </p>
              <p className="mt-1 text-lg font-semibold tracking-tight text-zinc-50 md:text-xl">
                {info.jobTitle}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
                {info.departmentName ? (
                  <span>
                    Department:{" "}
                    <span className="text-zinc-200">{info.departmentName}</span>
                  </span>
                ) : null}
                {info.experienceLabel ? (
                  <span>
                    Experience:{" "}
                    <span className="text-zinc-200">{info.experienceLabel}</span>
                  </span>
                ) : null}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#0d121c]/90 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                  Interview progress
                </p>
                <p className="text-sm font-semibold tabular-nums text-zinc-100">
                  {answeredCount} / {info.maxQuestions}
                </p>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sky-500 to-violet-500 transition-[width] duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-zinc-500">Questions completed</p>
            </div>
          </div>

          {/* Orb + question */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0d121c]/70">
            <div className="shrink-0 px-4 pb-2 pt-4 md:px-6">
              <AIInterviewOrb
                state={orbState}
                heading={heading}
                statusLabel={statusLabel}
                guidance={guidance}
                reducedMotion={reducedMotion}
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2 md:px-6">
              {activeQuestion ? (
                <div className="mx-auto max-w-3xl rounded-2xl border border-sky-400/15 bg-[#111827]/80 px-5 py-5 md:px-6 md:py-6">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-300/80">
                    Current question
                  </p>
                  <p className="mt-3 text-[clamp(1.15rem,2.2vw,1.75rem)] font-medium leading-snug tracking-tight text-zinc-50">
                    {activeQuestion.question}
                  </p>
                </div>
              ) : (
                <div className="mx-auto max-w-3xl rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-5 text-sm text-zinc-400">
                  Preparing the next question…
                </div>
              )}

              {heardLabel ? (
                <div className="mx-auto mt-3 max-w-3xl rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    You
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-300">
                    Heard: {heardLabel}
                  </p>
                </div>
              ) : null}

              {answeredTurns.length > 0 ? (
                <details className="mx-auto mt-3 max-w-3xl">
                  <summary className="cursor-pointer text-xs text-zinc-500 outline-none hover:text-zinc-300">
                    View answered questions ({answeredTurns.length})
                  </summary>
                  <div className="mt-2 space-y-2">
                    {answeredTurns.map((t) => (
                      <div
                        key={t.sequence}
                        className="rounded-lg border border-white/5 bg-black/20 px-3 py-2 text-xs text-zinc-400"
                      >
                        <p className="font-medium text-zinc-300">Q{t.sequence}</p>
                        <p className="mt-1 line-clamp-2">{t.question}</p>
                        {t.answerText ? (
                          <p className="mt-1 line-clamp-2 text-zinc-500">
                            You: {t.answerText}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>

            <div className="shrink-0 border-t border-white/10 px-4 py-4 md:px-6">
              {error || pendingProcessing ? (
                <div className="mb-3 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-50">
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
                    {info.mode === "VOICE" &&
                    error?.toLowerCase().includes("speech") ? (
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
                <div className="mb-3 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-50">
                  We couldn&apos;t hear that clearly. Continue by typing your
                  answer — re-recording is not available.
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-center gap-3">
                {useVoiceUi && activeQuestion ? (
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    onClick={replayQuestion}
                    disabled={recording || thinking || voiceSubmitting}
                    className="border-white/15 bg-transparent text-zinc-300"
                  >
                    Replay question
                  </Button>
                ) : null}

                {info.mode === "VOICE" && useVoiceUi ? (
                  <button
                    type="button"
                    className="text-sm text-zinc-500 underline-offset-4 outline-none hover:text-zinc-300 hover:underline focus-visible:ring-2 focus-visible:ring-sky-400"
                    onClick={() => setAnswerMode("text")}
                  >
                    Switch to typing
                  </button>
                ) : null}
              </div>

              {canAnswer || recording ? (
                <div className="mt-4">
                  {useVoiceUi ? (
                    <InterviewMicControl
                      recording={recording}
                      thinking={thinking || voiceSubmitting}
                      aiSpeaking={aiSpeaking}
                      reducedMotion={reducedMotion}
                      elapsedLabel={formatElapsed(elapsed)}
                      onToggle={recording ? stopRecording : startRecording}
                    />
                  ) : (
                    <div className="mx-auto max-w-xl space-y-3">
                      <Textarea
                        ref={textareaRef}
                        value={answer}
                        onChange={(e) => setAnswer(e.target.value)}
                        rows={4}
                        placeholder="Type your answer…"
                        disabled={thinking}
                        className="min-h-28 resize-y border-white/10 bg-black/30 text-zinc-100"
                      />
                      <Button
                        className="h-11 w-full"
                        onClick={submitText}
                        disabled={!answer.trim() || thinking}
                      >
                        Submit answer
                      </Button>
                      {info.mode === "VOICE" ? (
                        <button
                          type="button"
                          className="w-full text-center text-sm text-zinc-500 underline"
                          onClick={() => setAnswerMode("voice")}
                        >
                          Back to voice
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* RIGHT */}
        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto lg:overflow-hidden">
          <PrimaryCameraPanel
            stream={primaryCameraStream}
            cameraStatus={
              cameraAllowed ? primaryCameraStatus : "unavailable"
            }
            recordingStatus={
              cameraAllowed ? primaryRecordingStatus : "skipped"
            }
            cameraAllowed={cameraAllowed}
            onRetry={
              primaryCameraStatus === "lost" ||
              primaryCameraStatus === "denied" ||
              primaryCameraStatus === "unavailable"
                ? retryPrimaryCamera
                : undefined
            }
            onDismiss={dismissPrimaryCamera}
            className="shrink-0"
          />

          <InterviewStatusRail phase={phase} className="shrink-0" />

          <div className="shrink-0 rounded-2xl border border-white/10 bg-[#0d121c]/90 p-3">
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              Interview tips
            </h2>
            <ul className="space-y-1.5 text-xs leading-relaxed text-zinc-400">
              <li>• Speak clearly and at a normal pace</li>
              <li>• Take your time before answering</li>
              <li>• Provide specific examples from your experience</li>
              <li>• There is no single right answer</li>
            </ul>
          </div>

          <div className="mt-auto flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-2 text-[11px] text-zinc-500">
            <span className="inline-flex items-center gap-1.5">
              <Shield className="size-3.5" aria-hidden />
              Secure session · Activity is monitored for integrity
            </span>
            <span className="inline-flex items-center gap-1.5">
              <HelpCircle className="size-3.5" aria-hidden />
              Need help? Contact your recruiter
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}

function formatElapsed(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
