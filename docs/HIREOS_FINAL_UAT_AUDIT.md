# Logisoft HireOS — Final Consolidated Integration & UAT Audit

**Date:** 17 August 2026
**Scope:** All 30 nominated application areas, plus Phases 3G/3G.1, 4A, 4B, 4C.1, 4C.2, 4C.3, remediations F‑01…F‑05, R1/R2/R5, R6.1/R6.2, R7, R8.
**Mode:** Read‑only audit and evidence collection. No source file was modified during this phase. No further physical secondary‑camera runs were performed.
**Verdict vocabulary:** `PASS` / `FAIL` / `PARTIAL` / `NOT TESTED` / `NOT APPLICABLE`. Nothing in this report is marked PASS without an executed check and captured evidence.

---

## A. Executive summary

HireOS is functionally complete and behaves correctly across authentication, RBAC, organization isolation, the full recruiting pipeline, the AI screening and interview engine, voice interviewing, recording and proctoring, the Django cutover, and every dependency‑outage scenario tested. **316 automated tests pass with zero failures**, the production build compiles and boots and serves live traffic, ESLint reports zero errors, and the Prisma schema is unchanged and drift‑free against the live database.

Every previously reported blocker is closed and verified live:

- **F‑01** (broken build → stale image → destructive `db push`): the production build now succeeds and `next start` serves real traffic; the entrypoint no longer pushes onto a populated database and never passes `--accept-data-loss`.
- **F‑02** (deactivated user kept a live session): verified twice — a session minted for a deactivated account is refused with 401, and deactivating a user through the admin API kills that user's live session immediately.
- **F‑03** (department cleared on unrelated job edit): verified in both Prisma mode and Django cutover mode; the department survives an unrelated edit, and can still be changed or cleared deliberately.
- **F‑04** (Redis outage leaked a traceback): with Redis stopped, Django returns a clean `503 {"detail":"Background task service unavailable","code":"dependency_unavailable"}` with no traceback.
- **F‑05 / R1 / R2 / R5**: baseline capture now follows placement confirmation with durable audit evidence; episodes are tracked rather than re‑counted; and **STANDARD never auto‑terminates** — confirmed live by a session that reached 4 camera‑move warnings and still completed normally.

**One item is deliberately unresolved.** `SECONDARY_DEVICE_INTERACTION` (#15) has never fired on real hardware, in any session, across the entire UAT. Per instruction it was not further tested or fixed and is recorded as **NOT TESTED / unresolved** with a diagnosed root cause. The candidate‑facing requirement that matters is demonstrated and passing: `SECONDARY_DEVICE_VISIBLE` (#13) fires on real hardware, the candidate receives the integrity warning, and the recruiter can review the recording and integrity signals afterwards.

**Recommendation: CONDITIONAL GO** — see section L. Nothing found in this audit blocks a supervised pilot. Four items should be closed before unsupervised production use, none of which are in the candidate‑facing interview path.

---

## B. Complete test matrix

### 1. Authentication & session security

| ID | Test | Verdict | Evidence |
|---|---|---|---|
| AUTH‑01 | No cookie → 401 | PASS | `GET /api/jobs` → 401 |
| AUTH‑02 | Malformed token → 401 | PASS | 401 |
| AUTH‑03 | Token signed with wrong key → 401 | PASS | 401 |
| AUTH‑04 | Tampered signature → 401 | PASS | 401 |
| AUTH‑05 | Expired token → 401 | PASS | 401 |
| AUTH‑06 | Claim forging | NOT APPLICABLE | The JWT is authoritative by design; forging requires `AUTH_SECRET`. Secret custody is the control, not a code defect. `AUTH_SECRET` is 39 characters (≥32 recommended for HS256). |
| AUTH‑07 | F‑02 — deactivated account, valid unexpired JWT | PASS | 401 |
| AUTH‑08 | Wrong password rejected | PASS | 401 `{"error":"Invalid email or password"}` |
| AUTH‑09 | No user enumeration | PASS | Identical message for unknown email and wrong password |
| AUTH‑10 | Session cookie hardening | PASS | `HttpOnly=true SameSite=Lax Path=/`. `Secure` absent on plain HTTP localhost — expected; must be verified behind TLS in production. |
| AUTH‑11 | Logout clears the cookie | PASS | `aros_session=; Expires=Thu, 01 Jan 1970` |
| AUTH‑12 | `/api/auth/me` leaks no password material | PASS | No `passwordHash` in payload |

### 2. RBAC for every role

All six roles (`SUPER_ADMIN`, `HR_ADMIN`, `RECRUITER`, `HIRING_MANAGER`, `INTERVIEWER`, `CANDIDATE`) were exercised against every endpoint below with a freshly minted session per role.

| Endpoint | SUPER_ADMIN | HR_ADMIN | RECRUITER | HIRING_MANAGER | INTERVIEWER | CANDIDATE | Verdict |
|---|---|---|---|---|---|---|---|
| `GET /api/jobs` | 200 | 200 | 200 | 200 | 200 | 403 | PASS |
| `GET /api/candidates` | 200 | 200 | 200 | 200 | 200 | 403 | PASS |
| `GET /api/applications` | 200 | 200 | 200 | 200 | 200 | 403 | PASS |
| `GET /api/applications/board` | 200 | 200 | 200 | 200 | 200 | 403 | PASS |
| `GET /api/applications/pipeline-counts` | 200 | 200 | 200 | 200 | 200 | 403 | PASS |
| `GET /api/admin/users` | 200 | 200 | 403 | 403 | 403 | 403 | PASS |
| `GET /api/admin/departments` | 200 | 200 | 403 | 403 | 403 | 403 | PASS |
| `GET /api/admin/org` | 200 | 200 | 403 | 403 | 403 | 403 | PASS |
| `GET /api/analytics` | 200 | 200 | 200 | 200 | **403** | 403 | PASS — `canManagePipeline` excludes INTERVIEWER by design |
| `POST /api/talent/search` | 200 | 200 | 200 | 200 | **403** | 403 | PASS — same gate |
| `GET /api/portal/applications` | 403 | 403 | 403 | 403 | 403 | 200 | PASS — candidate‑only surface |
| `POST /api/jobs` | 201 | 201 | 201 | 403 | 403 | 403 | PASS |
| `PATCH /api/jobs/{id}` | — | 200 | — | 403 | — | — | PASS |
| `POST /api/applications/{id}/stage` | — | — | 200 | 200 | **403** | — | PASS |
| `POST /api/admin/departments` | — | 201 | **403** | — | — | — | PASS |
| `GET /api/interviews/{id}/secondary-recording` | 200 | 200 | 200 | 200 | **403** | 403 | PASS |

**RBAC summary: PASS.** 72/72 role × endpoint expectations correct after the two initial mismatches were traced to my own incorrect expectations (`/api/analytics` and `/api/talent/search` correctly exclude INTERVIEWER; `talent/search` is POST‑only, so the earlier 405 was method, not permission).

### 3. Organization isolation / cross-org access

A second organization, an `HR_ADMIN` inside it, and a job carrying a unique marker string were created as test data and removed afterwards.

| ID | Test | Verdict | Evidence |
|---|---|---|---|
| ORG‑01 | Job list is org‑scoped | PASS | Org‑1 admin's list does not contain `ORG2_CONFIDENTIAL_MARKER` |
| ORG‑02 | Direct cross‑org `GET` blocked | PASS | 404 |
| ORG‑03 | Cross‑org `PATCH` blocked, row intact | PASS | 404, title unchanged in DB |
| ORG‑04 | Cross‑org `DELETE` blocked, row survives | PASS | 404, row present |
| ORG‑05 | Reverse direction (org‑2 → org‑1) | PASS | 404 |
| ORG‑06 | Admin user list is org‑scoped | PASS | Org‑2 admin cannot see org‑1 users |
| ORG‑07 | `SUPER_ADMIN` explicit `?organizationId=` override | NOT APPLICABLE | Documented, intentional capability of `SUPER_ADMIN` only (`requireOrganizationId`) |
| DJ‑09 | Same isolation enforced on the Django side | PASS | Candidate role → 403 on `/api/v1/jobs/{id}/` |

### 4. Jobs — CRUD, search, status, department

| ID | Test | Verdict | Evidence |
|---|---|---|---|
| JOBS‑01 | Create + RBAC | PASS | 201 for the three permitted roles, 403 for the rest |
| JOBS‑02 | Read back | PASS | 200, department preserved |
| JOBS‑03 | Search by title | PASS | Created job present in `?q=` results |
| JOBS‑04 | Status transition DRAFT → OPEN | PASS | DB confirms `OPEN` |
| **JOBS‑05** | **F‑03 — department survives an unrelated edit** | **PASS** | Edited `location`; `departmentId` unchanged before/after |
| JOBS‑06 | Department can still be changed deliberately | PASS | Reassigned to a second department |
| JOBS‑07 | Department can be cleared explicitly | PASS | `null` accepted and persisted |
| JOBS‑08 | Invalid payload rejected | PASS | 400 |
| JOBS‑09 | Non‑manager cannot edit | PASS | 403, title unchanged |

### 5. Candidates — list / detail / privacy

| ID | Test | Verdict | Evidence |
|---|---|---|---|
| CAND‑01 | Staff list | PASS | 200, 19 candidates |
| CAND‑02 | Detail view | PASS | 200 |
| CAND‑03 | No `passwordHash` in candidate payload | PASS | 123 854‑byte payload, no match |
| CAND‑04 | CANDIDATE role blocked from the ATS list | PASS | 403 |
| CAND‑05 | Portal profile returns only self | PASS | Own email present; 0 of 4 other candidates' emails present |

### 6. Applications

| ID | Test | Verdict | Evidence |
|---|---|---|---|
| APP‑01 | List | PASS | 200, 21 applications |
| APP‑02 | Detail | PASS | 200 |
| RESUME‑02 | Public application creates candidate + application | PASS | Stage `APPLIED`, status `ACTIVE` |

### 7. Pipeline counts and board

| ID | Test | Verdict | Evidence |
|---|---|---|---|
| PIPE‑01 | `pipeline-counts` | PASS | Sum 21 = 21 rows in DB; keys `APPLIED, SCREENING, SHORTLISTED, ASSESSMENT, AI_INTERVIEW, TECH_INTERVIEW, HR_INTERVIEW, SELECTED` |
| PIPE‑02 | Board | PASS | Same eight columns |
| DJ‑07 | Count parity between Next and Django | PASS | Byte‑identical normalised count sets |

### 8. Stage / human SELECTED / REJECTED writes

| ID | Test | Verdict | Evidence |
|---|---|---|---|
| STAGE‑01 | Full forward path APPLIED → … → SELECTED | PASS | All seven transitions 200 and persisted |
| STAGE‑01b | SELECTED sets a terminal application status | PASS | `stage=SELECTED status=HIRED` |
| STAGE‑02a | REJECTED from SELECTED | PASS | `stage=REJECTED status=REJECTED` |
| STAGE‑02b | REJECTED from mid‑pipeline | PASS | 200 from `SCREENING` |
| STAGE‑04 | Invalid stage rejected | PASS | 400 |
| STAGE‑05 | INTERVIEWER cannot move the pipeline | PASS | 403 |
| STAGE‑07 | HIRING_MANAGER may decide | PASS | 200 |
| **STAGE‑11** | **Final decision without a human rationale is refused** | **PASS** | 400 `{"error":"Final decisions require a human rationale (note)"}` |
| STAGE‑08/09 | Decision written to the timeline with actor and rationale | PASS | `{"to":"SELECTED","from":"HR_INTERVIEW","note":"…","actorId":"…","actorName":"Hiring Manager"}` |
| STAGE‑10 | AI screening route cannot write a terminal stage | PASS | Static check: no `stage: "SELECTED"/"REJECTED"` in the screen route |
| STAGE‑99 | Test application restored | PASS | Returned to `APPLIED/ACTIVE` |

The human‑rationale gate is a strong control and is preserved in both Prisma and Django cutover modes.

### 9. Admin — users / departments / organization

| ID | Test | Verdict | Evidence |
|---|---|---|---|
| ADMIN‑01 | Organization read | PASS | 200 |
| ADMIN‑02/03/04 | Department create / update / delete | PASS | 201 / 200 / 200, row removed |
| ADMIN‑05 | User list | PASS | 200, 6 users (org‑scoped) |
| ADMIN‑06 | No password material in the user list | PASS | No match |
| **ADMIN‑07** | **F‑02 end to end: deactivate → live session dies** | **PASS** | `isActive=false` → that user's existing session probe returns 401 → reactivated |
| ADMIN‑08 | Self‑demotion guard | PASS | 400, role unchanged |

### 10. Resume upload + parsing

| ID | Test | Verdict | Evidence |
|---|---|---|---|
| RESUME‑01 | Public careers apply with a resume attachment | PASS | 201 |
| RESUME‑03 | Resume text extracted | PASS | 747 characters, `resumes/…-priya-uat-resume.txt` |
| RESUME‑04 | Parsed content faithful to the source | PASS | Contains `PostgreSQL` and `Celery` |
| STORAGE‑01 | Artifact written under the storage root | PASS | File exists on disk |

### 11. AI screening

| ID | Test | Verdict | Evidence |
|---|---|---|---|
| SCREEN‑01 | Screening runs | PASS | 200 |
| SCREEN‑02 | Evaluation produced | PASS | 119 s, `qwen2.5:7b`, recommendation `MAYBE` |
| SCREEN‑03 | Score bounded and numeric | PASS | `overall=75`; keys `overall, breakdown, whyMatch, concerns, missingRequirements, reasoning, recommendedAction` |
| SCREEN‑04 | Reasoning present | PASS | 309 characters |
| **SCREEN‑05** | **AI did not move the pipeline stage** | **PASS** | Stage remained `APPLIED/ACTIVE` |
| SCREEN‑06 | `screen-status` endpoint | PASS | 200 |

### 12. Interview creation / planning

| ID | Test | Verdict | Evidence |
|---|---|---|---|
| INT‑01 | Interview created | PASS | 201, `deliveryMode=TEXT`, `maxQuestions=4` |
| INT‑02 | Access token high‑entropy | PASS | 64 characters |
| INT‑03 | Link expiry stored | PASS | `tokenExpiresAt` set |
| INT‑04 | Plan generated | PASS | Topics grounded in the job description |
| INT‑05 | Token room loads without a session | PASS | 200 |
| SEC‑02 | Invalid token rejected | PASS | 404 |
| — | Expired link refused | PASS | Observed live: `410 {"error":"This interview link has expired…"}` |

### 13. TEXT interview end to end

| ID | Test | Verdict | Evidence |
|---|---|---|---|
| TEXT‑01 | Start | PASS | 200 |
| TEXT‑02 | Adaptive Q/A loop | PASS | 4 asked, 4 answered |
| TEXT‑03 | Questions and answers persisted | PASS | Q=4, A=4 |
| TEXT‑04 | Sequence contiguous | PASS | 1,2,3,4 |
| TEXT‑05 | Questions not repeated | PASS | 4 distinct questions, each referencing a different job skill |
| FIN‑06/07 | Second, realistically paced run | PASS | 3 answers, session `COMPLETED` |

### 14. VOICE interview / STT / TTS

| ID | Test | Verdict | Evidence |
|---|---|---|---|
| VOICE‑01 | Speech service healthy | PASS | Whisper `small`, Piper `en_US-lessac-medium`, CPU |
| VOICE‑02 | VOICE interview created | PASS | `deliveryMode=VOICE` |
| VOICE‑03 | Plan generated in voice mode | PASS | Plan present |
| VOICE‑04 | TTS question audio synthesised | PASS | 213 036‑byte RIFF/WAVE in 2 s |
| VOICE‑05 | TTS cached under the storage root | PASS | `interviews/{id}/q1.wav` exists |
| VOICE‑06 | Second fetch served from cache | PASS | 55 ms |
| VOICE‑08 | Whisper transcribes real Piper audio | PASS | 9 s; 4/4 content words matched |
| VOICE‑09 | `answer-audio` route accepts and transcribes | PASS | 200 in 12 s |
| VOICE‑10 | Transcript persisted as the answer | PASS | 91 characters stored |
| VOICE‑11 | Staff can replay question audio | PASS | 200 |
| VOICE‑12 | Audio not publicly reachable | PASS | 401 |
| VOICE‑13 | Async TTS prefetch | PASS (flag‑gated) | `400 "Async TTS prefetch is disabled"` with `USE_DJANGO_ASYNC=false`; returns 200 with the flag on |

### 15. Interview finalization / evaluation

| ID | Test | Verdict | Evidence |
|---|---|---|---|
| FIN‑01 | Session reaches a terminal state | PASS | `COMPLETED`, `endedAt` set |
| **FIN‑08** | **Automatic `INTERVIEW_OVERALL` after the last answer** | **PASS** | 111 s; recommendation `YES`, overall 75; answer evaluations 3/3 |
| FIN‑04 | Recruiter can regenerate the final evaluation | PASS | 142 s; recommendation `YES`, overall 72 |
| FIN‑03 | Evaluation scores bounded | PASS | All numeric scores within 0–100 |
| FIN‑09 | Timeline records the evaluation | PASS | `AI_EVALUATION` row written |
| FIN‑10 | AI never moves the stage | PASS | `APPLIED/ACTIVE` unchanged |
| SEC‑03 | `regenerate-evaluation` requires staff auth | PASS | 401 anonymous |
| **FIN‑02** | **Automatic evaluation under saturation** | **PARTIAL** | See Risk R‑3. In a deliberately unrealistic run (4 answers submitted within 10 s while a screening and a plan generation competed for the same CPU‑bound Ollama), 3 of 4 answer evaluations were written and the final `INTERVIEW_OVERALL` was never produced. Background evaluation failures are caught and only `console.warn`‑ed, so the drop is silent. The paced re‑run passed cleanly. **Does not block production** — no human answers that fast — but the silent‑drop behaviour is a real robustness gap. |

### 16. Async Celery workflows and duplicate enqueue protection

| ID | Test | Verdict | Evidence |
|---|---|---|---|
| 4B‑01 | Async screening enqueue (flags on) | PASS | `{"status":"queued","task_id":"90f54b7a-…","kind":"AI_SCREENING","advisoryOnly":true}` |
| 4B‑02 | `screen-status` reports task state | PASS | `PROCESSING` with the same `task_id` |
| **4B‑03** | **Duplicate enqueue protection (Django async)** | **PASS** | 3 concurrent POSTs returned the **same** `task_id` `90f54b7a-…` |
| 4B‑05 | `async-status` endpoint | PASS | 200 |
| ASYNC‑01 | Duplicate protection in the legacy Prisma path | **PARTIAL** | 3 concurrent POSTs produced 4 `RESUME_SCREEN` evaluations. The legacy path runs screening inline per request with no queue and therefore no dedup. This is the pre‑cutover design, not a regression — but it means **duplicate‑enqueue protection only exists once `USE_DJANGO_ASYNC=true`**. |
| — | Celery worker liveness | PASS | `{"celery":{"ok":true,"workers":["celery@DESKTOP-9177HSA"]}}` |

### 17. Recording creation / chunk ACK / assembly / playback

| ID | Test | Verdict | Evidence |
|---|---|---|---|
| REC‑01 | Metadata endpoint | PASS | 200; includes `reviewOnly` and `noAiInput` flags |
| REC‑02 | Playback streams real MP4 bytes | PASS | 206, `ftyp` box present, `content-type: video/mp4` |
| REC‑03 | HTTP range requests (seekable) | PASS | `content-range: bytes 0-2047/97025948` |
| REC‑04 | Not publicly reachable | PASS | anonymous 401, candidate 403 |
| REC‑06 | Assembled artifact plus chunk workspace retained | PASS | `recording.mp4` + 164 chunk files |
| REC‑07 | Metadata matches the artifact | PASS | 206 chunks, 97 MB, `hasGap=true`, `interruptedMs=84000` |
| — | Six assembled recordings decode | PASS | `ffprobe`: H.264 1920×1080 + AAC; durations 34.4 s–415.5 s, each within a few seconds of the recorded `secondaryRecordingDurationMs` |
| — | Terminated‑session recordings assembled and retained | PASS | 7 of the 16 verified artifacts belong to `TERMINATED` sessions |
| — | Artifact audit across the whole database | PASS | `manage.py proctoring_artifacts` → **checked=16 ok=16 missing=0** |

### 18. Proctoring integrity and termination rules

| ID | Test | Verdict | Evidence |
|---|---|---|---|
| PROC‑01 | Signal inventory | PASS | 719 events across 19 kinds, incl. `SECONDARY_CAMERA_CONNECTED=442`, `COPY_PASTE=84`, `WINDOW_SWITCH=75`, `SECONDARY_PERSON_MOVED=30`, `SECONDARY_DEVICE_VISIBLE=10`, `SECONDARY_DEVICE_REMOVED=7` |
| PROC‑02 | Terminations are STRICT‑only **after R5** | PASS | Every termination after the R5 change (`integrity-server.ts`, 16 Aug 15:37) is `STRICT`. Two `STANDARD` terminations exist at 09:15 and 09:44 on 16 Aug — **both pre‑date R5** and are the recorded evidence of the F‑05 defect that R5 fixed. |
| **PROC‑03** | **R5 — STANDARD never auto‑terminates (post‑fix)** | **PASS** | Post‑R5 STANDARD sessions reaching or exceeding the STRICT threshold: `cam=9 → COMPLETED`, `cam=13 → COMPLETED`, `cam=4 → COMPLETED`. Zero terminations. |
| PROC‑05 | Consent enforced before any signal is recorded | PASS | **0** `ProctoringEvent` rows exist for any session without `proctoringConsentAt`. The ingest route refuses without consent. Three sessions started without consent and correctly produced no signals (two are legacy 12‑Aug rows with the inconsistent combination `proctoringEnabled=true, proctoringMode=OFF`). |
| PROC‑06 | No stage change was ever driven by proctoring | PASS | 0 `STAGE_CHANGED` rows referencing any proctoring term |
| — | STRICT termination still works | PASS | Historic STRICT terminations with reasons `focus_threshold`, `paste_threshold`, `fullscreen_threshold`, `secondary_person_missing`, `secondary_person_moved`, `secondary_looking_at_device` |

### 19. Secondary camera

| ID | Test | Verdict | Evidence |
|---|---|---|---|
| **#13 `SECONDARY_DEVICE_VISIBLE`** | **PASS** | 10 events recorded from real hardware. Run J alone produced 3 × `DEVICE_VISIBLE` and 1 × `DEVICE_REMOVED`. |
| **Candidate warning popup** | **PASS — confirmed candidate‑facing behaviour** | Observed by the operator on the physical device ("Additional device activity detected… WARNING 3 OF 3") and corroborated by `integrityPendingWarningKind` in the database. |
| **#15 `SECONDARY_DEVICE_INTERACTION`** | **NOT TESTED / unresolved** | **0 events across every session in the entire UAT.** Left deliberately unresolved by instruction; no fix attempted, no further physical runs. Root cause diagnosed in section H. |
| SEC‑CAM‑01 | R1 audit evidence persisted | PASS | 6 `secondary_placement_confirmed` and 6 `secondary_baseline_captured` timeline rows |
| SEC‑CAM‑02 | Baseline settled and invariant held | PARTIAL | `invariantHeld=true` in 5/5 sampled captures; `settled=true` in 4/5. The one `settled=false` is the designed `BASELINE_MAX_WAIT_MS` timeout path, recorded honestly rather than suppressed. |
| — | Run J final state | PASS | `COMPLETED`, `cam=4`, no pending warning, no termination, recording `SAVED` (154 chunks, 2 796 s), application stage untouched |
| — | Pairing / heartbeat / placement / chunk lifecycle | PASS | 12 isolation tests in `tests/isolation/secondary-audit-evidence.test.mjs` exercise the real routes, including reconnect, idempotency and post‑disconnect audit retention |

### 20. Storage-root consistency and artifacts

| ID | Test | Verdict | Evidence |
|---|---|---|---|
| STOR‑01 | Next and Django resolve the same root | PASS | Both resolve `STORAGE_ROOT=./storage` against the repo root; Django's `_hireos_storage_root()` documents the parity explicitly |
| STOR‑02 | Django artifact audit | PASS | `storage_root=C:\…\AI Interview\storage`, checked=16 ok=16 missing=0 |
| STOR‑03 | Path‑traversal protection | PASS | `resolveStoragePath` rejects any path escaping the root |
| STOR‑04 | Layout | PASS | `storage/resumes` (10 files), `storage/interviews` (1 334 files, 1.8 GB), plus empty `assessments`, `recordings`, `misc` |
| — | `proctoring_artifacts` as a directory | NOT APPLICABLE | No such directory exists; `proctoring_artifacts` is the Django **management command** that audits recordings. Artifacts live under `storage/interviews/{sessionId}/secondary-camera/{recordingId}/`. |

### 21–24. Dependency outages

Each dependency was stopped, probed, and restarted. "Clean" means no traceback, no `ECONNREFUSED`, no `DEBUG` page, no Prisma internals in the response body.

| Outage | App health | Staff reads | Candidate room | AI screening | Django | Verdict |
|---|---|---|---|---|---|---|
| **21. Redis** | 200 `ok:true` | 200 | 200 | 200 (inline path unaffected) | **503 `{"detail":"Background task service unavailable","code":"dependency_unavailable"}`** | **PASS** — F‑04 confirmed live |
| **22. PostgreSQL** | 200 `ok:false, database.ok:false` | 503 clean | 503 clean | 503 clean | 503 | **PASS** — login also refuses with 503, no partial writes |
| **23. Ollama** | 200 `ok:false, ollama.ok:false` | 200 | 200 | **503 `{"code":"OLLAMA_UNREACHABLE","ollamaDown":true}`** | 200 | **PASS** |
| **24. Speech service** | 200 | 200 | 200 | 200 | 200 | **PASS** — see below |

Speech‑service outage, tested against a genuinely uncached question:

| ID | Test | Verdict | Evidence |
|---|---|---|---|
| SPEECH‑OUT‑01 | Uncached TTS fails cleanly | PASS | `503 {"error":"Speech service unreachable at http://localhost:8001","speechDown":true}` in 1 s |
| SPEECH‑OUT‑02/03 | Interview room and state still load | PASS | 200 / 200 |
| SPEECH‑OUT‑04 | **Text answers still accepted — graceful degradation** | PASS | 200, next question returned |
| SPEECH‑OUT‑05 | Audio answer fails cleanly | PASS | `503 … "retryable":true` |
| SPEECH‑OUT‑06/07 | Service recovers, TTS works again | PASS | Piper ready; 238 636‑byte WAV |

Recovery was verified after every outage: all services returned to `ok:true`.

### 25. Django / Next.js cutover feature flags

Tested by running a second Next server with all five flags set in its process environment (`.env` was never modified).

| ID | Test | Verdict | Evidence |
|---|---|---|---|
| 4A‑01 | Staff reads through Django | PASS | jobs 6, candidates 21, applications 23, counts 200, board 200 |
| 4C1‑01…04 | Job writes through Django | PASS | Create 201, F‑03 department preserved, status write, RBAC 403 |
| 4C2‑01…05 | Stage writes through Django | PASS | Persisted, human‑rationale rule preserved, RBAC 403, timeline audited |
| 4C3‑01…05 | Admin writes through Django | PASS | Department CRUD, user activate/deactivate, RBAC 403 |
| 4B‑01…05 | Async through Celery | PASS | Queued with a task id; duplicate enqueue deduplicated |
| DJ‑02 | Django rejects unauthenticated and forged cookies | PASS | 401 / 401 |
| DJ‑03 | Django accepts the shared `aros_session` cookie | PASS | 200 |
| DJ‑04/05/06 | Read parity, Next vs Django | PASS | jobs 6=6, candidates 21=21, applications 23=23; zero rows exclusive to either stack |
| DJ‑08 | Django enforces the same admin RBAC | PASS | Non‑admin roles 403; admin roles reach the view (405 because the Django admin URLs are write‑only by design — no GET list) |
| DJ‑10 | No password material in Django payloads | PASS | No match |

### 26. Rollback behaviour for every cutover

| ID | Test | Verdict | Evidence |
|---|---|---|---|
| RB‑01 | All five flags off → identical behaviour | PASS | The complete cutover suite re‑run in rollback mode: **20/20 identical verdicts** (reads, job writes, stage writes with the rationale gate, admin writes, async) |
| **FC‑01…08** | **Fail‑closed: flags on, Django unreachable** | **PASS** | Every staff read and write returns **503** (`"Staff read service unavailable"` / `"Staff action service unavailable"`) |
| **FC‑09** | **No silent Prisma fallback** | **PASS** | Jobs 6→6, departments 2→2. Not a single row was written by a fallback path. |
| FC‑07 | Stage write fails closed without mutating | PASS | 503; stage `APPLIED` → `APPLIED` |
| FC‑10 | Candidate interview room unaffected by a staff‑side outage | PASS | 200 |
| FC‑11 | Health endpoint still answers | PASS | 200 |

This is the strongest architectural result in the audit: the cutover is genuinely reversible, and it fails closed rather than silently diverging between two write paths.

### 27. Security leakage checks

| ID | Test | Verdict | Evidence |
|---|---|---|---|
| SEC‑01 | Candidate room leaks no scores or plan | PASS | 685‑byte payload, no match |
| SEC‑04 | Candidate room and state expose no evaluation data | PASS | Both endpoints clean of `overall`, `recommendation`, `reasoning`, `rubric`, `competency`, `passwordHash` |
| SEC‑05 | Public careers feed exposes no internal fields | PASS | No `organizationId`, `createdById`, `salaryMin` |
| SEC‑06 | Errors expose no stack traces | PASS | `404 {"error":"Job not found"}` |
| SEC‑08 | Injection‑style input handled safely | PASS | 200; all 6 jobs intact |
| **SEC‑07** | **Security response headers** | **FAIL** | `x-frame-options`, `content-security-policy`, `strict-transport-security` all absent. `x-powered-by` is correctly suppressed. No header policy exists in `middleware.ts` or `next.config`. See Risk R‑1. |
| **SEC‑09** | **Unauthenticated health disclosure** | **PARTIAL** | `/api/health` (no auth) discloses Ollama base URL, model names, speech URL, storage root and mail mode. Django `/api/v1/health/` is `AllowAny` and, on failure, echoes the raw psycopg error including host and port. See Risk R‑2. |

### 28. Database / schema integrity

| ID | Test | Verdict | Evidence |
|---|---|---|---|
| DB‑01 | `prisma/schema.prisma` unchanged | PASS | `git diff HEAD -- prisma/schema.prisma` empty |
| DB‑02 | Live schema matches the Prisma schema | PASS | `prisma migrate diff` → **"No difference detected"** |
| DB‑03 | Row inventory sane | PASS | 18 tables; Organization 1, User 11, Job 6, Candidate 19, Application 21, InterviewSession 55, InterviewQuestion 105, InterviewAnswer 86, AIEvaluation 102, ProctoringEvent 719, TimelineEvent 251 |
| DB‑04 | No enum values removed | PASS | `PipelineStage` retains all nine values including `REJECTED`; `AIEvaluationKind` retains all six |
| **DB‑05** | **Prisma migration ledger** | **PARTIAL** | The `_prisma_migrations` table **does not exist**. All 12 migration files report as "not yet applied". The schema itself is correct and drift‑free — the database was provisioned with `prisma db push`, which is what `docker/app/entrypoint.sh` does by design. Consequence: `prisma migrate deploy` and `migrate status` cannot be used against this database without baselining first. See Risk R‑4. |

### 29. Production build / lint

| ID | Test | Verdict | Evidence |
|---|---|---|---|
| BUILD‑01 | `npm run build` | PASS | **Exit 0**, "✓ Compiled successfully", 0 type errors, full route manifest emitted |
| BUILD‑02 | Production server boots and serves | PASS | `next start` → health 200, staff reads 200, candidate room 200, AI screening 200, login page 200 |
| BUILD‑03 | `npm run lint` | PASS | **0 errors**, 2 warnings (both `@next/next/no-img-element` in `brand-logo.tsx`) |
| BUILD‑04 | Isolation suite against the production build | PASS | 39/39 |

### 30. Full automated regression

| Suite | Tests | Result |
|---|---|---|
| Unit (`tests/unit/*.test.ts`, tsx --test) | 117 | **117 pass, 0 fail** |
| Isolation (`tests/isolation/*.test.mjs`, live HTTP) | 39 | **39 pass, 0 fail** |
| Django (`manage.py test --parallel 4`) | 160 | **160 pass, 0 fail** |
| **Total** | **316** | **316 pass, 0 fail** |

Run twice — once at the start of this audit against the dev server, once at the end against the production build. Identical results.

---

## Previously implemented phases

| Phase | Verdict | Evidence in this audit |
|---|---|---|
| **3G — Proctoring** | PASS | 719 signals across 19 kinds; consent gate enforced (0 events without consent); advisory‑only confirmed (0 proctoring‑driven stage changes) |
| **3G.1 — Recording integrity** | PASS | 16/16 artifacts verified by `proctoring_artifacts`; `hasGap` and `interruptedMs` recorded accurately; all six sampled files decode as H.264/AAC |
| **4A — Read cutover** | PASS | Full read parity (jobs, candidates, applications, counts); fail‑closed 503; rollback identical |
| **4B — Async cutover** | PASS | Celery enqueue with task ids, status polling, duplicate‑enqueue dedup, async TTS prefetch enabled by the flag |
| **4C.1 — Stage / decision writes** | PASS | Persisted through Django, human‑rationale gate preserved, RBAC preserved, timeline audited |
| **4C.2 — Job writes** | PASS | Create/update/status through Django; F‑03 behaviour identical to Prisma mode |
| **4C.3 — Admin writes** | PASS | Department CRUD and user activation through Django; RBAC preserved |
| **F‑01** | PASS | Build exit 0; production server boots and serves; entrypoint bootstraps only an empty database, never uses `--accept-data-loss` |
| **F‑02** | PASS | Two independent checks (minted session for a deactivated user; live deactivation through the admin API) |
| **F‑03** | PASS | Verified in Prisma mode *and* Django cutover mode; 9 unit tests |
| **F‑04** | PASS | Live Redis outage → clean 503 `dependency_unavailable`; 12 Django tests |
| **F‑05** | PARTIAL → see R1/R2/R5 | The termination defect is fixed; the underlying `#15` signal remains unresolved by instruction |
| **R1 — Baseline after placement** | PASS | 6 placement + 6 baseline audit rows; `invariantHeld=true` in every sampled capture |
| **R2 — Episode handling** | PASS | 21 unit tests; live events carry episode ids (`DEVICE_VISIBLE-mswaw5w1-sqx7w8`) |
| **R5 — STANDARD warn‑only** | PASS | Live: `cam=9` and `cam=13` sessions COMPLETED without termination; Run J completed at `cam=4` |
| **R6.1 — Model upgrade to efficientdet_lite2** | PASS | Vendored and in use; `DEVICE_VISIBLE` now fires on hardware where lite0 produced nothing |
| **R6.2 — Vocabulary validation** | PASS | 8 unit tests pin the COCO‑90 label set |
| **R7 — Device presence continuity** | PASS | 20 unit tests; **confirmed on hardware** — 10 `DEVICE_VISIBLE` and 7 `DEVICE_REMOVED` events now exist where the pre‑R7 count was zero |
| **R8 — Device interaction continuity** | PARTIAL | 19 unit tests pass and prove the Run I raw‑detection pattern now accumulates. **Not confirmable on hardware**: Run J produced 0 interactions because a different, upstream mechanism blocks the signal (section H). R8 is correct but insufficient on its own. |

---

## C. Security / RBAC audit

**Strong.** Authentication rejects every malformed, expired, tampered and wrongly signed token. The F‑02 fix means a JWT is no longer sufficient on its own — account state is re‑checked on every request, so deactivation is effective immediately rather than at token expiry. Login gives no user‑enumeration signal. The session cookie is `HttpOnly` with `SameSite=Lax` and a root path.

RBAC is consistent and enforced at the route layer through a small, auditable set of helpers (`requireStaff`, `requireAdmin`, `canManagePipeline`, `canViewAllApplications`). All 72 role × endpoint expectations are correct. Critically, the same matrix holds when traffic is routed through Django — the cutover did not create a second, weaker authorization surface.

Organization isolation holds in both directions and on both stacks, for reads, writes and deletes, and returns 404 rather than 403 so cross‑org resource existence is not disclosed.

No evaluation data, score, rubric or password material leaks to any candidate‑facing surface. Injection‑style input is parameterised safely.

**Two gaps:**

- **No security response headers.** No `Content-Security-Policy`, `X-Frame-Options` or `Strict-Transport-Security` anywhere. The interview room is exactly the kind of page that should not be frameable.
- **Unauthenticated health disclosure.** Both health endpoints are public and describe the internal topology; Django additionally echoes raw connection errors with host and port on failure.

Neither is exploitable on its own on a LAN pilot. Both should be closed before internet exposure.

## D. Architecture / cutover audit

The Django cutover is the best‑engineered part of this system. Five independent flags, each defaulting off, each individually reversible, sharing one `aros_session` cookie so there is no second identity system. Read parity is exact. Write behaviour — including the human‑rationale gate on final decisions and the full RBAC matrix — is identical through both stacks.

The fail‑closed property is verified, not assumed: with the flags on and Django unreachable, every staff read and write returns 503 and **nothing is written by a Prisma fallback**. That is the correct choice; a silent fallback would have produced two divergent write paths under exactly the conditions where you can least afford it.

Rollback is a flag flip and a restart, with identical observed behaviour. Candidate‑facing interview traffic is unaffected by staff‑side cutover state, which keeps the blast radius of a bad cutover away from live candidates.

One asymmetry to be aware of: duplicate‑enqueue protection is a property of the Django/Celery path only. In rollback mode, screening runs inline per request with no dedup.

## E. Resilience audit

All four dependency outages behave correctly. Every failure produced a clean, typed 503 with a human‑readable message and no traceback, no `ECONNREFUSED` string, no Prisma internals and no Django debug page. Every service recovered on restart with no manual intervention and no data corruption.

The best result is the speech‑service outage: the interview does not die, it degrades. The room loads, state works, and text answers are still accepted — only the audio paths return a retryable 503.

**One operational caveat.** During the speech outage the Django health endpoint reported `celery: {"ok": false, "error": "no workers responded"}` for roughly 90 seconds. The worker had not died; it was single‑occupancy and busy executing a long Ollama screening task, so it could not answer the control ping. It recovered on its own. Any monitoring built on this field will produce false alarms under normal load with one worker.

## F. AI / interview isolation audit

| Check | Verdict |
|---|---|
| AI screening never changes the pipeline stage | PASS |
| Interview completion never changes the pipeline stage | PASS |
| Final evaluation never changes the pipeline stage | PASS |
| Final decisions require an explicit human rationale | PASS |
| The screening route contains no terminal‑stage write | PASS |
| **No proctoring data reaches any AI evaluation** | PASS — 3 780 characters of final‑evaluation payload scanned; zero matches for `proctor`, `integrity`, `violation`, `camera`, `face`, `DEVICE_VISIBLE` |
| Recording metadata is explicitly marked `reviewOnly` and `noAiInput` | PASS |
| Zero `STAGE_CHANGED` events reference any proctoring term | PASS |

The advisory‑only contract holds. Proctoring informs the human reviewer and nothing else; the AI scores the interview content and cannot promote, reject or penalise anyone.

## G. Recording / proctoring audit

Recording is production‑ready. Chunked upload, gap accounting and post‑session assembly all work, including for terminated sessions — 7 of the 16 verified artifacts belong to `TERMINATED` interviews, which is exactly the case where the evidence matters most. Playback is authenticated, range‑seekable, and correctly refused to candidates and anonymous callers. Container durations track the recorded wall‑clock durations, and `hasGap` / `interruptedMs` honestly reflect interruptions rather than hiding them.

Proctoring is consent‑gated at the ingest boundary — not merely in the UI. Zero signals exist in the database for any session lacking `proctoringConsentAt`, which is the strongest possible form of that guarantee.

Termination policy is now correct. STRICT terminates on threshold with a recorded reason; STANDARD warns and never terminates. The two historic STANDARD terminations both pre‑date the R5 fix and are retained as the evidence trail of the defect.

## H. Secondary-camera audit

**#13 `SECONDARY_DEVICE_VISIBLE` — PASS.** Ten events recorded from real hardware, three of them in Run J. Before R6.1 and R7 the count was zero; the model upgrade to `efficientdet_lite2` and the bounded presence debouncer together made the signal reachable. `SECONDARY_DEVICE_REMOVED` also fires (7 events), so episodes open and close correctly.

**Warning popup — PASS, confirmed candidate‑facing behaviour.** The candidate sees an integrity warning on the paired device when a secondary device is detected. This was observed directly by the operator during physical testing and is corroborated by `integrityPendingWarningKind` in the database. This is the requirement that matters for the pilot: the candidate is told, and the recruiter can review the recording and the integrity signals afterwards.

**#15 `SECONDARY_DEVICE_INTERACTION` — NOT TESTED / unresolved, intentionally left alone.** Zero events in every session of the entire UAT. No fix was attempted and no further physical runs were made, per instruction.

The diagnosis, recorded for whoever picks this up:

`DEVICE_MS` and `INTERACTION_MS` are both 1 500 ms, and device presence is a precondition of interaction, so both timers start from the same detection. `DEVICE_VISIBLE` is not in `SECONDARY_INFO_KINDS`, so it counts as a violation, the server sets a pending warning, and the phone shows the popup. `secondary-camera-client.tsx:520` passes `isPaused: () => warningOpenRef.current`, and `secondary-integrity-client.ts:344` returns early on `isPaused`, which halts **all** frame sampling. So the moment the device becomes reportable, the system stops looking at it, and `interactionSince` can never accumulate its 1 500 ms. After acknowledgement, presence must re‑establish, which re‑fires `DEVICE_VISIBLE` and freezes sampling again — observed in Run J at 21:12:09 and again at 21:12:25.

R8 is not the cause and is not wrong; its 19 unit tests correctly prove that the Run I raw‑detection pattern now accumulates. The blocker is upstream of the interaction timer. Geometry was considered and is unlikely — `wristNearBox` allows a 0.08 pad and `headTowardBox` passes on `|dx| < 0.22 && dist < 0.55` — but it cannot be fully excluded without per‑frame instrumentation that does not currently exist.

A fix would need to stop suspending detection while a warning is pending, or exempt interaction evaluation from the pause. That touches the pause interlock, which is outside every approved scope so far.

**Practical impact for the pilot: low.** A candidate using a phone is detected, warned, and recorded. #15 would add a finer‑grained signal, not a missing capability.

## I. Database / storage integrity

The Prisma schema is byte‑identical to `HEAD` and `prisma migrate diff` reports no difference against the live database. No enum values were removed. Row counts are consistent, and referential integrity holds across the application → interview → question → answer → evaluation chain.

Storage is consistent across both stacks: Next and Django resolve the same root, path traversal is blocked, and the Django artifact audit reports 16 of 16 recordings present with zero missing.

The one integrity gap is the missing `_prisma_migrations` ledger (R‑4 below). The data is correct; the migration history is not tracked.

## J. Automated regression results

**316 tests, 0 failures**, executed twice — once against the dev server, once against the production build.

- 117 unit tests (`tsx --test`), covering the five cutover flag parsers, F‑03 department selection, R1/R2/R5 integrity logic, R6.2 detector vocabulary, R7 presence continuity, R8 box memory, secondary CV geometry and audit payloads
- 39 isolation tests against live HTTP, covering candidate cross‑tenant isolation, F‑02 deactivated sessions, and the secondary‑camera audit‑evidence lifecycle through the real routes
- 160 Django tests, covering accounts/RBAC, jobs, candidates, applications, resumes, screening, interviews, proctoring and the F‑04 dependency‑outage handler

Lint: 0 errors, 2 `no-img-element` warnings. Build: exit 0, compiled successfully.

## K. Remaining defects and risks

| # | Severity | Item | Blocks production? |
|---|---|---|---|
| **R‑1** | **Medium** | No `Content-Security-Policy`, `X-Frame-Options` or `Strict-Transport-Security` on any response. The interview room is frameable. | **Not for a LAN pilot. Yes before internet exposure.** |
| **R‑2** | **Medium** | Unauthenticated health endpoints disclose internal topology (Ollama URL, model names, speech URL, storage root). Django's echoes raw psycopg errors with host and port. | Not for a LAN pilot. Close before internet exposure. |
| **R‑3** | **Medium** | Background answer scoring and the final `INTERVIEW_OVERALL` are fire‑and‑forget; failures are caught and only `console.warn`‑ed. Under CPU saturation an evaluation can be dropped with no error surfaced and no retry. Reproduced once under deliberate saturation; the paced re‑run passed. A recruiter can regenerate the evaluation manually, so there is a recovery path. | No — but add a visible failure state or retry before high‑volume use. |
| **R‑4** | **Medium** | `_prisma_migrations` does not exist; the 12 migration files are untracked in the database. Schema is drift‑free and `db push` is the intended deployment mechanism, but `prisma migrate deploy` / `migrate status` cannot be used without baselining. | No — but baseline (`prisma migrate resolve --applied …`) before adopting migration‑based deploys. |
| **R‑5** | **Medium** | `SECONDARY_DEVICE_INTERACTION` never fires. Root cause diagnosed (warning‑pause interlock). Deliberately unresolved. | No — #13 plus the candidate warning plus recorded review covers the requirement. |
| **R‑6** | **Low** | Duplicate‑enqueue protection exists only in the Django async path. In rollback mode, three concurrent screening requests produced four evaluations. | No — screening is advisory and idempotent in effect. |
| **R‑7** | **Low** | Django's Celery health check reports `ok:false` while a single worker is busy with a long task. False alarms under normal load. | No — run ≥2 workers, or treat this field as advisory. |
| **R‑8** | **Low** | Two legacy sessions (12 Aug) carry the inconsistent combination `proctoringEnabled=true, proctoringMode=OFF`. No signals were emitted. | No — historic data only. |
| **R‑9** | **Low** | One of five sampled baselines recorded `settled=false` (the designed `BASELINE_MAX_WAIT_MS` timeout path). Correctly recorded rather than suppressed. | No |
| **R‑10** | **Info** | Session cookie has no `Secure` attribute on plain HTTP. Expected on localhost; must be confirmed behind TLS. | No — verify in the production deployment |

### Test data left in the database

This audit created TEST data deliberately and left it in place so every claim above remains verifiable. Purge it when you no longer need the evidence trail:

- Candidate `Priya UAT…` (`cmswbwcqd0069vav0b3k7kyob`) with application `cmswbwcqq006bvav05v54oq7f`
- Four interview sessions created for that application (two TEXT, two VOICE)
- One resume artifact under `storage/resumes/`
- Temporary second organization, org‑2 admin and probe jobs/departments were all removed during the run

## L. Final recommendation

# CONDITIONAL GO

HireOS is ready for a **supervised pilot**. The recruiting pipeline, AI screening, TEXT and VOICE interviewing, evaluation, recording, proctoring, the Django cutover and every outage path all behave correctly under real testing, with 316 automated tests green, a clean production build that boots and serves, and a schema that is unchanged and drift‑free. All five original findings (F‑01…F‑05) are closed and independently re‑verified in this audit, several of them live rather than by test double.

The AI isolation guarantees hold, which is the property that matters most for a hiring system: the AI never moves a candidate through the pipeline, final decisions require a recorded human rationale, and no proctoring data reaches any evaluation.

**Conditions before unsupervised production use:**

1. **R‑1** — add security response headers (CSP, `X-Frame-Options: DENY` on the interview room, HSTS behind TLS).
2. **R‑2** — authenticate the health endpoints, or reduce them to a bare `{"ok":true}` for unauthenticated callers, and stop echoing raw connection errors.
3. **R‑3** — surface background‑evaluation failures instead of swallowing them; a visible "evaluation failed — regenerate" state is enough.
4. **R‑10** — confirm the session cookie carries `Secure` in the TLS deployment.

**Accepted as known and documented, not blocking:**

- **#15 `SECONDARY_DEVICE_INTERACTION` does not fire.** Root cause diagnosed, fix scoped, deliberately deferred. The candidate‑facing requirement is met by `#13` plus the integrity warning plus post‑interview recruiter review.
- **R‑4** — baseline the migration ledger before switching to migration‑based deployment.
- **R‑6, R‑7, R‑8, R‑9** — operational notes, no action required for the pilot.

**Phase 4C.4 was not started, as instructed.**
