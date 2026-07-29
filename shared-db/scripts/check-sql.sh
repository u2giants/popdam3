#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
migration_dir="$root_dir/supabase/migrations"

# No two migrations may share a version (the leading 14-digit timestamp).
# Supabase's ledger `supabase_migrations.schema_migrations` keys on the version
# ALONE, not the filename, so a duplicate is silently skipped on first apply and
# then aborts every later `db push` with a `schema_migrations_pkey` unique
# violation. This has now happened twice (versions 20260722220000 and
# 20260728160000); AGENTS.md section 4 rule 5 asked a human to run this check by
# hand, which is exactly why it was missed. Enforce it here instead.
duplicate_versions="$(
  find "$migration_dir" -maxdepth 1 -name '*.sql' -exec basename {} \; \
    | cut -c1-14 \
    | sort \
    | uniq -d
)"

if [[ -n "$duplicate_versions" ]]; then
  echo "ERROR: duplicate migration version(s) detected:" >&2
  while IFS= read -r version; do
    echo "  version $version is claimed by:" >&2
    find "$migration_dir" -maxdepth 1 -name "${version}*.sql" -exec basename {} \; >&2
  done <<< "$duplicate_versions"
  echo >&2
  echo "Supabase keys its migration ledger on the 14-digit version alone, not the" >&2
  echo "filename. Re-timestamp the NOT-YET-APPLIED file so it sorts after the" >&2
  echo "winner, keeping dependent migrations in order. If its content has already" >&2
  echo "landed via a later re-issue, delete the superseded file instead --" >&2
  echo "re-timestamping it would re-apply stale DDL over the newer fixes." >&2
  exit 1
fi

required_files=(
  "20260621150714_foundation.sql"
  "20260621150815_app_core.sql"
  "20260621151024_domain_tables.sql"
  "20260621151155_api_rls_realtime.sql"
)

for file in "${required_files[@]}"; do
  test -f "$migration_dir/$file"
done

rg --quiet "create schema if not exists app" "$migration_dir/20260621150714_foundation.sql"
rg --quiet "create table core.company" "$migration_dir/20260621150815_app_core.sql"
rg --quiet "create table pim.product" "$migration_dir/20260621151024_domain_tables.sql"
rg --quiet "create or replace view api.pm_product_board" "$migration_dir/20260621151155_api_rls_realtime.sql"
rg --quiet "enable row level security" "$migration_dir/20260621151155_api_rls_realtime.sql"

if [[ -n "${DATABASE_URL:-}" ]]; then
  command -v psql >/dev/null
  for file in "${required_files[@]}"; do
    psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --single-transaction --file "$migration_dir/$file"
  done
else
  echo "Static checks passed. Set DATABASE_URL to run migrations against a disposable database."
fi
