#!/usr/bin/env bash
# Run a command on the Synology NAS via SSH.
# Usage: ./scripts/nas-ssh.sh <command>
# Example: ./scripts/nas-ssh.sh 'docker ps'
#
# Credentials are loaded from .env.local (gitignored).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/.env.local"

if [[ -z "${SYNOLOGY_SSH_HOST:-}" || -z "${SYNOLOGY_SSH_USER:-}" || -z "${SYNOLOGY_SSH_KEY:-}" ]]; then
  echo "ERROR: SYNOLOGY_SSH_HOST, SYNOLOGY_SSH_USER, SYNOLOGY_SSH_KEY must be set in .env.local" >&2
  exit 1
fi

ssh \
  -i "$SYNOLOGY_SSH_KEY" \
  -o StrictHostKeyChecking=no \
  -o ConnectTimeout=10 \
  "${SYNOLOGY_SSH_USER}@${SYNOLOGY_SSH_HOST}" \
  "$@"
