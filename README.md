# Logisoft HireOS

AI Recruitment Operating System — Intelligent hiring. Human decisions.

Self-hosted ATS + advisory AI screening + adaptive AI interview + V3.1 assessment engine + proctoring signals + evaluation.

## What is included

1. **Foundation** — Prisma, local auth, RBAC, organization and departments
2. **ATS core** — jobs, candidates, resume upload and parse, pipeline board, timeline
3. **AI screening** — advisory JD vs resume match; every score stores its reasoning
4. **AI interview** — adaptive Q&A, including voice and video
5. **V3.1 assessment engine** — job assessments, practical tasks, and the tokenized assessment hub
6. **Proctoring signals and evaluation reports** — timestamped signals only, never an automatic verdict
7. **Talent pool, templates, and analytics**

## Staff-only mode

Candidate self-service is off unless `CANDIDATE_ACCOUNTS_ENABLED=true` (see `.env.example`).

With the default (unset or not `true`):

- `/register` redirects to `/login`, and the login page has no "Create an account" link
- candidate sign-in and `/portal` are blocked
- candidates use the interview and assessment links staff send them

Staff roles are unchanged. Leave the flag off on a company server unless the candidate portal is an explicit decision.

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

### Local demo data and first administrator

`npm run db:seed` loads demo data for local development only. Do not run it on a company server.

On a fresh server, create the first organization and `SUPER_ADMIN` with `npm run bootstrap:admin`. See [docs/DEPLOYMENT-BOOTSTRAP-ADMIN.md](docs/DEPLOYMENT-BOOTSTRAP-ADMIN.md).

## Deployment

| Document | Use |
|---|---|
| [docs/DEPLOYMENT-DATABASE-V3.1.md](docs/DEPLOYMENT-DATABASE-V3.1.md) | V3.1 schema on an empty database (`prisma db push` plus the manual immutability trigger). Do not run `prisma migrate deploy` (R-4). |
| [docs/DEPLOYMENT-BOOTSTRAP-ADMIN.md](docs/DEPLOYMENT-BOOTSTRAP-ADMIN.md) | First organization and administrator |
| [docs/DEPLOYMENT-CENTOS9.md](docs/DEPLOYMENT-CENTOS9.md) | Ollama, speech, code runner, HTTPS, firewall, backups |
| [docs/FRONTEND-ARCHITECTURE.md](docs/FRONTEND-ARCHITECTURE.md) | The React / Next.js process DevOps runs |
| [docs/PACKAGING.md](docs/PACKAGING.md) | Local Docker pilot (Postgres, Ollama, speech, app) |

Production: `npm ci`, `npm run build` (`output: "standalone"`), then `npm run start`. Do not use `npm run dev` on a server.

## Health and version

| Endpoint | Who | Returns |
|---|---|---|
| `GET /api/health` | Public | Readiness booleans for Postgres, Ollama, and speech. No URLs, model names, paths, or errors. |
| `GET /api/version` | Public | `{ "service", "commit" }`. `commit` is the git SHA recorded at build time, or `"unknown"`. No environment variables or secrets. |

`postbuild` writes that commit into the standalone output. A git checkout supplies it automatically. Docker images exclude `.git`, so pass `--build-arg HIREOS_BUILD_COMMIT=$(git rev-parse HEAD)`. `GITHUB_SHA` and `CI_COMMIT_SHA` are also accepted at build time.

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
| POST | `/api/applications/:id/screen` | Advisory screening. Does not change stage or status |
| GET | `/api/version` | Build commit (`service` and `commit` only) |
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
