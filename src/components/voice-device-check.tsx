"use client";

import { PreInterviewSystemCheck } from "@/components/pre-interview-system-check";

/**
 * @deprecated Use PreInterviewSystemCheck — kept as a thin wrapper for voice-only callers.
 */
export function VoiceDeviceCheck({
  onContinue,
  onUseText,
}: {
  onContinue: () => void;
  onUseText: () => void;
}) {
  return (
    <PreInterviewSystemCheck
      mode="VOICE"
      proctoringEnabled={false}
      onContinue={onContinue}
      onUseText={onUseText}
    />
  );
}
