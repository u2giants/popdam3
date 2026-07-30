#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# CHECK_SQL_MIGRATION_DIR / CHECK_SQL_MAIN_NEWEST / CHECK_SQL_MIGRATIONS_ONLY are
# test seams only, used by scripts/check-sql.test.mjs to drive the migration
# guards against a throwaway fixture directory. CI and a developer's plain
# `bash scripts/check-sql.sh` set none of them and behave exactly as before.
migration_dir="${CHECK_SQL_MIGRATION_DIR:-$root_dir/supabase/migrations}"

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

# Note on the two historical collisions named above: there is deliberately NO
# allowlist grandfathering them. Both are resolved on disk -- the losing file was
# deleted once its DDL had been re-issued under a later version
# (20260728174500_clickup_incremental_task_import_reissue.sql, itself corrected
# by 20260728181500), while the winner keeps the version its ledger row belongs
# to. Each version is now claimed by exactly one file, so the check above passes
# with nothing exempted. If either version ever collides again, that is a real
# regression and must fail loudly.

# --- Guard B: a new migration may not be backdated behind the base branch -----
# Legal for Supabase, dangerous here, and the actual CAUSE of the 20260728160000
# collision: that migration was authored on a branch cut BEFORE another session's
# migration landed on main, so its version sat behind main's newest and nothing
# ever compared the two. Several AI sessions work in parallel in this repo, so a
# version that is in the past relative to the base branch is the warning sign.
#
# Resolving "the base branch's newest version" needs the base ref. If it cannot
# be resolved (shallow clone, detached checkout, no network, a fixture directory)
# this guard SKIPS with a loud warning rather than failing -- a false positive
# here would block every pull request, which is worse than the bug it prevents.
main_newest_version="${CHECK_SQL_MAIN_NEWEST:-}"
base_versions_file=""
guard_b_source="injected CHECK_SQL_MAIN_NEWEST"

if [[ -z "$main_newest_version" ]]; then
  base_ref="${GITHUB_BASE_REF:-main}"
  base_rev=""
  if command -v git >/dev/null 2>&1 && git -C "$root_dir" rev-parse --git-dir >/dev/null 2>&1; then
    for candidate in "origin/$base_ref" "refs/remotes/origin/$base_ref" "$base_ref"; do
      if git -C "$root_dir" rev-parse --verify --quiet "$candidate" >/dev/null 2>&1; then
        base_rev="$candidate"
        break
      fi
    done
    if [[ -z "$base_rev" ]] \
      && git -C "$root_dir" fetch --quiet --no-tags origin "$base_ref" >/dev/null 2>&1 \
      && git -C "$root_dir" rev-parse --verify --quiet FETCH_HEAD >/dev/null 2>&1; then
      base_rev="FETCH_HEAD"
    fi
  fi

  if [[ -n "$base_rev" ]]; then
    base_versions_file="$(mktemp)"
    git -C "$root_dir" ls-tree -r --name-only "$base_rev" -- supabase/migrations \
      | sed 's#.*/##' \
      | grep -E '^[0-9]{14}.*\.sql$' \
      | cut -c1-14 \
      | sort -u > "$base_versions_file" || true
    main_newest_version="$(tail -n 1 "$base_versions_file")"
    guard_b_source="git:$base_rev"
  fi
fi

if [[ -z "$main_newest_version" ]]; then
  echo "WARNING: Guard B (backdated migration) SKIPPED -- could not determine the" >&2
  echo "newest migration version on the base branch (base ref unavailable: no git" >&2
  echo "repository, no origin/${GITHUB_BASE_REF:-main}, or no network to fetch it)." >&2
  echo "Duplicate-version checking still ran. If this appears in CI, give the" >&2
  echo "checkout access to the base branch (actions/checkout fetch-depth: 0)." >&2
else
  backdated=""
  while IFS= read -r name; do
    version="${name:0:14}"
    [[ "$version" =~ ^[0-9]{14}$ ]] || continue
    # Only versions this branch ADDS matter. Anything already on the base branch
    # is history and is allowed to sort wherever it already sorts.
    if [[ -n "$base_versions_file" ]] && grep -qx "$version" "$base_versions_file"; then
      continue
    fi
    if [[ "$version" < "$main_newest_version" ]]; then
      backdated+="  $name"$'\n'
    fi
  done < <(find "$migration_dir" -maxdepth 1 -name '*.sql' -exec basename {} \; | sort)

  if [[ -n "$backdated" ]]; then
    echo "ERROR: backdated migration(s) detected." >&2
    echo "The newest migration version already on the base branch is $main_newest_version," >&2
    echo "but this branch adds migration(s) that sort BEFORE it:" >&2
    printf '%s' "$backdated" >&2
    echo >&2
    echo "HOW TO FIX: rename each file above to a NEW 14-digit timestamp later than" >&2
    echo "$main_newest_version (use the current UTC time), keeping the rest of the filename." >&2
    echo "It is a pure rename -- the SQL does not change." >&2
    echo >&2
    echo "WHY THIS IS BLOCKED: a version behind the base branch means this branch was" >&2
    echo "cut before another session's migration landed, so the two were never" >&2
    echo "compared. That is exactly how version 20260728160000 collided on 2026-07-28" >&2
    echo "and how an entire ClickUp migration was silently skipped in preview AND" >&2
    echo "production. Even without a collision, applying older DDL after newer DDL can" >&2
    echo "\`create or replace\` a corrected object back to its stale body." >&2
    rm -f "$base_versions_file"
    exit 1
  fi
  echo "Guard B: no migration sorts before the base branch's newest version $main_newest_version (source: $guard_b_source)."
fi

rm -f "$base_versions_file"

if [[ -n "${CHECK_SQL_MIGRATIONS_ONLY:-}" ]]; then
  echo "Migration guards passed (CHECK_SQL_MIGRATIONS_ONLY set; content checks skipped)."
  exit 0
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
