"use client";

import { useEffect, useRef, useState } from "react";
import type { SpeakingOrbElement } from "@/types/speaking-orb";
import {
  clampSpeakingOrbLevel,
  speakingOrbParticleCount,
  type SpeakingOrbVisualState,
  type SpeakingOrbWord,
} from "./speaking-orb-state";

const SCRIPT_SRC = "/vendor/speaking-orb/speaking-orb.js";
const SCRIPT_ATTR = "data-hireos-speaking-orb";

function loadSpeakingOrbScript(): Promise<void> {
  if (customElements.get("speaking-orb")) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>(
    `script[${SCRIPT_ATTR}]`,
  );
  if (existing) {
    return customElements.whenDefined("speaking-orb").then(() => undefined);
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.setAttribute(SCRIPT_ATTR, "");
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("speaking-orb failed to load"));
    document.head.appendChild(script);
  });
}

function useSpeakingOrbReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadSpeakingOrbScript()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return ready;
}

function useParticleCount(): number {
  const [count, setCount] = useState(speakingOrbParticleCount({
    width: 1280,
    coarsePointer: false,
  }));
  useEffect(() => {
    const apply = () => {
      setCount(
        speakingOrbParticleCount({
          width: window.innerWidth,
          coarsePointer: window.matchMedia("(pointer: coarse)").matches,
        }),
      );
    };
    apply();
    const mq = window.matchMedia("(pointer: coarse)");
    mq.addEventListener("change", apply);
    window.addEventListener("resize", apply);
    return () => {
      mq.removeEventListener("change", apply);
      window.removeEventListener("resize", apply);
    };
  }, []);
  return count;
}

/**
 * Square slot of `size` px — the same box ThinkingOrb occupies.
 * Built-in captions stay off: the question card under the orb is the
 * readable text. Piper has no word timings, so there is nothing exact to show.
 *
 * Listening level comes from the interview room's existing mic analyser.
 * `listen()` is not used: it would open a second microphone and stop those
 * tracks, which would kill the answer recording.
 */
export function SpeakingOrbView({
  size,
  state,
  rest,
  audio,
  level,
  words,
}: {
  size: number;
  state: SpeakingOrbVisualState;
  rest: SpeakingOrbVisualState;
  audio: HTMLAudioElement | null;
  level: number;
  words: SpeakingOrbWord[] | null;
}) {
  const ready = useSpeakingOrbReady();
  const particles = useParticleCount();
  const ref = useRef<SpeakingOrbElement | null>(null);
  const boundAudio = useRef<HTMLAudioElement | null>(null);
  const restRef = useRef(rest);
  const wordsRef = useRef(words);
  restRef.current = rest;
  wordsRef.current = words;

  useEffect(() => {
    ref.current?.setAttribute("rest", rest);
  }, [rest, ready]);

  useEffect(() => {
    const el = ref.current;
    if (!ready || !el || !audio) return;
    if (boundAudio.current === audio) return;
    boundAudio.current = audio;
    el.setAttribute("rest", restRef.current);
    const timed = wordsRef.current;
    try {
      el.say(" ", {
        audio,
        external: true,
        ...(timed && timed.length > 0 ? { words: timed } : {}),
      });
    } catch {
      // Analyser tap failed. The room still owns playback.
      boundAudio.current = null;
    }
  }, [audio, ready]);

  const safeLevel = clampSpeakingOrbLevel(level).toFixed(3);

  return (
    <div
      className="relative shrink-0 overflow-hidden"
      style={{ width: size, height: size }}
      data-speaking-orb-slot=""
    >
      <speaking-orb
        ref={ref}
        className="absolute inset-0 block h-full w-full"
        state={state}
        rest={rest}
        level={safeLevel}
        particles={String(particles)}
        captions="off"
        aria-hidden="true"
        style={{ ["--cap" as string]: "transparent", ["--cap-dim" as string]: "transparent" }}
      />
    </div>
  );
}
