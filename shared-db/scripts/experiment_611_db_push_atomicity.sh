#!/usr/bin/env bash
# =============================================================================
# ISSUE #611 -- does `supabase db push` write a migration's SQL and its
# `supabase_migrations.schema_migrations` row in ONE transaction?
#
# STATUS: **NOT SETTLED.** This script is the experiment, written and reviewed
# but NOT RUN. The machine it was authored on (al8960ofc, 2026-08-10) has no
# Docker and no local PostgreSQL, so there was no disposable database to destroy.
# Run it and record the output in
# docs/verification/ before anyone relies on an answer.
#
# WHY YOU MUST NOT SKIP THIS AND JUST ASSERT AN ANSWER.
# One recent plan's reviewer asserted this as settled fact, was challenged, and
# retracted -- dropping that plan's confidence from 85% to 30%. The answer
# decides what "a run that died halfway" leaves behind, which is the whole basis
# of the one-directional co-presence recovery rules in
# scripts/production_migration_guard.py. Guessing it wrong means the recovery
# procedure is wrong.
#
# THREE QUESTIONS, NOT ONE. Q3 is the one people forget, and it is the one that
# matters for a bounded batch:
#   Q1  Does a migration's SQL and its ledger row commit together?
#   Q2  When file 2 of 3 fails, is file 1 rolled back, or does it stay applied?
#   Q3  When a SINGLE migration fails HALFWAY THROUGH ITS OWN SQL -- statement 1
#       succeeds, statement 2 raises -- is statement 1 rolled back, and is a
#       ledger row left behind? A migration that is half-applied WITHOUT a ledger
#       row is the worst case: `db push` will try to run the whole file again,
#       and its first statement will now fail with "already exists".
#
# REQUIREMENTS
#   * Docker (for the throwaway postgres), or any PostgreSQL you may destroy.
#   * supabase CLI 2.105.0 (the version the workflow pins).
#
# ****** THE DISPOSABLE DATABASE MUST CARRY A REALISTIC LEDGER. ******
# This is the trap that makes this experiment silently test the wrong thing. If
# `supabase_migrations.schema_migrations` is EMPTY, `db push` treats all ~423
# repo migrations as pending and tries to run them. It will fail early on
# unrelated dependencies, and you will be reading the failure mode of a
# completely different scenario while the script appears to work. So step 3
# below seeds the ledger with every repo version EXCEPT the fixtures -- the
# rows are fake, but their presence is what makes `db push` consider only the
# fixture files pending, which is the shape of a real bounded apply.
# =============================================================================
set -euo pipefail

PGPORT="${PGPORT:-55432}"
PGPASSWORD="${PGPASSWORD:-canary}"
DB_URL="postgresql://postgres:${PGPASSWORD}@127.0.0.1:${PGPORT}/postgres"
WORK="$(mktemp -d)"
CONTAINER="issue611-canary"

echo "== 1. Disposable database =="
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD="$PGPASSWORD" \
  -p "${PGPORT}:5432" postgres:15 >/dev/null
until docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
psql() { docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

echo "== 2. Fixture migrations =="
REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
mkdir -p "$WORK/supabase/migrations"
cp "$REPO/supabase/migrations/"*.sql "$WORK/supabase/migrations/"
cp "$REPO/supabase/config.toml" "$WORK/supabase/" 2>/dev/null || true

# Q3 fixture: ONE file, TWO statements, the second guaranteed to fail.
cat > "$WORK/supabase/migrations/29990101000001_q3_half_failing_file.sql" <<'SQL'
create table public.q3_first_statement_succeeded (id int);
select 1 / 0;   -- division_by_zero: this file dies halfway through itself
SQL

# Q1/Q2 fixtures: file A succeeds, file B fails outright.
cat > "$WORK/supabase/migrations/29990101000002_q2_file_a_succeeds.sql" <<'SQL'
create table public.q2_file_a (id int);
SQL
cat > "$WORK/supabase/migrations/29990101000003_q2_file_b_fails.sql" <<'SQL'
create table public.q2_file_b (id int);
select 1 / 0;
SQL

echo "== 3. Seed a REALISTIC ledger (see the header -- this is not optional) =="
psql -c 'create schema if not exists supabase_migrations;'
psql -c 'create table if not exists supabase_migrations.schema_migrations (
           version text primary key, statements text[], name text);'
# Also create the schemas the repo's real migrations assume, so nothing here
# depends on them existing.
psql -c 'create schema if not exists plm; create schema if not exists core;
         create schema if not exists api; create schema if not exists dam;'
for f in "$REPO/supabase/migrations/"*.sql; do
  v="$(basename "$f" | cut -c1-14)"
  psql -c "insert into supabase_migrations.schema_migrations(version)
           values ('$v') on conflict do nothing;"
done
echo "ledger rows seeded: $(psql -tAc 'select count(*) from supabase_migrations.schema_migrations')"

run_push() {  # $1 = single version to leave pending
  ( cd "$WORK" && supabase db push --db-url "$DB_URL" --include-all --yes 2>&1 ) || true
}

echo
echo "########## Q3: a migration that fails HALFWAY THROUGH ITS OWN SQL ##########"
psql -c "delete from supabase_migrations.schema_migrations
         where version in ('29990101000001','29990101000002','29990101000003');"
psql -c "insert into supabase_migrations.schema_migrations(version)
         values ('29990101000002'),('29990101000003') on conflict do nothing;"
run_push
echo "--- Q3 RESULT ---"
echo "statement-1 table present (t = NOT rolled back, the dangerous answer):"
psql -tAc "select to_regclass('public.q3_first_statement_succeeded') is not null;"
echo "ledger row for 29990101000001 present (t = ledger lies about a failed file):"
psql -tAc "select exists(select 1 from supabase_migrations.schema_migrations
                         where version = '29990101000001');"

echo
echo "########## Q1/Q2: file A succeeds, then file B fails ##########"
psql -c "delete from supabase_migrations.schema_migrations
         where version in ('29990101000001','29990101000002','29990101000003');"
psql -c "insert into supabase_migrations.schema_migrations(version)
         values ('29990101000001') on conflict do nothing;"
psql -c "drop table if exists public.q2_file_a, public.q2_file_b;"
run_push
echo "--- Q1/Q2 RESULT ---"
echo "file A table present (t = earlier files STAY applied; f = whole batch is one txn):"
psql -tAc "select to_regclass('public.q2_file_a') is not null;"
echo "file A ledger row present:"
psql -tAc "select exists(select 1 from supabase_migrations.schema_migrations
                         where version = '29990101000002');"
echo "file B table present (t = SQL committed without its ledger row -- the worst case):"
psql -tAc "select to_regclass('public.q2_file_b') is not null;"
echo "file B ledger row present:"
psql -tAc "select exists(select 1 from supabase_migrations.schema_migrations
                         where version = '29990101000003');"

echo
echo "== HOW TO READ THIS =="
cat <<'TXT'
  file A table = t AND file A ledger = t  -> per-file atomicity, batch is NOT one
      transaction. A failed run leaves earlier files APPLIED. This is what the
      one-directional co-presence recovery rules assume; if you see this, they
      are correct as written.
  file A table = f                        -> the whole batch is one transaction.
      A failed run leaves production UNCHANGED, and the co-presence recovery
      case can never arise. The rules stay (they cost nothing) but the urgency
      argument in their comment should be softened to match.
  any "table = t AND ledger = f"          -> SQL and ledger are NOT atomic. This
      is the dangerous answer: a re-push re-runs an already-applied file. Say so
      loudly in AGENTS.md and design the recovery procedure around it.
TXT

echo
echo "== cleanup =="
docker rm -f "$CONTAINER" >/dev/null
rm -rf "$WORK"
