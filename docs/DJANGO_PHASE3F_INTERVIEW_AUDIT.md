# Logisoft HireOS — Phase 3F interview engine audit

**Status:** Audit complete. Implementation: `docs/DJANGO_PHASE3F_INTERVIEW.md`.  
**Date:** 2026-08-15  
**Sources:** Prisma `InterviewSession` / `InterviewQuestion` / `InterviewAnswer`; `src/app/api/applications/[id]/interviews/route.ts`; `src/app/api/interview/[token]/{start,answer,answer-audio,continue,question-audio}`; `src/lib/ai/{interview.ts,interview-guard.ts,process-answer-turn.ts,submit-interview-answer.ts,interview-session.ts}`; `src/lib/question-tts.ts`; `src/lib/speech.ts`.

---

## 1. Session lifecycle (actual)

Staff `POST /api/applications/[id]/interviews` (`canManagePipeline`): **synchronously** `generatePlan` (Ollama, fallback template on failure) then `InterviewSession.create` **SCHEDULED** with `plan` JSON, `accessToken` (32-byte hex), `tokenExpiresAt` (1/3/7 days), `durationMinutes` (15/30/45/60), `maxQuestions` (3–30, default 12), `deliveryMode` TEXT|VOICE, proctoring/integrity flags. Timeline `INTERVIEW_SCHEDULED`. **Does not change Application.stage.**

Candidate room uses **magic `accessToken`**, no staff JWT (`/interview/*` public in middleware).

| Check | Behavior |
|---|---|
| Unknown token | 404 |
| `tokenExpiresAt` past | **410** |
| COMPLETED start | 400 |
| TERMINATED / CANCELLED | 410 |
| STRICT without `integrityConsentAt` | 403 on start |
| IN_PROGRESS reconnect | start returns `alreadyStarted` + first question + `endsAt` |

`endsAt` = `startedAt + durationMinutes`. Enforced in `processAnswerTurn` (`isSessionTimeUp` → force CONCLUDE after saving the current answer). **Not** a Celery job.

There is **no** separate InterviewPlan table — plan is `InterviewSession.plan` Json.

---

## 2. Live turn contract (TEXT)

`POST /api/interview/[token]/answer` `{ answerText, durationSec? }`

1. Session IN_PROGRESS + token valid  
2. In-memory `tryAcquireSessionLock` (one in-flight turn; else **429** retryable)  
3. Current unanswered question; existing `InterviewAnswer` on that `questionId` → **409**  
4. `interviewAnswer.create`  
5. `processAnswerTurn`: **`decideNextTurn` in code** (`modelResult: null`) — next question is **deterministic**, not LLM  
6. If time up → CONCLUDE  
7. Write heuristic `answer.evaluation` immediately; update `adaptiveState`  
8. CONCLUDE → status COMPLETED, `endedAt`, secondary-camera cleanup, `INTERVIEW_COMPLETED` timeline; **then** `void scoreInBackground`  
9. Else create next `InterviewQuestion`, `prefetchQuestionTts` (non-blocking), `void scoreInBackground`  
10. Response **only** `{ concluded: true }` or `{ concluded: false, nextQuestion: { sequence, question } }` — **never scores**

If Ollama fails **after** save: 503 `retryable: true`; client `POST /continue` (no resubmit).

**VOICE** `POST .../answer-audio`: local STT (`speech-service` :8001) then **same** `submitInterviewAnswer`. Speech down → 503 `speechDown`. Transcript returned to room; scores still hidden.

**Start:** persist opening from **existing plan** as sequence 1; prefetch TTS. Candidate cannot start without a parseable plan (`parsePlan` on `session.plan`).

---

## 3. Adaptive engine (source of truth)

Live next-question path: `decideNextTurn` in `interview-guard.ts` (job-scoped topics, no repeats, coverage, maxQuestions, duration). LLM `nextTurnWithState` exists but **`processAnswerTurn` does not call it**. Scoring LLM is **after** the candidate already has the next question.

`src/lib/ai/adaptive-interview.ts` `generateNextQuestion` is a **legacy unused** helper (not the live engine).

---

## 4. Plan generation

`generatePlan` in `interview.ts`: PLAN_SYSTEM + job/candidate/resume slice 4000 + optional screening gaps. `temperature: 0.1`, `numPredict: 900`. On failure: `buildFallbackInterviewPlan`, `model: fallback-template`. Sanitized with `sanitizePlanForJob`. Stored once at create; recruiter can PATCH while **SCHEDULED**. Opening question comes from plan at start.

**Runs on staff HTTP create — candidate is not waiting.** Strong Celery candidate. Must not start without a plan (current start requires parseable plan).

---

## 5. Evaluation / finalization

| Kind | When | Blocks candidate? |
|---|---|---|
| Heuristic `answer.evaluation` | sync in `processAnswerTurn` | No (same request as next Q, no Ollama) |
| `INTERVIEW_ANSWER` via `evaluateAnswerOnly` | `void scoreInBackground` | **No** |
| `INTERVIEW_OVERALL` via `finalEvaluation` | background after COMPLETED | **No** |
| Staff `POST /api/interviews/[id]/regenerate-evaluation` | sync staff HTTP | N/A |

`evaluateAnswerOnly` SCORE_SYSTEM: “Do not mention proctoring.” Does **not** pass proctoring events. `finalEvaluation` uses plan, transcript, resume slice 5000 — no proctoring.

Recommendation: answer scores store `MAYBE` on INTERVIEW_ANSWER; overall uses `mapFinalRecommendation` (includes STRONG_YES…STRONG_NO from FinalResult). Advisory. No stage change.

---

## 6. TTS / speech

`ensureQuestionTts`: Piper via local speech-service, cache `InterviewQuestion.ttsPath` under `storage/interviews/{sessionId}/q{n}.wav`. In-process inflight map. Prefetch on start/next; GET `/question-audio/[sequence]` generates if missing (candidate **can** wait on first play). Same text/voice → reuse `ttsPath`.

STT is **on the live VOICE answer path** — must not go through Celery.

---

## 7. Concurrency / recovery

- Process-local session lock (not Redis) — 429 if duplicate in-flight  
- Unique `InterviewAnswer.questionId` → 409  
- `/continue` after 503  
- IN_PROGRESS start reconnect  
- Browser refresh: GET `/state` (not re-audited line-by-line; exists)

---

## 8. Proctoring

Stored on session + `ProctoringEvent`. **Not** in plan/turn/score/final prompts except the score system line forbidding mentioning it. Integrity TERMINATED is separate from AI. Phase 3F must **not** migrate proctoring/secondary camera.

---

## 9. Classification

| Operation | Current | Real-time? | Safe Celery? | Class |
|---|---|---|---|---|
| Link/token/expiry/status | HTTP | Yes | No | A |
| Create session + sync `generatePlan` | Staff HTTP + Ollama | Staff waits; candidate does not | **Yes** (plan only) | B |
| Start + opening Q | HTTP + DB | Yes | No | A |
| Answer persist + lock + 409 | HTTP | Yes | No | A |
| `decideNextTurn` + next Q | HTTP | Yes | **No** (correctness + latency) | A |
| Duration `endsAt` | HTTP in turn | Yes | **No** | A |
| Heuristic eval JSON | HTTP | Same request | No need | A |
| `evaluateAnswerOnly` | `void` background | No | **Yes** (already async; Celery more durable) | B |
| `finalEvaluation` | `void` after complete | No | **Yes** | B |
| TTS prefetch | `void` | Nice-to-have | **Yes** if GET fallback remains | C |
| TTS GET if uncached | Candidate wait | Hybrid | Do not **only** Celery | C |
| VOICE STT | Live answer | Yes | **No** | A |
| Proctoring ingest | HTTP | Yes | Out of scope | A |
| Staff regenerate overall | Staff HTTP | Staff waits | **Yes** as finalize task | B |
| Report UI | Dashboard read | N/A | No new report engine | — |

**Do not** queue every candidate answer → next question.

---

## 10. Phase 3F implication

Keep Next.js interview routes as source of truth.

Django/Celery prove **only**:

1. `interviews.generate_plan(session_id, organization_id)` for **SCHEDULED** sessions  
2. `interviews.finalize_interview` for **COMPLETED** (same `finalEvaluation` write as regenerate)  
3. `interviews.prefetch_question_tts` (idempotent cache)

Live TEXT/VOICE turns stay on Next.js. No Prisma schema change. No frontend cutover.
