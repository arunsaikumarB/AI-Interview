# Logisoft HireOS — Django Phase 3G: post-session proctoring

**Status:** Complete for post-session processing only. Next.js remains the live proctoring source of truth.  
**Date:** 2026-08-15  
**Audit:** `docs/DJANGO_PHASE3G_PROCTORING_AUDIT.md`

Prisma schema was **not** changed. Live ingest, pairing, heartbeat, frames, integrity TERMINATE, recording start, and chunk ACK were **not** moved. No frontend cutover. No Application.stage writes. No interview AI calls.

---

## 1. Existing proctoring architecture

Live path: candidate/phone → Next.js → consent, system check, signal ingest, secondary pairing, heartbeat, in-memory preview, chunk upload (disk then 200), integrity POST (may TERMINATE). Events are timestamped **signals**, never cheating verdicts.

Staff review stays `GET /api/interviews/[id]/proctoring`. Playback stays `GET /api/interviews/[id]/secondary-recording/file`.

---

## 2. Live vs background split

| Live (Next.js, unchanged) | Background (Django/Celery) |
|---|---|
| Consent, check, ingest, face sampling in browser | Assemble chunks after terminal status |
| Pair, connect, heartbeat, live frames | Staff JSON report package |
| Integrity POST / warnings / TERMINATE | Pair-token clear after successful assemble / no recording |
| Recording start + chunk ACK | **Not** recording deletion |

---

## 3. Recording storage

`STORAGE_ROOT` (repo `./storage`, Django resolves relative paths from `backend/`):

`interviews/{sessionId}/secondary-camera/{recordingId}/chunk-NNNNNN.part` plus optional `recording.webm|mp4`.

IDs must match `[a-zA-Z0-9_-]{8,80}`. Paths are resolved under the storage root; `..` is rejected.

---

## 4. Chunk assembly

Task `proctoring.assemble_recording` / combined `proctoring.process_session`.

- Sort `chunk-*.part` by index.
- Missing indexes → **INCOMPLETE**, **no** final file written, **chunks kept**.
- Duplicate filenames cannot exist on disk (same name).
- Empty/unreadable chunk → permanent `corrupt_chunk` / transient `chunk_unreadable`.
- Concat is **byte-join** (same as existing `finalizeRecordingFile`), no re-encode.
- Source chunks are **never deleted**.
- Already SAVED + readable final file → `already_completed`.
- This machine’s DB `SAVED` sessions had **no chunk files on disk** → live outcome `incomplete` (honest; did not invent a video).

Unit test: two parts `AAAA`+`BBBB` → `recording.webm`, chunks still present. Gap at index 1 → incomplete, no output file.

---

## 5. ffmpeg requirements

Host has **ffmpeg 8.1.2** (gyan.dev full build). Assembly does **not** require it. Optional `ffprobe` is used only when a final file exists. Concat does not use `shell=True`. ffmpeg was **not** newly installed.

---

## 6. Orientation handling

Source chunks are not rotated. `createOrientedRecordStream` already returns null; recruiter UI uses CSS rotate. Report/API always set `orientation_corrected: false`. No guessed ffmpeg transpose.

---

## 7. Audio handling

Byte-concat preserves audio bytes when present in MediaRecorder parts. No STT, speaker ID, or LLM ingest. Live SAVED file was not on disk here, so audio-in-file was **not** ffprobe-verified on a real clip.

---

## 8. Report packaging

`proctoring.package_report` writes `interviews/{sessionId}/proctoring-report.json` (staff artifact, not a candidate API).

Includes: session ids, times, duration, consent flags, termination **policy label**, secondary status, recording metadata **without filesystem paths**, event counts, timestamped events with `observed_signal` + “Human review required. This is not a cheating verdict.”

Omits: accessToken, pair tokens, passwords, prompts, embeddings, stack traces, emails, resume text.

Live `candidate@local.dev` TERMINATED `cmsrgv1o50005ce9j68vx6rhu`: 2 × COPY_PASTE, “Paste observed (length N)”, no secrets in file.

Live `cameron@example.com` COMPLETED `cmssuxuyk000vjfxpxspi3ob5`: 29 events (secondary connect/disconnect), Enhanced consent, recording metadata has_gap true — **no** pair token in JSON.

---

## 9. Retention policy

`docs/RECORDINGS.md` recommends a local window (example 90 days) but **no job implements it**. Phase 3G does **not** delete recordings. Cleanup needs an HR/legal policy before automation.

---

## 10. Pair-token cleanup

After terminal process, pair token is cleared only when assemble outcome is `assembled`, `already_completed`, or `no_recording`. Incomplete (missing files) leaves the token so a flush path is not destroyed. Never runs on IN_PROGRESS (enqueue 400).

---

## 11. Redis locks

`proctoring:assemble:{sessionId}`, `proctoring:report:{sessionId}`, `proctoring:process:{sessionId}` SET NX TTL 900s. Duplicate POST → `already_processing` + same `task_id`.

---

## 12. Retry policy

Transient: disk OSError, unreadable chunk → ≤ 3 retries, backoff `min(60, 5*2^n)`.  
Permanent: not terminal, wrong org, corrupt/empty, path traversal — no retry.  
Incomplete missing chunks is a completed job with `outcome=incomplete`, not an endless retry.

---

## 13. Security

`POST /api/v1/proctoring/process/` `{session_id, kind}` kind = `process` | `assemble` | `report`.  
`GET /api/v1/proctoring/status/?session_id=&kind=`

RecruitmentStaff JWT + org. Body `{status, task_id, kind}` only.

| Case | Result |
|---|---|
| no JWT | **401** live |
| CANDIDATE | **403** live |
| INTERVIEWER | **403** unit |
| cross-org | **404** unit |
| IN_PROGRESS | **400** `session_not_terminal` |
| TERMINATED/COMPLETED | **200** queued |

---

## 14. Integrity signal semantics

Types unchanged. Labels match `integritySignalLabel` (e.g. “Additional person detected”, not “Candidate cheated”). Strict TERMINATE remains Next.js.

---

## 15. AI isolation

Python `services/proctoring` and `apps/proctoring` do not call `screenApplication`, `generatePlan`, `finalEvaluation`, Ollama, or interview scoring. Unit scan enforces this. Report `not_ai_input: true`.

---

## 16. Performance

| Path | Time |
|---|---|
| Enqueue process (live, no recording) | **91–162 ms** |
| Duplicate while locked | **42 ms** |
| Worker process + report (2 events) | **50–109 ms** |
| Enqueue second session | **63–121 ms** |
| Worker incomplete+29-event report | **~2 s** wall including HTTP |

HTTP does not wait for ffmpeg. No claim that video processing is instant. Concat of real multi-minute WebM was **not** timed (files absent).

---

## 17. Real recording test

A full Enhanced interview (phone pair → chunks → complete → assemble playable file) was **not** run in this phase.

What was run:

- Unit concat of synthetic parts (playable-as-bytes, chunks preserved).
- Live Celery on designated `candidate@local.dev` TERMINATED (no secondary recording).
- Live Celery on designated `cameron@example.com` COMPLETED/SAVED: **chunks/final file not on this disk** → `incomplete`, chunks_preserved, pair token **not** cleared, application still ASSESSMENT/ACTIVE.

Do not claim device camera/mic verification.

---

## 18. Report test

Staff package generated for both sessions. No accessToken/pair token/path/cheat verdict. Candidate cannot call the Django endpoint (403). Next.js staff GET was not replaced.

---

## 19. Regression

`python manage.py check` — no issues.  
`manage.py test` accounts…proctoring — **110 OK**.  
Next.js `GET /api/health` — ok (DB, Ollama, speech).  
Live Next.js interview/proctoring routes **unchanged**. Device TEXT/VOICE/Enhanced pairing was **not** re-run.

---

## 20. Known limitations

- Next.js still finalizes recordings in-request on session end (`endSecondaryCameraSession`). Celery is an extra post-session path, not a UI cutover.
- Phase 3G reported Cameron as `incomplete` because Django used the wrong storage root. **3G.1** aligned roots; the ~130 MB `recording.mp4` was always under repo `storage/` (gitignored). See `docs/DJANGO_PHASE3G1_RECORDING_INTEGRITY.md`.
- Full Enhanced **phone** pairing was still not run.
- No auto-delete / 90-day retention job.
- No analytics scores.
- Windows Celery `-P solo`; stale workers can `NotRegistered`.
- Django SUPER_ADMIN is org-scoped.

**STOP. Do not start Phase 3H without approval.**
