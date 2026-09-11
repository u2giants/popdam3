#!/usr/bin/env python3
"""Exercise the pass-2 routine snapshot against the live CI PostgreSQL."""

from __future__ import annotations

import subprocess
import sys

from check_pass2_routine_supersession import snapshot_query


def psql(sql: str, *, capture: bool = False) -> str:
    result = subprocess.run(
        ["psql", "-At", "--no-psqlrc", "-v", "ON_ERROR_STOP=1"],
        input=sql,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        sys.stderr.write(result.stdout)
        sys.stderr.write(result.stderr)
        raise SystemExit(result.returncode)
    return result.stdout if capture else ""


psql(
    """
    create extension if not exists vector;
    drop schema if exists pass2_restore_test cascade;
    create schema pass2_restore_test;

    create function pass2_restore_test.sample(i integer)
    returns integer language sql security invoker as $$ select i + 100 $$;

    create function pass2_restore_test.sample(v vector)
    returns double precision language sql security invoker
    set search_path = public, extensions
    as $$ select v <=> v $$;

    create procedure pass2_restore_test.sample_proc()
    language plpgsql security invoker as $$ begin null; end $$;
    """
)

query = snapshot_query(
    {
        "pass2_restore_test.sample": ["later.sql"],
        "pass2_restore_test.sample_proc": ["later.sql"],
    }
)
snapshot = psql(query, capture=True)
if "\n" not in snapshot or "CREATE OR REPLACE" not in snapshot.upper():
    raise SystemExit("snapshot did not contain executable newline-separated definitions")

psql(
    """
    drop function pass2_restore_test.sample(vector);
    create or replace function pass2_restore_test.sample(i integer)
    returns integer language sql security definer set statement_timeout = '5s'
    as $$ select i - 1 $$;
    create or replace procedure pass2_restore_test.sample_proc()
    language plpgsql security definer set statement_timeout = '5s'
    as $$ begin raise notice 'old'; end $$;
    """
)
psql(snapshot)

result = psql(
    """
    select count(*) = 3
       and bool_and(not p.prosecdef)
       and bool_and(case when pg_get_function_identity_arguments(p.oid) in ('i integer', '')
                         then p.proconfig is null else true end)
       and bool_or(pg_get_function_identity_arguments(p.oid) = 'v vector'
                   and p.proconfig = array['search_path=public, extensions']
                   and position('<=>' in pg_get_functiondef(p.oid)) > 0)
       and bool_or(p.prokind = 'p')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'pass2_restore_test';
    """,
    capture=True,
).strip()
if result != "t":
    raise SystemExit("restored routines did not match the snapshotted catalog truth")

psql("drop schema pass2_restore_test cascade;")
print("pass-2 live routine restoration: PASS")
