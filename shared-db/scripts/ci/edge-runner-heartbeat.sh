#!/usr/bin/env bash
# Runs every minute on the self-hosted runner host (systemd user timer
# shared-db-runner-heartbeat.timer). Publishes this repository's runner state to
# the repository variable SHARED_DB_LINUX_RUNNER_HEARTBEAT as
# "<online|offline>,<idle|busy>,<unix-seconds>" for scripts/ci/runner-route.mjs.
# Uses the host's own gh login (repository admin); no secret leaves the host.
# If this host dies the variable goes stale and every job routes to hosted.
set -euo pipefail
REPO="${SHARED_DB_REPO:-popcre/shared-db}"
LABEL="${SHARED_DB_RUNNER_LABEL:-shared-db-linux}"
# Any online runner carrying the label counts: "idle" when at least one is free
# (four runners share this host; watching only the first sent work to hosted
# runners while three sat idle).
state=$(gh api "repos/$REPO/actions/runners" --jq "[.runners[] | select(any(.labels[]; .name == \"$LABEL\")) | select(.status == \"online\")] | if length == 0 then \"\" elif any(.[]; .busy | not) then \"online,idle\" else \"online,busy\" end" 2>/dev/null || true)
[ -n "$state" ] || state="offline,busy"
gh variable set SHARED_DB_LINUX_RUNNER_HEARTBEAT -R "$REPO" --body "$state,$(date +%s)"
