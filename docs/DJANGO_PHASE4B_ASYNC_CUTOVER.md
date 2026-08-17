# Logisoft HireOS — Django Phase 4B: Async staff action cutover

**Status:** Implemented. Feature flag **defaults OFF**.  
**Date:** 2026-08-15  
**Does not start Phase 4C.**

Phase 4A reads are unchanged (`NEXT_PUBLIC_USE_DJANGO_READS`). This flag is independent.

---

## 1. Existing synchronous flow (audit)

| Workload | Frontend | Next.js | Current behavior | Celery (Phase 3) | DB writes | UI |
|---|---|---|---|---|---|---|
| Resume process | `resume-upload.tsx` → `POST /api/documents/upload` | Parse + `embedCandidate` in request | Sync ~seconds–minutes | `files.process_resume` via `POST /api/v1/resumes/process/` | `Candidate.resumeUrl/text/embedding`; timeline `DOCUMENT_UPLOADED` | Toast parsed / parse error |
| AI screening | `ai-screening-card.tsx`, `screen-all-button.tsx` | `POST /api/applications/:id/screen` → `screenApplication` | Sync ~90s Ollama | `screening.screen_application` | New `AIEvaluation` RESUME_SCREEN; timeline; embed; **no stage change** | Button “Screening… (10–40s)” |
| Interview plan | `create-interview-dialog.tsx` | `POST /api/applications/:id/interviews` → `generatePlan` then create session | Sync ~130s | `interviews.generate_plan` needs **existing SCHEDULED** session | Session + timeline `INTERVIEW_SCHEDULED`; **no stage change** | Dialog waits up to 240s |
| Interview finalize | `interview-report.tsx` regenerate | `POST /api/interviews/:id/regenerate-evaluation` → `finalEvaluation` | Sync ~200s | `interviews.finalize_interview` | New `INTERVIEW_OVERALL`; timeline; **no stage change** | “Regenerating…” |
| TTS prefetch | Candidate start/state/answer | `prefetchQuestionTts` / `ensureQuestionTts` | Fire-and-forget on **live** path | `interviews.prefetch_question_tts` | `InterviewQuestion.ttsPath` | Live audio GET fallback |
| Post-session proctoring | Recruiter interview RSC salvage | `finalizeSecondaryRecording` on page load | Sync assemble | `proctoring.process_session` | Recording metadata; report; pair token; **no stage change** | Playback / review |

**Not cut over:** live answer turns, STT, voice loop, chunk ACK, integrity TERMINATE, portal/careers resume, job/candidate/stage writes.

---

## 2. New async flow

```
Browser → Next.js same-origin BFF (aros_session) → Django enqueue → Redis lock → Celery → existing TS engines
HTTP returns { status: queued|already_processing, task_id, kind }
UI polls Next status BFF (Django Redis + Prisma state) with backoff until COMPLETED/FAILED
```

No second token. No silent Next.js fallback if Django is down while the flag is on.

---

## 3. Feature flag

`NEXT_PUBLIC_USE_DJANGO_ASYNC` default **false**.

| Value | Behavior |
|---|---|
| false | Existing Next.js sync/heavy paths |
| true | Approved staff heavy actions enqueue Django/Celery |

Rollback: set `false`, restart Next.js.

Independent of `NEXT_PUBLIC_USE_DJANGO_READS`.

---

## 4. APIs switched (flag=true)

| Next BFF | Django | Task |
|---|---|---|
| `POST /api/documents/upload` (after storing file) | `POST /api/v1/resumes/process/` | `files.process_resume` |
| `GET /api/documents/process-status` | `GET /api/v1/resumes/status/` | Redis |
| `POST /api/applications/:id/screen` | `POST /api/v1/screening/` | `screening.screen_application` |
| `GET /api/applications/:id/screen-status` | `GET /api/v1/screening/status/` | Redis |
| `POST /api/applications/:id/interviews` | create session (template plan) then `POST /api/v1/interviews/plan/` | `interviews.generate_plan` |
| `POST /api/interviews/:id/regenerate-evaluation` | `POST /api/v1/interviews/finalize/` | `interviews.finalize_interview` |
| `GET /api/interviews/:id/async-status` | `GET /api/v1/interviews/status/` | Redis |
| `POST /api/interviews/:id/prefetch-tts` | `POST /api/v1/interviews/tts/` | `interviews.prefetch_question_tts` |
| `POST /api/interviews/:id/proctoring-process` | `POST /api/v1/proctoring/process/` | `proctoring.process_session` |
| `GET /api/interviews/:id/proctoring-process-status` | `GET /api/v1/proctoring/status/` | Redis |

---

## 5. APIs not switched

- Live `/api/interview/[token]/*` (start, answer, STT, question-audio)
- Live `prefetchQuestionTts` on candidate start/state/answer
- Recording chunk upload / finalize / ACK
- Integrity terminate
- Job/candidate/application/stage/tags/notes writes
- Portal and careers resume parse (candidate-triggered)
- `POST /api/jobs/:id/screen-all` (unused by UI; Screen all uses per-application POST)

---

## 6. Celery tasks reused

No new workers. `files.process_resume`, `screening.screen_application`, `interviews.generate_plan`, `interviews.finalize_interview`, `interviews.prefetch_question_tts`, `proctoring.process_session`.

---

## 7. Status handling

UI maps Redis/API status to Queued / Processing / Completed / Failed.

Poll: 1s → 2s → 4s → 8s cap. Stop on COMPLETED, FAILED, CANCELLED, or ~5 minutes.

Do not re-POST while polling.

If an evaluation already exists, screening card still shows it while a re-run is queued.

---

## 8. Idempotency

Existing Redis NX locks. Second click → `already_processing` + same `task_id`. UI treats that as accepted (not a new job).

---

## 9–11. Auth / RBAC / org

Same as Phase 3: `aros_session` forwarded server-side. RecruitmentStaff on Django (not INTERVIEWER/CANDIDATE). Org from JWT, never from the browser. Cross-org 404. Invalid JWT 401. Wrong role 403.

---

## 12–13. Performance

**Before (Next.js HTTP waits for Ollama / parse)** — from Phase 3 live runs, not re-run here to avoid extra GPU load:

| Action | Next.js request (approx) |
|---|---|
| Resume process (small txt) | ~1.8 s in-request parse+embed |
| Screening | ~90 s |
| Plan generation | ~131 s |
| Finalization | ~206 s |

**After (Django enqueue, n=7, 2026-08-15, recruiter JWT, live `:8000`)**

First POST acquired the Redis lock (`queued`); the following 6 returned `already_processing` with the **same `task_id`**.

| Enqueue | avg | P50 | P95 | n |
|---|---|---|---|---|
| Resume `POST /api/v1/resumes/process/` | 43.6 ms | 35.5 ms | 93.3 ms | 7 |
| Screening `POST /api/v1/screening/` | 42.4 ms | 40.2 ms | 54.3 ms | 7 |
| Plan `POST /api/v1/interviews/plan/` | 41.4 ms | 38.3 ms | 64.2 ms | 7 |
| Finalize `POST /api/v1/interviews/finalize/` | 42.6 ms | 38.9 ms | 61.2 ms | 7 |

**Worker duration is unchanged** (still Ollama / ffmpeg / parser). Phase 4B makes the **HTTP** request fast. **Ollama did not get faster.**

Worker timings from Phase 3 (not re-optimized): resume ~1.8 s on the txt fixture; screening ~90 s; plan ~131 s; finalize ~206 s.

---

## 14. Failure handling

Django/Redis/Celery down → BFF 503. UI shows an error. Screening/plan/finalize toasts do **not** say started unless `queued` / `already_processing`. Resume: file may be stored; error states processing was not queued.

---

## 15. Rollback

`NEXT_PUBLIC_USE_DJANGO_ASYNC=false` then restart Next.js. Flag false was not toggled in this environment’s live `.env` (default remains off).

---

## 16. AI parity

Celery still runs `scripts/screen-application.mjs` → `screenApplication`. No prompt/model/temperature edits in this phase. LLM reasoning text remains nondeterministic.

---

## 17. Interview parity

Plan worker still `scripts/generate-interview-plan.mjs`. Finalize still `scripts/finalize-interview.mjs`. Create-interview with flag on inserts a template plan then queues LLM overwrite while SCHEDULED. Application.stage not written by these tasks.

---

## 18. Proctoring parity

`proctoring.process_session` unchanged. Recruiter terminal sessions enqueue instead of sync RSC salvage when the flag is on. Live ingest/chunks/ACK unchanged.

---

## 19. Regression

- `python manage.py check` clean  
- `python manage.py test` **112 OK**  
- `tests/unit/staff-async.test.ts` + `staff-reads.test.ts` **10 pass**  
- Prisma schema not modified  
- Login/cookie/`AUTH_SECRET` not modified  

Concurrency: 7 POSTs per workload returned one `task_id` after the first lock (`already_processing`).

Worker interruption was **not** newly crash-tested in 4B; Phase 3 lock/retry behavior remains.

---

## 20. Files changed

- `src/lib/staff-async/*`
- `src/lib/staff-reads/django-client.ts` (POST)
- Next BFF routes listed in §4
- `src/app/api/documents/upload/route.ts` (GET parse skipped when flag on)
- `src/app/api/applications/[id]/screen/route.ts`
- `src/app/api/applications/[id]/interviews/route.ts`
- `src/app/api/interviews/[id]/regenerate-evaluation/route.ts`
- `src/components/ai-screening-card.tsx`, `resume-upload.tsx`, `screen-all-button.tsx`, `create-interview-dialog.tsx`, `interview-report.tsx`
- `src/components/staff-async-side-effects.tsx`
- `src/app/dashboard/interviews/[id]/page.tsx` (terminal salvage vs enqueue)
- `.env.example`
- `tests/unit/staff-async.test.ts`
- `docs/DJANGO_PHASE4B_ASYNC_CUTOVER.md`

---

## 21. Known limitations

1. Interview create with flag on uses **template plan immediately**, then Celery overwrites `session.plan` while **SCHEDULED**. Candidate can start before LLM plan completes (template is existing `buildFallbackInterviewPlan`). Dialog polls until plan COMPLETED.
2. Live TTS remains Next.js. Staff TTS prefetch only for persisted questions (after start).
3. Portal/careers resume still sync.
4. SUPER_ADMIN remains org-scoped on Django.
5. Screen-all queues jobs quickly but does not wait for every worker to finish.
6. Ollama is not faster.

