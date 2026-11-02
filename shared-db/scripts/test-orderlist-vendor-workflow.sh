#!/usr/bin/env bash
# Owner: OrderList #5393. Disposable real-Postgres function behavior test.
set -euo pipefail
cd "$(dirname "$0")/.."
container="orderlist-contract-${RANDOM}-${RANDOM}"
compose_file="$(mktemp "${TMPDIR:-/tmp}/orderlist-contract.XXXXXX.yml")"
trap 'docker compose -p "$container" -f "$compose_file" down -v >/dev/null 2>&1 || true; rm -f "$compose_file"' EXIT
cat > "$compose_file" <<YAML
services:
  database:
    image: postgres:17
    container_name: $container
    environment:
      POSTGRES_HOST_AUTH_METHOD: trust
    healthcheck:
      test: [CMD-SHELL, "pg_isready -U postgres"]
      interval: 1s
      timeout: 2s
      retries: 30
YAML
docker compose -p "$container" -f "$compose_file" up -d --wait --wait-timeout 40 >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 < scripts/fixtures/orderlist-vendor-workflow-bootstrap.sql >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 < supabase/migrations/20261102003158_orderlist_vendor_ids_and_workflow.sql >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 < scripts/fixtures/orderlist-vendor-workflow-cases.sql
