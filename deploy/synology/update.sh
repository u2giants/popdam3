#!/bin/bash
# Run this on the Synology to update the bridge agent to latest.
# Usage: ssh admin@nas "bash /volume1/docker/popdam/update.sh"
set -euo pipefail

cd /volume1/docker/popdam

docker compose config --quiet
previous_image_id="$(docker inspect --format '{{.Image}}' popdam-bridge 2>/dev/null || true)"

echo "Pulling latest bridge agent image..."
docker compose pull bridge-agent

echo "Recreating only the bridge container..."
docker compose up -d --force-recreate bridge-agent

echo "Verifying stability across the restart window..."
sleep 45
state="$(docker inspect --format '{{.State.Running}} {{.RestartCount}} {{index .Config.Labels "com.docker.compose.service"}}' popdam-bridge 2>/dev/null || true)"
if [ "$state" = "true 0 bridge-agent" ]; then
  echo "Bridge agent is stable and Compose-managed."
  exit 0
fi

echo "Bridge update failed stability verification; restoring the prior image." >&2
docker logs --tail 40 popdam-bridge >&2 2>/dev/null || true
if [ -n "$previous_image_id" ]; then
  docker image tag "$previous_image_id" ghcr.io/u2giants/popdam-bridge:stable
  docker compose up -d --force-recreate bridge-agent
  sleep 15
  docker inspect --format 'Rollback state: running={{.State.Running}} restarts={{.RestartCount}} compose={{index .Config.Labels "com.docker.compose.service"}}' popdam-bridge
else
  echo "No prior container image was available for automatic rollback." >&2
fi
exit 1
