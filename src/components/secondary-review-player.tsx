"use client";

import { useEffect, useState, type MutableRefObject } from "react";

const STORAGE_PREFIX = "hireos-secondary-rot-";

/** Phone recordings in this product are stored 90° off. Recruiter can override. */
export function defaultSecondaryReviewRotation(
  videoWidth: number,
  videoHeight: number,
): 0 | 90 | 180 | 270 {
  if (videoWidth < 16 || videoHeight < 16) return 0;
  return 90;
}

export function SecondaryReviewPlayer({
  src,
  interviewId,
  videoRef,
}: {
  src: string;
  interviewId: string;
  videoRef: MutableRefObject<HTMLVideoElement | null>;
}) {
  const [deg, setDeg] = useState<0 | 90 | 180 | 270>(90);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_PREFIX + interviewId);
      if (saved === "0" || saved === "90" || saved === "180" || saved === "270") {
        setDeg(Number(saved) as 0 | 90 | 180 | 270);
      }
    } catch {
      /* ignore */
    }
  }, [interviewId]);

  function persist(next: 0 | 90 | 180 | 270) {
    setDeg(next);
    try {
      localStorage.setItem(STORAGE_PREFIX + interviewId, String(next));
    } catch {
      /* ignore */
    }
  }

  function onMeta(el: HTMLVideoElement) {
    try {
      const saved = localStorage.getItem(STORAGE_PREFIX + interviewId);
      if (saved === "0" || saved === "90" || saved === "180" || saved === "270") {
        setDeg(Number(saved) as 0 | 90 | 180 | 270);
      } else {
        persist(defaultSecondaryReviewRotation(el.videoWidth, el.videoHeight));
      }
    } catch {
      persist(defaultSecondaryReviewRotation(el.videoWidth, el.videoHeight));
    }
    setReady(true);
  }

  const quarter = deg === 90 || deg === 270;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-black">
      <div className="flex max-h-[70vh] min-h-[240px] items-center justify-center overflow-hidden">
        <video
          ref={(node) => {
            videoRef.current = node;
          }}
          className="origin-center object-contain"
          style={{
            transform: `rotate(${deg}deg)`,
            maxHeight: quarter ? "min(100vw, 70vh)" : "70vh",
            maxWidth: quarter ? "70vh" : "100%",
            width: quarter ? "auto" : "100%",
            height: quarter ? "min(100vw, 70vh)" : "auto",
          }}
          controls
          preload="metadata"
          src={src}
          onLoadedMetadata={(e) => onMeta(e.currentTarget)}
        />
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-white/10 px-3 py-2">
        <p className="text-xs text-muted-foreground">
          {ready ? `Playback rotation ${deg}°` : "Loading video…"}
        </p>
        <button
          type="button"
          className="rounded-md border border-white/15 px-3 py-1 text-xs font-medium text-foreground hover:bg-white/5"
          onClick={() => persist(((deg + 90) % 360) as 0 | 90 | 180 | 270)}
        >
          Rotate 90°
        </button>
      </div>
    </div>
  );
}
