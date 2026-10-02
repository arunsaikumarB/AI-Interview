# Logisoft HireOS

## Hard rules
- 100% local/self-hosted. NEVER suggest Supabase, Firebase, Vercel, Netlify, cloud DBs, cloud storage, or OpenAI API.
- Production is 100% local. Ollama Cloud permitted ONLY behind AI_PROVIDER=cloud for development.
- AI chat: AI_PROVIDER=local (default) → http://localhost:11434; AI_PROVIDER=cloud → ollama.com + OLLAMA_API_KEY. Embeddings always use local Ollama.
- Speech (STT/TTS) runs ONLY on the local speech-service (default http://localhost:8001). No cloud STT/TTS ever, regardless of AI_PROVIDER.
- DB: PostgreSQL + Prisma + pgvector. Files: local disk /storage
- Stack: Next.js 14 App Router, TypeScript strict, Tailwind, shadcn/ui, Zustand, TanStack Query
- Roles: SUPER_ADMIN, HR_ADMIN, RECRUITER, HIRING_MANAGER, INTERVIEWER, CANDIDATE — every API route checks role
- Pipeline stages: APPLIED → SCREENING → SHORTLISTED → ASSESSMENT → AI_INTERVIEW → TECH_INTERVIEW → HR_INTERVIEW → SELECTED/REJECTED
- AI recommendations are advisory only — recruiter always makes the final decision, and every AI score/evaluation must store its reasoning
- Proctoring events are SIGNALS with timestamps, never auto-verdicts. Proctoring NEVER affects AI scores/recommendations, NEVER auto-changes stage/status, and requires explicit candidate consent. Never pass proctoring into LLM prompts.

## Build order
1. Foundation (scaffold, schema, auth, org/departments, layouts)
2. ATS core (jobs, candidates, resume, pipeline board, timeline)
3. AI Screening
4. AI Interview engine (text-first)
5. Voice/video interview
6. Proctoring + evaluation reports
7. Talent pool, templates, analytics

## Cloud Agent

The Cloud Agent VM has no systemd. Docker is started by the environment `start` command (`fuse-overlayfs`, legacy iptables). App processes are the Next.js and Django terminals.

Host development containers are Postgres (`localhost:55432`), Redis (`6379`), and Ollama (`11434`). Ollama is started with `docker run` because the compose `ollama` service reserves an NVIDIA GPU, which this VM does not have. `nomic-embed-text` is pulled for embeddings. The chat model `qwen2.5:7b` is not preloaded; pull it inside `aros-ollama` when a task needs chat. Speech (`8001`) and Celery are not started. Text ATS flows keep working; Django health reports `celery.ok: false` until a worker is running.

`npx prisma db push` runs only while the Prisma `"User"` table is absent. After `manage.py migrate`, Prisma sees `django_*` and `auth_*` as extra tables and stops unless `--accept-data-loss` is passed. Do not pass that flag.

Seed login after a fresh database: `recruiter@local.dev` / `password123`. `python` on `PATH` is Python 3 so `tests/unit/detector-vocabulary.test.ts` can read the MediaPipe label file.
