# Logisoft HireOS — Phase 3E AI screening audit

**Status:** Audit only (written before implementation).  
**Date:** 2026-08-15  
**Sources:** `src/app/api/applications/[id]/screen/route.ts`, `src/app/api/jobs/[id]/screen-all/route.ts`, `src/lib/ai/run-screening.ts`, `src/lib/ai/screening.ts`, `src/lib/ai/ollama.ts`, `src/lib/ai/llm-coerce.ts`, Prisma `AIEvaluation` / `AIRecommendation` / `AIEvaluationKind`.

---

## 1. Entry points (synchronous today)

| Path | Who | Auth |
|---|---|---|
| `POST /api/applications/[id]/screen` | Staff | `requireUser` + `canManagePipeline` (SUPER_ADMIN, HR_ADMIN, RECRUITER, HIRING_MANAGER). **INTERVIEWER 403. CANDIDATE 403.** |
| `POST /api/jobs/[id]/screen-all` | Staff | Same. Sequential `screenApplication` per ACTIVE APPLIED/SCREENING app with resume text. |

There is **no Celery/queue**. `chatJSON` runs **inside the HTTP request**. Timeout default **240s** (`OLLAMA_TIMEOUT_MS`), **2** structured-output attempts.

Org check on single-screen: Next.js returns **403** if the application exists but `job.organizationId` ≠ JWT org (**SUPER_ADMIN bypasses**). Django Phase 2+ staff APIs are **always JWT-org-scoped** and use **404** for cross-org (no existence leak). Phase 3E follows Django (404), documented as stricter than Next SUPER_ADMIN.

---

## 2. Data loaded

`prisma.application.findUnique({ include: { job: true, candidate: true } })`.

Required before Ollama: `candidate.resumeText` trimmed non-empty. Missing → `AIError VALIDATION` → HTTP **400**.

Job fields used in the prompt: `title`, `description`, `skills`, `experienceMin`, `experienceMax`, `screeningCriteria` (`mustHave` / `niceToHave` string arrays; missing/invalid → empty lists). Empty criteria is **valid**.

Candidate fields: `firstName`, `lastName`, `summary`, `skills`, `experience`, `education`, `certifications`, `resumeText`.

**Not** loaded: interviews, proctoring, notes, recruiter opinions, embeddings (embed runs *after* eval write and must not fail screening).

---

## 3. Prompt (verbatim contract)

**System** (`SYSTEM_PROMPT` in `src/lib/ai/screening.ts`): advisory screener; never hiring decisions / stage changes; score only vs JD + criteria; whyMatch 3–6 string array; no invented facts; `recommendedAction` SHORTLIST | REVIEW | REJECT; reasoning 3–5 sentences; JSON only.

**User** (`buildScreeningUserPrompt`): job title/description/skills/experience range/must-have/nice-to-have; candidate name/summary/skills/years/education JSON/certifications JSON; resume truncated at 6000 chars (head 4000 + tail 2000); schema key instructions.

Resume placeholder if empty string after trim: `(No resume text extracted.)` — but `screenApplication` already refuses empty text, so that branch is not hit from the HTTP path.

---

## 4. Model / Ollama

- Chat: `OLLAMA_CHAT_MODEL` or `OLLAMA_MODEL` default **`qwen2.5:7b`**. Host: `getChatOllamaUrl()` (`AI_PROVIDER=local` → `OLLAMA_LOCAL_URL` / localhost:11434).
- `chatJSON`: `temperature: 0.1`, `numPredict: 1200`, `format` = Zod JSON Schema of `ScreeningResultShape`, `stream: false`.
- **Not deterministic** (no seed). Parity must not demand byte-equal reasoning.
- Returned `model` is **`raw.model ?? requested model`** — stored on `AIEvaluation.model` (analytics provenance). Never a hardcoded write.

---

## 5. Parse / coerce / scores

`ScreeningResultSchema` preprocess then strict shape:

| Field | Contract |
|---|---|
| `overall` | 0–100 (coerced) |
| `breakdown` | technicalSkills, experience, education, domainExperience, jobRequirements — each 0–100 |
| `whyMatch` | 3–6 strings |
| `missingRequirements` / `concerns` | string arrays |
| `recommendedAction` | SHORTLIST \| REVIEW \| REJECT |
| `reasoning` | min 40 chars |

Empty reasoning after coerce still throws before persist.

---

## 6. Recommendation mapping (advisory)

LLM action → Prisma `AIRecommendation` (subset of enum):

| recommendedAction | AIEvaluation.recommendation |
|---|---|
| SHORTLIST | **YES** |
| REVIEW | **MAYBE** |
| REJECT | **NO** |

Does **not** write STRONG_YES / STRONG_NO. Do not invent new categories.

---

## 7. Prisma write

**Creates a new** `AIEvaluation` every run (history preserved). No update-in-place. Re-screen is **allowed after completion**.

Fields written: `applicationId`, `kind: RESUME_SCREEN`, `scores: result` (full ScreeningResult JSON), `recommendation`, `reasoning` (trimmed), `model` (runtime), `rawResponse`. `sessionId` null. **No `updatedAt` column.**

Then `TimelineEvent` `SCREENING_COMPLETED` with payload `{ evaluationId, overall, recommendedAction, recommendation, model, advisoryOnly: true }`.

**Never** updates `Application.stage` or `Application.status`.

Then `embedCandidate` (best-effort; failures logged, screening still succeeds).

---

## 8. AIEvaluation schema (actual)

| Column | Type |
|---|---|
| id | cuid PK |
| applicationId | text |
| sessionId | text null |
| kind | `AIEvaluationKind` — screening uses **RESUME_SCREEN** |
| scores | Json |
| recommendation | `AIRecommendation` |
| reasoning | text, mandatory |
| model | text |
| rawResponse | Json null |
| createdAt | timestamp |

Indexes: `(applicationId, kind)`, `sessionId`.

---

## 9. Loading / status UX

No processing-status column. UI uses latest `RESUME_SCREEN` eval or “No screening result yet.” Duplicate concurrent screens are **not** locked today (two POSTs can race).

---

## 10. Errors / retries

- Unreachable / timeout → `OLLAMA_UNREACHABLE` HTTP **503**
- HTTP error from Ollama → `OLLAMA_HTTP` **503**
- Invalid JSON / Zod after 2 attempts → `VALIDATION` / `INVALID_JSON` **400** (do not retry forever in Celery)
- Missing app → Next **404**; missing resume → **400**

No Redis lock. No Celery.

---

## 11. Proctoring isolation

`src/lib/ai/screening.ts` and `src/lib/ai/run-screening.ts` contain **zero** references to proctoring, cameras, tab signals, or cheating. Interview prompts (out of scope) are separate.

---

## 12. Implications for Celery

- Reuse **`screenApplication`** in `src/lib/ai/run-screening.ts` via a Node CLI (same prompt, coerce, chatJSON, Prisma create, timeline, embed). Do not rewrite the engine in Python.
- Django only: RBAC, org checks, resume-text presence, Redis lock, queue, status. Pass **IDs only**.
- Concurrent: Redis lock per application. After success, allow another screen (matches Next history).
- No Prisma schema change. No stage writes from Django.
