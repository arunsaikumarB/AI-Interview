# Logisoft HireOS — Phase 3G proctoring audit

**Status:** Audit complete. Implementation: `docs/DJANGO_PHASE3G_PROCTORING.md`.  
**Date:** 2026-08-15  
**Sources:** `prisma/schema.prisma`; `src/lib/proctoring.ts`; `src/lib/secondary-recording.ts`; `src/lib/secondary-recording-server.ts`; `src/lib/secondary-camera-lifecycle.ts`; `src/lib/secondary-record-orientation.ts`; `src/lib/integrity.ts`; `src/app/api/interview/[token]/proctoring/*`; `src/app/api/interview/secondary/[code]/*`; `src/app/api/interviews/[id]/{proctoring,secondary-recording,expire}`; `docs/RECORDINGS.md`.

---

## 1. Session and events (actual)

`InterviewStatus`: **SCHEDULED | IN_PROGRESS | COMPLETED | CANCELLED | NO_SHOW | TERMINATED**.  
There is **no** `EXPIRED` status. Staff expire (`POST /api/interviews/[id]/expire`) sets `tokenExpiresAt = now` and status **CANCELLED** (unless already COMPLETED).

Terminal for post-session work: **COMPLETED, TERMINATED, CANCELLED, NO_SHOW**.  
Non-terminal: SCHEDULED, IN_PROGRESS.

`ProctoringEvent`: `sessionId`, `type` (`ProctoringSignalType`), `timestamp`, `meta` Json. Signals only (`signalOnly` / `advisoryOnly` / `noAutoVerdict` in meta). Never auto-verdicts. Never Application.stage.

---

## 2. Live path (must stay Next.js)

| Step | Implementation |
|---|---|
| Consent | `POST /api/interview/[token]/proctoring/consent` — `proctoringConsentAt`, camera + optional recording consent |
| System check | Client `pre-interview-system-check.tsx` — camera optional |
| Signal ingest | `POST /api/interview/[token]/proctoring` — batch 1–50, 20 batches/min, cap 2000, `createMany`, IN_PROGRESS + consent required |
| Face sampling | **Browser only** (`src/lib/proctoring.ts`) — frames never uploaded |
| Pairing | `secondaryPairToken` unique, `secondaryPairExpiresAt`, QR/deep link |
| Heartbeat | `POST .../secondary/[code]/heartbeat` — lastSeen, **no** ProctoringEvent per beat |
| Live preview | In-memory `getLiveFrame`; `GET .../proctoring/secondary/frame` |
| Integrity POST | `POST .../secondary/[code]/integrity` — may **TERMINATE** in-request |
| Recording start | `startSecondaryRecording` — IN_PROGRESS + placement + consent |
| Chunk upload | `ingestSecondaryChunk` — writes disk **then** 200; idempotent `recordingId + chunkIndex`; trailing chunks allowed after COMPLETED/TERMINATED |
| Duration / complete | Interview engine + `endsAt`; then `endSecondaryCameraSession` |

Staff review: `GET/POST /api/interviews/[id]/proctoring` (`canManagePipeline`). Candidates use token route. **Do not replace in 3G.**

---

## 3. Recording storage (actual)

Relative under `STORAGE_ROOT` (default `./storage`):

```
interviews/{sessionId}/secondary-camera/{recordingId}/
  chunk-000000.part
  recording.webm | recording.mp4
  meta.json
```

`resolveStoragePath` rejects paths outside the storage root.

Status: **NONE | READY | RECORDING | INTERRUPTED | FINALIZING | SAVED | FAILED | DISCARDED**.

Live finalize (`finalizeRecordingFile`): **byte-concat** of `chunk-*.part` in index order. **Skips missing chunks**. Empty concat → FAILED. Success → `secondaryRecordingPath` relative, status SAVED. **Does not delete chunks.** **Does not use ffmpeg.** Called from phone finalize, `endSecondaryCameraSession` (if chunks exist), and staff file GET salvage.

---

## 4. Orientation / audio (actual)

`createOrientedRecordStream` **returns null** — capture is camera-track as-is. Recruiter `SecondaryReviewPlayer` applies **CSS rotate** (default 90° for this product). Source files are not rewritten.

Audio: MediaRecorder chunks include room audio when Enhanced recording consent is given. Concat preserves bytes (including audio) if present. No STT/speaker ID on this path.

---

## 5. Pair token after end (actual)

`endSecondaryCameraSession`: may keep pair token **10 minutes** if recording not yet SAVED (flush trailing chunks). Otherwise `secondaryPairToken = null`. Clears in-memory frames. Disconnect signal if previously CONNECTED.

---

## 6. Retention (actual)

`docs/RECORDINGS.md`: “Do not retain indefinitely. **Recommended** example 90 days. Delete when application/org removed.”  
**No implemented TTL job.** Consent copy refers to “organization’s local retention policy.”  
**3G must not auto-delete recordings.** Cleanup of pair tokens after terminal + assembly is existing security behavior, not a retention window.

---

## 7. Analytics

No dedicated proctoring analytics store. Event counts belong in a **staff report package**, not a cheating/trust score.

---

## 8. Classification

| Operation | Real-time? | Safe Celery? | 3G |
|---|---|---|---|
| Consent / check / ingest / pairing / heartbeat / frames / integrity TERMINATE / chunk ACK | Yes | **No** | Unchanged Next.js |
| Byte-concat / verify recording after terminal | No | **Yes** | assemble |
| Staff JSON package (signals, metadata, counts) | Staff | **Yes** | report |
| Pair-token invalidate after SAVED + terminal | After live | **Yes** if already terminal | part of process |
| Delete recordings after N days | N/A | **No policy implemented** | Document only |
| ffmpeg re-encode / rotate file | Optional | Only if reliable | **Do not guess rotate**; probe if ffmpeg on PATH |

---

## 9. 3G implication

Keep all live routes. Django staff `POST /api/v1/proctoring/process/` for terminal sessions only. IDs only. Redis lock. No Prisma schema change. No AI imports. No Application.stage writes.
