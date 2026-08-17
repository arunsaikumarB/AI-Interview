# Logisoft HireOS — Django Phase 4A: Staff READ cutover

**Status:** Implemented. Feature flag **defaults OFF**.  
**Date:** 2026-08-15  
**Does not start Phase 4B.**

This is the first frontend/API cutover. The UI still talks to same-origin Next.js routes and RSC loaders. When the flag is on, **selected GET reads** are fulfilled by Django via a Next.js server-side BFF. The browser never stores a second token.

---

## 1. Frontend READ inventory (traced)

Staff dashboards are **not** primarily client `fetch` to `/api/jobs`. Most list/detail pages are React Server Components that query **Prisma directly**.

### Jobs

| File | Function | Endpoint | Method | Consumer | Expected shape |
|---|---|---|---|---|---|
| `src/app/dashboard/jobs/page.tsx` | `loadJobsHub` | Prisma `job.findMany` (flag off) or Django jobs+applications (flag on) | GET (server) | Jobs hub table | Rows: id, title, location, status, updatedAt, applications, inInterview, selected |
| `src/app/api/jobs/route.ts` | `GET` | `/api/jobs` | GET | No current dashboard `fetch`; API clients | `{ jobs: [scalars + createdBy + department + organization + _count.applications] }` |
| `src/app/api/jobs/[id]/route.ts` | `GET` | `/api/jobs/:id` | GET | No current form GET; PATCH/DELETE still Next | `{ job: … same include }` |
| `src/app/dashboard/jobs/[id]/page.tsx` | page | Prisma `job.findFirst` + nested applications/evals/interviews | RSC | Job workspace | Nested applicants, AI match, interview status, JobForm initial |
| `src/components/job-form.tsx` | submit | `/api/jobs` or `/api/jobs/:id` | **POST/PATCH** | Create/edit | Write — not switched |
| `src/components/job-delete-button.tsx` | delete | `/api/jobs/:id` | **DELETE** | Job details | Write — not switched |
| `src/components/screen-all-button.tsx` | list | `/api/jobs/:id/screenable` | GET | Screen-all | Nested screenable apps — **not switched** |

### Candidates

| File | Function | Endpoint | Method | Consumer | Expected shape |
|---|---|---|---|---|---|
| `src/app/dashboard/candidates/page.tsx` | page | Prisma `candidate.findMany` + latest application + RESUME_SCREEN + interview | RSC | Candidates table | name, email, experience, aiMatch, stage, jobTitle, interviewStatus |
| `src/app/api/candidates/route.ts` | `GET` | `/api/candidates?q=` | GET | No dashboard fetch (profile form is POST) | `{ candidates: [scalars including resumeText + _count.applications] }` |
| `src/app/api/candidates/[id]/route.ts` | `GET` | `/api/candidates/:id` | GET | Not used by candidate detail RSC | Nested applications, notes, tags, timeline, **all aiEvaluations** |
| `src/app/dashboard/candidates/[id]/page.tsx` | page | Prisma nested include (timeline, interviews, proctoring helpers, resume disk check) | RSC | Candidate detail | Far richer than Django candidate detail |
| `src/components/candidate-tags.tsx` | tags | `/api/candidates/:id/tags` | GET/POST/DELETE | Detail | **not switched** |
| `src/components/candidate-profile-form.tsx` | save | `/api/candidates` | **POST** | Portal/profile | Write — not switched |

### Applications / pipeline

| File | Function | Endpoint | Method | Consumer | Expected shape |
|---|---|---|---|---|---|
| `src/components/pipeline-board.tsx` | `useQuery` | `/api/applications/board?jobId=` | GET | Pipeline page + job pipeline tab | `{ columns: Record<stage, apps>, stages }` with candidate, job, **aiEvaluations** |
| `src/app/api/applications/board/route.ts` | `GET` | `/api/applications/board` | GET | PipelineBoard | Grouped Prisma rows + screening scores |
| `src/app/api/applications/route.ts` | `GET` | `/api/applications` | GET | No dashboard fetch | `{ applications: [scalars + job + candidate + latest RESUME_SCREEN] }` |
| `src/app/api/applications/[id]/route.ts` | `GET` | `/api/applications/:id` | GET | Not the RSC detail page | Full candidate, timeline, all evals, interviewSessions |
| `src/app/api/applications/pipeline-counts/route.ts` | `GET` | `/api/applications/pipeline-counts?jobId=` | GET | Tests / ops (board does **not** call this) | `{ counts, stages }` |
| `src/components/pipeline-board.tsx` | mutation | `/api/applications/:id/stage` | **POST** | Drag-drop | Write — not switched |
| `src/components/application-stage-controls.tsx` | stage | `/api/applications/:id/stage` | **POST** | Detail | Write |
| `src/components/ai-screening-card.tsx` | screen | `/api/applications/:id/screen` | **POST** | Detail | Write / AI |
| `src/components/interviews-panel.tsx` | list | `/api/applications/:id/interviews` | GET | Detail | Interviews — **not switched** |
| `src/components/create-interview-dialog.tsx` | create | `/api/applications/:id/interviews` | **POST** | Detail | Write |

### Intentionally not inventory-switched

Careers, candidate portal, `/api/careers`, `/api/portal/*`, home `src/lib/dashboard.ts` metrics, analytics, talent search, communications.

---

## 2. Response contract mapping

### GET `/api/jobs` vs Django `GET /api/v1/jobs/`

**Next (flag off):** unpaginated `{ jobs: [...] }` ordered `createdAt desc`. `_count.applications`. SUPER_ADMIN unscoped.

**Django:** paginated `{ count, page, page_size, jobs }` default 25. `applicationCount`. Always org-scoped.

**Adapter:** fetch all pages (`page_size=100`), `normalizeJob()` maps `applicationCount` → `_count.applications`. Ordering `-created_at`.

### GET `/api/jobs/:id` vs Django `GET /api/v1/jobs/{id}/`

Same field mapping. Cross-org → Django **404**. Next SUPER_ADMIN can see any org when flag off.

### GET `/api/candidates` vs Django `GET /api/v1/candidates/`

**Next:** unpaginated, `_count.applications`, `?q=` on name/email/skills.

**Django:** paginated, `applicationCount`, `q`/`search` same fields.

**Adapter:** all pages, `applicationCount` → `_count`. **Does not add nested applications.**

### GET `/api/applications` vs Django `GET /api/v1/applications/`

**Next:** includes latest `aiEvaluations` (RESUME_SCREEN).

**Django:** scalars + compact candidate/job. **No AI evaluations.**

**Adapter:** `normalizeApplicationListItem()` keeps Next list scalars + job/candidate name/email. **Does not invent `aiEvaluations`.** No current UI fetches this GET.

### GET `/api/applications/:id` vs Django detail

**Next:** timeline, all evals, interview sessions, full candidate.

**Django:** compact application only.

**Decision A:** keep this GET on Next.js / Prisma.

### GET `/api/candidates/:id` vs Django detail

**Next:** applications, notes, tags, timeline, evals.

**Django:** candidate scalars + `applicationCount`.

**Decision A:** keep candidate detail RSC and this GET on Next.js.

### Pipeline board vs Django `pipeline-counts`

**Board** needs cards + screening %. Django counts are a histogram only.

**Decision A:** `/api/applications/board` stays Prisma. New Next `GET /api/applications/pipeline-counts` proxies Django when flag on (Prisma `groupBy` when off). Pipeline UI unchanged.

### Jobs hub vs Django

Hub needs per-job in-interview / selected counts. Django job list has total `applicationCount` only.

**Adapter:** Django jobs list (`ordering=-updated_at`, `q`, `status`) **plus** Django applications list; compute interview/selected in `loadJobsHub`. Search already includes department name on Django.

---

## 3. Feature flag

| Variable | Default | Meaning |
|---|---|---|
| `NEXT_PUBLIC_USE_DJANGO_READS` | **false** | `false` → Next.js/Prisma reads. `true` → approved Django reads via BFF |

One flag for jobs + candidates + applications list reads (smallest safe design). Independent per-domain flags were not required.

---

## 4. API base URL

| Variable | Role |
|---|---|
| `DJANGO_API_URL` | Preferred **server** origin |
| `NEXT_PUBLIC_DJANGO_API_URL` | Fallback if `DJANGO_API_URL` unset |
| Default | `http://127.0.0.1:8000` |

No hardcoded origin in components. No secrets in `NEXT_PUBLIC_*`. `AUTH_SECRET` stays server-only.

---

## 5. Authentication approach

Login remains Next.js. Cookie **`aros_session`** (httpOnly, SameSite=Lax, path `/`). Django already validates that JWT.

**Chosen approach: same-origin Next.js BFF.**

```
Browser → Next.js (RSC or /api/*) → Django GET /api/v1/...
         Cookie: aros_session forwarded server-side
```

The browser does **not** call Django. No second login. No Bearer token in JS.

Next still runs `requireStaff` / `canViewAllApplications` **before** proxying.

---

## 6. CORS / cookie approach

Direct browser → Django is **not used**, so CORS credentials are not required for this phase.

Django CORS settings are unchanged. Cookies are **not** weakened (`Secure` still production-only; SameSite still Lax).

---

## 7. Response adapters

| Module | Role |
|---|---|
| `src/lib/staff-reads/flag.ts` | Flag + Django URL |
| `src/lib/staff-reads/django-client.ts` | Cookie-forwarding GET, pagination |
| `src/lib/staff-reads/normalize.ts` | Django JSON → existing UI/API models |
| `src/lib/staff-reads/django-reads.ts` | Domain list/detail helpers |
| `src/lib/staff-reads/jobs-hub.ts` | Jobs dashboard rows |
| `src/lib/staff-reads/errors.ts` | `DjangoReadError` — no silent Prisma fallback |

---

## 8. APIs switched vs not

**Switched when flag=true**

- `GET /api/jobs` → `GET /api/v1/jobs/`
- `GET /api/jobs/:id` → `GET /api/v1/jobs/{id}/`
- `GET /api/candidates` → `GET /api/v1/candidates/`
- `GET /api/applications` → `GET /api/v1/applications/`
- `GET /api/applications/pipeline-counts` → `GET /api/v1/applications/pipeline-counts/`
- Jobs hub RSC (`/dashboard/jobs`) → Django jobs + applications lists

**Not switched (keep Next/Prisma)**

- Job detail RSC (nested applicants, screening, interviews, JobForm)
- Candidates dashboard RSC (AI match + interview columns)
- Candidate detail RSC
- Application detail GET (timeline/evals/sessions)
- Candidate detail GET (notes/tags/timeline/evals)
- Pipeline **board** GET (cards + scores)
- All POST/PATCH/DELETE (jobs, stage, screen, interviews, tags, resume, apply)
- Portal, careers, screening, interviews, proctoring, secondary camera
- Home dashboard metrics, analytics

---

## 9. Failure behavior (Option A)

No silent Django → Next fallback.

If flag=`true` and Django is down: existing error JSON / Next error UI (503 `Staff read service unavailable`).

**Rollback**

1. Set `NEXT_PUBLIC_USE_DJANGO_READS=false` in `.env`
2. Restart Next.js (`npm run dev` or the production Node process)
3. Staff reads return to Prisma

No production data change.

---

## 10. Known limitations

1. **SUPER_ADMIN:** Next Prisma lists can be global (`orgScopeWhere` empty). Django is **always org-scoped** from JWT `organizationId`. Flag on = stricter isolation. Django was **not** weakened.
2. **Candidates dashboard / job detail / board / candidate detail** stay on Prisma because Django READ APIs omit nested screening, interviews, notes, tags, timeline, proctoring.
3. **GET `/api/applications` (Django)** omits `aiEvaluations`. No UI consumer today.
4. Phase 4A does **not** make Ollama faster.

---

## 11. Parity / RBAC / cross-org / performance / regression

Command (2026-08-15):

```text
backend\.venv\Scripts\python.exe manage.py read_parity --jobs 5 --candidates 5 --applications 10 --measure 7
```

**Parity:** 5 jobs, 5 candidates, 10 applications — **0 ID mismatches, 0 relevant field mismatches.** Pipeline counts (org-scoped) match for every stage (APPLIED 9, SCREENING 0, SHORTLISTED 0, ASSESSMENT 1, AI_INTERVIEW 2, TECH_INTERVIEW 1, HR_INTERVIEW 1, SELECTED 1, REJECTED 6).

**RBAC / auth / cross-org:** existing Django suite **112 OK** (`manage.py test`). Staff list/detail: candidate **403**, missing/invalid/expired JWT **401**, cross-org detail **404**. Django SUPER_ADMIN remains org-scoped (stricter than Next).

**Performance (n=7, live HTTP, flag off so Next still hits Prisma).** This does **not** include Ollama. Next P95 is dominated by a cold first sample; P50 is the fairer comparison.

| Read | avg | P50 | P95 | size |
|---|---|---|---|---|
| Django jobs | 46.5 ms | 37.4 ms | 103.4 ms | 8839 B |
| Next jobs | 128.0 ms | 34.1 ms | 633.4 ms | 8809 B |
| Django candidates | 31.4 ms | 30.3 ms | 39.6 ms | 29060 B |
| Next candidates | 96.1 ms | 36.5 ms | 310.9 ms | 27257 B |
| Django applications | 30.7 ms | 28.9 ms | 38.3 ms | 12178 B |
| Next applications | 95.0 ms | 42.1 ms | 413.9 ms | 56557 B |

Next applications payload is larger because it embeds latest `aiEvaluations`. Django list does not. P50 is similar (Django slightly lower on applications). **No claim that Ollama became faster.**

**Regression:** `manage.py check` clean. `manage.py test` 112 OK. `tests/unit/staff-reads.test.ts` 5 pass. Unrelated interview/proctoring/AI code was not modified.

---

## 12. Files changed

- `src/lib/staff-reads/*` (new)
- `src/app/api/jobs/route.ts` (GET only)
- `src/app/api/jobs/[id]/route.ts` (GET only)
- `src/app/api/candidates/route.ts` (GET only)
- `src/app/api/applications/route.ts` (GET only)
- `src/app/api/applications/pipeline-counts/route.ts` (new GET)
- `src/app/dashboard/jobs/page.tsx` (data loader only)
- `tests/unit/staff-reads.test.ts`
- `backend/common/management/commands/read_parity.py`
- `.env.example`, `backend/.env.example`
- `docs/DJANGO_PHASE4A_READ_CUTOVER.md`

**Not changed:** Prisma schema, Django DB schema, auth cookie/JWT, AI, interviews, proctoring, candidate interview UI.

---

## 13. Write protection

POST/PATCH/DELETE handlers were not pointed at Django. Job create/edit/delete, stage changes, screening, interviews remain Next.js regardless of the flag.
