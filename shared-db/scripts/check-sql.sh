#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
migration_dir="$root_dir/supabase/migrations"

required_files=(
  "20260621000100_foundation.sql"
  "20260621000200_app_core.sql"
  "20260621000300_domain_tables.sql"
  "20260621000400_api_rls_realtime.sql"
)

for file in "${required_files[@]}"; do
  test -f "$migration_dir/$file"
done

rg --quiet "create schema if not exists app" "$migration_dir/20260621000100_foundation.sql"
rg --quiet "create table core.company" "$migration_dir/20260621000200_app_core.sql"
rg --quiet "create table pim.product" "$migration_dir/20260621000300_domain_tables.sql"
rg --quiet "create or replace view api.pm_product_board" "$migration_dir/20260621000400_api_rls_realtime.sql"
rg --quiet "enable row level security" "$migration_dir/20260621000400_api_rls_realtime.sql"

if [[ -n "${DATABASE_URL:-}" ]]; then
  command -v psql >/dev/null
  for file in "${required_files[@]}"; do
    psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --single-transaction --file "$migration_dir/$file"
  done
else
  echo "Static checks passed. Set DATABASE_URL to run migrations against a disposable database."
fi
