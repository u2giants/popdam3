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
# Enumerate the migration filenames ONCE and reuse the list everywhere below.
# `find -exec basename {} \;` spawns one process per file; at 437 migrations
# that is 437 process creations per pass, which on Git Bash for Windows takes
# over a minute for a single guard. Guard B2 needs the same list, so doing it
# this way twice made a slow check unusable. `sed` strips the directory in one
# process and is portable in a way `find -printf` is not.
migration_names_file="$(mktemp)"
find "$migration_dir" -maxdepth 1 -name '*.sql' | sed 's#.*/##' | sort > "$migration_names_file"

duplicate_versions="$(cut -c1-14 "$migration_names_file" | sort | uniq -d)"

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
  rm -f "$migration_names_file"
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

# CHECK_SQL_BASE_VERSIONS is a test seam, like the others above: a file holding
# the base branch's versions, one per line. It exists because Guard B2 needs to
# know which versions a branch ADDS, and CHECK_SQL_MAIN_NEWEST alone conveys a
# maximum but not a set. CI and a plain `bash scripts/check-sql.sh` set none of
# these and resolve the base branch from git exactly as before.
if [[ -n "${CHECK_SQL_BASE_VERSIONS:-}" && -f "${CHECK_SQL_BASE_VERSIONS}" ]]; then
  base_versions_file="$(mktemp)"
  grep -oE '^[0-9]{14}' "${CHECK_SQL_BASE_VERSIONS}" | sort -u > "$base_versions_file" || true
  [[ -n "$main_newest_version" ]] || main_newest_version="$(tail -n 1 "$base_versions_file")"
  guard_b_source="injected CHECK_SQL_BASE_VERSIONS"
fi

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
      if node scripts/historical-migration-restorations.mjs --allows-backdated "supabase/migrations/$name"; then
        echo "Guard B historical restoration: exact governed version $version is allowed to sort before main."
        continue
      fi
      backdated+="  $name"$'\n'
    fi
  done < "$migration_names_file"

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
    rm -f "$base_versions_file" "$migration_names_file"
    exit 1
  fi
  echo "Guard B: no migration sorts before the base branch's newest version $main_newest_version (source: $guard_b_source)."
fi

# --- Guard B2: a new migration may not be backdated behind a LIVE LEDGER ------
# ISSUE #651. Guard B compares this branch only against the BASE BRANCH, and that
# is a real blind spot: `main` is not what the databases have actually run.
#
# Measured 2026-08-12 against the live environments:
#   preview    (rjyboqwcdzcocqgmsyel): 430 applied, newest 20260812211000
#   production (qsllyeztdwjgirsysgai): 426 applied, newest 20260812020000
#   repository:                        437 migration files
#
# So a branch can add a version that sorts after main's newest and STILL be
# behind what preview has already applied. Supabase's ledger keys on the version
# alone, so such a migration either applies out of order after newer DDL (a
# `create or replace` can restore a corrected object to its stale body) or, if
# the version is already in the ledger, is SILENTLY SKIPPED while the push
# reports success.
#
# ⚠️ PREVIEW IS NOT A SUPERSET OF PRODUCTION, and any check written here must
# handle that rather than assuming one environment is ahead. Verified: versions
# 20260810140000 and 20260810180000 are applied on PRODUCTION but not on
# PREVIEW. Each ledger is therefore evaluated INDEPENDENTLY, against its own
# newest version — never against a merged or assumed-ahead view.
#
# ⚠️ SCOPED TO VERSIONS THIS BRANCH ADDS, exactly like Guard B, and this is not
# a softening. Seven files already on `main` (20260810140000, 20260810180000,
# 20260810190000, 20260810190100, 20260811050000, 20260811060000, 20260811070000)
# are pending in preview and ALL of them sort below preview's newest. Checking
# every local file instead of only the added ones would fail this guard on `main`
# itself from the first run, and a guard that is red on an untouched branch is a
# guard everybody switches off.
check_ledger() {
  ledger_name="$1"
  ledger_file="$2"

  ledger_versions="$(mktemp)"
  grep -oE '^[0-9]{14}' "$ledger_file" | sort -u > "$ledger_versions" || true

  # A ledger file that parses to NOTHING must never read as "nothing is applied".
  # That is the false-clear shape this repository keeps being bitten by: an empty
  # read would make every version look new and pass the guard silently.
  if [[ ! -s "$ledger_versions" ]]; then
    echo "ERROR: the $ledger_name ledger at $ledger_file contains no 14-digit versions." >&2
    echo "Refusing to treat an unreadable ledger as an empty one -- that would clear" >&2
    echo "every migration this branch adds. Check the query and the file." >&2
    rm -f "$ledger_versions"
    return 1
  fi

  ledger_newest="$(tail -n 1 "$ledger_versions")"
  ledger_count="$(wc -l < "$ledger_versions" | tr -d ' ')"

  already_applied=""
  behind_ledger=""
  while IFS= read -r added_version; do
    [[ -n "$added_version" ]] || continue
    if grep -qx "$added_version" "$ledger_versions"; then
      already_applied+="  $added_version"$'\n'
    elif [[ "$added_version" < "$ledger_newest" ]]; then
      behind_ledger+="  $added_version"$'\n'
    fi
  done < "$added_versions_file"

  rm -f "$ledger_versions"

  if [[ -n "$already_applied" ]]; then
    echo "ERROR: this branch adds migration(s) whose version is ALREADY APPLIED in $ledger_name:" >&2
    printf '%s' "$already_applied" >&2
    echo >&2
    echo "$ledger_name has $ledger_count applied version(s), newest $ledger_newest." >&2
    echo "A version already in the ledger is SILENTLY SKIPPED on the next push while" >&2
    echo "the push reports success -- the file never runs and nothing says so." >&2
    echo "HOW TO FIX: rename the file to a NEW 14-digit timestamp later than $ledger_newest." >&2
    return 1
  fi

  if [[ -n "$behind_ledger" ]]; then
    echo "ERROR: this branch adds migration(s) that sort BEFORE what $ledger_name has already applied:" >&2
    printf '%s' "$behind_ledger" >&2
    echo >&2
    echo "$ledger_name has $ledger_count applied version(s), newest $ledger_newest." >&2
    echo "Passing Guard B is not enough: the base branch is not what the databases have" >&2
    echo "actually run. Applying older DDL after newer DDL can \`create or replace\` a" >&2
    echo "corrected object back to its stale body." >&2
    echo "HOW TO FIX: rename each file above to a NEW 14-digit timestamp later than" >&2
    echo "$ledger_newest (use the current UTC time). It is a pure rename -- the SQL" >&2
    echo "does not change." >&2
    return 1
  fi

  echo "Guard B2: no added migration is behind or duplicated in $ledger_name (${ledger_count} applied, newest $ledger_newest)."
  return 0
}

# Resolve a ledger to a file, either from a pre-fetched path or by querying the
# database directly. Prints the path on stdout; empty means "not configured".
resolve_ledger_file() {
  ledger_path="$1"
  ledger_url="$2"

  if [[ -n "$ledger_path" ]]; then
    if [[ ! -f "$ledger_path" ]]; then
      echo "MISSING:$ledger_path"
      return 0
    fi
    echo "$ledger_path"
    return 0
  fi

  if [[ -n "$ledger_url" ]]; then
    if ! command -v psql >/dev/null 2>&1; then
      echo "NOPSQL:"
      return 0
    fi
    out="$(mktemp)"
    # Read-only. `ON_ERROR_STOP` so a failed query is an empty file AND a
    # non-zero status, never a silently truncated ledger.
    if psql "$ledger_url" --set ON_ERROR_STOP=1 -At \
      -c 'select version from supabase_migrations.schema_migrations order by version' \
      > "$out"; then
      echo "$out"
    else
      rm -f "$out"
      echo "QUERYFAILED:"
    fi
    return 0
  fi

  echo ""
}

# The versions this branch ADDS -- the same scoping Guard B uses.
added_versions_file="$(mktemp)"
guard_b2_scope_known=0
if [[ -n "$base_versions_file" && -s "$base_versions_file" ]]; then
  guard_b2_scope_known=1
  # `comm` on two sorted lists, not a `grep` per file: at 437 migrations the
  # per-file form is 437 subprocesses for a set difference the shell can get in
  # one. Both inputs are already sorted and de-duplicated.
  local_versions_file="$(mktemp)"
  cut -c1-14 "$migration_names_file" | grep -E '^[0-9]{14}$' | sort -u > "$local_versions_file"
  comm -23 "$local_versions_file" "$base_versions_file" > "$added_versions_file"
  rm -f "$local_versions_file"
fi

guard_b2_failed=0
guard_b2_ran=0
for ledger_name in preview production; do
  if [[ "$ledger_name" == "preview" ]]; then
    ledger_path="${CHECK_SQL_PREVIEW_LEDGER:-}"
    ledger_url="${CHECK_SQL_PREVIEW_DB_URL:-}"
  else
    ledger_path="${CHECK_SQL_PRODUCTION_LEDGER:-}"
    ledger_url="${CHECK_SQL_PRODUCTION_DB_URL:-}"
  fi

  resolved="$(resolve_ledger_file "$ledger_path" "$ledger_url")"

  case "$resolved" in
    '')
      continue
      ;;
    MISSING:*)
      echo "ERROR: the $ledger_name ledger file ${resolved#MISSING:} does not exist." >&2
      echo "It was named explicitly, so this is a wiring fault, not an absence." >&2
      guard_b2_failed=1
      continue
      ;;
    NOPSQL:)
      echo "ERROR: a $ledger_name database URL was given but psql is not installed." >&2
      guard_b2_failed=1
      continue
      ;;
    QUERYFAILED:)
      echo "ERROR: could not read the $ledger_name ledger from its database URL." >&2
      echo "Refusing to continue as though the ledger were empty." >&2
      guard_b2_failed=1
      continue
      ;;
  esac

  if [[ "$guard_b2_scope_known" -eq 0 ]]; then
    echo "ERROR: a $ledger_name ledger was configured, but the set of versions this" >&2
    echo "branch ADDS could not be determined (the base ref was unavailable, so Guard B" >&2
    echo "skipped too). Checking every local file instead would fail on main itself." >&2
    echo "Give the checkout access to the base branch (actions/checkout fetch-depth: 0)." >&2
    guard_b2_failed=1
    continue
  fi

  guard_b2_ran=1
  check_ledger "$ledger_name" "$resolved" || guard_b2_failed=1
  [[ "$resolved" == "$ledger_path" ]] || rm -f "$resolved"
done

if [[ "$guard_b2_ran" -eq 0 && "$guard_b2_failed" -eq 0 ]]; then
  # LOUD, because this guard silently doing nothing is precisely the #651 defect.
  # Set CHECK_SQL_REQUIRE_LEDGER=1 wherever credentials ARE available (CI) to
  # turn this warning into a hard failure.
  echo "WARNING: Guard B2 (backdated against a LIVE LEDGER) did not run -- no ledger" >&2
  echo "source configured. Guard B only compared this branch against the base branch," >&2
  echo "which is NOT what the databases have actually applied (issue #651)." >&2
  echo "Configure one of:" >&2
  echo "  CHECK_SQL_PREVIEW_DB_URL / CHECK_SQL_PRODUCTION_DB_URL   (queried directly)" >&2
  echo "  CHECK_SQL_PREVIEW_LEDGER / CHECK_SQL_PRODUCTION_LEDGER   (file of versions)" >&2
  if [[ -n "${CHECK_SQL_REQUIRE_LEDGER:-}" ]]; then
    echo "CHECK_SQL_REQUIRE_LEDGER is set, so this is an ERROR rather than a warning." >&2
    guard_b2_failed=1
  fi
fi

rm -f "$added_versions_file" "$migration_names_file"

if [[ "$guard_b2_failed" -ne 0 ]]; then
  rm -f "$base_versions_file"
  exit 1
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

grep -qF "create schema if not exists app" "$migration_dir/20260621150714_foundation.sql"
grep -qF "create table core.company" "$migration_dir/20260621150815_app_core.sql"
grep -qF "create table pim.product" "$migration_dir/20260621151024_domain_tables.sql"
grep -qF "create or replace view api.pm_product_board" "$migration_dir/20260621151155_api_rls_realtime.sql"
grep -qF "enable row level security" "$migration_dir/20260621151155_api_rls_realtime.sql"

if [[ -n "${DATABASE_URL:-}" ]]; then
  command -v psql >/dev/null
  for file in "${required_files[@]}"; do
    psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --single-transaction --file "$migration_dir/$file"
  done
else
  echo "Static checks passed. Set DATABASE_URL to run migrations against a disposable database."
fi
