#!/usr/bin/env bash
# Runs every minute on the self-hosted runner host (systemd user timer
# shared-db-runner-heartbeat.timer). Publishes this repository's runner state to
# the repository variable SHARED_DB_LINUX_RUNNER_HEARTBEAT as
# "<online|offline>,<idle|busy>,<unix-seconds>" for scripts/ci/runner-route.mjs.
# Uses the host's own gh login (repository admin); no secret leaves the host.
# If this host dies the variable goes stale and every job routes to hosted.
set -euo pipefail
REPO="${SHARED_DB_REPO:-popcre/shared-db}"
RUNNER="${SHARED_DB_RUNNER_NAME:-edge-dev3-linux}"
state=$(gh api "repos/$REPO/actions/runners" --jq ".runners[] | select(.name == \"$RUNNER\") | \"\(.status),\(if .busy then \"busy\" else \"idle\" end)\"" 2>/dev/null || true)
[ -n "$state" ] || state="offline,busy"
gh variable set SHARED_DB_LINUX_RUNNER_HEARTBEAT -R "$REPO" --body "$state,$(date +%s)"
