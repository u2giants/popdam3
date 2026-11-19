#!/usr/bin/env bash
# Runs every minute on the self-hosted runner host (systemd user timer
# shared-db-runner-heartbeat.timer). Publishes this repository's runner state to
# the repository variable SHARED_DB_LINUX_RUNNER_HEARTBEAT as
# "<online|offline>,<idle|busy>,<unix-seconds>" for scripts/ci/runner-route.mjs.
# Uses the host's own gh login (repository admin); no secret leaves the host.
# If this host dies the variable goes stale and every job routes to hosted.
#
# Request budget: the state is read from the local runner processes (no API
# call), and the variable is written only when the state changes or the last
# write is REFRESH_SECONDS old (runner-route.mjs accepts up to 150 s). That is
# about 33 requests an hour instead of 120 on the personal GitHub allowance.
# When no local runner process is found, the runner list API is the fallback.
set -euo pipefail
REPO="${SHARED_DB_REPO:-popcre/shared-db}"
LABEL="${SHARED_DB_RUNNER_LABEL:-shared-db-linux}"
RUNNER_GLOB="${SHARED_DB_RUNNER_DIR_GLOB:-$HOME/actions-runners/actions-runner-shared-db*}"
REFRESH_SECONDS="${SHARED_DB_HEARTBEAT_REFRESH_SECONDS:-110}"
STATE_FILE="${SHARED_DB_HEARTBEAT_STATE_FILE:-${XDG_STATE_HOME:-$HOME/.local/state}/shared-db-runner-heartbeat.last}"

# Local view: each matching runner directory with a running Runner.Listener is
# online; it is busy while that listener has a Runner.Worker child.
local_state() {
  local online=0 idle=0 dir pid
  for dir in $RUNNER_GLOB; do
    [ -d "$dir" ] || continue
    pid=$(pgrep -f -x "$dir/bin/Runner.Listener run.*" | head -n 1 || true)
    [ -n "$pid" ] || continue
    online=$((online + 1))
    pgrep -P "$pid" -f Runner.Worker >/dev/null 2>&1 || idle=$((idle + 1))
  done
  [ "$online" -gt 0 ] || return 1
  if [ "$idle" -gt 0 ]; then echo "online,idle"; else echo "online,busy"; fi
}

# Any online runner carrying the label counts: "idle" when at least one is free
# (four runners share this host; watching only the first sent work to hosted
# runners while three sat idle).
api_state() {
  gh api "repos/$REPO/actions/runners" --jq "[.runners[] | select(any(.labels[]; .name == \"$LABEL\")) | select(.status == \"online\")] | if length == 0 then \"\" elif any(.[]; .busy | not) then \"online,idle\" else \"online,busy\" end" 2>/dev/null || true
}

state=$(local_state || api_state)
[ -n "$state" ] || state="offline,busy"
now=$(date +%s)
last_state="" last_time=0
if [ -r "$STATE_FILE" ]; then read -r last_state last_time < "$STATE_FILE" || true; fi
case "$last_time" in ''|*[!0-9]*) last_time=0 ;; esac
if [ "$state" = "$last_state" ] && [ $((now - last_time)) -lt "$REFRESH_SECONDS" ]; then
  exit 0
fi
gh variable set SHARED_DB_LINUX_RUNNER_HEARTBEAT -R "$REPO" --body "$state,$now"
mkdir -p "$(dirname "$STATE_FILE")"
printf '%s %s\n' "$state" "$now" > "$STATE_FILE"
