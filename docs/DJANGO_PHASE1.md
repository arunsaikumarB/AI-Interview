# Logisoft HireOS — Django Phase 1 (foundation only)

**Status:** Infrastructure alongside Next.js. No business-domain migration.  
**Date:** 2026-08-15

The live product remains **Next.js 14 + Prisma + PostgreSQL**. Django is a second process on a **different port** (default **8000**). Next.js stays on **3000**.

---

## 1. Django architecture

```
Browser / staff UI  →  Next.js :3000  (unchanged APIs, Prisma, auth, interviews)
Optional clients    →  Django  :8000  /api/v1/health/ only

Django
  → PostgreSQL (same DATABASE_URL as Prisma; read/connect only in Phase 1)
  → Celery
       → Redis (new container: backend/docker-compose.yml)
```

Domain apps (`jobs`, `candidates`, `interviews`, …) exist as **empty stubs**. They do not map Prisma tables and have **no models**.

---

## 2. Installed packages

From `backend/requirements/base.txt` (no extras beyond `psycopg[binary]` wheels):

| Package | Role |
|---|---|
| Django | Web framework |
| djangorestframework | REST |
| django-cors-headers | CORS for `http://127.0.0.1:3000` |
| psycopg[binary] | PostgreSQL (psycopg3) |
| django-environ | Env files / `DATABASE_URL` |
| celery | Task queue |
| redis | Broker client |
| djangorestframework-simplejwt | JWT **settings only** — not wired to login |

HTTP to Ollama and speech uses the Python stdlib (`urllib`).

---

## 3. Folder structure

```
backend/
  manage.py
  requirements/base.txt
  .env.example
  docker-compose.yml          Redis only (does not replace repo docker-compose.yml)
  config/
    settings/base.py
    urls.py
    celery.py
    asgi.py
    wsgi.py
  apps/
    accounts/                 roles + permission stubs
    jobs/ candidates/ interviews/ screening/ proctoring/ files/
  services/
    ai/ollama.py
    speech/client.py
    storage/paths.py
  common/
    views.py                  GET /api/v1/health/
    tasks.py                  health_check_task
    management/commands/
      inspect_schema.py       read-only table list
      hireos_probes.py        Ollama + speech HTTP probes
```

---

## 4. PostgreSQL connection

Django reads `DATABASE_URL` from **repo-root `.env`**, then **`backend/.env`** (overrides).

Default (same as Prisma): `postgresql://ats:…@localhost:55432/ai_recruitment_os`

The Prisma query param `?schema=public` is stripped before Django parses the URL.

**Phase 1 rules**

- Do **not** `migrate` Prisma-managed tables (`"User"`, `"Job"`, `"Candidate"`, …).
- Do **not** unmanaged-map those tables yet.
- Django contrib tables (`django_*`, `auth_*`) are **not** created until someone runs `migrate`. Phase 1 does **not** run that by default.
- `python manage.py inspect_schema` lists public tables (read-only).

---

## 5. Redis configuration

`REDIS_URL` default: `redis://127.0.0.1:6379/0`

Start (does not touch Postgres/Ollama/speech/Next):

```powershell
docker compose -f backend/docker-compose.yml up -d
```

---

## 6. Celery configuration

- App: `config.celery` (`CELERY_*` from Django settings)
- Broker and result backend: `REDIS_URL`
- Task: `common.health_check_task` → `{"status": "ok", "task": "health_check_task"}`

Windows workers: use solo pool:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
celery -A config worker -l info -P solo
```

---

## 7. Ollama integration foundation

`services.ai.ollama.OllamaClient`

- Local chat/embed host: `OLLAMA_LOCAL_URL` (default `http://localhost:11434`)
- `AI_PROVIDER=local` (default) or `cloud` (dev-only; key from env, never hardcoded)
- Health probe: `GET /api/tags` (does not change Next.js `src/lib/ai/ollama.ts`)

---

## 8. Speech service integration foundation

`services.speech.client.SpeechServiceClient`

- Base: `SPEECH_SERVICE_URL` (default `http://localhost:8001`)
- Health probe: `GET /health`
- Does not replace `speech-service/`

---

## 9. Authentication foundation

- SimpleJWT configured (`DJANGO_JWT_SIGNING_KEY`, 12h access). **No login views.**
- Next.js `aros_session` / `AUTH_SECRET` remains the live session.
- Role enum (future mapping): `ADMIN`, `HR`, `RECRUITER`, `HIRING_MANAGER`, `INTERVIEWER`, `CANDIDATE`
- Next.js names `SUPER_ADMIN` / `HR_ADMIN` are listed in `NEXTJS_ROLE_TO_HIREOS` only — unused at runtime.

---

## 10. Health endpoint

`GET http://127.0.0.1:8000/api/v1/health/`

JSON:

```json
{
  "django": { "ok": true },
  "postgres": { "ok": true },
  "redis": { "ok": true },
  "celery": { "ok": true, "workers": ["celery@host"] }
}
```

HTTP **200** if Postgres is up; **503** if Postgres is down. Redis/Celery report `ok: false` in the body if those processes are not running (expected until you start them).

---

## 11. How to start Django

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements/base.txt
copy .env.example .env
# Set DJANGO_SECRET_KEY and DJANGO_JWT_SIGNING_KEY in backend/.env
python manage.py check
python manage.py runserver 127.0.0.1:8000
```

---

## 12. How to start Redis

```powershell
docker compose -f backend/docker-compose.yml up -d
```

---

## 13. How to start Celery

With Redis running and the venv active (`cd backend`):

```powershell
celery -A config worker -l info -P solo
```

---

## 14. How to verify the complete stack

1. Start Docker Desktop, then root `docker compose` (Postgres / Ollama / speech / Next) and `docker compose -f backend/docker-compose.yml up -d` (Redis).  
   `runserver` contacts Postgres on startup to inspect the migration graph; it will not listen until port **55432** is up. Phase 1 still does **not** run `migrate`.  
2. Redis: `docker compose -f backend/docker-compose.yml ps`  
3. Celery worker process (above).  
4. `python manage.py check`  
5. `python manage.py inspect_schema`  
6. `python manage.py hireos_probes` (Ollama + speech; fails softly if those are down)  
7. `Invoke-WebRequest http://127.0.0.1:8000/api/v1/health/`  
8. Confirm Next.js still serves `http://127.0.0.1:3000` and `/api/health`

**Do not proceed to Phase 2** (jobs, candidates, screening, interviews, Prisma models) without explicit approval.
