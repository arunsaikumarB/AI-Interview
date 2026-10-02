#!/usr/bin/env bash
# HireOS release deploy for the app server. The live app keeps serving while the new
# version is installed and built in its own folder; the new build is started on a spare
# port and health-checked before it goes live; only then is the `current` symlink switched
# and the service restarted (a few seconds). If the restarted app is unhealthy, the
# previous release is put back automatically.
#
#   cd APP_DIR && bash scripts/deploy-release.sh               # deploy latest origin/fe
#   cd APP_DIR && bash scripts/deploy-release.sh <commit>      # deploy a specific commit
#   cd APP_DIR && bash scripts/deploy-release.sh --no-restart  # build + switch only (first-time setup)
#   cd APP_DIR && bash scripts/deploy-release.sh --rollback    # go back to the previous release
#
# Run as APP_USER. See docs/DEPLOYMENT-CENTOS9.md section 11.
set -Eeuo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
HIREOS_BASE="${HIREOS_BASE:-/opt/hireos}"
DEPLOY_REMOTE="${DEPLOY_REMOTE:-origin}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-fe}"
APP_PORT="${APP_PORT:-5000}"
SMOKE_PORT="${SMOKE_PORT:-5099}"
KEEP_RELEASES="${KEEP_RELEASES:-3}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"
SERVICE="${SERVICE:-hireos-app}"
RESTART_CMD="${RESTART_CMD:-sudo systemctl restart $SERVICE}"

RELEASES="$HIREOS_BASE/releases"
CURRENT="$HIREOS_BASE/current"
ENV_FILE="$APP_DIR/.env"

log() { printf '[deploy %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { log "FAILED: $*"; exit 1; }

commit=""
restart=1
rollback=0
for arg in "$@"; do
  case "$arg" in
    --no-restart) restart=0 ;;
    --rollback) rollback=1 ;;
    -*) die "unknown option $arg" ;;
    *) commit="$arg" ;;
  esac
done

healthy() {
  local url="$1" deadline=$((SECONDS + HEALTH_TIMEOUT)) body
  while ((SECONDS < deadline)); do
    body="$(curl -fsS --max-time 5 "$url" 2>/dev/null || true)"
    [[ "$body" == *'"database":{"ok":true}'* ]] && return 0
    sleep 2
  done
  return 1
}

port_answers() {
  curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$1/"
}

point_current_at() {
  ln -sfn "$1" "$CURRENT.next"
  mv -Tf "$CURRENT.next" "$CURRENT"
}

restart_and_check() {
  ((restart)) || return 0
  log "restarting $SERVICE"
  $RESTART_CMD 9>&-
  healthy "http://127.0.0.1:$APP_PORT/api/health"
}

previous_release() {
  local live d found=""
  live="$(readlink -f "$CURRENT" 2>/dev/null || true)"
  mapfile -t dirs < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d | sort)
  for d in "${dirs[@]}"; do
    [[ "$d" == "$live" ]] && break
    found="$d"
  done
  echo "$found"
}

mkdir -p "$RELEASES"
exec 9>"$HIREOS_BASE/.deploy.lock"
flock -n 9 || die "another deploy is already running"

if ((restart)) && [[ "$RESTART_CMD" == "sudo systemctl restart $SERVICE" ]]; then
  unit_dir="$(systemctl show -p WorkingDirectory --value "$SERVICE" 2>/dev/null || true)"
  [[ "$unit_dir" == "$CURRENT" ]] ||
    die "$SERVICE must run from $CURRENT (it runs from '${unit_dir:-?}'). Install deploy/systemd/hireos-app.service first, or use --no-restart for the first deploy."
fi

if ((rollback)); then
  prev="$(previous_release)"
  [[ -n "$prev" ]] || die "no previous release to roll back to"
  log "rolling back to $(basename "$prev")"
  point_current_at "$prev"
  restart_and_check || die "previous release did not become healthy either; check: journalctl -u $SERVICE -n 100"
  log "live: $(basename "$prev")"
  exit 0
fi

[[ -f "$ENV_FILE" ]] || die "$ENV_FILE not found"
storage="$(grep -E '^[[:space:]]*STORAGE_ROOT=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d "\"' " || true)"
[[ "$storage" == /* ]] ||
  die "STORAGE_ROOT in .env must be an absolute path such as /data/hireos/storage (resumes and recordings must survive releases). See section 10."
[[ -d "$storage" ]] || die "STORAGE_ROOT folder $storage does not exist"

log "fetching $DEPLOY_REMOTE/$DEPLOY_BRANCH"
git -C "$APP_DIR" fetch --quiet "$DEPLOY_REMOTE" "$DEPLOY_BRANCH"
sha="$(git -C "$APP_DIR" rev-parse --verify "${commit:-FETCH_HEAD}^{commit}")"
rel="$RELEASES/$(date -u +%Y%m%d%H%M%S)-${sha:0:7}"
log "preparing ${sha:0:7} in $rel (live app keeps running)"

git -C "$APP_DIR" worktree add --detach --quiet "$rel" "$sha"
ln -s "$ENV_FILE" "$rel/.env"

discard() {
  git -C "$APP_DIR" worktree remove --force "$rel" 2>/dev/null || rm -rf "$rel"
  git -C "$APP_DIR" worktree prune
}

log "installing dependencies and building (log: $rel.build.log)"
if ! (cd "$rel" && npm ci --include=dev --no-audit --no-fund && npm run build) >"$rel.build.log" 2>&1; then
  discard
  die "build failed; the live app was not touched. See $rel.build.log"
fi

log "smoke test on 127.0.0.1:$SMOKE_PORT"
if port_answers "$SMOKE_PORT"; then
  discard
  die "port $SMOKE_PORT is already in use, so the new version cannot be tested; stop whatever listens there (or set SMOKE_PORT)"
fi
(cd "$rel" && NODE_ENV=production exec setsid node_modules/.bin/next start -H 127.0.0.1 -p "$SMOKE_PORT") >"$rel.smoke.log" 2>&1 9>&- &
smoke_pid=$!
smoke_ok=0
healthy "http://127.0.0.1:$SMOKE_PORT/api/health" && smoke_ok=1
kill -TERM -- "-$smoke_pid" 2>/dev/null || kill "$smoke_pid" 2>/dev/null || true
for _ in $(seq 1 20); do port_answers "$SMOKE_PORT" || break; sleep 1; done
kill -KILL -- "-$smoke_pid" 2>/dev/null || true
wait "$smoke_pid" 2>/dev/null || true
if ((!smoke_ok)); then
  discard
  die "the new version did not start or cannot reach the database; the live app was not touched. See $rel.smoke.log"
fi

prev="$(readlink -f "$CURRENT" 2>/dev/null || true)"
log "switching live app to ${sha:0:7}"
point_current_at "$rel"

if ! restart_and_check; then
  if [[ -n "$prev" && -d "$prev" ]]; then
    log "new version unhealthy after restart; rolling back to $(basename "$prev")"
    point_current_at "$prev"
    restart_and_check || die "rollback also unhealthy; check: journalctl -u $SERVICE -n 100"
    discard
    die "deploy of ${sha:0:7} rolled back; previous release is live again. Check: journalctl -u $SERVICE -n 100"
  fi
  die "new version unhealthy after restart and there is no previous release; check: journalctl -u $SERVICE -n 100"
fi

git -C "$APP_DIR" merge --ff-only --quiet "$sha" 2>/dev/null ||
  log "note: $APP_DIR was not fast-forwarded (local changes?); the live app is unaffected"

live="$(readlink -f "$CURRENT")"
mapfile -t all < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d | sort)
for ((i = 0; i < ${#all[@]} - KEEP_RELEASES; i++)); do
  old="${all[i]}"
  [[ "$old" == "$live" || "$old" == "$prev" ]] && continue
  git -C "$APP_DIR" worktree remove --force "$old" 2>/dev/null || rm -rf "$old"
  rm -f "$old".build.log "$old".smoke.log
done
git -C "$APP_DIR" worktree prune
find "$RELEASES" -maxdepth 1 -name '*.log' -mtime +30 -delete

if ((restart)); then
  log "done: ${sha:0:7} is live and healthy"
else
  log "done: ${sha:0:7} is built and $CURRENT points to it (service not restarted)"
fi
