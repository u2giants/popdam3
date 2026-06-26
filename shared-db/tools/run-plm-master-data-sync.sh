#!/usr/bin/env bash
# Host wrapper for plm-sync.service.
# Secrets stay outside git in /home/ai/.plm-sync.env. The old env file used
# PLM_API_KEY, while the canonical import tool accepts DESIGNFLOW_API_KEY.
set -euo pipefail

if [ -n "${PLM_API_KEY:-}" ] && [ -z "${DESIGNFLOW_API_KEY:-}" ]; then
  export DESIGNFLOW_API_KEY="$PLM_API_KEY"
fi

exec /usr/bin/node /worksp/shared-db/tools/sync-plm-master-data.mjs --apply
