# Logisoft HireOS — Phase 3H cutover audit & migration plan

**Status:** Audit / planning only. **No functional migration.** No Prisma, auth, frontend, interview, or proctoring changes in this phase.  
**Date:** 2026-08-15  
**Prerequisite:** Phases 3A–3G.1 complete. Enhanced secondary-camera UAT signed off by the team.

This document inventories **actual** `src/app/api/**` routes and the Django/Celery surface already proven. Classifications are based on latency, device interaction, and risk — not framework preference.

---

## 0. How to read classifications

| Code | Meaning |
|---|---|
| **A** KEEP NEXT.JS | Permanent or long-term Next.js (real-time, cookies, public site) |
| **B** MOVE TO DJANGO | Staff HTTP that can later be Django-sync (still Prisma) |
| **C** MOVE TO DJANGO + CELERY | Already or should be queued; HTTP returns immediately |
| **D** KEEP NEXT.JS + CALL DJANGO | Next route stays; internally enqueue Django/Celery (no UI rewrite) |
| **E** DO NOT MIGRATE / LEGACY | Unused, duplicate, or must not be copied |

Priorities for **future** work only: **P0** must (when a cutover is approved), **P1** should, **P2** optional, **KEEP** remain Next.js.

Django already exists for some **B/C** items as **parallel** APIs. The UI still calls Next.js. That is **not** a cutover.

---

## 1. Complete Next.js API inventory

Auth unless noted: cookie JWT `aros_session` via `getSession()`. Candidate interview/secondary: **magic token / pair token**, not staff JWT.

### 1.1 Auth & health

| Path | Methods | Purpose | Facing | Class | Pri | Django today |
|---|---|---|---|---|---|---|
| `/api/auth/login` | POST | bcrypt + mint JWT cookie | public | **A** | KEEP | No (Django only verifies) |
| `/api/auth/logout` | POST | clear cookie | user | **A** | KEEP | No |
| `/api/auth/me` | GET | session + Prisma user | user | **A** / later **D** | P2 | `GET /api/v1/accounts/me/` |
| `/api/auth/register` | POST | candidate/org signup | public | **A** | KEEP | No |
| `/api/health` | GET | DB + Ollama + speech | ops | **A** | KEEP | `GET /api/v1/health/` (infra) |

### 1.2 Org / admin

| Path | Methods | Purpose | Auth | Tables | Class | Pri |
|---|---|---|---|---|---|---|
| `/api/org` | GET | current org | staff | Organization | **B** | P1 |
| `/api/admin/org` | GET, PATCH | org settings | `requireAdmin` | Organization | **B** | P1 |
| `/api/admin/users` | GET, POST | user admin | `requireAdmin` | User | **B** | P1 |
| `/api/admin/users/[id]` | PATCH | user update | `requireAdmin` | User | **B** | P1 |
| `/api/admin/departments` | GET, POST | departments | `requireAdmin` | Department | **B** | P1 |
| `/api/admin/departments/[id]` | PATCH, DELETE | departments | `requireAdmin` | Department | **B** | P1 |

### 1.3 Jobs / candidates / applications (ATS core)

| Path | Methods | Purpose | Auth | Class | Pri | Django today |
|---|---|---|---|---|---|---|
| `/api/jobs` | GET | list | staff + `canManageJobs` on POST | GET **B**; POST **B** | GET P0 write P1 | GET `/api/v1/jobs/` |
| `/api/jobs/[id]` | GET, PATCH, DELETE | job CRUD | GET staff; write `canManageJobs` | GET **B**; write **B** | GET P0 write P1 | GET `/api/v1/jobs/<id>/` |
| `/api/jobs/[id]/screenable` | GET | who can be screened | pipeline | **B** | P1 | No |
| `/api/jobs/[id]/screen-all` | POST | sequential screens | pipeline | **D**→**C** | P1 | No (per-app Celery exists) |
| `/api/candidates` | GET | list | staff | **B** | P0 | GET `/api/v1/candidates/` |
| `/api/candidates/[id]` | GET | detail | staff | **B** | P0 | GET `/api/v1/candidates/<id>/` |
| `/api/candidates/[id]/tags` | GET, POST, DELETE | tags | GET staff; write pipeline | GET **B**; write **B** | P1 | No |
| `/api/applications` | GET | list | staff | **B** | P0 | GET `/api/v1/applications/` |
| `/api/applications/board` | GET | pipeline board | staff | **B** | P0 | pipeline-counts on Django |
| `/api/applications/[id]` | GET | detail | staff | **B** | P0 | GET `/api/v1/applications/<id>/` |
| `/api/applications/[id]/stage` | POST | **human** stage + optional note | pipeline | **B** | P0 | No — **highest-value remaining write** |
| `/api/applications/[id]/screen` | POST | sync `screenApplication` | pipeline | **D** | P1 | POST `/api/v1/screening/` Celery |
| `/api/applications/[id]/interviews` | GET, POST | list / **create + sync generatePlan** | pipeline | GET **B**; POST **D** | P1 | plan Celery exists; create session still Next |

There is **no** dedicated `/api/notes` route. Notes are written via stage payload / timeline (`NOTE_ADDED` / `DECISION`).

### 1.4 Files, talent, comms, templates, analytics

| Path | Methods | Purpose | Class | Pri | Django |
|---|---|---|---|---|---|
| `/api/documents/upload` | POST | staff resume upload + parse (sync) | **D** (upload A/B, parse **C**) | P1 | POST `/api/v1/resumes/process/` |
| `/api/tags` | GET, POST | org tags | **B** | P2 | No |
| `/api/tags/[id]` | PATCH, DELETE | tags | **B** | P2 | No |
| `/api/talent/search` | POST | pgvector search | **B** or **C** if heavy | P2 | No (embed already Celery via resume) |
| `/api/communications` | GET | logs | **B** | P2 | No |
| `/api/communications/compose-context` | GET | compose + may include interview link | **B** | P2 | No |
| `/api/communications/send` | POST | local mail / clipboard | **B** | P2 | No |
| `/api/templates` | GET, POST | email templates | **B** | P2 | No |
| `/api/templates/[id]` | PATCH, DELETE | templates | **B** | P2 | No |
| `/api/analytics` | GET | dashboard aggregates | **B** | P2 | No |

### 1.5 Public careers + candidate portal

| Path | Methods | Purpose | Auth | Class | Pri |
|---|---|---|---|---|---|
| `/api/careers` | GET | open jobs | public | **A** or **B** later | P2 KEEP for now |
| `/api/careers/[jobId]` | GET | job posting | public | **A** | KEEP |
| `/api/careers/apply` | POST | apply + resume | public | **A** then **D** parse | P1 KEEP apply in Next; parse Celery |
| `/api/portal/applications` | GET | my applications | CANDIDATE JWT | **A** | KEEP |
| `/api/portal/profile` | GET, PATCH, PUT | profile + resume PUT | CANDIDATE | **A** | KEEP |

Candidate portal and careers stay Next.js until a dedicated portal cutover is approved. They are **browser + cookie + public SEO** surfaces.

### 1.6 Staff interview / recording / evaluation

| Path | Methods | Purpose | Class | Pri | Django |
|---|---|---|---|---|---|
| `/api/interviews/[id]` | GET | report payload | **B** | P1 | No |
| `/api/interviews/[id]/expire` | POST | cancel + token expiry | **B** | P1 | No |
| `/api/interviews/[id]/plan` | GET, PATCH | plan while SCHEDULED | GET **B**; PATCH **B** | P1 | No |
| `/api/interviews/[id]/plan/refine` | POST | LLM refine plan | **C**/**D** | P2 | plan Celery is regenerate-from-create, not refine |
| `/api/interviews/[id]/regenerate-evaluation` | POST | sync overall eval | **D** | P1 | `interviews.finalize_interview` |
| `/api/interviews/[id]/proctoring` | GET, POST | staff signal review | GET **B**; POST KEEP **A** if live | P2 | report package Celery |
| `/api/interviews/[id]/secondary-recording` | GET | metadata (disk-verified 3G.1) | **B** | P2 | No |
| `/api/interviews/[id]/secondary-recording/file` | GET | **byte-range playback** | **A** (streaming) | KEEP | post-session process only |
| `/api/interviews/[id]/audio/[sequence]` | GET | staff TTS/audio | **A** | KEEP | prefetch Celery optional |

### 1.7 Live candidate interview (token)

| Path | Methods | Purpose | Class | Pri |
|---|---|---|---|---|
| `/api/interview/[token]` | GET | session bootstrap | **A** | KEEP |
| `/api/interview/[token]/state` | GET | reconnect | **A** | KEEP |
| `/api/interview/[token]/start` | POST | start + opening Q | **A** | KEEP |
| `/api/interview/[token]/answer` | POST | TEXT turn | **A** | KEEP |
| `/api/interview/[token]/answer-audio` | POST | VOICE STT + turn | **A** | KEEP |
| `/api/interview/[token]/continue` | POST | retry after 503 | **A** | KEEP |
| `/api/interview/[token]/candidate-question` | POST | candidate asks | **A** | KEEP |
| `/api/interview/[token]/question-audio/[sequence]` | GET | live TTS GET | **A** (prefetch **C**) | KEEP |
| `/api/interview/[token]/nudge-audio` | GET | TTS nudge | **A** | KEEP |
| `/api/interview/[token]/proctoring` | POST | signal ingest | **A** | KEEP |
| `/api/interview/[token]/proctoring/consent` | POST | consent | **A** | KEEP |
| `/api/interview/[token]/proctoring/secondary` | GET/POST | pair QR | **A** | KEEP |
| `/api/interview/[token]/proctoring/secondary/frame` | GET | laptop preview | **A** | KEEP |
| `/api/interview/[token]/integrity/consent` | POST | strict consent | **A** | KEEP |
| `/api/interview/[token]/integrity/violation` | POST | strict episode | **A** | KEEP |
| `/api/interview/[token]/integrity/ack` | POST | warning ack | **A** | KEEP |

### 1.8 Live secondary device (pair code)

| Path | Methods | Purpose | Class |
|---|---|---|---|
| `/api/interview/secondary/[code]` | GET | phone page metadata | **A** |
| `.../connect` | POST | pair | **A** |
| `.../heartbeat` | POST | keepalive | **A** |
| `.../frame` | POST | live frame | **A** |
| `.../integrity` | POST | may TERMINATE | **A** |
| `.../integrity/ack` | POST | ack | **A** |
| `.../recording/start` | POST | start | **A** |
| `.../recording/chunk` | POST | **ACK after disk write** | **A** |
| `.../recording/interrupt` | POST | gap | **A** |
| `.../recording/finalize` | POST | concat + verify (3G.1) | **A** (Celery **C** after terminal) |

**Do not move 1.7–1.8 for architectural consistency.**

---

## 2. Domain ownership

| Domain | Live owner | Background | DB SoT |
|---|---|---|---|
| Users / login | Next.js | — | Prisma `User` |
| Organizations / departments | Next.js admin APIs | — | Prisma |
| Jobs / candidates / applications **reads** | Next.js UI → Next API (Django GET exists unused by UI) | — | Prisma |
| Stage / decisions | Next.js `stage` POST | never Celery | Prisma Application + Timeline |
| Resume parse / embed | Next upload still sync | Django Celery `files.process_resume` | Candidate.resumeText / embedding |
| Screening | Next sync POST | Django Celery `screening.screen_application` | AIEvaluation |
| Interview live | Next.js | plan/finalize/TTS Celery | InterviewSession/* |
| Proctoring live | Next.js | assemble/report Celery | ProctoringEvent + files |
| Recordings | Next.js chunk ACK + finalize | Celery verify/assemble | disk + session columns |
| Files | `STORAGE_ROOT` | same root (3G.1) | disk; paths in DB |

**Prisma remains the database source of truth.** Django uses unmanaged reads, parameterized SQL, or `tsx` calling existing Prisma code. No duplicate Django-managed ATS tables.

Django **writes** today (via Node Prisma or parameterized SQL only):

- Resume text/embedding (Node extract + Prisma)
- AIEvaluation screening / INTERVIEW_OVERALL (Node)
- InterviewSession.plan (Node `generatePlan`)
- InterviewSession recording status/path and pair token (SQL, post-session)
- Never Application.stage from AI/Celery

---

## 3. Keep / move (summary)

**Stay Next.js (A):** login/logout/register; live interview + voice; STT; live TTS GET; system check; all live proctoring/secondary/chunk ACK/TERMINATE/duration; careers apply + portal; byte-range recording playback; middleware cookie gate.

**Move to Django later (B):** staff GET jobs/candidates/applications/board (already implemented — **UI not switched**); job/candidate/application **writes**; admin users/org/departments; tags; communications; templates; analytics; interview expire/plan PATCH; staff interview GET.

**Django + Celery (C) — already built, UI still Next sync:** resume process, screening, interview plan, finalize, TTS prefetch, proctoring process.

**Next + call Django (D) — recommended pattern for first cutovers:** keep `/api/applications/[id]/screen` URL; enqueue Celery; poll status. Same for staff resume upload parse, interview create plan, regenerate-evaluation.

**Never migrate without explicit new approval:** live interview engine, adaptive `decideNextTurn`, speech loop, secondary protocol, chunk ACK, duration, candidate magic links, Prisma schema, AI prompts/scoring, automatic stage from AI.

---

## 4. Real-time vs background

**Real-time (sync Next.js):** answer → persist → `decideNextTurn` → next question; STT; chunk 200; integrity TERMINATE; heartbeat; frames; start/reconnect; duration `endsAt`.

**Background (Celery proven):** resume embed; screening ~90s Ollama; plan ~131s; finalize ~206s; TTS cache ~0.88s; post-session recording/report.

**Hybrid:** TTS GET fallback if prefetch miss; Next.js still finalizes recording on session end; Celery re-verifies.

---

## 5. Write API audit (remaining Next.js writes)

| Write | Route | Pri | Future |
|---|---|---|---|
| Job create/update/delete | `/api/jobs` | P1 | **B** |
| Application stage + note | `/api/applications/[id]/stage` | **P0** | **B** — recruiter decision SoT |
| Interview create + plan | POST `.../interviews` | P1 | **D** (session create Next or Django; plan Celery) |
| Interview expire | `.../expire` | P1 | **B** |
| Resume upload | `/api/documents/upload`, portal PUT, careers apply | P1 | upload **A/B**; parse **C** |
| Screening | `.../screen`, `screen-all` | P1 | **D** |
| Tags | candidates/tags, tags | P2 | **B** |
| Admin users/org/depts | `/api/admin/*` | P1 | **B** |
| Communications send | `/api/communications/send` | P2 | **B** |
| Templates | `/api/templates` | P2 | **B** |
| Register | `/api/auth/register` | KEEP | **A** |
| Live interview/proctoring writes | `/api/interview/**` | KEEP | **A** |
| Plan PATCH/refine | plan routes | P2 | PATCH **B**; refine **C** |
| Staff proctoring POST | signals | KEEP | **A** if used live |

AI must **never** call stage. That remains a hard rule after any cutover.

---

## 6. Authentication

| Item | Owner |
|---|---|
| Login, cookie mint, bcrypt | Next.js **permanent for this program unless re-approved** |
| JWT `aros_session` HS256 `AUTH_SECRET` | shared |
| Django | **verify only** (Bearer or cookie) |
| Interview `accessToken` | Next.js only |
| Secondary `secondaryPairToken` | Next.js only |
| Candidate portal JWT | Next.js |

Django can be the **staff JSON backend** while Next keeps login. Candidate interview tokens **must not** move to Django in the next cutovers.

No `AUTH_SECRET` in client bundles (server `process.env` only). Do not put pair tokens in Django queue payloads (already IDs-only).

**Inconsistency:** Next `orgScopeWhere` lets SUPER_ADMIN see all orgs; Django staff APIs require JWT `organizationId` (stricter). Cutover must pick one rule and document it — **do not silently widen Django**.

---

## 7. RBAC (Role × domain)

Pipeline = SUPER_ADMIN, HR_ADMIN, RECRUITER, HIRING_MANAGER. Admin console = SUPER_ADMIN, HR_ADMIN. Jobs write = SUPER_ADMIN, HR_ADMIN, RECRUITER (`canManageJobs`). Interviewer: view apps, not pipeline moves. Candidate: portal + careers; **403** on staff Django queues.

| Domain | SA | HR | Rec | HM | Int | Cand |
|---|---|---|---|---|---|---|
| Login / me | Y | Y | Y | Y | Y | Y |
| Admin users/org/dept | Y | Y | N | N | N | N |
| Jobs write | Y | Y | Y | N | N | N |
| Jobs/candidates/apps read | Y | Y | Y | Y | Y* | N staff |
| Stage / screen / interview create | Y | Y | Y | Y | N | N |
| Live interview token | — | — | — | — | — | token, not role |
| Django resume/screen/plan/proctoring queue | RecruitmentStaff | same | same | same | **403** | **403** |

\*Interviewer: `canViewAllApplications`; not `canManagePipeline`.

Org isolation: Job.organizationId via Application. Django 404 on cross-org (no existence leak). Next often 403 for wrong org on staff routes.

---

## 8. Database architecture (Prisma — do not change)

Tables: Organization, Department, User, Job, JobAssignment, Candidate (`resumeText`, `embedding vector(768)`), Application, TimelineEvent, Note, Tag, CandidateTag, InterviewSession, InterviewQuestion, InterviewAnswer, AIEvaluation, ProctoringEvent, EmailTemplate, CommunicationLog.

Hot reads: Job/Candidate/Application lists, board by stage, interview by accessToken (indexed).  
Hot writes: InterviewAnswer + questions during live turns; ProctoringEvent batches; recording lastChunkIndex; TimelineEvent.

JSON: plan, adaptiveState, evaluation, scores, meta.  
Large text: resumeText, job description, transcripts.  
Vectors: Candidate.embedding — talent search.

**Future (not now):** optional processing-status columns; HNSW index on embedding; no Django migrate on these tables.

---

## 9. Storage architecture

Next.js: `cwd` + `STORAGE_ROOT` (`./storage` from repo `.env`).  
Django 3G.1: absolute **repo `storage/`** unless `STORAGE_ROOT` is already absolute.

Layout: `resumes/`, `interviews/{sessionId}/` (TTS + `secondary-camera/{recordingId}/`), `proctoring-report.json`.

**Production recommendation (do not change in 3H):** set **absolute** `STORAGE_ROOT` in company `.env` so Next and Celery cannot diverge. Keep 3G.1 alignment.

---

## 10. Celery inventory

| Task | Trigger | Args | Lock | Retry | Typical duration | Writes | Ready? |
|---|---|---|---|---|---|---|---|
| `files.process_resume` | POST `/api/v1/resumes/process/` | candidate_id, org | resume lock | ≤4 | parse+embed | Candidate | yes (parallel to Next upload) |
| `screening.screen_application` | POST `/api/v1/screening/` | application_id, org | screening lock | ≤3 | **~90 s** | AIEvaluation, timeline, embed | yes; UI still sync Next |
| `interviews.generate_plan` | POST `/api/v1/interviews/plan/` | session_id, org | plan lock | ≤3 | **~131 s** | session.plan | yes; create-interview still sync |
| `interviews.finalize_interview` | POST `.../finalize/` | session_id, org | finalize lock | ≤3 | **~206 s** | INTERVIEW_OVERALL | yes; Next regenerate still sync |
| `interviews.prefetch_question_tts` | POST `.../tts/` | session, org, question | tts lock | ≤3 | **~0.88 s** cache | ttsPath | yes; GET fallback Next |
| `proctoring.process_session` | POST `/api/v1/proctoring/process/` | session_id, org | process lock | ≤3 | **~50–240 ms** if file exists | report file; maybe SAVED/FAILED; pair | yes post-terminal |
| `proctoring.assemble_recording` | kind assemble | same | assemble lock | ≤3 | concat/probe | recording columns | yes |
| `proctoring.package_report` | kind report | same | report lock | ≤3 | ms–s | JSON report | yes |
| `common.health_check_task` | health | — | — | — | ms | none | ops |

Idempotency: Redis NX; screening allows later re-run (history); plan SCHEDULED only; assemble `already_completed` if verified file.

**Production-ready as background paths.** Not production-ready as **sole** path until UI/D enqueue cutover is approved.

---

## 11. Performance (measured — do not claim Django sped Ollama)

| Item | Measurement |
|---|---|
| Resume enqueue | ~102–116 ms |
| Screening enqueue | ~149 ms |
| Screening worker | ~90 s (Ollama) |
| Plan worker | ~131 s |
| Finalize worker | ~206 s |
| TTS cache | ~0.88 s |
| Proctoring process (verified file) | enqueue ~146 ms, worker ~237 ms |
| Live next question | **no Ollama** (`decideNextTurn`) |

**Bottleneck:** local chat model (`qwen2.5:7b`), not Redis/HTTP.

Supported recommendations only: keep live turns off Celery; enqueue screening/plan so staff HTTP is not 90–200 s; Windows Celery `-P solo` (one heavy job at a time); GPU Ollama if hardware exists (ops, not a code change here); do not raise temperature/seed to force text equality.

---

## 12. Security findings (as-built)

- Staff Django queues: 401 unauth, 403 candidate/interviewer, 404 cross-org.
- Queue bodies: IDs only; no resume/transcript/paths.
- Proctoring not in interview/screening prompts.
- Pair tokens not in staff report JSON.
- Recording “available” requires on-disk verify (3G.1).
- Interview tokens in compose-context for staff (existing Next) — keep staff-only.
- JWT HMAC key length warning in tests if AUTH_SECRET short — **ops**: use a long secret in company deploy (do not rotate in this audit).
- Parameterized SQL only in Django repositories.

---

## 13. Migration risk matrix

| Domain | Benefit | Complexity | Risk | Recommendation |
|---|---|---|---|---|
| Switch UI GETs jobs/candidates/apps to Django | Unblock dual-stack; Django already proven | LOW | MEDIUM (shape/pagination drift) | **First cutover** after contract tests |
| Stage write → Django | Single decision API | MEDIUM | **HIGH** (hiring SoT) | After GET cutover + parity tests |
| Screen/plan/upload → enqueue **D** | Staff UI not blocked on Ollama | MEDIUM | MEDIUM | Parallel to GET cutover |
| Admin users | Natural Django | MEDIUM | HIGH (authz) | After RBAC SUPER_ADMIN scoping decision |
| Live interview | None for candidate | HIGH | **CRITICAL** | **Do not migrate** |
| Live proctoring / chunks | None | HIGH | **CRITICAL** | **Do not migrate** |
| Recording playback stream | Little | MEDIUM | HIGH (range/video) | Keep Next |
| Talent vector search | Possible | MEDIUM | MEDIUM | P2 |
| Communications | Little | LOW | LOW | P2 |
| Portal/careers | Little | MEDIUM | HIGH (public apply) | Keep Next |

---

## 14. Target architecture (recommended, not implemented)

```
Browser (staff dashboard, candidate room, phone)
        │
        ▼
Next.js 14  ── cookie login, middleware, UI
        │
        ├─ REAL-TIME (stay): /api/interview/*, /api/interview/secondary/*,
        │     duration, STT/TTS GET, chunk ACK, integrity TERMINATE
        │
        └─ STAFF JSON (future): proxy or rewrite fetches → Django
                    │
                    ▼
              Django  ── verify aros_session, org RBAC
                    │
                    ├─ PostgreSQL (Prisma tables, unmanaged)
                    ├─ STORAGE_ROOT (absolute in prod)
                    └─ Redis → Celery
                              ├─ resume / screen / plan / finalize / TTS prefetch
                              └─ proctoring post-session
                    Ollama (local) + speech-service (local) called from
                    Next live path OR Celery workers — never cloud STT
```

---

## 15. Recommended future sequence (do not start without approval)

**Next implementation (smallest):** **Phase 4A — Staff READ cutover**  
Objective: dashboard Jobs / Candidates / Applications / board GET use Django; Next routes remain for rollback.  
APIs: existing `/api/v1/jobs|candidates|applications/`. Tables: read-only. Frontend: fetch base URL or rewrite. Risk: MEDIUM (DTO mismatch). Rollback: flip env to Next. Performance: **no Ollama benefit**; maybe slightly different query cost only.

**Then 4B — Enqueue wrappers (D):** Next `screen`, `screen-all`, document upload parse, interview create plan, regenerate-evaluation call Celery; poll status. Benefit: staff wait 100 ms not 90–200 s. Rollback: env flag sync Next. Risk: MEDIUM (status UX).

**Then 4C — Stage + job writes** on Django. Risk HIGH. Rollback: Next POST. Benefit: domain API consolidation, not model speed.

**Not scheduled:** live interview, proctoring, portal, login replacement.

---

## 16. Rollback / fallback (requirements only — not built)

| Dependency down | Required behavior |
|---|---|
| Django down | Next.js APIs still serve (today’s default). After READ cutover: env back to Next. |
| Redis/Celery down | Live interview **must** continue. Background jobs fail visibly; no silent drop of answers/chunks (those are Next). |
| Ollama down | Live TEXT still next-Q (deterministic). Screening/plan fail/retry; no fake scores. |
| Next.js down | Whole product down (UI). Django alone is not the website. |
| Disk/storage down | Chunk ACK must fail (not 200); never SAVED without file. |

Must not lose: applications, resumes, answers, recordings, recruiter stage decisions.

---

## 17. Permanent Next.js

Browser UI; cookie login; middleware; candidate room; phone secondary app; WebRTC/camera/mic; MediaRecorder chunks; in-memory frames; duration; magic links; public careers pages.

## 18. Permanent Django (direction)

Staff domain HTTP; RBAC on JWT; Celery orchestration; file/AI job workers; post-session recording/report; health of redis/workers.

## 19. Do not migrate

Live interview/voice/STT; live proctoring/secondary/chunk ACK/TERMINATE; duration; Prisma schema; AI prompts/scoring/adaptive rules; auto stage from AI; replacing `aros_session` mint; cloud vendors.

---

## 20. Phase 3H acceptance

Inventory, classifications, real-time protection, write audit, DB/storage/auth/RBAC/Celery, measured performance, risk matrix, target architecture, cutover order, rollback notes: **documented**.  
**No code, schema, or routing changes in 3H.**

**STOP. Wait for approval before any cutover (including 4A READ switch).**
