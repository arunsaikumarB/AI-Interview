# Logisoft HireOS — Django Phase 4C.2: Job write cutover

**Status:** Implemented. Feature flag **defaults OFF**.  
**Date:** 2026-08-16  
**Does not start Phase 4C.3.**

Audit: `docs/DJANGO_PHASE4C2_JOB_WRITE_AUDIT.md`.

---

## 1. Existing Job write behavior

Staff mutations (traced):

| Mutation | Next.js |
|---|---|
| Create | `POST /api/jobs` → 201 `{ job }` |
| Edit + status | `PATCH /api/jobs/:id` → 200 `{ job }` |
| Delete | `DELETE /api/jobs/:id` → 200 `{ ok: true }` |

No duplicate-job API. Status is a field on create/edit, not a separate endpoint. UI: `job-form.tsx`, `job-delete-button.tsx`. After success: toast, `router.push`, `router.refresh()`. No `revalidatePath`, no timeline, no email, no AI.

---

## 2. Supported mutations migrated

Create, PATCH (including status), DELETE. Careers apply and screen-all are not job-domain writes for this phase.

---

## 3. Django endpoints

| Method | Path |
|---|---|
| POST | `/api/v1/jobs/` |
| PATCH | `/api/v1/jobs/{id}/` |
| DELETE | `/api/v1/jobs/{id}/` |

GET list/detail unchanged (StaffOnly). Writes use `JobManagers`. JWT `aros_session` / Bearer. No second session.

---

## 4. Write whitelist

Allowed: `title`, `departmentId`, `location`, `description`, `skills`, `experienceMin`, `experienceMax`, `salaryMin`, `salaryMax`, `employmentType`, `openings`, `status`, `screeningCriteria`, `interviewStages`.

Rejected: `organizationId`, `createdById`, `id`, timestamps, any other key → 400 `Unsupported fields`.

---

## 5. Validation

Parity with Zod: title min 2, description min 10, no trim, no max length, skills string[], status/employment enums, screeningCriteria `{ mustHave?, niceToHave? }` (unknown keys dropped like Zod). Defaults on create: skills `[]`, experienceMin `0`, employmentType `FULL_TIME`, openings `1`, status `DRAFT`, screeningCriteria `{}`, interviewStages `[]`.

---

## 6. RBAC

`canManageJobs`: SUPER_ADMIN, HR_ADMIN, RECRUITER. HIRING_MANAGER / INTERVIEWER / CANDIDATE → **403**. JWT missing/invalid/expired → **401**.

---

## 7. Organization isolation

JWT org only. Create uses authenticated org. PATCH/DELETE lookup `id + organizationId`. Cross-org / missing → **404** `{ error: "Job not found" }`. Django SUPER_ADMIN remains org-scoped (stricter than Next flag-off).

---

## 8. Department isolation

Department must belong to the same org (create and PATCH). Else **400** `"Department not found in organization"`. Next PATCH did not check this; Django does (security).

---

## 9. createdBy

Set from authenticated user on create. Not writable on PATCH.

---

## 10. Status behavior

No DAG. Any of DRAFT, OPEN, PAUSED, CLOSED.

---

## 11. Transactions

Create / update / delete each run in `transaction.atomic()`. Update uses `select_for_update`. Single `"Job"` row (plus Postgres FK cascade on delete).

---

## 12. Concurrency / double submit

Last write wins. No version field. Create is not idempotent (same as Next). UI `loading` reduces double-clicks. Do not invent distributed locks.

---

## 13. Response parity

Create **201** `{ job }` with GET-shaped serializer + `applicationCount` mapped to `_count.applications` in the BFF. PATCH **200** `{ job }`. DELETE **200** `{ ok: true }`. Adapter: `normalizeJob`.

---

## 14. Cache / revalidation

Unchanged client `router.refresh()` / navigation. No new cache layer.

---

## 15. Security tests

`backend/apps/jobs/tests/test_job_writes.py`: 401s, candidate/interviewer/HM 403, managers 201, extra fields 400, missing 404, cross-org department 400, delete `{ ok: true }`.

---

## 16. Performance

Synchronous SQL, no Celery. Live `job_write_parity` (TESTCASE org only):

| Op | Sample | Result |
|---|---|---|
| create | 1 | **8.9 ms** |
| edit/status | 7 | **p50 10.6 ms, p95 12.1 ms** |
| delete | 1 | **10.4 ms** |

All sub-second. Next.js UI writes were not separately timed (browser + compile dominate).

---

## 17. UI test

**Passed 2026-08-16** on a designated TEST job only (`4C.2 TESTCASE UI job`, id `c141b5d67ddfc6cce9ff4a18a`). No production job was edited.

1. Flag on; Django and Next.js restarted (Django `--noreload` must be restarted to load write views).
2. Recruiter UI **Create Job** → Django `POST /api/v1/jobs/` **201**. Job appeared as **OPEN**.
3. Job Details tab: edited title, description, skills, experience, screening criteria, status **PAUSED** → Django `PATCH` **200**; refresh showed persistence.
4. **Delete** that test job only → Django `DELETE` **200** `{ ok: true }`; job gone from the list.
5. Flag set back to **false**; Next.js restarted.

First delete attempt failed with `request is not defined` (DELETE handler used `_request` while forwarding `request`). Fixed before the successful delete.

---

## 18. Rollback

`NEXT_PUBLIC_USE_DJANGO_JOB_WRITES=false` + restart Next. Flag true + Django down → **503**, no Prisma fallback.

---

## 19. Regression

`manage.py check`, Django tests, frontend flag unit tests. Unrelated domains not migrated.

---

## 20. Known limitations

- Django SUPER_ADMIN cannot write another org.
- PATCH department org check is stricter than Next.
- Create not idempotent.
- Job delete still cascades applications (existing Prisma FK).
- Direct Django rejects `organizationId` in JSON; BFF strips it.

---

## Feature flag

`NEXT_PUBLIC_USE_DJANGO_JOB_WRITES` default **false**. Independent of READS / ASYNC / STAGE_WRITES.
