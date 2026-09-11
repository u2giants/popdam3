-- Synthetic append-only history checks; disposable database transaction only.
do $$
declare privilege_name text;
begin
  foreach privilege_name in array array['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    if has_table_privilege('service_role','public.bulk_operation_runs',privilege_name) then
      raise exception 'service_role unexpectedly holds % on immutable history', privilege_name;
    end if;
  end loop;
  if not has_table_privilege('service_role','public.bulk_operation_runs','INSERT')
     or not has_table_privilege('service_role','public.bulk_operation_runs','SELECT') then
    raise exception 'worker cannot append and read its history';
  end if;
  if has_table_privilege('anon','public.bulk_operation_runs','SELECT')
     or has_table_privilege('authenticated','public.bulk_operation_runs','INSERT') then
    raise exception 'browser history privileges widened';
  end if;
end $$;
set local role service_role;
insert into public.bulk_operation_runs(operation,run_id,status,error,started_at)
values ('zztest-history','zztest-failed','failed','synthetic failure','2026-01-01T00:00:00Z');
insert into public.bulk_operation_runs(operation,run_id,status,started_at,ended_at)
values ('zztest-history','zztest-success','succeeded','2026-01-02T00:00:00Z','2026-01-02T01:00:00Z');
do $$
begin
  if (select count(*) from public.bulk_operation_runs where operation='zztest-history') <> 2
     or not exists (select 1 from public.bulk_operation_runs where operation='zztest-history' and run_id='zztest-failed' and error='synthetic failure') then
    raise exception 'later success erased earlier failed outcome';
  end if;
  begin
    update public.bulk_operation_runs set error='overwritten' where operation='zztest-history';
    raise exception 'history update was allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.bulk_operation_runs where operation='zztest-history';
    raise exception 'history deletion was allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.bulk_operation_runs(operation,run_id,status,error,started_at)
    values ('zztest-history','zztest-failed','failed','retry','2026-01-01T00:00:00Z');
    raise exception 'duplicate run was allowed';
  exception when unique_violation then null;
  end;
  begin
    insert into public.bulk_operation_runs(operation,run_id,status,started_at)
    values ('zztest-history','zztest-silent','failed','2026-01-03T00:00:00Z');
    raise exception 'silent failure was allowed';
  exception when check_violation then null;
  end;
end $$;
reset role;

-- Exercise the actual JWT-aware app role functions, not an always-true stub.
-- The surrounding database-contract harness owns BEGIN/ROLLBACK.
select set_config('request.jwt.claim.sub', 'a2439000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"a2439000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["administrator"]}}', true);
set local role authenticated;
do $$
begin
  if not app.has_any_role(array['administrator']::app.app_role[]) then
    raise exception 'administrator fixture did not resolve through real role helper';
  end if;
  if (select count(*) from public.bulk_operation_runs where operation='zztest-history') <> 2 then
    raise exception 'administrator cannot read retained history';
  end if;
  begin
    insert into public.bulk_operation_runs(operation,run_id,status,started_at)
    values ('zztest-history','zztest-browser','succeeded',now());
    raise exception 'administrator browser append was allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"a2439000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["viewer"]}}', true);
set local role authenticated;
do $$
begin
  if app.has_any_role(array['administrator']::app.app_role[]) then
    raise exception 'nonadministrator fixture unexpectedly has administrator role';
  end if;
  if exists (select 1 from public.bulk_operation_runs where operation='zztest-history') then
    raise exception 'ordinary browser can read private worker history';
  end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
begin
  begin
    perform 1 from public.bulk_operation_runs;
    raise exception 'anonymous history read was allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role service_role;
do $$
begin
  begin
    truncate public.bulk_operation_runs;
    raise exception 'worker history truncation was allowed';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.bulk_operation_runs where operation='zztest-history') <> 2 then
    raise exception 'history changed during role denial checks';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- Issue #2670 -- the terminal-status vocabulary must match what production emits,
-- and the failures index must actually carry the runs that went wrong.
--
-- Production (qsllyeztdwjgirsysgai, 2026-09-10) writes 'completed' for a finished
-- run and never writes 'succeeded'. It also writes live-state words -- 'idle' with
-- a null run_id -- which are NOT run outcomes and must still be refused. And
-- 'completed' is written for runs with per-item failures, so success is decided by
-- the succeeded column (status + progress->'failed'), never by the word alone.
--
-- The refusal counter below is the point: each negative case increments it only
-- from inside a check_violation handler, AND asserts which constraint fired, so a
-- refusal produced by the wrong constraint fails the test instead of being counted
-- as the intended one. If a rejection stopped rejecting, the bare `raise exception`
-- after the insert fires instead (SQLSTATE P0001, which the handler does not catch)
-- and this test fails. That is the primary failure mode and it is real. The final
-- row-count assertion is a second, weaker net: note that PL/pgSQL rolls a block's
-- successful INSERT back to its implicit savepoint before running an exception
-- handler, so a handler widened to `when others then refusals := refusals + 1` would
-- still reach 6 and leave no extra row -- which is exactly why each refusal is now
-- bound to its constraint name rather than to a bare SQLSTATE.
-- ---------------------------------------------------------------------------
set local role service_role;
do $$
declare
  refusals integer := 0;
  bad_status text;
  fired text;
  predicate text;
  admitted text;
  in_index boolean;
begin
  -- ALLOWED, AND A SUCCESS: the exact status and shape production produced for the
  -- nightly style-group rebuild on 2026-09-10, now carrying the failure counter the
  -- appender contract requires. No error and no reason_code, so this also proves
  -- bulk_operation_runs_failure_is_explained no longer demands an explanation from a
  -- clean success spelled 'completed'.
  insert into public.bulk_operation_runs
    (operation, run_id, status, source_status, progress, started_at, ended_at)
  values
    ('zztest-vocab', 'zztest-completed-clean', 'completed', 'completed',
     '{"groups": 35974, "assigned": 98035, "failed": 0, "skipped": 0}'::jsonb,
     '2026-09-10T06:00:03.776Z', '2026-09-10T08:12:40.259Z');

  if not exists (
       select 1 from public.bulk_operation_runs
        where operation = 'zztest-vocab' and run_id = 'zztest-completed-clean'
          and succeeded
          and source_status = 'completed') then
    raise exception 'live production success status was not classified as a success';
  end if;

  -- ALLOWED, AND NOT A SUCCESS: the partial-failure shape PopDAM also spells
  -- 'completed' ("Tagged 588. 1 skipped. 28 failed."). This is the H1 case: the run
  -- reached its end, 28 items failed, and it must NOT be filed as a success.
  insert into public.bulk_operation_runs
    (operation, run_id, status, source_status, progress, started_at, ended_at)
  values
    ('zztest-vocab', 'zztest-completed-partial', 'completed', 'completed',
     '{"processed": 588, "skipped": 1, "failed": 28}'::jsonb,
     '2026-09-10T06:00:00Z', '2026-09-10T06:30:00Z');

  if exists (
       select 1 from public.bulk_operation_runs
        where operation = 'zztest-vocab' and run_id = 'zztest-completed-partial'
          and succeeded) then
    raise exception 'a completed run with 28 item failures was classified as a success';
  end if;

  -- ALLOWED, still: the legacy explained failure. This widening must not narrow
  -- anything 20260909202801 published.
  insert into public.bulk_operation_runs
    (operation, run_id, status, error, started_at)
  values ('zztest-vocab', 'zztest-legacy-failed', 'failed', 'synthetic', now());

  -- THE STATUS MATRIX: one row per admitted status, with NO error, NO reason_code
  -- and NO counters. This pins exactly which words the database accepts unexplained,
  -- so any drift between the succeeded expression and
  -- bulk_operation_runs_failure_is_explained fails CI instead of passing silently.
  --   accepted: completed, interrupted, stopped, cancelled, succeeded
  --   refused : failed  (the one word that names no cause of its own)
  foreach admitted in array array['completed', 'interrupted', 'stopped',
                                  'cancelled', 'succeeded'] loop
    insert into public.bulk_operation_runs
      (operation, run_id, status, started_at)
    values ('zztest-vocab', 'zztest-bare-' || admitted, admitted, now());
  end loop;

  begin
    insert into public.bulk_operation_runs
      (operation, run_id, status, started_at)
    values ('zztest-vocab', 'zztest-bare-failed', 'failed', now());
    raise exception 'status failed was accepted with no error and no reason_code';
  exception when check_violation then
    get stacked diagnostics fired = constraint_name;
    if fired <> 'bulk_operation_runs_failure_is_explained' then
      raise exception 'unexplained failed was refused by %, not the explanation constraint', fired;
    end if;
    refusals := refusals + 1;
  end;

  -- Only the two unconditional/clean successes classify as succeeded: the bare
  -- 'succeeded' row and the completed run that reported zero failures. Every other
  -- accepted row -- including both bare 'completed' (no counter declared) and the
  -- partial-failure 'completed' -- is a non-success.
  if (select count(*) from public.bulk_operation_runs
       where operation = 'zztest-vocab' and succeeded) <> 2 then
    raise exception 'success classification does not cover exactly the two clean successes';
  end if;

  -- REFUSED: live-state words are not outcomes. 'idle' is the one production has
  -- sitting in seven operation keys right now, every one with a null run_id.
  foreach bad_status in array array['idle', 'running', 'stop_requested', 'stopping'] loop
    begin
      insert into public.bulk_operation_runs
        (operation, run_id, status, error, started_at)
      values ('zztest-vocab', 'zztest-bad-' || bad_status, bad_status, 'synthetic', now());
      raise exception 'non-terminal live status % was accepted into the run history', bad_status;
    exception when check_violation then
      get stacked diagnostics fired = constraint_name;
      if fired <> 'bulk_operation_runs_status_is_terminal_outcome' then
        raise exception 'live status % was refused by %, not the vocabulary constraint',
          bad_status, fired;
      end if;
      refusals := refusals + 1;
    end;
  end loop;

  -- REFUSED: a blank raw status is not evidence of anything.
  begin
    insert into public.bulk_operation_runs
      (operation, run_id, status, source_status, progress, started_at)
    values ('zztest-vocab', 'zztest-blank-source', 'completed', '   ',
            '{"failed": 0}'::jsonb, now());
    raise exception 'blank source_status was accepted';
  exception when check_violation then
    get stacked diagnostics fired = constraint_name;
    if fired <> 'bulk_operation_runs_source_status_not_blank' then
      raise exception 'blank source_status was refused by %, not the not-blank constraint', fired;
    end if;
    refusals := refusals + 1;
  end;

  if refusals <> 6 then
    raise exception 'expected 6 vocabulary refusals, observed % -- a guard is not firing', refusals;
  end if;

  if (select count(*) from public.bulk_operation_runs where operation = 'zztest-vocab') <> 8 then
    raise exception 'a refused row was written to the run history anyway';
  end if;

  -- THE FAILURES INDEX ITSELF. The index is the subject of this change, so assert
  -- the object in the catalog, not just the column value: the predicate must be the
  -- classification column, and the actual rows must fall on the sides the predicate
  -- puts them. The predicate is evaluated dynamically against each row, so this
  -- fails if the index is missing, if `create index if not exists` no-opped against a
  -- stale index of the same name, or if the old `where status <> 'succeeded'`
  -- predicate were left standing.
  select pg_get_expr(i.indpred, i.indrelid)
    into predicate
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'bulk_operation_runs_failures_idx';

  if predicate is null then
    raise exception 'bulk_operation_runs_failures_idx is missing or is not a partial index';
  end if;
  if predicate !~ 'succeeded' or predicate ~ '''succeeded''' then
    raise exception 'failures index predicate is not the classification column: %', predicate;
  end if;

  foreach admitted in array array['zztest-completed-clean', 'zztest-bare-succeeded',
                                  'zztest-completed-partial', 'zztest-bare-interrupted',
                                  'zztest-bare-completed', 'zztest-legacy-failed'] loop
    execute format(
      'select exists (select 1 from public.bulk_operation_runs
                       where operation = %L and run_id = %L and (%s))',
      'zztest-vocab', admitted, predicate)
      into in_index;
    if admitted in ('zztest-completed-clean', 'zztest-bare-succeeded') then
      if in_index then
        raise exception 'success row % is listed in the failures index', admitted;
      end if;
    else
      if not in_index then
        raise exception 'non-success row % is missing from the failures index', admitted;
      end if;
    end if;
  end loop;
end $$;
reset role;
