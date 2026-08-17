#!/bin/sh
set -e

PRISMA="node ./node_modules/prisma/build/index.js"
SCHEMA="prisma/schema.prisma"
SEED_JS="dist/docker/seed.cjs"

# Run a SQL statement through Prisma without mutating schema. Returns non-zero
# when the statement fails (e.g. the relation does not exist yet).
db_exec() {
  echo "$1" | $PRISMA db execute --schema "$SCHEMA" --stdin >/dev/null 2>&1
}

# 1. Wait for the database to accept connections. This step never writes.
echo "[app] Waiting for database…"
i=0
until db_exec "SELECT 1;"; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "[app] database unreachable after 30 attempts — aborting"
    exit 1
  fi
  echo "[app] database not ready, retry $i/30…"
  sleep 2
done
echo "[app] Database reachable."

# 2. Apply the schema only when it is safe to do so.
#
#    A populated database is the source of truth (Prisma owns it, but the rows
#    are real). Pushing a container image's schema onto an existing database is
#    how a stale image silently proposes destructive changes, so we only
#    bootstrap an EMPTY database automatically. Set HIREOS_DB_PUSH=true to force
#    a push against a populated database after you have reviewed the diff.
#
#    --accept-data-loss is never used. If Prisma reports that a change would
#    drop data, the correct fix is to rebuild the image from the current schema,
#    not to override the warning.
if db_exec 'SELECT 1 FROM "User" LIMIT 1;'; then
  SCHEMA_PRESENT=true
else
  SCHEMA_PRESENT=false
fi

if [ "$SCHEMA_PRESENT" = "false" ]; then
  echo "[app] Empty database detected — bootstrapping schema with prisma db push…"
  if ! $PRISMA db push --schema "$SCHEMA" --skip-generate; then
    echo "[app] Schema bootstrap failed — aborting"
    exit 1
  fi
  echo "[app] Schema bootstrap complete."
elif [ "${HIREOS_DB_PUSH:-false}" = "true" ]; then
  echo "[app] HIREOS_DB_PUSH=true — applying schema to the existing database…"
  if ! $PRISMA db push --schema "$SCHEMA" --skip-generate; then
    echo "[app] ---------------------------------------------------------------"
    echo "[app] prisma db push refused to apply this image's schema."
    echo "[app] The image is out of date relative to the database, or the schema"
    echo "[app] genuinely diverges. Rebuild the image from the current source"
    echo "[app] (npm run pilot:up -- --build). Do NOT pass --accept-data-loss:"
    echo "[app] it would drop columns or enum values the running app still uses."
    echo "[app] ---------------------------------------------------------------"
    exit 1
  fi
  echo "[app] Schema applied."
else
  echo "[app] Existing schema detected — skipping db push (set HIREOS_DB_PUSH=true to force)."
fi

if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[app] Seeding database…"
  node "$SEED_JS" || true
fi

echo "[app] Starting Next.js on :${PORT:-3000}"
exec node server.js
