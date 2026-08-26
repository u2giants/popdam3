-- Issue #1184 phase 1 — contract tests for the Coldlion raw landing SPINE.
--
-- Proves the structure, the constraints, the indexes, RLS, and the ABSENCE of any
-- application grant. Every fixture below is invented and rolled back; nothing here
-- depends on a single pre-existing row, because CI replays every migration into an
-- EMPTY database and runs this file against that.

begin;

-- =====================================================================================
-- A. The schema exists, is documented, and is not reachable by an application role.
-- =====================================================================================
do $$
declare
  v_comment text;
begin
  if to_regnamespace('coldlion') is null then
    raise exception 'A FAILED: schema coldlion does not exist';
  end if;

  select obj_description(oid, 'pg_namespace') into v_comment
  from pg_namespace where nspname = 'coldlion';
  if v_comment is null
     or v_comment not ilike '%no grants to application roles%'
     or v_comment not ilike '%raw%' then
    raise exception 'A FAILED: schema comment does not state the landing-layer contract: %', v_comment;
  end if;

  if has_schema_privilege('anon', 'coldlion', 'USAGE')
     or has_schema_privilege('authenticated', 'coldlion', 'USAGE') then
    raise exception 'A FAILED: an application role has USAGE on schema coldlion';
  end if;

  if not has_schema_privilege('service_role', 'coldlion', 'USAGE') then
    raise exception 'A FAILED: service_role (the loader) cannot use schema coldlion';
  end if;

  raise notice 'A PASSED: schema coldlion exists, is documented, and is loader-only.';
end;
$$;

-- =====================================================================================
-- B. The three spine tables exist. Later phases may add feed tables.
-- =====================================================================================
do $$
declare
  v_tables text[];
begin
  select coalesce(array_agg(c.relname order by c.relname), '{}')
    into v_tables
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'coldlion' and c.relkind = 'r';

  if not array['change_log', 'sync_run', 'window_ledger'] <@ v_tables then
    raise exception 'B FAILED: one or more ColdLion spine tables are missing: %', v_tables;
  end if;

  raise notice 'B PASSED: sync_run, window_ledger and change_log exist; later feed tables are permitted.';
end;
$$;

-- =====================================================================================
-- C. RLS is on, application grants are absent, service_role has what a loader needs.
-- =====================================================================================
do $$
declare
  v_table text;
  v_role  text;
  v_priv  text;
begin
  foreach v_table in array array['sync_run', 'window_ledger', 'change_log'] loop
    if not (select relrowsecurity from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'coldlion' and c.relname = v_table) then
      raise exception 'C FAILED: RLS is not enabled on coldlion.%', v_table;
    end if;

    -- No policies at all: this layer is not row-filtered for applications, it is
    -- closed to them.
    if exists (select 1 from pg_policies
               where schemaname = 'coldlion' and tablename = v_table) then
      raise exception 'C FAILED: coldlion.% carries an RLS policy; the spine is closed, not filtered', v_table;
    end if;

    foreach v_role in array array['anon', 'authenticated'] loop
      foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
        if has_table_privilege(v_role, format('coldlion.%I', v_table), v_priv) then
          raise exception 'C FAILED: % has % on coldlion.% - no application role may reach this layer',
            v_role, v_priv, v_table;
        end if;
      end loop;
    end loop;

    -- PUBLIC is not a role and cannot be asked with has_table_privilege, so read the
    -- ACL directly. A grant to PUBLIC would reach every role in the database at once.
    if exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      where n.nspname = 'coldlion' and c.relname = v_table and a.grantee = 0
    ) then
      raise exception 'C FAILED: coldlion.% carries a grant to PUBLIC', v_table;
    end if;

    foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE'] loop
      if not has_table_privilege('service_role', format('coldlion.%I', v_table), v_priv) then
        raise exception 'C FAILED: service_role lacks % on coldlion.%', v_priv, v_table;
      end if;
    end loop;
  end loop;

  raise notice 'C PASSED: RLS on, no policies, no application grants, loader can write.';
end;
$$;

-- =====================================================================================
-- D. No foreign key leaves the coldlion schema. This layer never references core.*.
-- =====================================================================================
do $$
declare
  v_offenders text;
begin
  select string_agg(format('%s -> %s', conrelid::regclass, confrelid::regclass), ', ')
    into v_offenders
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_class fc on fc.oid = con.confrelid
  join pg_namespace fn on fn.oid = fc.relnamespace
  where con.contype = 'f' and n.nspname = 'coldlion' and fn.nspname <> 'coldlion';

  if v_offenders is not null then
    raise exception 'D FAILED: coldlion has a foreign key out of the schema: %', v_offenders;
  end if;

  raise notice 'D PASSED: no foreign key leaves coldlion.';
end;
$$;

-- =====================================================================================
-- E. No resolution/matching columns anywhere, and no invented active structure.
-- `active` itself is permitted when it is a field returned by ColdLion and selected
-- by the owner (D4). In particular merchGroupDetails.active was verified live on
-- 2026-08-20. Curated `is_active`/`active_flag` columns remain forbidden.
-- =====================================================================================
do $$
declare
  v_offenders text;
begin
  select string_agg(format('%s.%s', table_name, column_name), ', ')
    into v_offenders
  from information_schema.columns
  where table_schema = 'coldlion'
    and (
      column_name in (
        'resolution_status', 'resolved_by', 'resolved_at', 'match_status',
        'licensor_id', 'property_id', 'core_id', 'is_active',
        'active_flag', 'parent_licensor_code'
      )
      or column_name like 'resolved%'
      or column_name like 'match_%'
    );

  if v_offenders is not null then
    raise exception 'E FAILED: the landing layer carries curation or invented structure: %', v_offenders;
  end if;

  raise notice 'E PASSED: no resolution columns, invented active flag, or licensor-property link.';
end;
$$;

-- =====================================================================================
-- F. sync_run: the columns and indexes the loader contract depends on.
-- =====================================================================================
do $$
declare
  v_missing text;
  v_comment text;
begin
  select string_agg(needed, ', ') into v_missing
  from unnest(array[
    'id', 'endpoint', 'company_code', 'division_code', 'request_params',
    'window_from', 'window_to', 'status', 'requested_by', 'started_at',
    'finished_at', 'duration_ms', 'http_status', 'body_status',
    'rows_fetched', 'rows_inserted', 'rows_updated', 'rows_unchanged',
    'error_message', 'notes', 'created_at'
  ]) as needed
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'coldlion' and table_name = 'sync_run' and column_name = needed
  );
  if v_missing is not null then
    raise exception 'F FAILED: coldlion.sync_run is missing column(s): %', v_missing;
  end if;

  -- The malformed error contract must be recorded, not just remembered.
  select col_description('coldlion.sync_run'::regclass,
           (select ordinal_position from information_schema.columns
             where table_schema='coldlion' and table_name='sync_run' and column_name='http_status')::int)
    into v_comment;
  if v_comment is null or v_comment not ilike '%wire%' then
    raise exception 'F FAILED: http_status does not document that the WIRE status is the one to branch on';
  end if;

  foreach v_comment in array array[
    'coldlion_sync_run_endpoint_started_idx',
    'coldlion_sync_run_status_started_idx',
    'coldlion_sync_run_window_idx'
  ] loop
    if to_regclass('coldlion.' || v_comment) is null then
      raise exception 'F FAILED: index % is missing', v_comment;
    end if;
  end loop;

  raise notice 'F PASSED: sync_run shape, evidence columns and indexes are present.';
end;
$$;

-- =====================================================================================
-- G. sync_run behaviour: windows, the 7-day cap, the 1900 marker, loud failures.
-- =====================================================================================
do $$
declare
  v_run uuid;
begin
  -- A plain, non-history run needs no window.
  insert into coldlion.sync_run (endpoint, company_code, requested_by, request_params)
  values ('/merchGroupDetails', 'ZZTEST', 'ZZTEST', '{"companyCode":"ZZTEST"}'::jsonb)
  returning id into v_run;

  -- A legal 7-day inclusive window.
  insert into coldlion.sync_run (endpoint, company_code, requested_by, window_from, window_to)
  values ('/prodHistory', 'ZZTEST', 'ZZTEST', date '2026-01-01', date '2026-01-07');

  -- A single day is legal too (from == to returned HTTP 200 on the live API).
  insert into coldlion.sync_run (endpoint, company_code, requested_by, window_from, window_to)
  values ('/prodHistory', 'ZZTEST', 'ZZTEST', date '2026-01-01', date '2026-01-01');

  begin
    insert into coldlion.sync_run (endpoint, company_code, requested_by, window_from, window_to)
    values ('/prodHistory', 'ZZTEST', 'ZZTEST', date '2026-01-01', date '2026-01-08');
    raise exception 'G FAILED: an 8-day window was accepted; Coldlion refuses anything over 7';
  exception when check_violation then null;
  end;

  begin
    insert into coldlion.sync_run (endpoint, company_code, requested_by, window_from)
    values ('/prodHistory', 'ZZTEST', 'ZZTEST', date '2026-01-01');
    raise exception 'G FAILED: half a window was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into coldlion.sync_run (endpoint, company_code, requested_by, window_from, window_to)
    values ('/prodHistory', 'ZZTEST', 'ZZTEST', date '1900-01-01', date '1900-01-07');
    raise exception 'G FAILED: 1900-01-01 was accepted as a request window; it is the empty-date marker';
  exception when check_violation then null;
  end;

  begin
    insert into coldlion.sync_run (endpoint, requested_by)
    values ('prodHistory', 'ZZTEST');
    raise exception 'G FAILED: an endpoint that is not a path was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into coldlion.sync_run (endpoint, requested_by, request_params)
    values ('/items', 'ZZTEST', '[]'::jsonb);
    raise exception 'G FAILED: request_params accepted a non-object';
  exception when check_violation then null;
  end;

  -- No silent failures: a failed run must carry its reason.
  begin
    update coldlion.sync_run set status = 'failed' where id = v_run;
    raise exception 'G FAILED: a run was marked failed with no error_message';
  exception when check_violation then null;
  end;

  update coldlion.sync_run
     set status = 'failed', error_message = 'ZZTEST refusal', http_status = 400, body_status = 500
   where id = v_run;

  begin
    update coldlion.sync_run set rows_inserted = -1 where id = v_run;
    raise exception 'G FAILED: a negative row count was accepted';
  exception when check_violation then null;
  end;

  raise notice 'G PASSED: sync_run enforces the window cap, the 1900 marker and loud failure.';
end;
$$;

-- =====================================================================================
-- H. window_ledger behaviour: exactly 7 days on one fixed grid, one row per start,
-- evidenced outcomes.
-- =====================================================================================
do $$
declare
  v_run uuid;
  v_updated_before timestamptz;
  v_updated_after timestamptz;
begin
  insert into coldlion.sync_run (endpoint, company_code, requested_by, window_from, window_to)
  values ('/prodHistory', 'ZZTEST', 'ZZTEST', date '2026-02-03', date '2026-02-09')
  returning id into v_run;

  insert into coldlion.window_ledger (endpoint, company_code, window_from, window_to)
  values ('/prodHistory', 'ZZTEST', date '2026-02-03', date '2026-02-09');

  -- Exactly seven days, not "at most".
  begin
    insert into coldlion.window_ledger (endpoint, company_code, window_from, window_to)
    values ('/prodHistory', 'ZZTEST', date '2026-03-03', date '2026-03-06');
    raise exception 'H FAILED: a short window was accepted; a gap either side would be invisible';
  exception when check_violation then null;
  end;

  -- Only the two capped endpoints have windows at all.
  begin
    insert into coldlion.window_ledger (endpoint, company_code, window_from, window_to)
    values ('/items', 'ZZTEST', date '2026-03-03', date '2026-03-09');
    raise exception 'H FAILED: a non-history endpoint was given a window ledger row';
  exception when check_violation then null;
  end;

  -- One row per (endpoint, company, start).
  begin
    insert into coldlion.window_ledger (endpoint, company_code, window_from, window_to)
    values ('/prodHistory', 'ZZTEST', date '2026-02-03', date '2026-02-09');
    raise exception 'H FAILED: the same window was recorded twice';
  exception when unique_violation then null;
  end;

  -- A shifted seven-day window would overlap the fixed backfill grid even though
  -- its start differs, so the anchor constraint must reject it.
  begin
    insert into coldlion.window_ledger (endpoint, company_code, window_from, window_to)
    values ('/prodHistory', 'ZZTEST', date '2026-02-05', date '2026-02-11');
    raise exception 'H FAILED: a shifted overlapping seven-day grid was accepted';
  exception when check_violation then null;
  end;

  -- A failed window must say why; a loaded window must carry its evidence.
  begin
    update coldlion.window_ledger set state = 'failed'
     where endpoint = '/prodHistory' and company_code = 'ZZTEST' and window_from = date '2026-02-03';
    raise exception 'H FAILED: a window failed silently';
  exception when check_violation then null;
  end;

  begin
    update coldlion.window_ledger set state = 'loaded'
     where endpoint = '/prodHistory' and company_code = 'ZZTEST' and window_from = date '2026-02-03';
    raise exception 'H FAILED: a window was marked loaded with no row count, time or run';
  exception when check_violation then null;
  end;

  begin
    update coldlion.window_ledger set state = 'archived'
     where endpoint = '/prodHistory' and company_code = 'ZZTEST' and window_from = date '2026-02-03';
    raise exception 'H FAILED: an unknown state was accepted';
  exception when check_violation then null;
  end;

  -- The trigger must overwrite whatever the caller supplies. now() is fixed for the
  -- whole transaction, so "later than before" proves nothing here; "not the stale value
  -- the caller wrote" does.
  select updated_at into v_updated_before from coldlion.window_ledger
   where endpoint = '/prodHistory' and company_code = 'ZZTEST' and window_from = date '2026-02-03';

  update coldlion.window_ledger
     set state = 'loaded', row_count = 265, loaded_at = now(), last_run_id = v_run,
         attempt_count = 1, updated_at = timestamptz '2000-01-01Z'
   where endpoint = '/prodHistory' and company_code = 'ZZTEST' and window_from = date '2026-02-03';

  select updated_at into v_updated_after from coldlion.window_ledger
   where endpoint = '/prodHistory' and company_code = 'ZZTEST' and window_from = date '2026-02-03';

  if v_updated_after = timestamptz '2000-01-01Z' or v_updated_after < v_updated_before then
    raise exception 'H FAILED: the set_updated_at trigger did not fire (before %, after %)',
      v_updated_before, v_updated_after;
  end if;

  raise notice 'H PASSED: window_ledger enforces one anchored 7-day grid, unique starts and evidenced outcomes.';
end;
$$;

-- =====================================================================================
-- I. change_log: four-part keys survive whole, hashes are one algorithm, no non-changes.
-- =====================================================================================
do $$
declare
  v_run uuid;
  v_hash_a constant text := repeat('a', 64);
  v_hash_b constant text := repeat('b', 64);
begin
  insert into coldlion.sync_run (endpoint, company_code, requested_by)
  values ('/merchGroupDetails', 'ZZTEST', 'ZZTEST')
  returning id into v_run;

  -- The four-part merch-group key, recorded whole. `1P` is both a licensor and a
  -- property in CW001, so mg_type_code is part of identity and is never assumed.
  insert into coldlion.change_log
    (table_name, natural_key, change_kind, new_source_hash, new_raw, run_id)
  values (
    'merch_group_detail',
    '{"company_code":"ZZTEST","division_code":"ZZ001","mg_type_code":"05","mg_code":"1P"}'::jsonb,
    'inserted', v_hash_a, '{"mgCode":"1P","mgTypeCode":"05"}'::jsonb, v_run);

  -- A different mg_type_code with the SAME mg_code is a different row, not a conflict.
  insert into coldlion.change_log
    (table_name, natural_key, change_kind, new_source_hash, new_raw, run_id)
  values (
    'merch_group_detail',
    '{"company_code":"ZZTEST","division_code":"ZZ001","mg_type_code":"06","mg_code":"1P"}'::jsonb,
    'inserted', v_hash_b, '{"mgCode":"1P","mgTypeCode":"06"}'::jsonb, v_run);

  if (select count(*) from coldlion.change_log
       where table_name = 'merch_group_detail'
         and natural_key @> '{"mg_code":"1P"}'::jsonb) <> 2 then
    raise exception 'I FAILED: the four-part key did not keep two distinct 1P rows apart';
  end if;

  -- An update must carry both sides.
  insert into coldlion.change_log
    (table_name, natural_key, change_kind, previous_source_hash, previous_raw,
     new_source_hash, new_raw, run_id)
  values ('customer', '{"company_code":"ZZTEST","customer_code":"ZZ1"}'::jsonb,
          'updated', v_hash_a, '{"name":"old"}'::jsonb, v_hash_b, '{"name":"new"}'::jsonb, v_run);

  begin
    insert into coldlion.change_log
      (table_name, natural_key, change_kind, new_source_hash, new_raw, run_id)
    values ('customer', '{"company_code":"ZZTEST","customer_code":"ZZ2"}'::jsonb,
            'updated', v_hash_b, '{"name":"new"}'::jsonb, v_run);
    raise exception 'I FAILED: an update was recorded with no previous payload';
  exception when check_violation then null;
  end;

  -- Identical hashes are not a change and must not be recordable as one.
  begin
    insert into coldlion.change_log
      (table_name, natural_key, change_kind, previous_source_hash, previous_raw,
       new_source_hash, new_raw, run_id)
    values ('customer', '{"company_code":"ZZTEST","customer_code":"ZZ3"}'::jsonb,
            'updated', v_hash_a, '{"name":"same"}'::jsonb, v_hash_a, '{"name":"same"}'::jsonb, v_run);
    raise exception 'I FAILED: a no-op was recorded as a change';
  exception when check_violation then null;
  end;

  -- An insert has no previous side.
  begin
    insert into coldlion.change_log
      (table_name, natural_key, change_kind, previous_source_hash, previous_raw,
       new_source_hash, new_raw, run_id)
    values ('customer', '{"company_code":"ZZTEST","customer_code":"ZZ4"}'::jsonb,
            'inserted', v_hash_a, '{"name":"old"}'::jsonb, v_hash_b, '{"name":"new"}'::jsonb, v_run);
    raise exception 'I FAILED: a first sighting was allowed a previous payload';
  exception when check_violation then null;
  end;

  -- One hash algorithm across the whole schema: an md5 is not accepted.
  begin
    insert into coldlion.change_log
      (table_name, natural_key, change_kind, new_source_hash, new_raw, run_id)
    values ('customer', '{"company_code":"ZZTEST","customer_code":"ZZ5"}'::jsonb,
            'inserted', md5('ZZTEST'), '{}'::jsonb, v_run);
    raise exception 'I FAILED: a non-SHA-256 hash was accepted';
  exception when check_violation then null;
  end;

  -- The natural key is an object with content, never a string and never empty.
  begin
    insert into coldlion.change_log
      (table_name, natural_key, change_kind, new_source_hash, new_raw, run_id)
    values ('customer', '"ZZTEST|ZZ6"'::jsonb, 'inserted', v_hash_a, '{}'::jsonb, v_run);
    raise exception 'I FAILED: a flattened string key was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into coldlion.change_log
      (table_name, natural_key, change_kind, new_source_hash, new_raw, run_id)
    values ('customer', '{}'::jsonb, 'inserted', v_hash_a, '{}'::jsonb, v_run);
    raise exception 'I FAILED: an empty key was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into coldlion.change_log
      (table_name, natural_key, change_kind, new_source_hash, new_raw, run_id)
    values ('Customer', '{"company_code":"ZZTEST"}'::jsonb, 'inserted', v_hash_a, '{}'::jsonb, v_run);
    raise exception 'I FAILED: an unnormalised table_name was accepted';
  exception when check_violation then null;
  end;

  -- Every change is traceable to the run that saw it.
  begin
    insert into coldlion.change_log
      (table_name, natural_key, change_kind, new_source_hash, new_raw, run_id)
    values ('customer', '{"company_code":"ZZTEST"}'::jsonb, 'inserted', v_hash_a, '{}'::jsonb,
            '00000000-0000-0000-0000-000000000000'::uuid);
    raise exception 'I FAILED: a change was recorded against a run that does not exist';
  exception when foreign_key_violation then null;
  end;

  if to_regclass('coldlion.coldlion_change_log_natural_key_idx') is null
     or to_regclass('coldlion.coldlion_change_log_table_changed_idx') is null
     or to_regclass('coldlion.coldlion_change_log_run_idx') is null then
    raise exception 'I FAILED: a change_log index is missing';
  end if;

  raise notice 'I PASSED: change_log keeps four-part keys whole, one hash algorithm, no no-ops.';
end;
$$;

-- =====================================================================================
-- J. The change trail cannot be erased by deleting the run that produced it.
-- =====================================================================================
do $$
declare
  v_run uuid;
begin
  insert into coldlion.sync_run (endpoint, company_code, requested_by)
  values ('/customers', 'ZZTEST', 'ZZTEST')
  returning id into v_run;

  insert into coldlion.change_log
    (table_name, natural_key, change_kind, new_source_hash, new_raw, run_id)
  values ('customer', '{"company_code":"ZZTEST","customer_code":"ZZ9"}'::jsonb,
          'inserted', repeat('c', 64), '{"name":"zztest"}'::jsonb, v_run);

  begin
    delete from coldlion.sync_run where id = v_run;
    raise exception 'J FAILED: deleting a run silently erased its change trail';
  exception when foreign_key_violation then null;
  end;

  raise notice 'J PASSED: the change trail outlives any attempt to delete its run.';
end;
$$;

rollback;
