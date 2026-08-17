# Logisoft HireOS — Phase 4C.1 audit (before implementation)

**Date:** 2026-08-15  
**Scope:** Application stage + human decision writes only.  
**No code in this document’s original pass — implementation follows this contract.**

---

## 1. Traced write path

There is **one** staff write API for stage and human decisions:

| Item | Value |
|---|---|
| Endpoint | `POST /api/applications/:id/stage` |
| File | `src/app/api/applications/[id]/stage/route.ts` |
| UI | `application-stage-controls.tsx`, `pipeline-board.tsx` drag, `interview-report.tsx` RecruiterDecisionPanel |

**Not used:** generic `PATCH /api/applications/:id`. GET application detail is read-only. `ON_HOLD` / `WITHDRAWN` are **not** written by this route. Timeline type `DECISION` is **not** created here (UI may *display* terminals as “decision”).

**Side effects after HTTP success (client only):** toast; `router.refresh()`; pipeline board may open a draft-email chip (`STAGE_TO_CATEGORY`). **No server email, no Ollama, no Celery, no proctoring, no Application.stage from AI.**

---

## 2. Request contract

```json
{ "toStage": "SHORTLISTED", "note": "optional string" }
```

- `toStage`: Prisma `PipelineStage` enum (zod). Invalid → **400** `{ error: "Validation failed", issues }`.
- `note`: optional string. For `SELECTED` / `REJECTED`, `note.trim().length >= 5` or **400** `{ error: "Final decisions require a human rationale (note)" }`.

---

## 3. Auth / RBAC (actual)

- Cookie JWT `aros_session` via `getSession()` / `requireUser` → missing session **401**.
- `canManagePipeline`: **SUPER_ADMIN, HR_ADMIN, RECRUITER, HIRING_MANAGER**.
- **INTERVIEWER → 403**. **CANDIDATE → 403**.
- Org: `Application.job.organizationId`. Non–SUPER_ADMIN mismatch → **403** (existence leak). Missing application → **404**.
- SUPER_ADMIN skips org filter (can write any org). Django remains **org-scoped** from JWT (stricter). Do not weaken Django.

---

## 4. Enums (Prisma, verified)

**PipelineStage:** APPLIED, SCREENING, SHORTLISTED, ASSESSMENT, AI_INTERVIEW, TECH_INTERVIEW, HR_INTERVIEW, SELECTED, REJECTED.

**ApplicationStatus:** ACTIVE, WITHDRAWN, HIRED, REJECTED, ON_HOLD.

Stage write maps:

| toStage | status written |
|---|---|
| SELECTED | HIRED |
| REJECTED | REJECTED |
| any other | if current status is HIRED or REJECTED → **ACTIVE**, else **leave status** (including ON_HOLD / WITHDRAWN) |

No HOLD action exists in this API.

---

## 5. Transition rules (actual)

**None.** Any enum `toStage` is accepted, including skips, backwards, and terminal → non-terminal (reopen). Do **not** invent a DAG.

UI may hide some buttons; the API does not enforce that.

---

## 6. Timeline

Inside `prisma.$transaction`:

1. `application.update({ stage, status })` (`updatedAt` via Prisma `@updatedAt`)
2. `timelineEvent.create({ type: "STAGE_CHANGED", payload: { from, to, note, actorId, actorName, humanDecision: true } })`

`from` is the stage **before** the update. `note` is `body.note ?? null` (not trimmed for storage).

No `STATUS_CHANGED` event. No rewrite of history.

---

## 7. Idempotency / concurrency (actual)

- Same stage twice: **still writes** a second `STAGE_CHANGED` (UI disables Move when select equals current; Select/Reject/board can still fire).
- No version column, no 409.
- Two recruiters: last Prisma update wins; **two** timeline rows.

---

## 8. HTTP map

| Case | Next today |
|---|---|
| Success | **200** `{ application, advisoryNote }` |
| Bad body / short terminal note | **400** |
| No/invalid/expired JWT | **401** |
| Wrong role / other-org (non-super) | **403** |
| Missing id | **404** |
| Conflict | **not used** |

`advisoryNote`: `"AI recommendations are advisory only. This stage change was made by a human."`

---

## 9. Django endpoint decision

**Not** generic `PATCH /api/v1/applications/{id}/`.

**Yes:** `POST /api/v1/applications/{id}/stage/`  
Body whitelist: `toStage`, `note` only.

---

## 10. Intentional Django deltas (integrity / isolation)

1. Cross-org / missing → **404** (no existence leak). Security over Next 403.
2. Same `toStage` + computed status unchanged → **200**, **no new timeline** (STEP 14). Flag-off Next still duplicates.
3. `select_for_update` in the transaction (serialize writers). Still last-write-wins; no new version field.
4. SUPER_ADMIN writes only JWT org.

---

## 11. Feature flag

`NEXT_PUBLIC_USE_DJANGO_STAGE_WRITES=false` (independent).
