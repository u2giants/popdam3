#!/usr/bin/env bash
set -euo pipefail

# Issue #963: prove two real database sessions cannot both create the same
# first decision. This runs only in CI's throwaway local Supabase database.
first_log="${RUNNER_TEMP:-/tmp}/source-resolution-first-writer.log"
second_log="${RUNNER_TEMP:-/tmp}/source-resolution-second-writer.log"

cleanup() {
  psql -v ON_ERROR_STOP=1 --no-psqlrc -q -c \
    "delete from plm.source_resolution where source_system='zztest-race' and entity_kind='property' and source_id='same-key'" \
    >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

PGAPPNAME=source-resolution-first-writer \
psql -v ON_ERROR_STOP=1 --no-psqlrc >"$first_log" 2>&1 <<'SQL' &
begin;
select plm.set_source_resolution(
  'zztest-race','property','same-key','unresolved',
  null,null,null,null,'first',null
);
select pg_sleep(10);
commit;
SQL
first_pid=$!

first_ready=false
for _ in $(seq 1 100); do
  if [ "$(psql -v ON_ERROR_STOP=1 --no-psqlrc -Atqc \
    "select exists (select 1 from pg_stat_activity where application_name='source-resolution-first-writer' and state='active' and query like 'select pg_sleep(%')")" = "t" ]; then
    first_ready=true
    break
  fi
  sleep 0.1
done
if [ "$first_ready" != true ]; then
  echo "first writer did not reach its open transaction before timeout" >&2
  cat "$first_log" >&2
  exit 1
fi

set +e
psql -v ON_ERROR_STOP=1 --no-psqlrc >"$second_log" 2>&1 <<'SQL'
\set VERBOSITY verbose
select plm.set_source_resolution(
  'zztest-race','property','same-key','no_match',
  null,null,null,null,'second',null
);
SQL
second_rc=$?
set -e

wait "$first_pid"

if [ "$second_rc" -eq 0 ]; then
  echo "second concurrent first writer unexpectedly succeeded" >&2
  cat "$second_log" >&2
  exit 1
fi
if ! grep -q 'ERROR:  40001:' "$second_log"; then
  echo "second concurrent first writer did not receive the required reload conflict" >&2
  cat "$second_log" >&2
  exit 1
fi
if grep -qi 'unique.*violation\|duplicate key' "$second_log"; then
  echo "concurrent first writer leaked a duplicate-key error" >&2
  cat "$second_log" >&2
  exit 1
fi

echo "source-resolution first-writer race: PASS"
