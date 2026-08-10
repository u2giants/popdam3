#!/usr/bin/env bash
# =============================================================================
# ISSUE #611 -- does `supabase db push` write a migration's SQL and its
# `supabase_migrations.schema_migrations` row in ONE transaction?
#
# STATUS: **RUN AND SETTLED for CLI 2.105.0**, on the hetz VPS on 2026-08-10
# against repo `main` tip bc29d36. Result, evidence and scope:
#   docs/verification/issue-611-db-push-atomicity-20260810.md
#   docs/verification/issue-611-run-output-20260810.txt   (the raw log)
# The answer in one line: **SQL and ledger row are atomic PER FILE, NOT per
# batch.** A batch that dies on file 40 leaves files 1-39 applied AND ledgered.
# This script stays runnable so the result can be re-measured on a future CLI
# version -- the behaviour belongs to the CLI, so a version bump reopens it.
#
# TWO DEFECTS VOIDED THREE OF THE FOUR ATTEMPTS ON 2026-08-10. Both are fixed
# below; both used to look EXACTLY like a clean pass, which is the worst shape a
# failure can take. Do not undo either.
#   1. The v2.105.0 linux tarball ships TWO binaries. `supabase` is a SHIM that
#      forwards to a co-located `supabase-go`. Extract the WHOLE tarball. If you
#      extract only `supabase`, every push dies with "Could not find the
#      `supabase-go` binary" and EVERY result line reads `f` -- indistinguishable
#      from a clean rollback. See issue #688. The step-1b preflight below now
#      fails loudly on this instead of producing a silent false pass.
#   2. CLI 2.105.0 FORCES TLS on `--db-url` and IGNORES `sslmode=disable`. Plain
#      `postgres:15` serves no TLS, so every push dies with
#      "tls error (server refused TLS connection)". Step 1 now gives the
#      throwaway container a self-signed cert and `ssl = on`, and prints
#      `container TLS: on` as a visible tripwire. This changes the container's
#      TRANSPORT ONLY -- no fixture, no SQL file, no assertion. Keep it that way.
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
# THREE MORE, ADDED 2026-08-10 after a three-model methodology review (Grok
# `grok-4.5-build`, Kimi `kimi-code/k3`, GLM `glm-5.2`) found the original three
# insufficient to settle #611. Full findings: comment on issue #611.
#   Q4  What does the runner do with a file containing NON-TRANSACTIONAL DDL
#       (`create index concurrently`)? Such a statement cannot live in a
#       transaction block, so a runner may drop to statement-by-statement
#       autocommit -- the one mode that leaves SQL applied with NO ledger row.
#       The detection rule for CLI 2.105.0 is UNKNOWN. Measure it.
#   Q5  The INVERSE failure: valid SQL, but the LEDGER INSERT raises. Every
#       other question fails on the SQL side and can only INFER atomicity.
#       Q5 is the only one that PROVES it.
#   Q6  INTERSPERSED placement. Q1-Q4 are versioned 2999, later than all 424
#       real migrations, so they only exercise the plain APPEND path. Q6 sorts
#       into the MIDDLE of the ledger -- the out-of-order case `--include-all`
#       exists for -- and is multi-statement, so "success" is never proven by a
#       single trivially-atomic statement.
#
# REQUIREMENTS
#   * Docker (for the throwaway postgres:15). The PostgreSQL major version does
#     not decide the answer; the CLI version does.
#   * supabase CLI **2.105.0** -- the version the workflow pins, and the version
#     the #611 gate names. A run on any other CLI version does NOT discharge the
#     gate. Record `supabase --version` alongside the output.
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

# --- TLS. NOT optional, and NOT a fixture change. CLI 2.105.0 forces TLS on
# --- `--db-url` and ignores sslmode=disable; plain postgres:15 serves no TLS,
# --- so without this every push dies with "tls error (server refused TLS
# --- connection)". Only the container's transport is touched here.
CERTD="$(mktemp -d)"
openssl req -new -x509 -days 1 -nodes -subj "/CN=localhost" \
  -keyout "$CERTD/server.key" -out "$CERTD/server.crt" 2>/dev/null
docker cp "$CERTD/server.crt" "$CONTAINER":/var/lib/postgresql/data/server.crt
docker cp "$CERTD/server.key" "$CONTAINER":/var/lib/postgresql/data/server.key
docker exec -u root "$CONTAINER" chown postgres:postgres \
  /var/lib/postgresql/data/server.key /var/lib/postgresql/data/server.crt
docker exec -u root "$CONTAINER" chmod 600 /var/lib/postgresql/data/server.key
docker exec -i "$CONTAINER" psql -U postgres -c "alter system set ssl = on;" >/dev/null
docker restart "$CONTAINER" >/dev/null
until docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
# TRIPWIRE: this MUST print `container TLS: on`. If it prints `off`, every push
# below will die on TLS and every result line will read `f` -- which reads
# exactly like a clean rollback and would void the whole run.
echo "container TLS: $(docker exec -i "$CONTAINER" psql -U postgres -tAc "show ssl;")"

psql() { docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

# =============================================================================
# == 1b. PREFLIGHT -- PROVE THE CLI ACTUALLY RUNS BEFORE MEASURING ANYTHING ==
# =============================================================================
# This exists because on 2026-08-10 three of four attempts produced a full page
# of `f` results that looked like clean rollbacks and were in fact the CLI never
# executing at all (the supabase-go shim trap, #688) or never connecting at all
# (TLS). An absent table with no push is NOT a rollback. So: run one REAL,
# harmless CLI command against the throwaway container and refuse to continue
# unless it succeeds. It exercises the same binary path and the same TLS
# connection as every measurement below, so a green preflight rules out both
# defects at once.
echo "== 1b. CLI preflight =="
echo "supabase --version: $(supabase --version 2>&1 || true)"
if ! PREFLIGHT="$(supabase migration list --db-url "$DB_URL" 2>&1)"; then
  echo "$PREFLIGHT"
  echo
  echo "FATAL: the Supabase CLI could not talk to the throwaway database."
  case "$PREFLIGHT" in
    *supabase-go*)
      echo "  CAUSE: the two-binary trap (#688). The \`supabase\` on your PATH is a"
      echo "  SHIM that forwards to a co-located \`supabase-go\`, and \`supabase-go\` is"
      echo "  missing. Extract the WHOLE v2.105.0 tarball into one directory and run"
      echo "  the \`supabase\` inside it -- do not copy the single file anywhere." ;;
    *tls*|*TLS*)
      echo "  CAUSE: TLS. The container is not serving TLS -- check the"
      echo "  \`container TLS:\` line above; it must read \`on\`." ;;
    *)
      echo "  CAUSE: unknown. Read the error above. DO NOT continue and DO NOT" ;;
  esac
  echo "  ABORTING. A run past this point would print a page of \`f\` results that"
  echo "  are indistinguishable from clean rollbacks, and would be WORTHLESS."
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  exit 1
fi
echo "CLI preflight: OK (the real CLI ran and connected over TLS)"

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

# ---------------------------------------------------------------------------
# Q4 fixture -- NON-TRANSACTIONAL DDL. The panel's top finding, raised
# independently by all three models (Grok, Kimi, GLM).
#
# `CREATE INDEX CONCURRENTLY` (like REINDEX, VACUUM, and REFRESH MATERIALIZED
# VIEW ... CONCURRENTLY) CANNOT run inside a transaction block. A runner that
# detects such a statement has only two choices: refuse the file, or drop to
# statement-by-statement autocommit. In autocommit mode a mid-file failure
# leaves SQL APPLIED WITH NO LEDGER ROW -- exactly the state #611 fears.
#
# NOBODY KNOWS CLI 2.105.0's detection rule. Do NOT assert it. MEASURE it.
# Whatever this fixture does is the answer, and the answer for Q1-Q3 is only
# valid for files that do NOT look like this one.
#
# Real licensor/ColdLion batches plausibly contain a concurrent index, which is
# why this case is not academic.
# ---------------------------------------------------------------------------
cat > "$WORK/supabase/migrations/29990101000004_q4_non_transactional_ddl.sql" <<'SQL'
create table public.q4_before_concurrent (id int);
create index concurrently q4_idx on public.q4_before_concurrent (id);
select 1 / 0;   -- the file dies AFTER a statement that cannot be in a txn
SQL

# ---------------------------------------------------------------------------
# Q5 fixture -- THE INVERSE FAILURE (Kimi and GLM). This is the ONLY fixture
# that PROVES atomicity rather than inferring it.
#
# Every other fixture fails on the SQL side. Nothing makes the LEDGER INSERT
# fail. So a clean-looking rollback everywhere else is still consistent with
# "the SQL was in one transaction and the ledger insert was in another" -- and
# also with Kimi's WIRE-PROTOCOL MASKING: if the CLI ships a whole file as one
# multi-statement string over the simple query protocol, PostgreSQL wraps it in
# ONE IMPLICIT TRANSACTION all by itself. The file then looks perfectly atomic
# as an artefact of the wire protocol, while saying nothing whatever about
# where the ledger insert sits.
#
# So: perfectly VALID SQL in the file, and a BEFORE INSERT trigger on
# supabase_migrations.schema_migrations that raises for THIS version only.
#   * SQL still there             -> they are NOT one transaction. Wire-protocol
#                                    masking was all we were ever seeing.
#   * SQL gone AND the trigger's exception text appears in the push log
#                                 -> SQL and ledger really are one transaction.
#
# THE LOG CHECK IS NOT OPTIONAL. An absent table on its own proves nothing: it is
# equally consistent with the file's SQL NEVER HAVING RUN -- the CLI might write
# the ledger row before executing the file, or the push might die on validation
# or the connection first. So the block below greps its own captured push output
# for the exception text, and "atomic" requires all three signals to line up.
# ---------------------------------------------------------------------------
cat > "$WORK/supabase/migrations/29990101000005_q5_ledger_insert_fails.sql" <<'SQL'
create table public.q5_valid_sql (id int);
insert into public.q5_valid_sql (id) values (1);
SQL

# ---------------------------------------------------------------------------
# Q6 fixture -- INTERSPERSED PLACEMENT (GLM alone; verified against the script).
#
# Every fixture above is versioned 2999-01-01, LATER than all 424 real repo
# migrations, so they sort onto the END of the list and exercise only the plain
# APPEND path. The scenario production actually faces is an INTERSPERSED
# migration that sorts BEFORE files already in the ledger -- which is the
# entire reason `--include-all` exists. This version (2026-06-01) lands in the
# MIDDLE of the seeded ledger.
#
# It is also deliberately MULTI-STATEMENT (Grok), so "success" is never proven
# by a single statement: a one-statement file is trivially atomic and tells you
# nothing.
# ---------------------------------------------------------------------------
cat > "$WORK/supabase/migrations/20260601005500_q6_interspersed_multi_statement.sql" <<'SQL'
create table public.q6_interspersed (id int, label text);
insert into public.q6_interspersed (id, label) values (1, 'first');
create index q6_interspersed_id_idx on public.q6_interspersed (id);
insert into public.q6_interspersed (id, label) values (2, 'second');
SQL

# Every fixture version, for the per-question ledger resets below. A block
# SUPPRESSES a fixture by inserting its version (db push then skips it) and
# ENABLES a fixture by leaving its version out.
FIXTURES="'29990101000001','29990101000002','29990101000003',
          '29990101000004','29990101000005','20260601005500'"

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

run_push() {  # takes no arguments -- which fixtures run is decided by the LEDGER,
              # not by anything passed in here. A block leaves a fixture pending
              # by NOT inserting its version before calling this. (An earlier
              # draft documented a `$1 = single version to leave pending`
              # parameter that was never read; it is removed rather than
              # implemented, so nobody can believe it is doing something.)
  ( cd "$WORK" && supabase db push --db-url "$DB_URL" --include-all --yes 2>&1 ) || true
}

# Reset between questions: forget every fixture ledger row and drop every object
# a fixture may have created, so each block starts from the same clean state.
reset_fixtures() {
  psql -c "delete from supabase_migrations.schema_migrations where version in ($FIXTURES);"
  psql -c "drop table if exists public.q3_first_statement_succeeded,
                                public.q2_file_a, public.q2_file_b,
                                public.q4_before_concurrent,
                                public.q5_valid_sql,
                                public.q6_interspersed cascade;"
}

# Suppress the listed fixture versions (db push will skip them as already applied).
suppress() {  # $@ = versions to mark applied
  for v in "$@"; do
    psql -c "insert into supabase_migrations.schema_migrations(version)
             values ('$v') on conflict do nothing;"
  done
}

echo
echo "########## Q3: a migration that fails HALFWAY THROUGH ITS OWN SQL ##########"
reset_fixtures
suppress 29990101000002 29990101000003 29990101000004 29990101000005 20260601005500
run_push
echo "--- Q3 RESULT ---"
echo "statement-1 table present (t = NOT rolled back, the dangerous answer):"
psql -tAc "select to_regclass('public.q3_first_statement_succeeded') is not null;"
echo "ledger row for 29990101000001 present (t = ledger lies about a failed file):"
psql -tAc "select exists(select 1 from supabase_migrations.schema_migrations
                         where version = '29990101000001');"

echo
echo "########## Q1/Q2: file A succeeds, then file B fails ##########"
reset_fixtures
suppress 29990101000001 29990101000004 29990101000005 20260601005500
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
echo "########## Q4: NON-TRANSACTIONAL DDL (create index concurrently) ##########"
echo "# MEASURE the CLI's behaviour here. Do not assume it. If the runner drops to"
echo "# autocommit for this file, a mid-file failure can leave SQL applied with NO"
echo "# ledger row, and the Q1-Q3 answers do NOT generalise to files like this."
reset_fixtures
suppress 29990101000001 29990101000002 29990101000003 29990101000005 20260601005500
run_push
echo "--- Q4 RESULT ---"
echo "pre-concurrent table present (t = NOT rolled back -- autocommit, the dangerous mode):"
psql -tAc "select to_regclass('public.q4_before_concurrent') is not null;"
echo "concurrent index present (t = the CLI really did run it outside a txn):"
psql -tAc "select to_regclass('public.q4_idx') is not null;"
echo "ledger row for 29990101000004 present (t = ledger lies about a failed file):"
psql -tAc "select exists(select 1 from supabase_migrations.schema_migrations
                         where version = '29990101000004');"
echo "NOTE: the CLI REFUSING this file outright is also a valid, informative result."
echo "      Record the exact error text; it is the detection rule we do not know."

echo
echo "########## Q5: the INVERSE failure -- valid SQL, ledger insert raises ##########"
echo "# The only fixture that PROVES atomicity instead of inferring it."
reset_fixtures
suppress 29990101000001 29990101000002 29990101000003 29990101000004 20260601005500
psql -c "create or replace function supabase_migrations.q5_block_ledger()
         returns trigger language plpgsql as \$fn\$
         begin
           if new.version = '29990101000005' then
             raise exception 'issue611 fixture: ledger insert deliberately blocked';
           end if;
           return new;
         end \$fn\$;"
psql -c "drop trigger if exists q5_block_ledger on supabase_migrations.schema_migrations;
         create trigger q5_block_ledger before insert on
           supabase_migrations.schema_migrations
           for each row execute function supabase_migrations.q5_block_ledger();"
# Capture this push, because an ABSENT table is only meaningful if the ledger
# insert was actually REACHED and actually RAISED -- see the third result line.
run_push | tee "$WORK/q5_push.log"
psql -c "drop trigger if exists q5_block_ledger on supabase_migrations.schema_migrations;"
echo "--- Q5 RESULT ---"
echo "trigger exception seen in the push log (MUST be t, or Q5 proves NOTHING):"
if grep -q 'issue611 fixture: ledger insert deliberately blocked' "$WORK/q5_push.log"; then
  echo "t"
else
  echo "f"
  echo "  ^^ the fixture's ledger insert was never reached, or never raised."
  echo "     Q5 is INCONCLUSIVE this run. Read the log above before concluding"
  echo "     anything: the push may have died on validation or the connection,"
  echo "     or never got as far as this file at all."
fi
echo "q5 table present  (t = SQL SURVIVED a failed ledger insert => NOT one transaction):"
psql -tAc "select to_regclass('public.q5_valid_sql') is not null;"
echo "ledger row for 29990101000005 present (expected f -- the trigger blocked it):"
psql -tAc "select exists(select 1 from supabase_migrations.schema_migrations
                         where version = '29990101000005');"
echo "READ THESE THREE TOGETHER -- 'ATOMIC' REQUIRES ALL THREE:"
echo "  exception = t  AND  table = f  AND  ledger = f"
echo "      -> the ledger insert was reached and failed, and the file's SQL went"
echo "         with it. SQL and ledger ARE one transaction. This is the proof."
echo "  exception = t  AND  table = t"
echo "      -> SQL survived a failed ledger insert. They are NOT one transaction."
echo "  exception = f  (whatever the other two say)"
echo "      -> INCONCLUSIVE, NOT atomic. An absent table is equally consistent"
echo "         with the SQL never having executed at all -- the CLI may write the"
echo "         ledger row BEFORE running the file, or the push may have failed"
echo "         earlier. Do not report atomicity from this. Fix the run and repeat."

echo
echo "########## Q6: INTERSPERSED placement, multi-statement success ##########"
echo "# Version 20260601005500 sorts in the MIDDLE of the seeded ledger, not after"
echo "# it. This is the out-of-order case --include-all actually exists for, and the"
echo "# shape a real production backlog has. The three 2999 fixtures only ever"
echo "# exercised the plain APPEND path."
reset_fixtures
suppress 29990101000001 29990101000002 29990101000003 29990101000004 29990101000005
run_push
echo "--- Q6 RESULT ---"
echo "q6 table present (expect t -- an interspersed file applies at all):"
psql -tAc "select to_regclass('public.q6_interspersed') is not null;"
echo "q6 row count (expect 2 -- ALL statements of a multi-statement file committed):"
psql -tAc "select count(*) from public.q6_interspersed;" 2>/dev/null || echo "(table absent)"
echo "q6 ledger row present (expect t):"
psql -tAc "select exists(select 1 from supabase_migrations.schema_migrations
                         where version = '20260601005500');"
echo "ALSO CHECK THE PUSH LOG ABOVE: it must list ONLY 20260601005500 as applied."
echo "If it re-listed the 424 seeded versions, --include-all is not ledger-filtered"
echo "and every other conclusion in this run is suspect."

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

  ---- THREE WAYS TO GET A CONFIDENT BUT WRONG ANSWER OUT OF THIS RUN ----

  1. STOP-ON-FIRST-ERROR IS NOT BATCH ATOMICITY. Read the "file A table = f"
     line above STRICTLY. It only tells you that the file BEFORE the failure was
     rolled back in THIS two-file arrangement. It does NOT license the sentence
     "a failed 60-file run leaves production unchanged." If `db push` merely
     stops at the first error, files 1..N-1 of a 60-file batch are already
     committed and STAY committed. The Q1/Q2 fixture cannot distinguish
     "whole batch is one transaction" from "stopped early and there happened to
     be nothing before it" unless the push log shows earlier files applied and
     then reverted. Check the log, not just the table.

  2. WIRE-PROTOCOL MASKING. A clean per-file rollback may be an ARTEFACT, not a
     design: if the CLI sends a file as one multi-statement string over the
     simple query protocol, PostgreSQL wraps it in one implicit transaction by
     itself. Everything then LOOKS atomic while telling you nothing about where
     the ledger insert sits. Q5 -- and only Q5 -- separates the two. If Q5 shows
     the SQL surviving a failed ledger insert, the tidy Q1/Q2/Q3 results were
     wire-protocol masking and the ledger is NOT in the same transaction.

  3. THE RESULT IS CONDITIONAL ON FILE CONTENTS, NOT UNIVERSAL. Whatever Q1-Q3
     and Q6 show is true only for files the runner CAN wrap in a transaction.
     Q4 is the counterexample: a file containing CREATE INDEX CONCURRENTLY (or
     REINDEX / VACUUM / REFRESH MATERIALIZED VIEW ... CONCURRENTLY) may be run
     statement-by-statement in autocommit. Write the conclusion as
     "for CLI 2.105.0, for files containing only transactional DDL, ..." and
     state the Q4 answer separately. Never write it as a universal law.

  ---- AND THE RESULT IS SCOPED TO THE CLI VERSION ----
  This answers the question for the Supabase CLI version you actually ran
  (the gate requires 2.105.0). The behaviour belongs to the CLI, not to the
  PostgreSQL major version. Record `supabase --version` with the output.
TXT

echo
echo "== cleanup =="
docker rm -f "$CONTAINER" >/dev/null
rm -rf "$WORK"
rm -rf "${CERTD:-}" 2>/dev/null || true
