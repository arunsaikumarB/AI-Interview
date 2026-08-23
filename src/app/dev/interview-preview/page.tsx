"use client";

import { useCallback, useEffect, useState } from "react";
import { Mic, LogOut } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { AIInterviewOrb } from "@/components/interview/ai-interview-orb";
import { PrimaryCameraPanel } from "@/components/interview/primary-camera-preview";
import { InterviewStatusRail } from "@/components/interview/interview-status-rail";
import { InterviewMicControl } from "@/components/interview/interview-mic-control";
import {
  deriveInterviewUiPhase,
  thinkingOrbGuidance,
  thinkingOrbHeading,
  thinkingOrbStatusLabel,
  type InterviewThinkingOrbState,
} from "@/components/interview/orb-state";
import type {
  PrimaryCameraUiStatus,
  PrimaryRecordingUiStatus,
} from "@/lib/primary-camera";

const STATES: InterviewThinkingOrbState[] = [
  "breathing",
  "listening",
  "composing",
  "connecting",
];

const SAMPLE_QUESTION =
  "For this HR Business Partner role, how have you used Performance Management Cycles in a real project?";

export default function InterviewPreviewPage() {
  const [orbState, setOrbState] =
    useState<InterviewThinkingOrbState>("breathing");
  const [autoCycle, setAutoCycle] = useState(true);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraStatus, setCameraStatus] =
    useState<PrimaryCameraUiStatus>("idle");
  const [recordingStatus, setRecordingStatus] =
    useState<PrimaryRecordingUiStatus>("idle");
  const [recording, setRecording] = useState(false);

  const startCamera = useCallback(async () => {
    setCameraStatus("requesting");
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      setStream((prev) => {
        prev?.getTracks().forEach((t) => t.stop());
        return media;
      });
      setCameraStatus("previewing");
      setRecordingStatus("recording");
    } catch {
      setCameraStatus("denied");
      setRecordingStatus("idle");
    }
  }, []);

  useEffect(() => {
    void startCamera();
    return () => {
      setStream((prev) => {
        prev?.getTracks().forEach((t) => t.stop());
        return null;
      });
    };
  }, [startCamera]);

  useEffect(() => {
    if (!autoCycle) return;
    const id = window.setInterval(() => {
      setOrbState((prev) => STATES[(STATES.indexOf(prev) + 1) % STATES.length]!);
    }, 2800);
    return () => window.clearInterval(id);
  }, [autoCycle]);

  const phase = deriveInterviewUiPhase({
    aiSpeaking: orbState === "breathing",
    candidateRecording: orbState === "listening" || recording,
    voiceSubmitting: orbState === "composing",
    processing: orbState === "connecting",
  });

  const btn =
    "rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20";
  const btnActive =
    "rounded-lg border border-sky-400/50 bg-sky-500/30 px-3 py-1.5 text-xs font-medium text-white";

  return (
    <div className="min-h-dvh bg-[#070b14] text-zinc-100">
      <div className="relative mx-auto flex h-[100dvh] max-w-[1400px] flex-col overflow-hidden px-3 py-3 md:px-5 md:py-4">
        <header className="mb-2 flex shrink-0 items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#0b101a]/85 px-3 py-2 sm:px-4 sm:py-2.5 md:px-5">
          <div className="min-w-0 shrink">
            <BrandLogo
              size="nav"
              className="h-8 w-[min(100%,10.5rem)] justify-start sm:h-9 sm:w-[min(100%,12rem)]"
            />
            <p className="mt-0.5 hidden text-[10px] leading-tight text-zinc-500 sm:block sm:text-[11px]">
              AI-Powered Interview Platform · UI preview
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3 md:gap-4">
            <div className="min-w-0 text-right">
              <p className="flex items-center justify-end gap-1.5 text-[15px] font-semibold leading-tight text-zinc-100 sm:text-base">
                <Mic
                  className="hidden size-3.5 shrink-0 text-sky-400/90 sm:inline"
                  aria-hidden
                />
                <span className="truncate">Interview 02 · Voice</span>
              </p>
              <p className="mt-0.5 text-[13px] tabular-nums leading-tight text-zinc-400 sm:text-sm">
                28:37
              </p>
            </div>
            <button
              type="button"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 text-xs font-medium text-zinc-200 outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-sky-400 sm:h-10 sm:gap-2 sm:px-3 sm:text-sm"
            >
              <LogOut className="size-3.5 shrink-0 sm:size-4" aria-hidden />
              <span className="whitespace-nowrap">Leave Interview</span>
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,32%)]">
          <div className="flex min-h-0 flex-col gap-3 overflow-hidden rounded-2xl border border-white/10 bg-[#0d121c]/70 p-4">
            <AIInterviewOrb
              state={orbState}
              heading={thinkingOrbHeading(orbState)}
              statusLabel={thinkingOrbStatusLabel(orbState)}
              guidance={thinkingOrbGuidance(orbState)}
            />
            <div className="rounded-2xl border border-sky-400/15 bg-[#111827]/80 px-5 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-300/80">
                Current question
              </p>
              <p className="mt-3 text-xl font-medium leading-snug text-zinc-50 md:text-2xl">
                {SAMPLE_QUESTION}
              </p>
            </div>
            <div className="mt-auto pt-4">
              <InterviewMicControl
                recording={recording || orbState === "listening"}
                thinking={orbState === "composing" || orbState === "connecting"}
                aiSpeaking={orbState === "breathing"}
                reducedMotion={false}
                onToggle={() => setRecording((v) => !v)}
              />
            </div>
          </div>

          <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto">
            <PrimaryCameraPanel
              stream={stream}
              cameraStatus={cameraStatus === "idle" ? "requesting" : cameraStatus}
              recordingStatus={recordingStatus}
              cameraAllowed
              onRetry={() => void startCamera()}
            />
            <InterviewStatusRail phase={phase} />
          </aside>
        </div>
      </div>

      <div className="fixed bottom-4 left-4 z-50 max-w-md space-y-2 rounded-xl border border-sky-400/30 bg-zinc-950/95 p-3">
        <p className="text-xs font-medium text-white">
          Preview {autoCycle ? "(auto-cycling)" : "(manual)"}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {STATES.map((s) => (
            <button
              key={s}
              type="button"
              className={orbState === s ? btnActive : btn}
              onClick={() => {
                setAutoCycle(false);
                setOrbState(s);
              }}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={btn}
          onClick={() => setAutoCycle((v) => !v)}
        >
          {autoCycle ? "Pause" : "Resume"} auto-cycle
        </button>
      </div>
    </div>
  );
}
