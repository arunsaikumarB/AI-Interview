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

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from example — set AUTH_SECRET to a long random value before use."
fi

AUTH_VAL="$(grep -E '^[[:space:]]*AUTH_SECRET=' .env | head -n1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
if [[ -z "${AUTH_VAL}" || "${AUTH_VAL}" == "replace-with-a-long-random-secret" || "${AUTH_VAL}" == "change-me-to-a-long-random-string" ]]; then
  echo "AUTH_SECRET in .env is missing or still a placeholder. Set a long random secret (single source for host + Docker)." >&2
  exit 1
fi

if [[ ! -f .env.docker ]]; then
  cp .env.docker.example .env.docker
  echo "Created .env.docker from example (ports/services only; AUTH_SECRET comes from .env)."
fi

# Strip legacy AUTH_SECRET from .env.docker so it cannot override .env
if grep -qE '^[[:space:]]*AUTH_SECRET=' .env.docker 2>/dev/null; then
  grep -vE '^[[:space:]]*AUTH_SECRET=' .env.docker > .env.docker.tmp
  mv .env.docker.tmp .env.docker
  echo "Removed AUTH_SECRET from .env.docker (use .env only)."
fi

CHAT_MODEL="$(grep -E '^OLLAMA_CHAT_MODEL=' .env .env.docker 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '"' || true)"
EMBED_MODEL="$(grep -E '^OLLAMA_EMBED_MODEL=' .env .env.docker 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '"' || true)"
CHAT_MODEL="${CHAT_MODEL:-qwen2.5:7b}"
EMBED_MODEL="${EMBED_MODEL:-nomic-embed-text}"

# Later --env-file wins: .env supplies AUTH_SECRET
COMPOSE_ENV=(--env-file .env.docker --env-file .env)

echo "==> Starting stack"
if [[ "$SKIP_BUILD" -eq 1 ]]; then
  docker compose "${COMPOSE_ENV[@]}" up -d
else
  docker compose "${COMPOSE_ENV[@]}" up -d --build
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
[[ "$ok" -eq 1 ]] || { echo "App health failed"; docker compose "${COMPOSE_ENV[@]}" logs --tail=80 app; exit 1; }

echo "==> Pulling Ollama models ($CHAT_MODEL, $EMBED_MODEL)"
docker compose "${COMPOSE_ENV[@]}" exec -T ollama ollama pull "$EMBED_MODEL"
docker compose "${COMPOSE_ENV[@]}" exec -T ollama ollama pull "$CHAT_MODEL"

if [[ "$SKIP_SEED" -eq 0 ]]; then
  echo "==> Seeding database"
  docker compose "${COMPOSE_ENV[@]}" exec -T app node dist/docker/seed.cjs
fi

if [[ "$SKIP_EMBED" -eq 0 ]]; then
  echo "==> Backfilling embeddings"
  docker compose "${COMPOSE_ENV[@]}" exec -T \
    -e DATABASE_URL="postgresql://ats:ats_local_dev@postgres:5432/ai_recruitment_os?schema=public" \
    -e OLLAMA_LOCAL_URL="http://ollama:11434" \
    -e OLLAMA_EMBED_MODEL="$EMBED_MODEL" \
    app node dist/docker/backfill-embeddings.cjs
fi

echo ""
echo "Pilot stack ready: http://localhost:3000"
echo "Login (after seed): recruiter@local.dev / password123"
