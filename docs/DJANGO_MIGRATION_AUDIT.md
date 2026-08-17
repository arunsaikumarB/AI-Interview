# Logisoft HireOS — Backend architecture audit and Django migration assessment

**Status:** Audit only. No code, packages, schema, or runtime were changed as part of this document.

**Scope:** Existing repository as inspected on 2026-08-15. Claims below are limited to files that exist in this codebase. Where a requested capability was **not found**, that is stated explicitly.

**Product:** Logisoft HireOS — self-hosted ATS + AI screening + adaptive AI interview (text/voice) + proctoring signals. Tagline in `package.json`: “Intelligent hiring. Human decisions.”

---

## 1. Current backend framework and architecture

HireOS is **not** a separate backend service. The backend is **Next.js 14 App Router** (`next@14.2.35`) TypeScript API routes colocated with the React UI.

| Layer | Implementation |
|---|---|
| HTTP API | `src/app/api/**/route.ts` (App Router Route Handlers) |
| Server-rendered staff UI | `src/app/dashboard/**` — several pages query Prisma **directly** (not only via REST) |
| ORM | Prisma 5.22.0 (`prisma/schema.prisma`) |
| Database | PostgreSQL 16 + **pgvector** (`pgvector/pgvector:pg16` in `docker-compose.yml`) |
| Auth | JWT in httpOnly cookie (`jose` + `bcryptjs`) |
| Validation | Zod on request bodies |
| AI chat | HTTP to Ollama (`src/lib/ai/ollama.ts`) |
| Embeddings | Local Ollama only (`nomic-embed-text`, 768-d), written with raw SQL |
| Speech | Separate **FastAPI** process (`speech-service/`, default `http://localhost:8001`) |
| Files | Local disk under `STORAGE_ROOT` (`src/lib/storage.ts`) |
| Email | Optional nodemailer SMTP; otherwise “clipboard” mode (`src/lib/mail.ts`) |

**Process model:** one Node.js process (`next dev` / `next start`). There is **no Celery, Redis, Bull, Inngest, or job queue** in the repository. Long work (Ollama scoring, screen-all, TTS prefetch) runs **in-process** (`await` on the request, or `void scoreInBackground(...)` fire-and-forget).

**Hard product constraints** (`.cursorrules`, `README.md`, schema comments):

- Production is 100% local/self-hosted (no cloud DBs/storage/OpenAI).
- `AI_PROVIDER=local` (default) → `http://localhost:11434`; `AI_PROVIDER=cloud` is documented as **dev-only** (ollama.com + `OLLAMA_API_KEY`).
- Embeddings **always** use local Ollama.
- STT/TTS **never** use cloud APIs.
- AI is advisory; pipeline stage changes are human-only.
- Proctoring events are timestamped **signals**, never auto-verdicts, and must not be passed into LLM prompts.

---

## 2. Backend folder structure

```
src/app/api/                 Next.js Route Handlers (REST-ish JSON APIs)
src/middleware.ts            JWT gate + Candidate vs staff path split
src/instrumentation.ts       Logs cloud-AI warning on Node startup
src/lib/auth/                session.ts (JWT), rbac.ts
src/lib/ai/                  Ollama client, screening, interview engine, embeddings
src/lib/resume/              parse.ts, mime.ts
src/lib/integrity*.ts        Strict integrity policy + server episode handling
src/lib/proctoring.ts        Candidate-browser signal collector (client, used from interview room)
src/lib/secondary-*.ts       Pairing, recording, CV helpers, labels
src/lib/storage.ts           Local disk I/O
src/lib/speech.ts            Client to speech-service
src/lib/mail.ts              SMTP / clipboard
src/lib/db.ts                PrismaClient singleton
prisma/schema.prisma         Canonical data model
prisma/migrations/           SQL migrations (including pgvector HNSW)
speech-service/              FastAPI STT/TTS (Python)
docker-compose.yml           postgres, ollama, speech, app
storage/                     Runtime files (gitignored contents); categories created in code
```

**Note:** `src/lib/ollama.ts` re-exports `@/lib/ai/ollama` and is marked deprecated.

Dashboard pages that import Prisma / `@/lib/db` (server-side, bypassing REST for reads):  
`src/app/dashboard/interviews/[id]/page.tsx`, `plan/page.tsx`, `interview-links/page.tsx`, `jobs/page.tsx`, `jobs/[id]/page.tsx`, `candidates/page.tsx`, `candidates/[id]/page.tsx`.

---

## 3. All API endpoints

All handlers live under `src/app/api`. Methods listed are those **exported** from each `route.ts`.

### Auth and health

| Method | Path |
|---|---|
| POST | `/api/auth/login` |
| POST | `/api/auth/logout` |
| POST | `/api/auth/register` (creates `Role.CANDIDATE` + `Candidate`) |
| GET | `/api/auth/me` |
| GET | `/api/health` (Postgres + Ollama connectivity) |

### Org / admin

| Method | Path |
|---|---|
| GET | `/api/org` |
| GET, PATCH | `/api/admin/org` |
| GET, POST | `/api/admin/users` |
| PATCH | `/api/admin/users/[id]` |
| GET, POST | `/api/admin/departments` |
| PATCH, DELETE | `/api/admin/departments/[id]` |

### ATS

| Method | Path |
|---|---|
| GET, POST | `/api/jobs` |
| GET, PATCH, DELETE | `/api/jobs/[id]` |
| GET | `/api/jobs/[id]/screenable` |
| POST | `/api/jobs/[id]/screen-all` |
| GET | `/api/candidates` |
| GET | `/api/candidates/[id]` |
| GET, POST, DELETE | `/api/candidates/[id]/tags` |
| GET | `/api/applications` |
| GET | `/api/applications/board` |
| GET | `/api/applications/[id]` |
| POST | `/api/applications/[id]/stage` |
| POST | `/api/applications/[id]/screen` |
| GET, POST | `/api/applications/[id]/interviews` |
| GET, POST | `/api/tags` |
| PATCH, DELETE | `/api/tags/[id]` |
| POST | `/api/documents/upload` |
| POST | `/api/talent/search` |
| GET | `/api/analytics` |

**Not found:** REST create/update for `Note`; staff create-candidate besides careers apply / register; `Application` POST (applications are created via careers apply).

### Communications / templates

| Method | Path |
|---|---|
| GET | `/api/communications` |
| GET | `/api/communications/compose-context` |
| POST | `/api/communications/send` |
| GET, POST | `/api/templates` |
| PATCH, DELETE | `/api/templates/[id]` |

### Public careers

| Method | Path |
|---|---|
| GET | `/api/careers` |
| GET | `/api/careers/[jobId]` |
| POST | `/api/careers/apply` (rate-limited in-process) |

### Candidate portal (JWT `CANDIDATE`)

| Method | Path |
|---|---|
| GET | `/api/portal/applications` |
| GET, PATCH, PUT | `/api/portal/profile` (PUT = resume upload) |

### Staff interview admin (JWT staff)

| Method | Path |
|---|---|
| GET | `/api/interviews/[id]` |
| GET, PATCH | `/api/interviews/[id]/plan` |
| POST | `/api/interviews/[id]/plan/refine` |
| POST | `/api/interviews/[id]/expire` |
| POST | `/api/interviews/[id]/regenerate-evaluation` |
| GET, POST | `/api/interviews/[id]/proctoring` |
| GET | `/api/interviews/[id]/audio/[sequence]` |
| GET | `/api/interviews/[id]/secondary-recording` |
| GET | `/api/interviews/[id]/secondary-recording/file` |

### Candidate interview room (magic `accessToken`, **no session cookie**)

Public in `src/middleware.ts` (`/interview/*`, `/api/interview/*`).

| Method | Path |
|---|---|
| GET | `/api/interview/[token]` |
| GET | `/api/interview/[token]/state` |
| POST | `/api/interview/[token]/start` |
| POST | `/api/interview/[token]/answer` |
| POST | `/api/interview/[token]/answer-audio` |
| POST | `/api/interview/[token]/continue` |
| POST | `/api/interview/[token]/candidate-question` |
| GET | `/api/interview/[token]/question-audio/[sequence]` |
| GET | `/api/interview/[token]/nudge-audio` |
| POST | `/api/interview/[token]/proctoring` |
| POST | `/api/interview/[token]/proctoring/consent` |
| GET, POST | `/api/interview/[token]/proctoring/secondary` |
| GET | `/api/interview/[token]/proctoring/secondary/frame` |
| POST | `/api/interview/[token]/integrity/consent` |
| POST | `/api/interview/[token]/integrity/violation` |
| POST | `/api/interview/[token]/integrity/ack` |

### Secondary phone device (pair token `secondaryPairToken`)

| Method | Path |
|---|---|
| GET | `/api/interview/secondary/[code]` |
| POST | `/api/interview/secondary/[code]/connect` |
| POST | `/api/interview/secondary/[code]/heartbeat` |
| POST | `/api/interview/secondary/[code]/frame` |
| POST | `/api/interview/secondary/[code]/integrity` |
| POST | `/api/interview/secondary/[code]/integrity/ack` |
| POST | `/api/interview/secondary/[code]/recording/start` |
| POST | `/api/interview/secondary/[code]/recording/chunk` |
| POST | `/api/interview/secondary/[code]/recording/interrupt` |
| POST | `/api/interview/secondary/[code]/recording/finalize` |

---

## 4. Authentication implementation

**Staff and portal candidates**

1. `POST /api/auth/login` loads `User` by email, checks `isActive`, `bcrypt.compare` vs `passwordHash`.
2. `createSessionToken` (`src/lib/auth/session.ts`) signs JWT with `jose` (`HS256`): claims `email`, `name`, `role`, `organizationId`, `sub` = user id.
3. Cookie: `AUTH_COOKIE_NAME` (default `aros_session`), `httpOnly`, `sameSite=lax`, `secure` in production, TTL `AUTH_TOKEN_TTL_HOURS` (default 12).
4. `getSession()` verifies the cookie JWT. **Role is read from the token, not re-fetched from Postgres on each request.** Changing `User.role` in admin does not take effect until re-login or token expiry.
5. `src/middleware.ts` requires a valid JWT for non-public paths; sets `x-user-id`, `x-user-role`, `x-user-email` headers.

**Public (no cookie)**

- `/`, `/login`, `/register`, `/api/auth/login`, `/api/auth/register`, `/api/health`
- `/careers`, `/api/careers*`
- `/interview/*`, `/api/interview/*` (token or pair-code in the URL)

**Register:** `POST /api/auth/register` always creates `role: CANDIDATE` and a linked `Candidate` on the oldest `Organization`.

**Interview room:** `InterviewSession.accessToken` unique string; expiry `tokenExpiresAt`. Not a User JWT.

**Secondary camera:** `InterviewSession.secondaryPairToken` + `secondaryPairExpiresAt`.

---

## 5. Role-based access control

Roles in Prisma `enum Role`: `SUPER_ADMIN`, `HR_ADMIN`, `RECRUITER`, `HIRING_MANAGER`, `INTERVIEWER`, `CANDIDATE`.

Helpers in `src/lib/auth/rbac.ts`:

| Helper | Meaning in code |
|---|---|
| `requireUser` | Any authenticated JWT |
| `requireStaff` | All roles in `STAFF_ROLES` except Candidate |
| `requireAdmin` | `SUPER_ADMIN`, `HR_ADMIN` |
| `requireCandidate` | `CANDIDATE` |
| `canManageJobs` | Super Admin, HR Admin, Recruiter |
| `canManagePipeline` | Super Admin, HR Admin, Recruiter, Hiring Manager (**not** Interviewer) |
| `canViewAllApplications` | Pipeline roles + Interviewer |
| `canAdministerUsers` | Super Admin, HR Admin |
| `orgScopeWhere` | Super Admin: no org filter; others: `organizationId` |

**Middleware isolation:** Candidate hitting `/dashboard` or `/api/admin` → redirect `/portal` or 403. Non-candidate hitting `/portal` → `/dashboard`.

**API granularity is uneven:** many routes use `requireStaff` only. Interviewer can still `GET /api/candidates` (org-scoped). Pipeline writes (stage, screen, create interview, secondary recording file) check `canManagePipeline`. Job create/update/delete check `canManageJobs`. Role **change** on users requires Super Admin (`PATCH /api/admin/users/[id]`).

**UI:** `src/components/app-shell.tsx` hides nav items by role; several dashboard pages `redirect` if `!canManagePipeline` / `!canAdministerUsers`.

**Automated tests:** `tests/isolation/phase9-isolation.test.mjs` (Candidate 403 on staff APIs; some org IDOR). Not a full six-role matrix.

---

## 6. PostgreSQL / database schema

- Provider: PostgreSQL via `DATABASE_URL`.
- Extension: `vector` (Prisma `postgresqlExtensions` + `Unsupported("vector(768)")` on `Candidate.embedding`).
- Migration `prisma/migrations/20260812010000_candidate_embedding_hnsw/migration.sql` adds HNSW index for embeddings.
- Host-dev default URL in `.env.example`: port **55432**, user `ats`, db `ai_recruitment_os`.
- IDs: Prisma `cuid()`.
- JSON columns used for: `Job.interviewStages`, `Job.screeningCriteria`, candidate education/certifications, interview `plan` / `adaptiveState`, answer `evaluation`, evaluation `scores` / `rawResponse`, timeline/proctoring/communication `payload`/`meta`.

There is **no** Redis, Django, or Celery schema.

---

## 7. All database models / entities

From `prisma/schema.prisma`:

**Enums:** `Role`, `PipelineStage`, `JobStatus`, `EmploymentType`, `ApplicationStatus`, `TimelineEventType`, `InterviewMode`, `InterviewStatus`, `QuestionDifficulty`, `AIRecommendation`, `AIEvaluationKind`, `ProctoringSignalType`, `CommunicationChannel`, `CommunicationStatus`.

**Models:**

| Model | Role |
|---|---|
| `Organization` | Tenant; `companyName` for templates |
| `Department` | Org-scoped |
| `User` | Staff + portal accounts; `passwordHash` |
| `Job` | Requisition + `screeningCriteria` JSON |
| `JobAssignment` | Job ↔ User |
| `Candidate` | Talent profile; `resumeUrl`, `resumeText`, `embedding` |
| `Application` | Candidate × Job; `stage`, `status` |
| `TimelineEvent` | Append-only history |
| `Note` | Candidate notes (no dedicated API route found) |
| `Tag`, `CandidateTag` | Org tags |
| `InterviewSession` | AI interview + proctoring/secondary/recording fields |
| `InterviewQuestion` | Sequence, optional `ttsPath` |
| `InterviewAnswer` | Text/transcript, optional `audioPath` |
| `AIEvaluation` | Advisory scores + **required** `reasoning` |
| `ProctoringEvent` | Signals |
| `EmailTemplate`, `CommunicationLog` | Local comms |

`InterviewSession.deliveryMode` is a **String** (`TEXT` \| `VOICE`), not an enum. `InterviewMode` (`AI_ADAPTIVE`, `TECH`, `HR`, `PANEL`) is the engine kind, not the candidate channel.

**No `VIDEO` delivery mode** exists in schema or create-interview UI (`create-interview-dialog.tsx` options: Text, Voice).

---

## 8. Resume upload and parsing flow

**Entry points**

1. Staff: `POST /api/documents/upload` (`multipart`: `file` + `applicationId` or `candidateId`). Requires staff; pipeline permission + org check when application-scoped.
2. Candidate portal: `PUT /api/portal/profile` (`requireCandidate`).
3. Public apply: `POST /api/careers/apply`.

**Storage:** `saveUpload({ category: "resumes", ... })` → `STORAGE_ROOT/resumes/{timestamp}-{uuid}-{safeName}`. Path stored on `Candidate.resumeUrl`.

**Parse:** `src/lib/resume/parse.ts` — local **PDF** (`pdf-parse` + DOM polyfills) and **DOCX** (`mammoth`). MIME/size gates in `src/lib/resume/mime.ts` (`RESUME_MAX_BYTES`). Parse failure is stored as `parseError` on staff upload; screening later requires `resumeText`.

**After save:** `embedCandidate` (`src/lib/ai/embeddings.ts`) calls local Ollama embed and `UPDATE`s `Candidate.embedding` via raw SQL.

**Not found:** cloud OCR, S3, or async parse workers.

---

## 9. AI screening flow

1. Recruiter (pipeline roles) `POST /api/applications/[id]/screen`.
2. `screenApplication` (`src/lib/ai/run-screening.ts`) requires `candidate.resumeText`.
3. `runResumeScreening` (`src/lib/ai/screening.ts`) builds a JSON-only system prompt; scores **only** vs job description + `Job.screeningCriteria` (`mustHave` / `niceToHave`). Resume text truncated (~6000 chars head/tail).
4. Creates `AIEvaluation` kind `RESUME_SCREEN` with `reasoning` mandatory; timeline `SCREENING_COMPLETED` / `AI_EVALUATION`.
5. **Guardrail in comments and code:** does **not** change `Application.stage` or `status`.
6. Optionally refreshes embedding.
7. `POST /api/jobs/[id]/screen-all` screens ACTIVE applications in `APPLIED` or `SCREENING` **sequentially** (“one Ollama call at a time — local GPU”).

`src/lib/ai/scoring.ts` also exports `screenJobCandidate` / `scoreWithReasoning` used from interview scoring.

---

## 10. AI job-description generation flow

**Not implemented in this codebase.**

- `Job.description` is a required string on create (`POST /api/jobs`, Zod `description.min(10)`).
- `src/components/job-form.tsx` submits title, description, skills, must-have / nice-to-have lines as **form fields**. No `fetch` to an LLM generate-JD endpoint.
- Grep found **no** `generateDescription`, JD-draft, or equivalent API.

Do not treat JD generation as a current backend module.

---

## 11. Evaluation criteria generation

Two distinct mechanisms exist; only one is LLM-generated.

**A. Job screening criteria (human-authored)**  
`Job.screeningCriteria` JSON default `{}`, typically `{ mustHave: string[], niceToHave: string[] }` from the job form. Passed into screening prompts (`buildScreeningUserPrompt`) and interview `generatePlan`. **No LLM writes this field.**

**B. Interview plan / per-question competency (LLM + code guards)**  
`POST /api/applications/[id]/interviews` calls `generatePlan` (`src/lib/ai/interview.ts`): Ollama JSON plan (topics, opening question, `focusAreas`, competencies). `sanitizePlanForJob` / `interview-guard.ts` rewrite off-role content. Recruiter can `GET/PATCH /api/interviews/[id]/plan` and `POST .../plan/refine` (`refineInterviewPlan`).

Per-answer “evaluation” used to **advance the interview** is produced by **deterministic** `decideNextTurn` (`interview-guard.ts`), not by waiting on Ollama. Recruiter-facing model scores run in `scoreInBackground` (`evaluateAnswerOnly` / `finalEvaluation`).

---

## 12. AI interview architecture

**Create (staff):** `POST /api/applications/[id]/interviews` — `generatePlan`, unique `accessToken`, `deliveryMode` TEXT|VOICE, optional proctoring/integrity fields. Does **not** change application stage.

**Candidate session**

1. `GET /api/interview/[token]` — session metadata (no scores/plan dump to candidate in start handler comments).
2. Consent routes as configured (proctoring / integrity / enhanced secondary).
3. `POST .../start` — `IN_PROGRESS`, persist opening question as sequence 1, optional TTS prefetch.
4. Answer: `POST .../answer` (JSON text) or `POST .../answer-audio` (multipart → speech-service STT → same submit path).
5. `processAnswerTurn` (`src/lib/ai/process-answer-turn.ts`):
   - Next question from **code** (`decideNextTurn`) so the candidate is not blocked on Ollama.
   - In-memory `tryAcquireSessionLock` / `releaseSessionLock` (single Node process only).
   - `void scoreInBackground(...)` for `AIEvaluation` kinds `INTERVIEW_ANSWER` / `INTERVIEW_OVERALL`.
   - Does **not** change `Application.stage`.
6. `POST .../continue` retries processing if scoring/next-question failed after the answer was saved.
7. Voice: `GET .../question-audio/[sequence]` serves cached Piper wav (`InterviewQuestion.ttsPath`); `prefetchQuestionTts`.
8. `POST .../candidate-question` — optional candidate questions to the AI (`answerCandidateQuestion`).

**Adaptive state** lives in `InterviewSession.adaptiveState` JSON; engine comments: “updated in code, not by the LLM.”

**No live video interview** and no `VIDEO` mode (see §7).

---

## 13. Ollama integration

File: `src/lib/ai/ollama.ts`.

| Function | Behavior |
|---|---|
| `getAIProvider()` | `local` (default) or `cloud` |
| `getLocalOllamaUrl()` | `OLLAMA_LOCAL_URL` or `OLLAMA_BASE_URL` or `http://localhost:11434` |
| `getChatOllamaUrl()` | Cloud URL + `OLLAMA_API_KEY` when `AI_PROVIDER=cloud` |
| `chatJSON` | Chat completions, parse/validate JSON with Zod |
| `embed` | **Always local** embed API, model `OLLAMA_EMBED_MODEL` (default `nomic-embed-text`) |
| `healthCheck` | Used by `/api/health` |

Chat model: `OLLAMA_CHAT_MODEL` or `OLLAMA_MODEL` (default `qwen2.5:7b`).

Docker Compose includes an `ollama` service. Cloud provider logs a warning via `src/instrumentation.ts`.

---

## 14. Speech / voice integration

**Next.js client:** `src/lib/speech.ts` → `SPEECH_SERVICE_URL` (default `http://localhost:8001`).

| Call | Speech-service path |
|---|---|
| Health | `GET /health` |
| STT | `POST /transcribe` multipart `audio` |
| TTS | `POST /synthesize` `{ text }` → wav |

**Python service** (`speech-service/README.md`): FastAPI; **faster-whisper** STT; **Piper** TTS (`en_US-lessac-medium`). ffmpeg required for webm/opus. Env: `SPEECH_PORT`, `PIPER_VOICE`, `WHISPER_MODEL`, `WHISPER_MODEL_CPU`.

**App usage:** voice answers (`answer-audio`), question TTS cache (`src/lib/question-tts.ts`), focus nudge audio (`/api/interview/[token]/nudge-audio`). `AVG_LOGPROB_MIN = -1.2` can force switch to typing (no re-record).

Independent of `AI_PROVIDER`.

---

## 15. Secondary-camera architecture

**Mode:** `InterviewSession.proctoringMode` `OFF` \| `STANDARD` \| `ENHANCED`. Enhanced adds QR pairing (`secondaryPairToken`).

**Laptop interview** (`/interview/[token]`): setup UI `enhanced-proctoring-setup.tsx`; APIs under `proctoring/secondary`. Placement confirmation and recording consent stored on the session.

**Phone page** (`/interview/secondary/[code]`): `secondary-camera-client.tsx` — connect, heartbeat, JPEG/frame upload, MediaRecorder chunks, on-device CV (`secondary-integrity-client.ts`, `secondary-integrity-cv.ts`, MediaPipe models via `npm run setup:mediapipe`).

**Integrity:** client POSTs typed events to `/api/interview/secondary/[code]/integrity`; server maps to `ProctoringEvent` (`integrity-server.ts`). Extra-person types exist in Prisma enum. **Not** sent to Ollama.

**Orientation:** `createOrientedRecordStream` in `src/lib/secondary-record-orientation.ts` currently **returns `null`** (canvas bake disabled). Recruiter playback uses CSS rotate (`secondary-review-player.tsx`).

**Lifecycle:** `secondary-camera-lifecycle.ts` cleanup when interview completes (`processAnswerTurn`).

---

## 16. Video / audio storage

All local disk. Paths are **relative** under `STORAGE_ROOT` (default `./storage`). `resolveStoragePath` rejects path escape.

| Asset | Location / fields |
|---|---|
| Resumes | `storage/resumes/...` → `Candidate.resumeUrl` |
| Voice answers | `saveInterviewAudio` → `interviews/{sessionId}/...` → `InterviewAnswer.audioPath` |
| Question TTS | `InterviewQuestion.ttsPath` |
| Secondary recording chunks | `interviews/{sessionId}/secondary-camera/{recordingId}/` (`src/lib/secondary-recording.ts`) |
| Finalized secondary file | `InterviewSession.secondaryRecordingPath`, mime, duration, gap flags |

`ensureStorageDirs` also creates `assessments/` and `recordings/`; **no `saveUpload` caller uses `assessments` or `recordings` categories** in `src/` (only `resumes`). Secondary files use interview paths, not `saveUpload({ category: "recordings" })`.

Staff playback: `GET /api/interviews/[id]/audio/[sequence]` and `.../secondary-recording/file` (auth + pipeline role + org). **Not** public `/storage` URLs.

Retention notes: `docs/RECORDINGS.md` (referenced from recording module comments).

---

## 17. Proctoring / integrity signal implementation

**Storage:** `ProctoringEvent` (`type` enum, `timestamp`, `meta` JSON).

**Candidate browser** (`src/lib/proctoring.ts`): batches events to `POST /api/interview/[token]/proctoring`. Types include tab blur/focus, fullscreen, copy/paste, window switch, optional camera face signals. Consent: `POST .../proctoring/consent` (`proctoringConsentAt`, `proctoringCameraConsent`).

**Strict integrity** (`src/lib/integrity.ts`, `integrity-episode.ts`, `integrity-server.ts`): server-authoritative counters on `InterviewSession` (`integrityViolationCount`, `integrityPasteCount`, `integrityCameraMoveCount`, `integrityTerminatedReason`). Can set status `TERMINATED` **without** changing ATS stage. Candidate ack routes exist.

**Enhanced secondary:** environment warnings; after configured warning count, interview can end. Recruiter live strip: `GET /api/interviews/[id]/proctoring`.

**Policy comments in code:** signals never auto-change hiring stage; never used as AI scores; never injected into LLM prompts.

---

## 18. Background / async processing

| Mechanism | Where | Notes |
|---|---|---|
| `void scoreInBackground(...)` | `process-answer-turn.ts` | Fire-and-forget Ollama scoring in the **same Node process** |
| Sequential `await screenApplication` | `jobs/[id]/screen-all` | Blocks the HTTP request for the full batch |
| `prefetchQuestionTts` | start / next question | In-request or follow-on I/O to speech-service |
| In-memory `Set` session lock | `interview-session.ts` | Lost on process restart; not shared across instances |
| In-memory rate limiter | `src/lib/rate-limit.ts` | Used on `careers/apply`; not Redis |
| Client queues | proctoring batch; secondary chunk pending queue | Browser-side |

**Not present:** Celery, Redis, Django Q, cron workers, `after()` from Next.js.

---

## 19. File upload handling

| Upload | Route | Limits / notes |
|---|---|---|
| Resume | documents/upload, portal profile PUT, careers apply | MIME allow-list + `RESUME_MAX_BYTES` |
| Answer audio | `answer-audio` | webm/opus typical; stored then STT |
| Secondary chunks | `recording/chunk` | `MAX_CHUNK_BYTES` 2_500_000; rate `MAX_CHUNKS_PER_MINUTE` in `secondary-recording.ts` |
| Secondary frames | `frame` POST | Preview frames for recruiter/setup |

No multipart proxy to cloud object storage.

---

## 20. Current environment variables

**From `.env.example` (and comments):**

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Prisma Postgres |
| `AUTH_SECRET` | JWT signing (required) |
| `AUTH_COOKIE_NAME` | Default `aros_session` |
| `AUTH_TOKEN_TTL_HOURS` | Default `12` |
| `AI_PROVIDER` | `local` \| `cloud` |
| `OLLAMA_LOCAL_URL` | Default `http://localhost:11434` |
| `OLLAMA_CLOUD_URL` | Default `https://ollama.com` |
| `OLLAMA_API_KEY` | Cloud chat only |
| `OLLAMA_MODEL` / `OLLAMA_CHAT_MODEL` | Chat model |
| `OLLAMA_EMBED_MODEL` | Default `nomic-embed-text` |
| `OLLAMA_BASE_URL` | Legacy fallback in ollama.ts |
| `STORAGE_ROOT` | Default `./storage` |
| `SPEECH_SERVICE_URL` | Default `http://localhost:8001` |
| `NEXT_PUBLIC_APP_NAME` | UI |
| `NEXT_PUBLIC_APP_URL` | Links / QR fallback |
| `PUBLIC_LAN_IP` | Phone QR (scripts) |
| `PUBLIC_HTTPS_URL` / `PUBLIC_HTTPS_PORT` | LAN HTTPS for camera Secure Context |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Optional mail |

**From `.env.docker.example` (compose):** `POSTGRES_*`, `APP_HOST_PORT`, `OLLAMA_HOST_PORT`, `SPEECH_HOST_PORT`, `RUN_SEED`, `WHISPER_MODEL`, `WHISPER_MODEL_CPU`, `PIPER_VOICE`.

**Speech-service README:** `SPEECH_PORT`, `PIPER_VOICE`, `WHISPER_MODEL`, `WHISPER_MODEL_CPU`, `AVG_LOGPROB_FAIL`.

---

## 21. External services / dependencies

| Dependency | Role | In-repo? |
|---|---|---|
| PostgreSQL + pgvector | Data | Docker |
| Ollama | LLM + embeddings | Docker / host |
| speech-service | STT/TTS | `speech-service/` |
| ffmpeg | Decode interview/secondary audio containers | Host PATH |
| Optional SMTP relay | Email | Env |
| MediaPipe models | On-device secondary CV | Downloaded by `scripts/setup-mediapipe.mjs` |
| Piper voice `.onnx` | TTS | Downloaded, not committed |

**npm (backend-relevant):** `@prisma/client`, `jose`, `bcryptjs`, `zod`, `nodemailer`, `pdf-parse`, `mammoth`, `next`.

**Not used:** Redis, Celery, Django, S3, OpenAI SDK.

---

## 22. Frontend-to-backend API dependencies

The React app is tightly coupled to the Next route shape (`fetch("/api/...")`).

| UI area | Primary APIs (from component `fetch` usage) |
|---|---|
| Login / register | `/api/auth/login`, `/api/auth/register`, logout |
| Job form | `/api/org`, `/api/jobs`, `/api/jobs/[id]` |
| Pipeline / stage | `/api/applications/board`, `/api/applications/[id]/stage` |
| Screening | `/api/applications/[id]/screen`, `/api/jobs/[id]/screen-all` |
| Resume | `/api/documents/upload` |
| Interviews | `/api/applications/[id]/interviews`, plan/refine, expire, regenerate-evaluation |
| Interview room | `/api/interview/[token]/*` (start, answer, audio, proctoring, integrity) |
| Secondary phone | `/api/interview/secondary/[code]/*` |
| Recruiter live/review | `/api/interviews/[id]/proctoring`, secondary-recording |
| Talent | `/api/talent/search` |
| Admin | `/api/admin/users`, departments, org |
| Portal | `/api/portal/profile`, `/api/portal/applications` |
| Careers | `/api/careers`, `/api/careers/apply` |
| Email | `/api/communications/send`, compose-context, templates |
| Analytics | `/api/analytics` |
| Health banner | `/api/health` |

**Additionally:** dashboard **server components** query Prisma directly (interview report, candidate detail, job lists, interview-links). A Django-only backend would require those pages to become API clients or remain on Next as a BFF.

Cookie auth (`credentials` / same-origin) is assumed. CORS is not a current concern because UI and API share origin.

---

## 23. Security-sensitive areas

- `AUTH_SECRET` and JWT cookies; `secure` flag only when `NODE_ENV=production`.
- Magic interview `accessToken` and `secondaryPairToken` in URLs (bearer-in-URL; leak via logs/referrer).
- Public `/api/interview/*` — authorization is “ possessor of token”, not a logged-in user.
- Password hashes (`bcryptjs`, cost 12 on register).
- Resume text and embeddings (PII) in Postgres; files on disk.
- Secondary video/audio on disk; staff-only file routes.
- Proctoring camera frames (ephemeral upload paths).
- `AI_PROVIDER=cloud` would send **chat** prompts (JD, resume excerpts, answers) to ollama.com if enabled.
- Path traversal guard in `resolveStoragePath`.
- In-memory rate limit only on careers apply; interview token routes are not globally rate-limited in `rate-limit.ts`.
- Register attaches every new candidate to the **first** organization.
- Role in JWT not revalidated against `User.isActive` / `User.role` on each request (except login).
- Isolation tests exist; Interviewer still has broad **read** via `requireStaff`.

---

## 24. Potential scalability bottlenecks

- **Single Node process:** in-memory interview locks, rate limiter, fire-and-forget scoring — unsafe/lossy with multiple app replicas.
- **Request-thread Ollama:** `screen-all` holds HTTP until all candidates screened; interview scoring races the process.
- **Local GPU/CPU:** Whisper + Piper + Ollama on the same machine as Next.
- **pgvector + sequential embeds** on every resume upload.
- **Chunked video** upload + finalize on the app server disk (I/O and disk growth).
- **No Redis/queue** to absorb STT/TTS/LLM latency.
- Prisma in serverless-unfriendly long connections if ever split to many instances without a pooler.
- Secondary frame polling (`enhanced-proctoring-setup`, recruiter live) increases request rate.

---

## 25. Current technical debt

- README “build order” still marks screening/interview as future; the code already implements them.
- `deliveryMode` is a free `String`, not an enum.
- `Note` model without a found API.
- Unused storage dirs `assessments/`, `recordings/` category.
- Deprecated `src/lib/ollama.ts` shim.
- `three` / R3F still in `package.json` / `next.config.mjs` after 3D orb rollback.
- Secondary capture orientation bake disabled; review depends on CSS rotate.
- Interviewer RBAC is coarse (staff reads).
- JWT role lag vs DB.
- `void scoreInBackground` can fail silently from the candidate’s perspective (mitigated by `/continue`).
- pdf-parse DOM polyfills (fragile in Docker).
- Isolation tests do not cover all roles or all interview token abuse cases.

---

# Migration assessment (Django + DRF + PostgreSQL + Celery/Redis)

This section is an **assessment**, not an implementation plan executed in-repo.

## A. What can be migrated directly to Django

These map cleanly to Django models + DRF viewsets if PostgreSQL (with pgvector) is kept:

- Organizations, departments, users, jobs, assignments, candidates, applications, timeline, tags, notes, templates, communication logs.
- Interview session/question/answer/evaluation/proctoring tables (same columns, including JSON fields as `JSONField` / `JSONB`).
- Role enum and pipeline enums.
- bcrypt password hashes (Django can verify existing hashes with a compatible hasher, or re-hash on login — must be designed carefully).
- Local file layout (`STORAGE_ROOT` categories) behind Django `FileField` / explicit path fields.
- REST resource names can stay `/api/...` for frontend compatibility.
- Ollama HTTP client (Python `httpx`) equivalent of `chatJSON` / `embed`.
- Speech-service remains a **sidecar**; Django would call the same `/transcribe` and `/synthesize` URLs.
- SMTP via Django email backend instead of nodemailer.
- Screening and interview **prompt/schema contracts** (Zod → Pydantic / DRF serializers) if prompts are ported verbatim.

pgvector: keep the same DB; Django would use `pgvector` Python bindings or raw SQL like `embedCandidate` does today.

## B. What needs to be redesigned

- **Process architecture:** Next in-process `void` jobs → Celery tasks (`scoreInBackground`, TTS prefetch, screen-all, embed, recording finalize).
- **Session locks:** in-memory `Set` → Redis lock / `select_for_update`.
- **Rate limiting:** in-memory map → Redis.
- **Auth cookie on a split origin:** if UI stays on Next and API moves to Django, CORS, CSRF, and cookie `Domain`/`SameSite` must be redesigned (or use token header).
- **Dashboard Prisma pages** must stop using the Node ORM.
- **Magic-link interview + middleware public paths** → Django auth classes (token in URL vs cookie).
- **JWT payload vs DB role:** opportunity to load `User` each request or use short-lived tokens + Redis session.
- **Secondary recording finalize** (chunk concat) as a Celery task with disk on a shared volume.
- **Interview-guard TypeScript** (~deterministic next-question) must be **ported or shared**, not “automatically” migrated; behavior drift would change live interviews.
- RBAC: DRF permissions should encode `canManageJobs` / `canManagePipeline` explicitly rather than copying `requireStaff` gaps.

## C. What should remain unchanged (recommended)

- PostgreSQL + pgvector as system of record (do not introduce a cloud DB).
- Local `STORAGE_ROOT` semantics and “no public file URLs” for recordings.
- Product rules: AI advisory, no auto stage change, proctoring as signals, no proctoring in LLM prompts, local STT/TTS.
- **speech-service** as a separate FastAPI process (already Python).
- **Ollama** as the LLM runtime.
- Candidate interview **delivery modes** actually implemented: TEXT and VOICE only (do not invent VIDEO in Django unless product adds it).
- On-device MediaPipe CV in the **browser** (not a Django concern except ingesting posted events).

## D. What could break during migration

- Cookie session if hosts diverge (`aros_session` not sent).
- Interview in-flight locks → duplicate next questions.
- Fire-and-forget scoring lost if the web worker dies before Celery is wired.
- Path separators / `resolveStoragePath` on Windows vs Linux.
- Prisma `cuid()` vs Django `uuid` / default pk — **existing IDs must be preserved** or all URLs/FKs break.
- `Unsupported("vector(768)")` if Django migrations recreate the column incorrectly (HNSW index).
- Zod-coerced LLM JSON vs stricter DRF parsers (screening/plan failures).
- `deliveryMode` string vs accidental enum tightening.
- Secondary pair/access tokens if URL routing (`[token]` vs Django converters) differs.
- Next middleware currently treats **all** `/api/interview/*` as public — a Django gateway that requires JWT on those routes would break the candidate room.
- Isolation tests (`tests/isolation/`) assume Next + cookie minting helpers.
- Embeddings raw SQL dialect.

## E. Recommended Django architecture (if approved later)

Keep a **modular monolith**, not microservices:

```
config/                 Django settings, JWT/cookie, CORS
apps/accounts           User, org, department, RBAC permissions
apps/ats                Job, candidate, application, timeline, tags, notes
apps/documents          Resume upload + parse (Python PDF/DOCX) + embed task
apps/screening          Ollama screening tasks + AIEvaluation
apps/interviews         Session, questions, answers, plan, adaptive guard port
apps/proctoring         Signals, integrity counters, termination
apps/secondary_camera   Pairing, chunks, finalize task, frame ingest
apps/comms              Templates + SMTP
apps/talent             Vector search
apps/analytics          Read models / aggregations
```

- **DRF** viewsets mirroring current paths for a transition period.
- **Celery + Redis:** `screen_application`, `screen_job_batch`, `embed_candidate`, `score_interview_turn`, `final_evaluation`, `synthesize_question_tts`, `finalize_secondary_recording`.
- **Shared volume** for `STORAGE_ROOT` across gunicorn + Celery workers.
- Leave **speech-service** and **Ollama** as Compose services; Django settings point at their URLs.

Optional: keep Next.js as UI-only against Django; or render staff UI in Django templates later (out of scope of current frontend).

## F. Recommended migration order

1. **Stand up Django + same Postgres** (read-only models generated from current schema; no cutover).
2. **Auth parity** (cookie JWT or explicit dual-run) + RBAC tests ported from `tests/isolation`.
3. **ATS CRUD** (jobs, candidates, applications, stage, tags) so dashboard can switch reads off Prisma.
4. **Documents + embeddings** (resume parse in Python; Celery embed).
5. **Screening** (single then screen-all as Celery).
6. **Interview create/plan/refine** (Ollama plan).
7. **Interview runtime** (token auth, start/answer/continue, deterministic guard port, Celery scoring).
8. **Voice** (proxy to existing speech-service).
9. **Proctoring + Strict integrity** (counters must stay server-authoritative).
10. **Secondary camera + recording finalize**.
11. **Comms, talent search, analytics**.
12. **Decommission Next Route Handlers and Prisma** only after parity tests pass.

Do not migrate interview runtime before locks and Celery exist.

## G. Estimated complexity of each module

Scale: **S** (days), **M** (1–2 weeks), **L** (2–4 weeks), **XL** (4+ weeks) for a small team that already knows this repo. Estimates assume keeping PostgreSQL and not rewriting product rules.

| Module | Complexity | Why |
|---|---|---|
| Org / users / admin | M | Straight CRUD; Super Admin vs HR Admin role-change rules |
| Jobs / pipeline / applications | M | Stage + human rationale; org scoping |
| Tags / notes / timeline | S–M | Notes have no API today |
| Resume upload/parse | M | Replace pdf-parse/mammoth; keep mime limits |
| Embeddings / talent search | M | pgvector + raw SQL / Django pgvector |
| Screening | M | Prompt + Zod schema + screen-all queueing |
| JD generation | — | **Not in codebase** (net-new if requested) |
| Interview plan + refine | L | LLM JSON + `sanitizePlanForJob` |
| Adaptive interview runtime | XL | `interview-guard.ts` + locks + continue path |
| Voice STT/TTS glue | M | Service stays; Django streaming/files |
| Proctoring ingest | M | Batch events + consent |
| Strict integrity termination | L | Episode state machine, must not touch ATS stage |
| Secondary camera + recording | XL | Chunks, finalize, pair tokens, CV event types |
| Communications | S | nodemailer → Django email |
| Analytics | S–M | SQL aggregations in `src/lib/analytics.ts` |
| Auth split (Next UI + Django API) | L | Cookies/CORS/CSRF |
| Celery cutover of in-process jobs | M | Needed before horizontal scale |

---

## Explicit non-findings (do not invent)

- No Django/DRF/Celery/Redis application code.
- No video-interview delivery mode or live WebRTC SFU.
- No AI job-description generator API.
- No LLM writer for `Job.screeningCriteria` (human form fields).
- No cloud object storage.
- No `Note` REST API (model only).
- No staff `POST /api/candidates` (list/get only; create via register/apply).

---

**Stop point:** This document is the audit deliverable. No migration, package install, or application code change was performed. Await approval before any Django scaffolding or dual-run work.
