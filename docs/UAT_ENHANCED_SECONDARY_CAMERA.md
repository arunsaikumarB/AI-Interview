# HireOS UAT — Enhanced secondary-camera (real phone)

This is **not** an architecture phase. Do not change pairing, chunk ACK, integrity, or storage layout for this test.

**Goal:** Prove the only remaining path:

Phone → QR pair → camera → recording chunks → interview completion → Celery → final video → recruiter playback

If HireOS tells HR a recording is available, the file must exist under repo `storage/` and play.

---

## Designated test only

Use a **local.dev / example.com** candidate. Do not use production people.

Suggested: create a **new** Enhanced TEXT interview for `candidate@local.dev` (or a throwaway `@example.com`) so you do not overwrite a historical session.

Laptop and phone must reach the **same** HireOS origin Next.js already prints (`pairUrl` / LAN IP). Phone cannot use `localhost`.

---

## Pass / fail (all required)

| Step | Pass |
|---|---|
| 1. Consent | Candidate accepts Enhanced + recording consent |
| 2. QR | Phone opens `/interview/secondary/{code}` before pair expiry |
| 3. Pair | Laptop shows CONNECTED; live preview updates |
| 4. Placement | Candidate confirms placement |
| 5. Record | Status RECORDING; `chunk-*.part` appear under `storage/interviews/{sessionId}/secondary-camera/{recordingId}/` |
| 6. Interview | At least 2 TEXT answers; duration still server-side |
| 7. Complete | Session COMPLETED or TERMINATED; **not** because of this UAT changing rules |
| 8. Artifact | `recording.webm` or `recording.mp4` exists, size > 0 |
| 9. Celery | `POST /api/v1/proctoring/process/` with recruiter JWT → `already_completed` or `assembled`; `recording_present: true` |
| 10. HR UI | Recruiter interview page shows recording **available** and the player plays (audio if the phone captured it) |
| 11. Honesty | `python manage.py proctoring_artifacts --limit 5` includes this session as **ok** |
| 12. Isolation | Application.stage unchanged; no proctoring in AI prompts |

**Fail if:** DB is SAVED but `proctoring_artifacts` reports MISSING_ARTIFACT; HR sees “available” but playback 404s; phone never CONNECTed; chunks ACK 200 but no files in repo `storage/`.

Orientation: if the picture is sideways, CSS rotate in the recruiter player is enough. Do not fail UAT because the file was not re-encoded.

---

## After the run (staff)

```text
python manage.py proctoring_artifacts --limit 10
```

Optional Celery (staff only, terminal session):

```text
POST /api/v1/proctoring/process/  { "session_id": "<id>", "kind": "process" }
```

Expect enqueue < 1s. Do not claim the live turn used Celery.

---

## Sign-off

| Item | Result | Initials / date |
|---|---|---|
| Real phone used | | |
| Pair CONNECTED | | |
| Chunks on disk | | |
| Session terminal | | |
| Final file playable | | |
| Celery artifact check | | |
| Stage unchanged | | |

When this table is filled **Pass**, Phase 3G (including 3G.1) is UAT-complete for Enhanced recording. Then Phase 3H may start **after approval**.
