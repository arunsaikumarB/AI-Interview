#!/usr/bin/env bash
# Start the production Next server, run a command, then stop it.
# Usage: scripts/with-next-server.sh <log-name> -- <command...>
set -euo pipefail

if [ "$#" -lt 3 ] || [ "$2" != "--" ]; then
  echo "usage: scripts/with-next-server.sh <log-name> -- <command...>" >&2
  exit 2
fi

name="$1"
shift 2
log="/tmp/next-${name}.log"
pid=""

stop_server() {
  if [ -n "${pid}" ]; then
    pkill -P "${pid}" 2>/dev/null || true
    kill "${pid}" 2>/dev/null || true
  fi
  # The next-server child can outlive `npm run start`.
  pkill -f "[n]ext-server" 2>/dev/null || true
  pkill -f "[n]ext start" 2>/dev/null || true
  if [ -n "${pid}" ]; then
    wait "${pid}" 2>/dev/null || true
  fi
  local i
  for i in $(seq 1 20); do
    if ! curl -sf --max-time 1 http://127.0.0.1:3000/api/health >/dev/null; then
      return 0
    fi
    sleep 0.5
  done
  echo "next server still listening on 127.0.0.1:3000" >&2
  return 1
}

npm run start -- --hostname 127.0.0.1 --port 3000 >"${log}" 2>&1 &
pid=$!

ready=0
for _ in $(seq 1 60); do
  if curl -sf http://127.0.0.1:3000/api/health >/dev/null; then
    echo "server up (${name})"
    ready=1
    break
  fi
  sleep 2
done

if [ "${ready}" -ne 1 ]; then
  echo "server failed to become healthy" >&2
  cat "${log}" >&2 || true
  stop_server || true
  exit 1
fi

set +e
"$@"
cmd_status=$?
set -e

if ! stop_server; then
  if [ "${cmd_status}" -eq 0 ]; then
    cmd_status=1
  fi
fi

exit "${cmd_status}"
