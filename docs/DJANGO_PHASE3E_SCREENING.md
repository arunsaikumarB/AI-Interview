# Logisoft HireOS — Django Phase 3E: AI Screening + Celery

**Status:** Complete (async path proven). Next.js `POST /api/applications/[id]/screen` remains live and synchronous.  
**Date:** 2026-08-15  
**Audit:** `docs/DJANGO_PHASE3E_SCREENING_AUDIT.md`

Prisma schema was **not** changed. No interview / proctoring / application-write / candidate-write / job-write migration. Frontend was **not** switched to Django.

---

## 1. Existing screening architecture

Staff `POST /api/applications/[id]/screen` (`canManagePipeline`) calls `screenApplication` in `src/lib/ai/run-screening.ts`:

load Application + Job + Candidate → require `resumeText` → `runResumeScreening` (`src/lib/ai/screening.ts` + `chatJSON`) → **create** `AIEvaluation` (`kind: RESUME_SCREEN`) → `TimelineEvent SCREENING_COMPLETED` → best-effort `embedCandidate`.

**Never** updates `Application.stage` or `Application.status`. Each run inserts a **new** evaluation (history preserved). Batch `POST /api/jobs/[id]/screen-all` is sequential and also unchanged.

---

## 2. Existing prompt

Unchanged. Celery invokes the same TypeScript module.

**System:** advisory screener; never hiring decisions; score only vs JD + criteria; whyMatch 3–6 strings; no invented facts; `SHORTLIST|REVIEW|REJECT`; 3–5 sentence reasoning; JSON only.

**User:** job title/description/skills/experience range/must-have/nice-to-have; candidate name/summary/skills/years/education JSON/certifications JSON; resume (truncate 6000 = head 4000 + tail 2000); schema keys.

Exported `SYSTEM_PROMPT` (additive export only) so fingerprints can hash the exact system string. Prompt construction is **not** duplicated in Python.

`python manage.py screening_parity --limit 3` ran `buildScreeningUserPrompt` twice per application; **prompt_sha256 stable** on all 3.

---

## 3. Existing scoring logic

`ScreeningResultSchema` coerce then strict: overall + breakdown (5 axes) 0–100; whyMatch 3–6; missingRequirements/concerns arrays; reasoning min 40 chars. `chatJSON` temperature **0.1**, `numPredict` **1200**, JSON-schema format, **2** attempts. Not seed-deterministic.

---

## 4. Existing evaluation schema

`AIEvaluation`: id, applicationId, sessionId (null for screening), **kind=RESUME_SCREEN**, scores Json, recommendation `AIRecommendation`, reasoning, model, rawResponse, createdAt.

LLM `SHORTLIST→YES`, `REVIEW→MAYBE`, `REJECT→NO`. Enum also has STRONG_YES/STRONG_NO; screening **does not write those**.

---

## 5. Django API

`POST /api/v1/screening/` `{ "application_id" }`  
Auth: HireOS JWT + **RecruitmentStaff** (same as `canManagePipeline`). Org via JWT. Cross-org / missing → **404**. No resume text → **400**. Returns immediately `{ status, task_id }` (no reasoning, paths, or scores).

`GET /api/v1/screening/status/?application_id=` → QUEUED / PROCESSING / COMPLETED / FAILED (plus evaluation_id/kind/recommendation/overall/model after success).

Django is org-strict for SUPER_ADMIN too (Phase 2 rule), unlike Next’s SUPER_ADMIN bypass.

---

## 6. Celery task

`screening.screen_application(application_id, organization_id)` — IDs only.

Worker: validate org/resume/JD → `tsx scripts/screen-application.mjs` → existing `screenApplication` → Prisma writes the evaluation/timeline/embed → confirm stage/status unchanged → Redis COMPLETED.

---

## 7. Redis locking

Key `screening:application:{application_id}` SET NX TTL **900s**.

First POST: `queued`. Concurrent POST: `already_processing` + existing task_id. After completion, a later POST may screen again (same as Next history).

---

## 8. Ollama configuration

Unchanged: `AI_PROVIDER=local`, chat `qwen2.5:7b` (env), `OLLAMA_TIMEOUT_MS` 240s default, temperature 0.1, embeddings always local `nomic-embed-text`. `AIEvaluation.model` is **runtime** `raw.model ?? requested` (live: `qwen2.5:7b`).

---

## 9. Database write strategy

No Django ORM insert. The Node engine uses the existing Prisma `aIEvaluation.create` + `timelineEvent.create` path. Django only **reads** Application/Job/Candidate for enqueue checks and post-run stage/status verification. Parameterized SQL for those reads. **No Application UPDATE.**

---

## 10. Output parity results

**Deterministic:** same `buildScreeningUserPrompt` + `SYSTEM_PROMPT` + `runResumeScreening` + Prisma write. Fingerprints stable (`screening_parity --limit 3`).

| application_id | job_id | prompt_stable |
|---|---|---|
| cmsp3apza001b2ezwmrzrfe1b | seed-fullstack-engineer | yes |
| cmsp3apzx001q2ezw7c7un5ns | seed-product-designer | yes |
| cmsp3apzt001n2ezwb6l7ku46 | seed-platform-engineer | yes |

**Live Celery** (designated `taylor.testcase@example.com` application `cmspldr2c000kjqylx1y8gg4v`; no prior eval):

| Field | Result |
|---|---|
| kind | RESUME_SCREEN |
| recommendedAction (scores) | SHORTLIST |
| recommendation | YES (mapping preserved) |
| overall | 85 (0–100) |
| scores schema | overall, breakdown, whyMatch, recommendedAction, reasoning |
| model | qwen2.5:7b |
| reasoning stored | 310 chars (not returned on queue API) |
| sessionId | null |
| Application | still APPLIED / ACTIVE |
| TimelineEvent | SCREENING_COMPLETED, advisoryOnly true |

LLM temperature 0.1 is **not** deterministic. This phase does **not** claim byte-equal reasoning vs a second Next.js POST. Engine identity is the parity guarantee. No production temperature/seed was changed to force a match.

---

## 11. Performance

| Path | Duration |
|---|---|
| Django enqueue (live) | **148.5 ms** |
| Duplicate while locked | **47 ms** |
| Celery + Ollama (live txt resume) | **~89.6 s** |

HTTP does not wait for Ollama. The model itself is not faster.

---

## 12. Security tests

Unit (SimpleTestCase) + live HTTP:

| Case | Result |
|---|---|
| no/invalid/expired token | 401 |
| CANDIDATE | 403 |
| INTERVIEWER | 403 |
| SUPER_ADMIN / HR_ADMIN / RECRUITER / HIRING_MANAGER | 200 queue |
| missing application | 404 |
| cross-org | 404 |
| missing resume | 400 |

`manage.py test apps.accounts apps.jobs apps.candidates apps.applications apps.files apps.screening` → **87 OK**. `manage.py check` → no issues.

---

## 13. Failure / retry

| Class | Examples | Behavior |
|---|---|---|
| Transient | Ollama unreachable, HTTP 5xx, timeout, tsx missing | retry ≤ 3, backoff `min(60, 5*2^n)` |
| Permanent | missing app/resume/JD, malformed JSON after 2 chatJSON attempts, unexpected kind/recommendation, pipeline mutated | no Celery retry |

Task `time_limit` 600s / soft 570s. Node subprocess timeout 540s.

---

## 14. Proctoring isolation

Code search: `src/lib/ai/screening.ts`, `src/lib/ai/run-screening.ts`, `scripts/screen-application.mjs`, `backend/services/screening/*`, `backend/apps/screening/*.py` — **no** proctoring, cameras, tab/window signals, copy/paste, or cheating features. Unit test scans Python screening packages.

---

## 15. Next.js compatibility

`POST /api/applications/[id]/screen` still exists and still calls `screenApplication` in-request. `GET http://127.0.0.1:3000/api/health` → ok, local Ollama `qwen2.5:7b`. Recruiter dashboard was not pointed at Django. Jobs/Candidates/Applications Django GETs still 200.

---

## 16. Known limitations

- Next.js screen remains **synchronous**; UI not switched.
- Redis status is TTL-based (no Prisma processing column).
- Temperature 0.1 → two runs can differ in score/reasoning.
- Concurrent screens blocked; sequential re-screens allowed (Next behavior).
- Django SUPER_ADMIN is org-scoped (stricter than Next screen 403/bypass).
- Worker must load current code (`screening.screen_application`). Stale workers → `NotRegistered`.
- Windows Celery uses `-P solo`.

---

## 17. Future migration (not started)

- Point the dashboard Screen button at `POST /api/v1/screening/` + poll status.
- Optional durable processing status on Prisma (stop and approve schema first).
- Then retire in-request Next screening.

**Do not start Phase 3F (interviews) without approval.**
