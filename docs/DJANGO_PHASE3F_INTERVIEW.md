# Logisoft HireOS — Django Phase 3F: Interview engine + Celery (real-time safe)

**Status:** Complete for background-only work. Next.js interview routes remain the live source of truth.  
**Date:** 2026-08-15  
**Audit:** `docs/DJANGO_PHASE3F_INTERVIEW_AUDIT.md`

Prisma schema was **not** changed. No frontend cutover. No live-turn Celery. No proctoring / secondary-camera / Application.stage / candidate / job write migration.

---

## 1. Existing interview architecture

Staff create: `POST /api/applications/[id]/interviews` → `generatePlan` (Ollama, template fallback) → `InterviewSession` **SCHEDULED** with `plan` JSON, `accessToken`, `tokenExpiresAt`, `durationMinutes`, `maxQuestions`, `deliveryMode` TEXT|VOICE. Timeline `INTERVIEW_SCHEDULED`. **Does not change Application.stage.**

Candidate room uses magic `accessToken` (public `/interview/*`). Start requires a parseable `session.plan`. Opening question is persisted from the plan. `endsAt = startedAt + durationMinutes`.

Live TEXT: `POST /api/interview/[token]/answer` `{ answerText, durationSec? }`.  
Live VOICE: `POST /api/interview/[token]/answer-audio` → local speech-service STT (`:8001`) → same `submitInterviewAnswer`.

`processAnswerTurn` (`src/lib/ai/process-answer-turn.ts`) calls **`decideNextTurn` with `modelResult: null`**. Next question is **deterministic code**, not an LLM. Heuristic `answer.evaluation` is written in the same request. LLM `evaluateAnswerOnly` / `finalEvaluation` run as `void scoreInBackground` after the HTTP response is already decided.

There is no separate InterviewPlan table — plan is `InterviewSession.plan`.

---

## 2. Audit results

Full trace: `docs/DJANGO_PHASE3F_INTERVIEW_AUDIT.md`.

The existing engine already splits **fast turn** vs **heavy AI**:

- Candidate next question does **not** wait for Ollama scoring.
- Plan generation is **staff HTTP at create**, not a live turn.
- TTS is prefetched (`void prefetchQuestionTts`) with GET `/question-audio` fallback.
- Duration and completion are enforced in the Next.js turn, not a queue.

Phase 3F therefore **must not** put a Celery hop between answer and next question.

---

## 3. Real-time vs background classification

| Class | Operations | Migrated? |
|---|---|---|
| **A REAL-TIME** | token/expiry/status, start, answer persist, session lock, 409 duplicate, `decideNextTurn`, `endsAt`, heuristic eval, VOICE STT, continue/reconnect | **No** — stay on Next.js |
| **B BACKGROUND** | `generatePlan` on SCHEDULED; staff-equivalent `finalEvaluation` on COMPLETED | **Yes** — Celery |
| **C HYBRID** | TTS prefetch (cache `ttsPath`); GET audio still generates if missing | **Yes** prefetch task; live GET fallback unchanged |

Per-answer `evaluateAnswerOnly` is already fire-and-forget in Next.js. It was **not** moved to Celery in 3F so a live turn cannot depend on a worker being up. Making that durable is a future option, not a live-path change.

---

## 4. Existing prompt architecture

Unchanged. Workers call existing TypeScript.

**Plan (`PLAN_SYSTEM`):** adaptive plan designer; competencies/topics; opening question; JSON plan schema; `temperature: 0.1`, `numPredict: 900`. Inputs: job, candidate, resume slice (~4000), optional latest `RESUME_SCREEN` gaps. **No proctoring.**

**Answer score (`SCORE_SYSTEM`):** score one answer; “Do not write a next question. Do not mention proctoring.” Used only in background scoring, not for question selection.

**Final:** `finalEvaluation` over plan + transcript + resume slice (~5000). Advisory `INTERVIEW_OVERALL`.

Python does not reconstruct prompts. Fingerprints: `python manage.py interview_parity --limit 3`.

---

## 5. Adaptive engine behavior

Source of truth: `decideNextTurn` in `src/lib/ai/interview-guard.ts` (job-scoped topics, no repeats, coverage, `maxQuestions`, duration). `processAnswerTurn` does **not** call LLM `nextTurnWithState`. `adaptive-interview.ts` `generateNextQuestion` is unused legacy.

Celery **does not choose questions**. Plan regeneration on SCHEDULED only updates `session.plan` while status stays SCHEDULED; it does not run during IN_PROGRESS.

---

## 6. Celery tasks introduced

IDs only on the queue. Worker loads Prisma data via `tsx` scripts.

| Task | HTTP | When | Script |
|---|---|---|---|
| `interviews.generate_plan` | `POST /api/v1/interviews/plan/` `{session_id}` | status **SCHEDULED** | `scripts/generate-interview-plan.mjs` → `generatePlan` |
| `interviews.finalize_interview` | `POST /api/v1/interviews/finalize/` `{session_id}` | status **COMPLETED** | `scripts/finalize-interview.mjs` → `finalEvaluation` + new `INTERVIEW_OVERALL` + `AI_EVALUATION` timeline (same as staff regenerate) |
| `interviews.prefetch_question_tts` | `POST /api/v1/interviews/tts/` `{session_id, question_id}` | question in org session | `scripts/prefetch-question-tts.mjs` → `ensureQuestionTts` |

Auth: HireOS JWT + **RecruitmentStaff** (not INTERVIEWER / CANDIDATE). Org from JWT. Cross-org / missing session → **404**. Queue body is only `{status, task_id, kind}`.

`GET /api/v1/interviews/status/?session_id=&kind=plan|finalize|tts` (optional `question_id` for TTS).

Does **not** mark the session COMPLETED. Finalize requires COMPLETED already.

---

## 7. Redis locks

| Kind | Lock key | Status key |
|---|---|---|
| plan | `interview:plan:{sessionId}` | same family |
| finalize | `interview:finalize:{sessionId}` | |
| tts | `interview:tts:{questionId}` | |

SET NX, TTL **900s**. Concurrent POST → `already_processing` + same `task_id`. Bounded retry ≤ 3, backoff `min(60, 5*2^n)`. Task `time_limit` 360s (TTS 120s).

---

## 8. TTS handling

Existing `ensureQuestionTts`: Piper via local speech-service; cache `InterviewQuestion.ttsPath` under `storage/interviews/{sessionId}/q{n}.wav`. Identical text/voice reuses path.

Live candidate GET `/api/interview/[token]/question-audio/[sequence]` still generates if uncached. Celery prefetch is optional and **not** on the answer→next-question path.

Live cache hit: question `cmssv57v2001cjfxp1mgsijca` → `cached: true`, worker **0.88 s**.

---

## 9. Voice handling

VOICE STT remains on Next.js `answer-audio`. Speech-service was **not** put behind Celery. Next.js `/api/health` reported speech **ok** (`http://localhost:8001`, Whisper small, Piper `en_US-lessac-medium`). A full microphone→TTS device interview was **not** run in this phase.

---

## 10. Duration enforcement

Unchanged in `processAnswerTurn` (`isSessionTimeUp` → save current answer then CONCLUDE). **Not** a Celery job. Link `tokenExpiresAt` still 410 on Next.js. Django background tasks refuse IN_PROGRESS plan regen (`session_not_scheduled`).

---

## 11. Session security

Django staff APIs: JWT + org match on `InterviewSession` → Job. Candidate JWT cannot enqueue. Candidate live APIs still use `accessToken` on Next.js only. Queue/status APIs do not return plan text, transcripts, scores, or reports. Staff reports stay on existing Next.js dashboard routes.

---

## 12. Proctoring isolation

Interview AI prompt construction (plan / score / final) does not consume TAB_BLUR, TAB_FOCUS, WINDOW_SWITCH, FULLSCREEN_EXIT, COPY_PASTE, NO_FACE, MULTIPLE_FACES, secondary-camera, or integrity events. `SCORE_SYSTEM` explicitly forbids mentioning proctoring. Unit test scans `backend/services/interviews` and `backend/apps/interviews` for those strings. Phase 3F did **not** migrate proctoring ingest.

---

## 13. Latency measurements

Live candidate TEXT/VOICE turns were **not** re-instrumented with P50/P95 in this phase (that would require a scripted interview loop against Next.js). Architecture: next question does not call Ollama; scoring is `void` after the response. **Do not claim Django/Celery made live interviews faster.**

Background path (measured 2026-08-15, local Ollama `qwen2.5:7b`):

| Path | Enqueue HTTP | Duplicate while locked | Worker |
|---|---|---|---|
| `generate_plan` session `cmsq1nfgs0003meibxinw992c` (candidate@local.dev, SCHEDULED) | **84.8 ms** | **47.8 ms**, same task_id | **131.28 s** |
| `prefetch_question_tts` (cache hit) | **66.9 ms** | — | **0.88 s** |
| `finalize_interview` session `cmssuxuyk000vjfxpxspi3ob5` (cameron@example.com, already COMPLETED) | **104.5 ms** | — | **205.84 s** |

HTTP does not wait for Ollama. Bottleneck is the chat model, not Redis enqueue.

---

## 14. Parity results

**Deterministic orchestration:** same `generatePlan` / `finalEvaluation` / `ensureQuestionTts` modules. Prompt fingerprints:

| session_id | status | prompt_stable | existing_topic_count |
|---|---|---|---|
| cmsq1nfgs0003meibxinw992c | SCHEDULED | yes | 4 |
| cmst3vi5s0005bjo3vwnt0cnm | TERMINATED | yes | 4 |
| cmssx4xka0005l1djxr6q5s5w | TERMINATED | yes | 4 |

`interview_parity --limit 3` → **checked=3 failed=0**.

**Live plan regen** (designated SCHEDULED local.dev): model `qwen2.5:7b`, `topic_count` 4, session **still SCHEDULED**, `application_stage_untouched`. LLM text is **not** byte-stable (temperature 0.1).

**Live finalize:** new `INTERVIEW_OVERALL` `cmsuf3ivr0001ufmr0ysq6iow`, recommendation **NO**, overall **58**, model `qwen2.5:7b`. Session **still COMPLETED**. Application **still ASSESSMENT / ACTIVE**. Overall eval count 1 → 2 (history, same as Next regenerate). Advisory only.

Adaptive question order was **not** re-run through a second engine because Celery does not select questions.

---

## 15. Concurrency tests

| Case | Result |
|---|---|
| Duplicate plan POST while locked | `already_processing`, same `task_id` (live + unit) |
| Plan while IN_PROGRESS | 400 `session_not_scheduled` (unit) |
| Finalize while SCHEDULED | 400 (unit) |
| Live answer double-submit | existing Next.js in-memory lock **429** + unique `questionId` **409** — **unchanged**, not reimplemented in Django |

---

## 16. Failure tests

| Class | Behavior |
|---|---|
| Transient (Ollama/speech timeout, tsx, OSError) | Celery retry ≤ 3 |
| Permanent (wrong org, not SCHEDULED/COMPLETED, invalid session) | no retry |
| Redis lock | duplicate enqueue shares task |
| Worker down | HTTP still returns queued; candidate live turns do not use this worker |
| Live Ollama fail after answer save | existing Next.js 503 + `/continue` — unchanged |
| Browser refresh / IN_PROGRESS reconnect | existing Next.js start `alreadyStarted` — unchanged |

A dedicated Redis-down / worker-kill chaos run was **not** performed beyond lock + unit coverage.

---

## 17. Security / regression results

**Live HTTP**

| Case | Result |
|---|---|
| no JWT plan POST | **401** |
| CANDIDATE plan POST | **403** |
| recruiter jobs GET | **200** |
| Django `/api/v1/health/` | postgres/redis/celery **ok** |
| Next.js `GET http://127.0.0.1:3000/api/health` | **ok**, local Ollama, speech **ok** |

**Unit** (`InterviewQueueTests`): INTERVIEWER 403; cross-org 404; queue body has no plan/topics; Python packages contain no proctoring signal names.

`python manage.py check` → no issues.  
`python manage.py test apps.accounts apps.jobs apps.candidates apps.applications apps.files apps.screening apps.interviews` → **98 OK**.

Next.js interview routes (`/api/interview/[token]/answer`, `answer-audio`, `continue`, start, question-audio, proctoring) **still present**. Recruiter UI was **not** pointed at Django.

**Not claimed:** full TEXT interview, full VOICE interview, system-check, consent, or enhanced secondary-camera pairing on a real device in this phase.

---

## 18. Known limitations

- Next.js staff create-interview still runs `generatePlan` **in-request**; dashboard is not switched to the Django queue.
- Live turns still use process-local session locks (not Redis).
- Per-answer LLM scoring remains Next.js `void` (lost if the Node process dies mid-score); not Celery.
- Temperature 0.1 → plan/final text and scores can differ across runs.
- Django SUPER_ADMIN is org-scoped (Phase 2).
- Windows Celery uses `-P solo`. Stale workers without `interviews.*` tasks will `NotRegistered`.
- Redis status is TTL-based (no Prisma processing column).

---

## 19. Future migration plan (not started — wait for Phase 3G approval)

1. Optionally enqueue plan from staff create so recruiters do not block on Ollama; block candidate **start** until plan parseable (already required).
2. Optionally durable-queue `evaluateAnswerOnly` **without** changing `decideNextTurn`.
3. Optionally prefetch TTS from Celery after next question insert; keep GET fallback.
4. Only after product approval: point staff UI at Django; later candidate room cutover.
5. Do **not** queue STT or next-question selection.

**STOP. Do not start Phase 3G without approval.**
