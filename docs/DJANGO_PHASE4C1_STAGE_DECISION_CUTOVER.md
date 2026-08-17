# Logisoft HireOS — Django Phase 4C.1: Application stage + human decision write cutover

**Status:** Implemented. Feature flag **defaults OFF**.  
**Date:** 2026-08-15  
**Does not start Phase 4C.2.**

This is the first high-risk **staff write** cutover. The recruiter UI still POSTs same-origin `POST /api/applications/:id/stage`. When the flag is on, Next.js authenticates/authorizes, then forwards the write to Django. There is **no silent Prisma fallback** if Django is down.

Audit (traced before code): `docs/DJANGO_PHASE4C1_STAGE_DECISION_AUDIT.md`.

---

## 1. Existing write behavior

Single Next.js write API: `POST /api/applications/:id/stage`  
File: `src/app/api/applications/[id]/stage/route.ts`

Body: `{ toStage, note? }`  
`toStage` is the Prisma `PipelineStage` enum. `ON_HOLD` / `WITHDRAWN` are **not** written here. Timeline type is **`STAGE_CHANGED`** only (not `DECISION`).

No Ollama, Celery, email, or proctoring on this path. AI screening never calls this route.

---

## 2. Django endpoint

`POST /api/v1/applications/{id}/stage/`

Not a generic `PATCH /api/v1/applications/{id}/`. Extra body keys besides `toStage` / `to_stage` / `note` → **400** `{ error: "Unsupported fields" }`.

Auth: HireOS JWT (`Authorization: Bearer` or cookie `aros_session`). Django does **not** mint a second session.

---

## 3. Allowed operations (whitelist)

Writable: `toStage` (or `to_stage`), `note`.

Not writable: `candidateId`, `jobId`, `organizationId`, timestamps, AI scores, resume, embeddings, status as a free-form client field (status is **derived** from stage).

Status mapping (same as Next.js):

| toStage | status written |
|---|---|
| SELECTED | HIRED |
| REJECTED | REJECTED |
| any other | if current status is HIRED or REJECTED → ACTIVE, else leave status (including ON_HOLD / WITHDRAWN) |

---

## 4. RBAC

Matches Next `canManagePipeline`:

| Role | Stage write |
|---|---|
| SUPER_ADMIN / ADMIN | allowed (Django still JWT-org-scoped) |
| HR_ADMIN / HR | allowed |
| RECRUITER | allowed |
| HIRING_MANAGER | allowed |
| INTERVIEWER | **403** |
| CANDIDATE | **403** |
| missing/invalid/expired JWT | **401** |

Django SUPER_ADMIN cannot write another org (stricter than Next flag-off).

---

## 5. Organization isolation

Application has no `organizationId`. Scope: Application → Job → Organization.

Mismatch or missing application → **404** `{ error: "Application not found" }` (no existence leak). Never trust org from the body.

---

## 6. Transition rules

**None in the existing product.** Any Prisma `PipelineStage` is accepted (skips, reverse, reopen). 4C.1 does **not** invent a DAG.

Invalid `toStage` (non-enum): Next Zod **400** `Validation failed`; Django **400** `Validation failed`.

---

## 7. Human rationale

`SELECTED` and `REJECTED` require `note.trim().length >= 5` server-side. Empty / whitespace-only rejected. The note is the human rationale, not AI reasoning. There is no HOLD action on this API.

---

## 8. Timeline behavior

Atomic with the application update:

`type: "STAGE_CHANGED"`  
`payload: { from, to, note, actorId, actorName, humanDecision: true }`

Does not rewrite history. Does not emit `DECISION` / `STATUS_CHANGED` (Next never did on this route).

**Django delta (STEP 14):** same `toStage` and computed status unchanged → **200**, **no new timeline**. Flag-off Next still inserts a duplicate row.

---

## 9. Transaction strategy

`transaction.atomic()` + `select_for_update()` on Application. Update Application then create TimelineEvent. Failure → rollback. No Django-owned duplicate tables (`managed = False`). No Celery for the write.

---

## 10. Concurrency

No version column (Next had none). `select_for_update` serializes writers on the same row. Last committed write wins; two different stages produce two timeline rows. No invented 409/optimistic locking.

---

## 11. Idempotency

Double-submit of the **same** stage: Django no-ops (no second timeline). Different stage: writes. Flag-off Next: same stage still creates another `STAGE_CHANGED`.

---

## 12. Feature flag

`NEXT_PUBLIC_USE_DJANGO_STAGE_WRITES` default **false**.

Independent of `NEXT_PUBLIC_USE_DJANGO_READS` and `NEXT_PUBLIC_USE_DJANGO_ASYNC`.

---

## 13. BFF architecture

Browser → `POST /api/applications/:id/stage` (unchanged UI).

Flag **false:** Prisma `$transaction` as today.

Flag **true:** Next session + pipeline RBAC + Zod, then `djangoPostJson` to Django. Django down → **503**, no Prisma write.

---

## 14. Response parity

Success **200:** `{ application: { id, candidateId, jobId, stage, status, source, coverNote, createdAt, updatedAt }, advisoryNote }`

Django application object is **scalars only** (no nested candidate/job). The UI only needs stage/status success + refresh.

| Case | Status | Body |
|---|---|---|
| Success | 200 | `{ application, advisoryNote }` |
| Bad enum / short terminal note / extra fields | 400 | `{ error }` (Next Zod also `{ issues }`) |
| Auth | 401 | |
| Wrong role | 403 | |
| Missing / cross-org | 404 Django / flag-off Next other-org **403** | `{ error: "Application not found" }` on Django |
| Conflict | unused | |

---

## 15. Security tests

Covered in `backend/apps/applications/tests/test_stage_write.py`: missing/invalid/expired JWT → 401; candidate/interviewer → 403; pipeline roles reach write; extra fields 400; missing/cross-org 404 without candidate leakage; short SELECTED note 400.

---

## 16. Performance

Stage write is synchronous SQL, not an AI job. Target: sub-second. Live `stage_write_parity` on test application `taylor.testcase@example.com`: **django_stage_write_ms ≈ 25**. Do not queue the write.

---

## 17. Rollback

Set `NEXT_PUBLIC_USE_DJANGO_STAGE_WRITES=false` and restart Next.js. Prisma write path is unchanged. Rollback is **explicit** — flag true + Django down fails the request.

---

## 18. Real recruiter test

**Passed 2026-08-15** on designated TEST candidate `taylor.testcase@example.com` only (`cmspldr28000ijqyl4znuq8su` / application `cmspldr2c000kjqylx1y8gg4v`). No production candidate.

Procedure:

1. Set `NEXT_PUBLIC_USE_DJANGO_STAGE_WRITES=true`, restart Next.js, restart Django (needed so `--noreload` picks up the new stage URL).
2. Sign in as `recruiter@local.dev` and open `/dashboard/candidates/cmspldr28000ijqyl4znuq8su`.
3. Recruiter Decision: **Advance** → refresh showed **Screening**.
4. Note `UI test select hire` → **Select** → refresh showed **Selected** and the note.
5. Note `UI test reject now` → **Reject** → refresh showed **Rejected** and the note.
6. Activity timeline: `Moved to Screening`, `Moved to Selected`, `Moved to Rejected` (human `STAGE_CHANGED`).
7. Browser `POST /api/applications/:id/stage` returned **200** with `advisoryNote`. Django logged three `POST /api/v1/applications/.../stage/` **200**s.
8. Flag set back to **false** and Next.js restarted.

First UI attempt hit Django **404** because the existing `runserver --noreload` process was started before the stage route existed. After restarting Django, the same UI workflow succeeded.

---

## 19. Regression

`python manage.py check`  
Django test suite  
Frontend unit tests for the flag parser  

Unrelated systems (jobs/candidates writes, screening, interviews, voice, proctoring, secondary camera) are not on this path.

---

## 20. Known limitations

- Django SUPER_ADMIN is org-scoped; Next flag-off SUPER_ADMIN is not.  
- Flag-on cross-org is 404; flag-off Next is 403 for non-super.  
- Same-stage idempotency only when the flag is on.  
- No HOLD write API (product never had one here).  
- Application JSON from Django omits Prisma extras the UI does not use on this response.  
- Timeline IDs for Django-created events use `c` + 24 hex (cuid-like), not Prisma’s `cuid()` helper.

---

## AI / proctoring isolation

`stage_write.py` does not import Ollama, screening, interview evaluation, or ProctoringEvent. Proctoring routes still must not update `Application.stage`. AI recommendations remain advisory.

---

## Commands

```text
backend\.venv\Scripts\python.exe manage.py check
backend\.venv\Scripts\python.exe manage.py test
backend\.venv\Scripts\python.exe manage.py stage_write_parity --dry-run
backend\.venv\Scripts\python.exe manage.py stage_write_parity
npx tsx --test tests/unit/staff-stage-writes.test.ts
```
