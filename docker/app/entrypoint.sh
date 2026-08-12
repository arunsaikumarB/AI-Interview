#!/bin/sh
set -e

PRISMA="node ./node_modules/prisma/build/index.js"
TSX="node ./node_modules/tsx/dist/cli.mjs"

echo "[app] Waiting for database…"
i=0
# Pilot uses db push (matches host workflow). migrate deploy needs a clean migration_lock.
until $PRISMA db push --skip-generate; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "[app] db push failed after retries"
    exit 1
  fi
  echo "[app] database not ready, retry $i/30…"
  sleep 2
done

if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[app] Seeding database…"
  $TSX prisma/seed.ts || true
fi

echo "[app] Starting Next.js on :${PORT:-3000}"
exec node server.js
