# Logisoft HireOS — Phase 3G.1 recording artifact integrity

**Status:** Integrity fix complete. Full Enhanced **phone** interview was still **not** run.  
**Date:** 2026-08-15  
**Parent:** `docs/DJANGO_PHASE3G_PROCTORING.md`

---

## What went wrong in 3G

`InterviewSession.secondaryRecordingStatus = SAVED` was treated as “file exists.”

For `cmssuxuyk000vjfxpxspi3ob5` (`cameron@example.com`):

| Check | 3G worker | After 3G.1 |
|---|---|---|
| Expected file | `interviews/{session}/secondary-camera/{recordingId}/recording.mp4` (mime is **mp4**, not webm) | same |
| Worker `STORAGE_ROOT` | `C:\Users\LSITC210\Downloads\storage` (`REPO_ROOT / "../storage"`) | `C:\Users\LSITC210\Downloads\AI Interview\storage` (same as Next.js repo `./storage`) |
| File actually on disk | **yes**, ~130 MB, under the **repo** storage tree (gitignored) | verified |
| 3G outcome | `incomplete` / no chunks | `already_completed`, `has_audio` true, `has_video` true |

The recording was **not** on another container. Django resolved a **different parent folder** than Next.js (`process.cwd()` + `./storage`).

Next.js `finalizeSecondaryRecording` also returned SAVED if the **database** already had a path, **without** `stat` of the file. Recruiter UI used `Boolean(secondaryRecordingPath)`, so HR could see “Recording available” for a missing file.

---

## Rule now

Chunks found → assemble → output exists → size > 0 → **only then SAVED**.

If the file is missing/unreadable:

- status **FAILED** (path cleared)
- source chunks kept
- pair token **not** cleared
- recruiter UI / playback API do **not** claim available

Pair token clears only after `already_completed` / `assembled` with `recording_present`, or `no_recording` (never recorded).

---

## Code changes

- Next.js `verifyStoredFile`; finalize writes then `stat`; stale SAVED falls through to salvage or FAILED.
- Staff dashboard, candidate card, playback GET, metadata GET: availability is **on-disk**, not path-in-DB.
- Django `STORAGE_ROOT` is always repo `storage/` unless an **absolute** env path is set.
- Assemble: SAVED + missing file → `mark_recording_artifact_missing` (FAILED, path null).
- `python manage.py proctoring_artifacts` audits SAVED vs disk (`--fix` optional).

Orientation: ffprobe `rotate_tag` **-90** on the Cameron file. **Not** rewritten (`orientation_corrected: false`). CSS review rotation remains.

---

## Tests

- Unit: SAVED without file → incomplete + missing-artifact marker; concat still preserves chunks.
- ffmpeg 1s VP8+Opus WebM as one chunk → assembled file **probed video+audio**.
- Live Celery on Cameron: enqueue **146 ms**, worker **237 ms**, `already_completed`, audio+video, pair cleared, stage still ASSESSMENT.
- `manage.py proctoring_artifacts --limit 10` → **checked=5 ok=5 missing=0**
- Full suite **112 OK**

---

## Still not proven

Phone → QR pair → live chunks → completion → Celery → play in the recruiter player.

That needs a designated test device. Do not treat 3G.1 as a substitute for that run.

**STOP. Phase 3H still waits for approval.**
