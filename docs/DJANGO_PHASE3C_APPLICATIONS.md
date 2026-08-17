# Logisoft HireOS — Django Phase 3C: Applications READ

**Status:** Read-only Django API over Prisma `"Application"`. Next.js owns writes, stage changes, board UI, screening, interviews.  
**Date:** 2026-08-15

---

## 1. Prisma Application schema (inspected)

There is **no `organizationId`** on Application. Org is `Job.organizationId`.

| Field | Postgres | Notes |
|---|---|---|
| `id` | text PK (cuid) | |
| `candidateId` | text NOT NULL | index; unique with `jobId` |
| `jobId` | text NOT NULL | index |
| `stage` | enum `PipelineStage` | index |
| `status` | enum `ApplicationStatus` | ACTIVE, WITHDRAWN, HIRED, REJECTED, ON_HOLD |
| `source` | text NULL | e.g. career_site |
| `coverNote` | text NULL | applicant cover text, not recruiter notes |
| `createdAt` / `updatedAt` | timestamp | |

**Not on the table:** recruiter/owner, rejection rationale, selection note (those are `TimelineEvent` payloads on stage change), resume FK (resume is on Candidate), screening/interview FKs (separate tables).

Relations: Candidate, Job, TimelineEvent[], InterviewSession[], AIEvaluation[]. Notes hang off Candidate, not Application.

Indexes: PK, stage, status, jobId, candidateId, unique `(candidateId, jobId)`.

**Next.js read APIs**

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/api/applications` | `requireStaff` + `canViewAllApplications` | all Application scalars + job summary + candidate name/email + latest `RESUME_SCREEN` eval |
| GET | `/api/applications/[id]` | `requireStaff`; then org check | full candidate, timeline, **all aiEvaluations**, interviewSessions; wrong org → **403** if row exists |
| GET | `/api/applications/board` | `requireStaff` | grouped by stage + screening scores |
| POST | `.../stage`, `.../screen`, interviews | writes | **not migrated** |

`canViewAllApplications` = SUPER_ADMIN, HR_ADMIN, RECRUITER, HIRING_MANAGER, **INTERVIEWER** (same as `STAFF_ROLES`). Interviewer is **not** restricted on this list API.

---

## 2. Pipeline stages (actual)

From Prisma `enum PipelineStage` / `PIPELINE_STAGES`:

APPLIED → SCREENING → SHORTLISTED → ASSESSMENT → AI_INTERVIEW → TECH_INTERVIEW → HR_INTERVIEW → SELECTED | REJECTED

Terminal: SELECTED, REJECTED. No legacy stages. Writes remain Next.js (`canManagePipeline` + human note for terminal).

---

## 3. Django unmanaged model

`apps.applications.models.Application` — `managed = False`, `db_table = "Application"`.  
FKs to existing Job/Candidate with `db_constraint=False`. Count stubs from 3A/3B remain.

---

## 4–5. APIs

`GET /api/v1/applications/`  
`GET /api/v1/applications/{id}/`  
`GET /api/v1/applications/pipeline-counts/` (stage histogram for board parity; no AI nested payload)

---

## 6–9. Search, filters, sort, pagination

- `search`/`q`: SQL ILIKE candidate first/last/email + job title  
- `stage=SCREENING` — invalid enum → **400**  
- `jobId=` — unknown/other-org → empty list  
- `sort`: allowlist `created_at`, `updated_at`, `stage` (±). Default **`-updated_at`** (Next list). Unknown sort ignored.  
- `page` / `page_size` default 25, max 100  

---

## 10. Candidate / Job summaries

Application JSON includes compact:

- candidate: id, firstName, lastName, email, experience, skills  
- job: id, title, status, department.name  

Not the full Candidate/Job records. `resumeText` / `embedding` / job description deferred out of SQL.

---

## 11. RBAC

StaffOnly (incl. INTERVIEWER) — matches Next `canViewAllApplications`. CANDIDATE **403**. Inactive **401**. Missing org **403**.

Cross-org detail: Django **404** (no existence leak). Next detail is **403** after `findUnique` (leaks existence). Phase 3C follows the 404 isolation rule.

---

## 12. PII

| Field | Why | Who |
|---|---|---|
| candidate name, email | pipeline identity | same-org staff |
| experience, skills | list context (requested read model) | same-org staff |
| coverNote | Next list already returns this scalar | same-org staff |
| source, stage, status | pipeline | same-org staff |

**Not returned:** passwordHash, embeddings, resumeText, AI scores/reasoning, interview evals, timeline, proctoring, recruiter notes, auth secrets.

---

## 13. Query behavior

One list query: Application ⋈ Job ⋈ Department ⋈ Candidate, `WHERE Job.organizationId = %s`, `defer` large columns, `LIMIT`. No N+1. Counts query is `GROUP BY stage` only.

**Future indexes (do not add):** `(jobId, stage)` already partly covered by jobId + stage indexes; no org column to index.

---

## 14–16. Parity (executed)

`python manage.py applications_parity --limit 10` → **10/10 OK**.

Pipeline counts (Prisma SQL = Django):

| Stage | Count |
|---|---|
| APPLIED | 10 |
| SCREENING | 0 |
| SHORTLISTED | 0 |
| ASSESSMENT | 1 |
| AI_INTERVIEW | 2 |
| TECH_INTERVIEW | 1 |
| HR_INTERVIEW | 1 |
| SELECTED | 1 |
| REJECTED | 5 |

Live Next `GET /api/applications` vs Django: **21/21 IDs**, sample 10 **0 mismatches**. Next board column lengths **exact match** Django `pipeline-counts`.

---

## 17. Tests (executed)

`manage.py test apps.accounts apps.jobs apps.candidates apps.applications` → **48 OK**.

Live: CANDIDATE 403; other-org list 0 / detail 404.

---

## 18. Limitations

Read-only. No stage PATCH. No nested AI/timeline/interviews. Django 404 vs Next 403 on cross-org detail. List is paginated; Next list is not.

---

## 19. Future

Stage transitions, screening, interviews stay on Next.js until a later phase.

---

## Regression (executed)

`manage.py check` clean. Login, `/api/auth/me`, `/api/health` (db/ollama/speech ok). Jobs 5 = Next 5. Candidates 19 = Next 19. `src/` and `prisma/` unchanged.
