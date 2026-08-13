# Logisoft HireOS

AI Recruitment Operating System — Intelligent hiring. Human decisions.

Self-hosted ATS + AI Screening + Adaptive AI Interview + Proctoring signals + Evaluation.

## Build order (do not skip ahead)

1. **Foundation** — scaffold, Prisma, local auth, RBAC, org/departments ✅
2. **ATS core** — jobs CRUD, candidate DB, resume upload+parse, DnD pipeline, timeline ✅
3. **AI Screening** — JD vs resume match with why / missing / concerns (next)
4. **AI Interview engine** — text-only adaptive Q&A first
5. **Voice/video session** — Whisper STT, TTS, recording
6. **Proctoring + evaluation reports**
7. **Talent pool, templates, analytics**

## Hard rules

- **100% local / self-hosted** — no Supabase, Firebase, Vercel, Netlify, cloud DBs, cloud storage, or OpenAI API
- **AI** via [Ollama](https://ollama.com) at `http://localhost:11434`
- **DB** PostgreSQL + Prisma + pgvector
- **Files** on local disk under `/storage` (configurable via `STORAGE_ROOT`)
- **Roles** checked on every API route: `SUPER_ADMIN`, `HR_ADMIN`, `RECRUITER`, `HIRING_MANAGER`, `INTERVIEWER`, `CANDIDATE`
- **Pipeline**: `APPLIED → SCREENING → SHORTLISTED → ASSESSMENT → AI_INTERVIEW → TECH_INTERVIEW → HR_INTERVIEW → SELECTED/REJECTED`
- **AI is advisory only** — recruiters make final decisions; every AI score stores `reasoning`
- **Proctoring events are signals with timestamps** — never auto-verdicts

## Stack

Next.js 14 (App Router) · TypeScript strict · Tailwind · shadcn/ui · Zustand · TanStack Query · Prisma · PostgreSQL/pgvector · Ollama

## Quick start

### Option A — Full pilot stack (app + Postgres + Ollama + speech)

See **[docs/PACKAGING.md](docs/PACKAGING.md)**. Short version:

```powershell
cp .env.docker.example .env.docker
.\scripts\setup-pilot.ps1
```

Open [http://localhost:3000](http://localhost:3000).

### Option B — Dev on the host (Postgres in Docker only)

```bash
docker compose up -d postgres
```

Postgres is on **host port `55432`**. Pull models into host Ollama, then:

```bash
cp .env.example .env
npm install
npx prisma db push
npm run db:seed
npm run setup:mediapipe
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). For VOICE interviews also run `speech-service\run.ps1`.

### Seed accounts

| Email | Password | Role |
|---|---|---|
| `admin@local.dev` | `password123` | SUPER_ADMIN |
| `recruiter@local.dev` | `password123` | RECRUITER |
| `candidate@local.dev` | `password123` | CANDIDATE |

(Also seeded: `hr@`, `hm@`, `interviewer@` — same password.)

### Health check

`GET /api/health` — reports Postgres + Ollama connectivity.

## Key APIs

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/login` | JWT httpOnly cookie (+ org id) |
| GET | `/api/org` | Organization + departments |
| GET/POST | `/api/jobs` · PATCH/DELETE `/api/jobs/:id` | Org-scoped jobs CRUD |
| GET/PATCH | `/api/candidates` · GET `/api/candidates/:id` | Candidate database |
| POST | `/api/documents/upload` | Local resume upload + PDF/DOCX parse |
| GET | `/api/applications/board` | Kanban columns by stage |
| GET | `/api/applications/:id` | Detail + timeline |
| POST | `/api/applications/:id/stage` | Human-only stage move / final decision |
| POST | `/api/applications/:id/screen` | Stub screening (Phase 3 expands match breakdown) |
| POST | `/api/interviews/:id/proctoring` | Timestamped proctoring **signal** |

## Project layout

```
src/app          App Router pages + API routes
src/lib/auth     Session (jose) + RBAC
src/lib/ai       Advisory scoring + adaptive interview
src/lib/ollama.ts Local Ollama client
src/lib/storage.ts Local disk uploads
prisma/          Schema + seed
storage/         Uploaded files (gitignored contents)
docker/          Postgres init (pgvector)
```

## Design principles

1. AI recommendations never auto-advance the pipeline.
2. Final `SELECTED` / `REJECTED` require a human rationale (`Decision` + `StageTransition`).
3. Proctoring stores evidence (`ProctoringEvent`) for reviewer judgment only.
