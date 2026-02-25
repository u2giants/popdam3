#!/bin/bash
# Run this on the Synology to update the bridge agent to latest.
# Usage: ssh admin@nas "bash /volume1/docker/popdam/update.sh"
set -e

cd /volume1/docker/popdam

echo "Pulling latest bridge agent image..."
docker compose pull

echo "Restarting container..."
docker compose down
docker compose up -d

echo "Done. Verifying..."
sleep 3
docker exec popdam-bridge node -e "console.log('Bridge agent running OK')"
