#!/usr/bin/env bash
# Pilot packaging setup — models, seed, embeddings.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SKIP_BUILD=0
SKIP_SEED=0
SKIP_EMBED=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --skip-seed) SKIP_SEED=1 ;;
    --skip-embed) SKIP_EMBED=1 ;;
  esac
done

if [[ ! -f .env.docker ]]; then
  cp .env.docker.example .env.docker
  echo "Created .env.docker from example — set AUTH_SECRET before production use."
fi

CHAT_MODEL="$(grep -E '^OLLAMA_CHAT_MODEL=' .env.docker | cut -d= -f2- | tr -d '"' || true)"
EMBED_MODEL="$(grep -E '^OLLAMA_EMBED_MODEL=' .env.docker | cut -d= -f2- | tr -d '"' || true)"
CHAT_MODEL="${CHAT_MODEL:-qwen3.6:latest}"
EMBED_MODEL="${EMBED_MODEL:-nomic-embed-text}"

echo "==> Starting stack"
if [[ "$SKIP_BUILD" -eq 1 ]]; then
  docker compose --env-file .env.docker up -d
else
  docker compose --env-file .env.docker up -d --build
fi

echo "==> Waiting for app health…"
ok=0
for i in $(seq 1 60); do
  if curl -sf http://localhost:3000/api/health | grep -q '"ok":true'; then
    ok=1
    break
  fi
  sleep 3
done
[[ "$ok" -eq 1 ]] || { echo "App health failed"; docker compose --env-file .env.docker logs --tail=80 app; exit 1; }

echo "==> Pulling Ollama models ($CHAT_MODEL, $EMBED_MODEL)"
docker compose --env-file .env.docker exec -T ollama ollama pull "$EMBED_MODEL"
docker compose --env-file .env.docker exec -T ollama ollama pull "$CHAT_MODEL"

if [[ "$SKIP_SEED" -eq 0 ]]; then
  echo "==> Seeding database"
  docker compose --env-file .env.docker exec -T app node dist/docker/seed.cjs
fi

if [[ "$SKIP_EMBED" -eq 0 ]]; then
  echo "==> Backfilling embeddings"
  docker compose --env-file .env.docker exec -T \
    -e DATABASE_URL="postgresql://ats:ats_local_dev@postgres:5432/ai_recruitment_os?schema=public" \
    -e OLLAMA_LOCAL_URL="http://ollama:11434" \
    -e OLLAMA_EMBED_MODEL="$EMBED_MODEL" \
    app node dist/docker/backfill-embeddings.cjs
fi

echo ""
echo "Pilot stack ready: http://localhost:3000"
echo "Login (after seed): recruiter@local.dev / password123"
