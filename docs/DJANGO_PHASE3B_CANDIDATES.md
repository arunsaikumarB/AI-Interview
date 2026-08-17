# Logisoft HireOS — Django Phase 3B: Candidates READ

**Status:** Read-only Django API over Prisma `"Candidate"`. Next.js remains the live writer and UI.  
**Date:** 2026-08-15

---

## 1. Prisma Candidate schema (inspected)

Live `"Candidate"` columns + `prisma/schema.prisma`:

| Field | Postgres | Notes |
|---|---|---|
| `id` | text PK (cuid) | |
| `organizationId` | text NOT NULL | index; unique with `email` |
| `userId` | text NULL unique | optional portal User |
| `email` | text NOT NULL | PII |
| `firstName` / `lastName` | text NOT NULL | PII |
| `phone` | text NULL | PII |
| `linkedIn` | text NULL | PII |
| `location` | text NULL | PII |
| `summary` | text NULL | |
| `skills` | `text[]` | |
| `experience` | float8 NOT NULL | years |
| `education` / `certifications` | jsonb NOT NULL | |
| `resumeUrl` | text NULL | local `/storage` relative path |
| `resumeText` | text NULL | parsed resume body (PII) |
| `embedding` | `vector(768)` NULL | **not mapped in Django** |
| `createdAt` / `updatedAt` | timestamp (no TZ) | |

Indexes: PK, `userId` unique, `organizationId`, `(lastName, firstName)`, `(organizationId, email)` unique.

No Candidate enums. Relations: Organization, optional User, Application[], Note[], CandidateTag[].

**Next.js staff APIs**

| Method | Path | Auth | Behavior |
|---|---|---|---|
| GET | `/api/candidates` | `requireStaff` (incl. INTERVIEWER); CANDIDATE 403 | org scope; `?q=` on firstName/lastName/email + `skills hasSome [q]`; `orderBy updatedAt desc`; `_count.applications`; **all scalars including resumeText** |
| GET | `/api/candidates/[id]` | `requireStaff` | org `findFirst`; miss → **404**; includes applications, notes, tags, **aiEvaluations**, timeline |
| POST | `/api/candidates` | staff create | **not migrated** |
| Portal | `/api/portal/profile` | CANDIDATE JWT | own profile only — **not this API** |

Dashboard `/dashboard/candidates` queries Prisma directly (stage/job search) — still Next.js.

---

## 2. Django unmanaged model

`apps.candidates.models.Candidate` — `managed = False`, `db_table = "Candidate"`.  
`embedding` is **not a model field** (not selected).  
`CandidateApplicationRef` → `"Application"` for COUNT only (not Application domain migration).

---

## 3. Endpoints

`GET /api/v1/candidates/`  
`GET /api/v1/candidates/{id}/`

JWT Bearer or `aros_session`. `StaffOnly`.

---

## 4. Search

`?search=` or `?q=` — SQL `ILIKE` on firstName, lastName, email; `skills && ARRAY[term]` (exact skill, same as Prisma `hasSome`).  
`?sort=` whitelist: `updated_at`, `created_at`, `first_name`, `last_name`, `email`, `experience` (optional `-`). Default `-updated_at`.

---

## 5. Pagination

`page`, `page_size` default 25, max 100.

```json
{ "count": 19, "page": 1, "page_size": 25, "candidates": [ ... ] }
```

Detail: `{ "candidate": { ... } }`.

---

## 6. RBAC

Same as Next `requireStaff`: ADMIN, HR, RECRUITER, HIRING_MANAGER, INTERVIEWER allowed. **CANDIDATE 403**. Interviewer **does** have staff candidate list/detail access in HireOS today.

---

## 7. Organization isolation

Always `filter(organization_id=JWT org)`. Cross-org detail **404** (matches Next GET `/api/candidates/[id]`, not the older isolation test that expected 403). Other-org list count 0.

---

## 8. PII exposure

Returned to **staff in the same org only** (matches Next staff GET list scalars):

| Field | Why |
|---|---|
| name, email, phone, linkedIn, location | recruiting contact / profile |
| summary, skills, experience, education, certifications | screening context already on Next staff GET |
| resumeUrl, resumeText | Next list/detail already return parsed resume to staff |
| userId | portal account link (not a password) |
| applicationCount | count only |

**Not returned:** `embedding`, `passwordHash`, JWT secrets, nested `aiEvaluations` / interview reasoning / notes / timeline (those are Application/AI/interview domain — Next detail includes them; Phase 3B does **not**, to avoid that migration).

CANDIDATE JWT cannot call this API. Cross-org cannot.

---

## 9. Query behavior

One list query: Candidate + Organization `select_related` + `COUNT(Application.id)` + `WHERE organizationId`. No embedding column. Pagination LIMIT. No Python-side full scan.

**Future indexes (do not add now):** trigram on email/name if search volume grows; `(organizationId, updatedAt)`. Existing org + name indexes already help.

---

## 10. Data parity

`python manage.py candidates_parity --limit 5` → **5/5 OK**.

Live Next `GET /api/candidates` vs Django `page_size=100`: **19/19 IDs match**. Sample of 5: **0 mismatches** on id, names, email, phone, linkedIn, location, summary, skills, experience, org, userId, resumeUrl, resumeText, applicationCount. Embedding absent on Django JSON.

---

## 11. Tests executed

`python manage.py test apps.accounts apps.jobs apps.candidates` → **35 OK**.

Candidate: 401 invalid/expired, 403 CANDIDATE, five staff roles 200, page_size cap, missing org 403, cross-org 404, SQL org filter, inactive **401** (see limitations).

Live: CANDIDATE 403; other-org list 0 / detail 404.

---

## 12. Limitations

- Read-only. No create/update/tags/resume upload.
- Detail does **not** nest applications, notes, tags, or AI evaluations (not migrating those modules).
- Django ADMIN is org-scoped (Next SUPER_ADMIN list can be global).
- Inactive staff: **401**, not 403 — same as Next `/api/auth/me` and Phase 2.
- List includes `resumeText` because Next GET `/api/candidates` does; it is large PII.

---

## 13. Future

Application-scoped candidate views, talent embedding search, resume processing, and nested screening/interview payloads stay on Next.js until those phases.

---

## Regression (executed)

- `manage.py check` — 0 issues  
- accounts + jobs + candidates tests — 35 OK  
- `GET /api/health` — db/ollama/speech ok  
- `POST /api/auth/login` + `GET /api/auth/me` — 200  
- Next + Django Jobs still 5 jobs  
- `src/` and `prisma/` unchanged
