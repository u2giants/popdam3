#!/usr/bin/env bash
set -euo pipefail

primary=public.ecr.aws/supabase/postgres:17.6.1.132
alternate=ghcr.io/supabase/postgres@sha256:9d50688a826cf1455a0e91013160171de73b4d31df1509014e73463fb276a84d
export SUPABASE_INTERNAL_IMAGE_REGISTRY=public.ecr.aws
log="$RUNNER_TEMP/db-start.log"

if timeout -k 10s 5m supabase db start 2>&1 | tee "$log"; then
  exit 0
fi

# Only the pinned ECR Postgres pull denial qualifies. The CLI v2.105.0
# inspects the local tag before pulling. Keep the original registry and
# startup command so only the transport for this one image changes.
quota='failed to pull docker image: Error response from daemon: error from registry: Data limit exceeded'
debug='Try rerunning the command with --debug to troubleshoot the error.'
if ! grep -Fxq "Retrying after 8s: $primary" "$log" ||
   [[ "$(tail -n 2 "$log")" != "$quota"$'\n'"$debug" ]]; then
  exit 1
fi

echo "ECR denied the Postgres pull. Checking the pinned equivalent image on GHCR."
timeout -k 10s 5m docker pull --platform linux/amd64 "$alternate"
timeout -k 5s 30s docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$alternate" |
  grep -Fxq "$alternate"
test "$(timeout -k 5s 30s docker image inspect --format '{{.Os}}/{{.Architecture}}' "$alternate")" = linux/amd64
image_id="$(timeout -k 5s 30s docker image inspect --format '{{.Id}}' "$alternate")"
test -n "$image_id"
timeout -k 5s 30s docker image tag "$alternate" "$primary"
test "$(timeout -k 5s 30s docker image inspect --format '{{.Id}}' "$primary")" = "$image_id"

timeout -k 10s 5m supabase db start 2>&1 | tee -a "$log"
