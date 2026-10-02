"use client";

import { AIInterviewOrb } from "@/components/interview/ai-interview-orb";
import type { InterviewOrbVariant } from "@/lib/interview-orb-flag";
import {
  SPEAKING_ORB_IDLE_LEVEL,
  mapLifecycleToSpeakingOrb,
  speakingOrbRestState,
  type SpeakingOrbWord,
} from "./speaking-orb-state";
import { SpeakingOrbView } from "./speaking-orb-view";
import type { InterviewOrbLifecycle, InterviewThinkingOrbState } from "./orb-state";

type InterviewOrbProps = {
  variant: InterviewOrbVariant;
  state: InterviewThinkingOrbState;
  lifecycle: InterviewOrbLifecycle;
  heading?: string;
  statusLabel?: string;
  guidance?: string;
  reducedMotion?: boolean;
  className?: string;
  size?: number;
  fill?: boolean;
  /** Piper `<audio>` already playing in the room. Null when the AI is silent. */
  audio?: HTMLAudioElement | null;
  /**
   * 0..1 from the room's mic analyser while the candidate is recording.
   * Omit when the mic is not open — the listening pose uses a quiet idle level.
   */
  micLevel?: number | null;
  /** Only if a caller already has timings. The TTS route does not return any. */
  words?: SpeakingOrbWord[] | null;
};

export function InterviewOrb({
  variant,
  lifecycle,
  audio = null,
  micLevel = null,
  words = null,
  ...classic
}: InterviewOrbProps) {
  if (variant === "classic") {
    return <AIInterviewOrb {...classic} variantLabel="classic" />;
  }

  const speakingState = mapLifecycleToSpeakingOrb(lifecycle);
  const rest = speakingOrbRestState(lifecycle);
  const level =
    speakingState === "listening" ? (micLevel ?? SPEAKING_ORB_IDLE_LEVEL) : 0;

  return (
    <AIInterviewOrb
      {...classic}
      variantLabel="speaking"
      badgeLabel={speakingState}
      visual={(size) => (
        <SpeakingOrbView
          size={size}
          state={speakingState}
          rest={rest}
          audio={audio}
          level={level}
          words={words}
        />
      )}
    />
  );
}
