# Packaging — pilot stack

One command path for a self-hosted pilot: **Postgres + Ollama + speech-service + Next.js app**.

## Quick start (Windows)

```powershell
cp .env.example .env
# Edit AUTH_SECRET in .env (required — single source for host tests + Docker JWT)
cp .env.docker.example .env.docker

.\scripts\setup-pilot.ps1
```

## Quick start (macOS / Linux)

```bash
cp .env.example .env
# Edit AUTH_SECRET in .env (required — single source for host tests + Docker JWT)
cp .env.docker.example .env.docker

chmod +x scripts/setup-pilot.sh
./scripts/setup-pilot.sh
```

**AUTH_SECRET:** set only in `.env`. Compose loads `.env.docker` then `.env` so the app container and `npm run test:isolation` share the same JWT secret. Do not put a second `AUTH_SECRET` in `.env.docker`.

What the setup script does:

1. `docker compose --env-file .env.docker --env-file .env up -d --build` (app, postgres, ollama, speech)
2. Waits for `/api/health`
3. Pulls chat + embedding models into the Ollama volume
4. Seeds demo users/jobs (`recruiter@local.dev` / `password123`)
5. Backfills candidate embeddings

MediaPipe WASM/model is vendored at **app image build** (`npm run setup:mediapipe`).  
Piper voice is vendored at **speech image build** (`scripts/download_voice.py`).

## URLs

| Service | URL |
|--------|-----|
| App | http://localhost:3000 |
| Health | http://localhost:3000/api/health |
| Speech | http://localhost:8001/health |
| Ollama | http://localhost:11434 |
| Postgres (host) | `localhost:55432` |

## Day-to-day

```powershell
docker compose --env-file .env.docker up -d
docker compose --env-file .env.docker logs -f app
docker compose --env-file .env.docker down
```

Host-only Postgres (old workflow) still works if you only need DB for `npm run dev`:

```powershell
docker compose up -d postgres
```

## Env

- Compose reads **`.env.docker`** (never commit real secrets).
- Inside the network: app → `postgres:5432`, `ollama:11434`, `speech:8001`.
- `AI_PROVIDER=local` by default. Cloud key not required.
- Change seed passwords / `AUTH_SECRET` before any real candidate data.

## Notes

- Speech container defaults to **CPU Whisper `small`** (portable). Host GPU speech via `speech-service\run.ps1` remains the fast path for VOICE QA.
- Ollama model pulls can take a long time on first run; volumes persist models.
- App schema: `prisma migrate deploy` on every container start (`docker/app/entrypoint.sh`).
- Storage (resumes / interview audio): Docker volume `app_storage` → `/storage`.

## Not in this compose (Tier 2 follow-ups)

- HTTPS / reverse proxy
- Automated `pg_dump` + `/storage` backup cron
- Admin password rotation beyond seed
