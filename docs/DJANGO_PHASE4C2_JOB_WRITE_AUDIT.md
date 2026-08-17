# Logisoft HireOS — Phase 4C.2 audit (before implementation)

**Date:** 2026-08-16  
**Scope:** Staff Job writes only.  
**Not in scope:** careers apply, screen-all, screenable, JobAssignment UI, duplicate job.

---

## 1. Mutations that actually exist

| Operation | Endpoint | Method | UI |
|---|---|---|---|
| Create | `POST /api/jobs` | POST | `job-form.tsx` (new job) |
| Edit (incl. status) | `PATCH /api/jobs/:id` | PATCH | `job-form.tsx` (edit) — **status is a field on the same form**, not a separate API |
| Delete | `DELETE /api/jobs/:id` | DELETE | `job-delete-button.tsx` |

**Does not exist:** duplicate/clone job, dedicated status-only endpoint, JobAssignment writes from this UI.

Reads (`GET /api/jobs`, `GET /api/jobs/:id`) already have a 4A BFF. Unchanged.

---

## 2. Prisma Job (verified)

`prisma/schema.prisma` `model Job`:

| Field | Type | Notes |
|---|---|---|
| id | String cuid PK | |
| organizationId | String required | index |
| departmentId | String? | index; SetNull on dept delete |
| title | String required | no max |
| description | String required | no `requirements` column |
| location | String? | |
| experienceMin | Int default 0 | |
| experienceMax | Int? | |
| skills | String[] default [] | order/duplicates preserved |
| salaryMin / salaryMax | Int? | |
| employmentType | EmploymentType default FULL_TIME | FULL_TIME, PART_TIME, CONTRACT, INTERN, TEMPORARY |
| openings | Int default 1 | |
| status | JobStatus default DRAFT | **DRAFT, OPEN, PAUSED, CLOSED** |
| interviewStages | Json default `[]` | |
| screeningCriteria | Json default `{}` | typically `{ mustHave, niceToHave }` |
| createdById | String required | User FK |
| createdAt / updatedAt | DateTime | `@updatedAt` on update |

`Application.job` **onDelete: Cascade**. Deleting a job deletes applications (and their timeline/interviews). Confirm dialog: “Delete this job and its applications?”

No Job timeline/audit table. No notifications.

---

## 3. Auth / RBAC (actual)

Cookie JWT `aros_session`. `canManageJobs`: **SUPER_ADMIN, HR_ADMIN, RECRUITER only**.

| Role | Create / PATCH / DELETE |
|---|---|
| SUPER_ADMIN, HR_ADMIN, RECRUITER | allowed |
| HIRING_MANAGER | **403** |
| INTERVIEWER | **403** |
| CANDIDATE | **403** |
| missing JWT | **401** |

This is **narrower** than pipeline writes (HIRING_MANAGER can move stages, cannot manage jobs).

---

## 4. Organization

- **Create:** `requireOrganizationId(user, body.organizationId)`. Non-super cannot set another org (**403**). SUPER_ADMIN may pass `organizationId`. **Django must use JWT org only** (same 4C.1 isolation; do not weaken).
- **PATCH/DELETE:** `orgScopeWhere` — SUPER_ADMIN unscoped; others `organizationId = user.org`. Missing / other-org → **404** `{ error: "Job not found" }`.

UI does not send `organizationId`.

---

## 5. Department

**Create:** if `departmentId` set, must exist in the target org else **400** `"Department not found in organization"`. Null/empty → null.

**PATCH weakness:** Next spreads `departmentId` with **no** org check. Cross-org department could be written. **Django will reject** (STEP 10 security). Documented delta.

---

## 6. createdBy

Create: `createdById: user.id` from session. Not in PATCH schema (cannot change). Do not accept from JSON.

---

## 7. Request contracts

### POST `/api/jobs`

Zod `createSchema`:

| Field | Rule |
|---|---|
| title | string min 2 (**no trim**) |
| description | string min 10 (**no trim**) |
| departmentId | optional nullable string |
| location | optional nullable |
| skills | optional string[] default `[]` |
| experienceMin | optional int ≥ 0 default **0** |
| experienceMax | optional nullable int ≥ 0 default **null** |
| salaryMin/Max | optional nullable int (UI does not send) |
| employmentType | optional enum default **FULL_TIME** |
| openings | optional int ≥ 1 default **1** |
| status | optional JobStatus default **DRAFT** |
| screeningCriteria | optional `{ mustHave?, niceToHave? }` default `{}` |
| interviewStages | optional unknown default `[]` (UI does not send) |
| organizationId | optional (SUPER_ADMIN only in Next) |

UI payload: title, departmentId, location, description, skills, experienceMin/Max, status, screeningCriteria `{ mustHave, niceToHave }`.

Success **201** `{ job }` with include: createdBy `{id,name,email}`, department `{id,name}`, organization `{id,name,slug}`, `_count.applications`.

### PATCH `/api/jobs/:id`

Same fields as create **except** organizationId; all optional. Partial update. Status change is this same body.

Success **200** `{ job }` same include.

### DELETE `/api/jobs/:id`

No body. Success **200** `{ ok: true }`.

### Errors

| Case | Next |
|---|---|
| Zod fail | 400 `{ error: "Validation failed", issues }` |
| Bad department on create | 400 |
| Auth | 401 |
| Wrong role | 403 |
| Missing / other-org job | 404 |
| Conflict | unused |

---

## 8. Validation notes (do not “fix” product)

- No max lengths.
- Whitespace-only title of length ≥ 2 is accepted.
- Skills: API does not dedupe or trim; UI trims/splits on comma.
- Status: **no transition DAG** — any enum allowed including CLOSED → DRAFT.
- screeningCriteria extra keys stripped by zod object (mustHave/niceToHave only).
- No idempotency on create (double-click can create two jobs). UI sets `loading` which reduces but does not eliminate doubles. Do **not** add server idempotency keys that would block two legitimate creates.
- Concurrency: last Prisma write wins; no version field.

---

## 9. Side effects / cache

No `revalidatePath`. Client: toast + `router.push` + `router.refresh()`. Delete: confirm then push `/dashboard/jobs`.

No Ollama, Celery, timeline, email.

PATCH/DELETE do not change Application.stage except **DELETE cascade** (existing).

---

## 10. Django endpoint decision

Reuse:

- `POST /api/v1/jobs/` create  
- `PATCH /api/v1/jobs/{id}/` update (incl. status)  
- `DELETE /api/v1/jobs/{id}/` delete  

Not a generic unrestricted update. Whitelist = create/update schema fields except org/id/timestamps/createdBy.

---

## 11. Feature flag

`NEXT_PUBLIC_USE_DJANGO_JOB_WRITES=false` (independent).
