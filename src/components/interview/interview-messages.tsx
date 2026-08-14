"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import styles from "./interview-ui.module.css";

export type InterviewChatMessage = {
  id: string;
  role: "ai" | "candidate";
  text: string;
  sequence: number;
  isCurrentQuestion: boolean;
  isLiveAnswer: boolean;
};

function splitPhrases(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const words = trimmed.split(/\s+/);
  if (words.length <= 5) return [trimmed];
  const size = words.length > 40 ? 5 : 4;
  const groups: string[] = [];
  for (let i = 0; i < words.length; i += size) {
    groups.push(words.slice(i, i + size).join(" "));
  }
  return groups;
}

function RevealedText({
  text,
  animate,
  reducedMotion,
}: {
  text: string;
  animate: boolean;
  reducedMotion: boolean;
}) {
  const phrases = useMemo(() => splitPhrases(text), [text]);
  const [count, setCount] = useState(
    animate && !reducedMotion ? 0 : phrases.length,
  );

  useEffect(() => {
    if (!animate || reducedMotion) {
      setCount(phrases.length);
      return;
    }
    setCount(0);
    const step = Math.max(
      40,
      Math.min(120, Math.floor(2000 / Math.max(phrases.length, 1))),
    );
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setCount(i);
      if (i >= phrases.length) window.clearInterval(id);
    }, step);
    return () => window.clearInterval(id);
  }, [animate, reducedMotion, phrases]);

  return <>{phrases.slice(0, Math.max(count, 0)).join(" ")}</>;
}

export function InterviewMessages({
  messages,
  reducedMotion,
  replayButton,
  resumeHistory,
}: {
  messages: InterviewChatMessage[];
  reducedMotion: boolean;
  replayButton?: ReactNode;
  /** True when the room opened with existing answered turns — skip entrance/reveal. */
  resumeHistory: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [showPill, setShowPill] = useState(false);
  const initialIdsRef = useRef<Set<string> | null>(null);
  if (initialIdsRef.current === null) {
    initialIdsRef.current = resumeHistory
      ? new Set(messages.map((m) => m.id))
      : new Set();
  }

  const signature = messages.map((m) => `${m.id}:${m.text.length}`).join("|");

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (pinned) {
      el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
      setShowPill(false);
    } else {
      setShowPill(true);
    }
  }, [signature, pinned, reducedMotion]);

  function onScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = dist < 80;
    setPinned(atBottom);
    if (atBottom) setShowPill(false);
  }

  function jumpToLatest() {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
    setPinned(true);
    setShowPill(false);
  }

  let lastAiTurn = -1;

  return (
    <div className="relative min-h-[10rem] flex-1">
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        tabIndex={0}
        role="log"
        aria-label="Interview conversation"
        aria-live="polite"
        className="absolute inset-0 overflow-y-auto overflow-x-hidden overscroll-contain pr-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col justify-end gap-3 py-2">
          {messages.map((m) => {
            const isNew = !initialIdsRef.current!.has(m.id);
            const dim = !m.isCurrentQuestion && !m.isLiveAnswer;
            const showAiLabel = m.role === "ai" && m.sequence !== lastAiTurn;
            if (m.role === "ai") lastAiTurn = m.sequence;
            return (
              <div
                key={m.id}
                className={cn(
                  "flex flex-col",
                  m.role === "ai" ? "items-start" : "items-end",
                  dim ? styles.msgDim : styles.msgLive,
                  isNew && !reducedMotion && styles.msgEnter,
                )}
              >
                {showAiLabel ? (
                  <span className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    AI Interviewer
                  </span>
                ) : null}
                <div
                  className={cn(
                    "text-[15px] leading-[1.6]",
                    m.role === "ai"
                      ? "max-w-[680px] rounded-[20px] border border-slate-300/50 bg-slate-100/90 px-[18px] py-[14px] text-slate-900 backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60 dark:text-slate-50"
                      : "max-w-[560px] rounded-[20px] bg-[#2563EB] px-4 py-3 text-white",
                  )}
                >
                  {m.role === "ai" && m.isCurrentQuestion && isNew ? (
                    <RevealedText
                      text={m.text}
                      animate
                      reducedMotion={reducedMotion}
                    />
                  ) : (
                    m.text
                  )}
                </div>
                {m.isCurrentQuestion && replayButton ? (
                  <div className="mt-2">{replayButton}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {showPill ? (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-white/10 bg-slate-800/90 px-3 py-1.5 text-xs font-medium text-white shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          ↓ New message
        </button>
      ) : null}
    </div>
  );
}
