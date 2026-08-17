# Logisoft HireOS — Django Phase 3A: Jobs READ

**Status:** Read-only Django API over Prisma `"Job"`. Next.js remains the live writer and UI.  
**Date:** 2026-08-15

---

## 1. Prisma Job schema (inspected)

`model Job` in `prisma/schema.prisma` plus live `information_schema` on `"Job"`:

| Prisma field | Postgres | Notes |
|---|---|---|
| `id` | `text` PK (cuid) | |
| `organizationId` | `text` NOT NULL | index `Job_organizationId_idx` |
| `departmentId` | `text` NULL | index `Job_departmentId_idx` |
| `title` | `text` NOT NULL | |
| `description` | `text` NOT NULL | **There is no `requirements` column** |
| `location` | `text` NULL | |
| `experienceMin` | `int4` NOT NULL default 0 | |
| `experienceMax` | `int4` NULL | |
| `skills` | `text[]` | Prisma `String[]` |
| `salaryMin` / `salaryMax` | `int4` NULL | |
| `employmentType` | enum `EmploymentType` | FULL_TIME, PART_TIME, CONTRACT, INTERN, TEMPORARY |
| `openings` | `int4` NOT NULL | |
| `status` | enum `JobStatus` | DRAFT, OPEN, PAUSED, CLOSED — index `Job_status_idx` |
| `interviewStages` | `jsonb` NOT NULL default `[]` | |
| `screeningCriteria` | `jsonb` NOT NULL default `{}` | typically `{ mustHave, niceToHave }` |
| `createdById` | `text` NOT NULL | User FK (owner/recruiter creator) |
| `createdAt` / `updatedAt` | `timestamp` (no TZ) | |

Relations: Organization (required), Department (optional), User `createdBy`, `JobAssignment[]`, `Application[]`.

**Next.js staff APIs**

| Method | Path | Auth | Scope | Notes |
|---|---|---|---|---|
| GET | `/api/jobs` | staff roles including INTERVIEWER; CANDIDATE 403 | `orgScopeWhere` (SUPER_ADMIN unscoped) | `orderBy createdAt desc`, include createdBy/department/organization/`_count.applications`. **No query params, no pagination.** |
| GET | `/api/jobs/[id]` | `requireStaff` | org filter; miss → **404** | same include |
| POST/PATCH/DELETE | `/api/jobs` | `canManageJobs` only | writes — **not migrated** | |
| Dashboard `/dashboard/jobs` | Prisma direct | session | `q` on title/location/department.name, `status`, `orderBy updatedAt desc` | UI-only; still Next.js |

Public careers (`/api/careers`) are out of scope.

---

## 2. Django unmanaged model

`apps.jobs.models.Job` — `managed = False`, `db_table = "Job"`.

FKs use `db_constraint=False` (no new constraints). Also unmanaged `Department` and count-only `JobApplicationRef` → `"Application"` (COUNT only, not an Application domain migration).

---

## 3. API endpoints

`GET /api/v1/jobs/`  
`GET /api/v1/jobs/{id}/`

Auth: HireOS JWT (Bearer or `aros_session`). Permission: `StaffOnly` (same staff set as Next GET `/api/jobs`).

---

## 4. RBAC

| Role | List/detail |
|---|---|
| ADMIN (SUPER_ADMIN) | allowed, **org-scoped** (stricter than Next SUPER_ADMIN global list) |
| HR | allowed |
| RECRUITER | allowed |
| HIRING_MANAGER | allowed (same as Next GET) |
| INTERVIEWER | allowed (same as Next GET) |
| CANDIDATE | **403** |

---

## 5. Organization isolation

Every queryset is `Job.objects.filter(organization_id=<JWT org>)`.  
Cross-org detail → **404** (same leak-avoidance as Next).  
Unknown org JWT → list `count=0`.

---

## 6. Pagination

`?page=1&page_size=25`  
Default 25, max **100** (`page_size=100000` → 100).

```json
{ "count": 5, "page": 1, "page_size": 25, "jobs": [ ... ] }
```

Detail:

```json
{ "job": { ... } }
```

---

## 7. Search / filtering

| Param | Behavior |
|---|---|
| `search` or `q` | SQL `ILIKE` on title, description, location, `Department.name` |
| `status` | exact Prisma `JobStatus` (`OPEN`, …); unknown ignored |
| `ordering` | whitelist: `created_at`, `updated_at`, `title`, `status` (prefix `-`) |

Default order: `-created_at` (matches GET `/api/jobs`).

---

## 8. SQL / query behavior

One list query: `SELECT Job.*` + `COUNT(Application.id)` + `select_related` Organization, Department, User.  
`WHERE "Job"."organizationId" = %s` always. No Python-side table scan. Pagination `LIMIT`.

**N+1:** avoided for list (join + group).  
**Future indexes (do not add now):** trigram on `title`/`description` if search grows; `(organizationId, status, createdAt)` composite. Existing: PK, status, organizationId, departmentId.

GROUP BY from `Count("application_refs")` is heavier than a subquery; acceptable at page_size ≤ 100.

User columns selected for `createdBy` do **not** include `passwordHash`.

---

## 9. Data parity

`python manage.py jobs_parity --limit 5` — **5/5 OK**.

Live HTTP (recruiter session): Next `GET /api/jobs` vs Django `GET /api/v1/jobs/` — **5 IDs match, 0 field mismatches** (id, title, status, description, location, skills, experience, org, department name, employmentType, openings, createdById, applicationCount).

No `requirements` field in either system.

---

## 10. Tests executed

`python manage.py test apps.jobs apps.accounts` → **25 OK**.

Jobs: invalid/expired 401, candidate 403, five staff roles 200, page_size cap, missing org 403, cross-org detail 404, SQL contains `organizationId` + search/status.

Live: candidate 403, org-B JWT list 0 / detail 404.

---

## 11. Next.js regression

`GET /api/health` → `ok: true`, database ok, Ollama ok, speech ok.  
`POST /api/auth/login` + `GET /api/jobs` still 200. Frontend/Prisma files **not** changed.

---

## 12. Files

- `backend/apps/jobs/models.py` `querysets.py` `serializers.py` `pagination.py` `views.py` `urls.py`
- `backend/apps/jobs/management/commands/jobs_parity.py`
- `backend/apps/jobs/tests/test_jobs.py`
- `backend/config/urls.py` `config/settings/base.py` (`django.contrib.postgres` for `ArrayField`)
- `docs/DJANGO_PHASE3A_JOBS.md`

---

## 13. Limitations

- Read-only. No create/update/delete.
- Django ADMIN cannot list other orgs (Next SUPER_ADMIN can).
- Next GET `/api/jobs` is unpaginated; Django is paginated.
- Dashboard search UI still hits Prisma, not Django.
- Application model is not migrated; only a COUNT join.
- `createdAt`/`updatedAt` are timestamp without time zone.
