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

# Kill a process and its descendants. `set -e` plus a tracked background job
# makes bash exit 143 ("Terminated") when that job is signalled, so this
# function turns off -e and disowns the pid before signalling it.
kill_tree() {
  local p="$1"
  local child
  for child in $(pgrep -P "${p}" 2>/dev/null || true); do
    kill_tree "${child}"
  done
  kill "${p}" 2>/dev/null || true
}

stop_server() {
  set +e
  if [ -n "${pid}" ]; then
    disown "${pid}" 2>/dev/null || true
    kill_tree "${pid}"
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

if ! stop_server; then
  if [ "${cmd_status}" -eq 0 ]; then
    cmd_status=1
  fi
fi

exit "${cmd_status}"
