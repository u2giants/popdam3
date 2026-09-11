-- Contract tests for the ColdLion MASTER landing tables.
-- Issue #2094 — the six master tables (sections A-I).
-- Issue #2171 — coldlion.division, the durable division dictionary (sections J-M).
--
-- Migrations: 20260902054548_coldlion_master_landing_season_salesperson.sql (A-I)
--             20260903200951_coldlion_division_reference_table.sql       (J-M, issue #2171)
--
-- Everything below is invented and rolled back. No fixture depends on a
-- pre-existing row, because CI replays every migration into an EMPTY database
-- and runs this file against that. Every literal is a labelled synthetic value
-- (ZZTEST / ZZ*), never a real company, division, customer, vendor or code.
-- The one real-world literal referenced is the `1P` / `CW001` key collision,
-- which is already published in docs/coldlion-raw-landing-schema-design.md §3.1
-- as evidence that merchandise-group identity is multi-dimensional.

begin;

-- =====================================================================================
-- A. All six master tables exist and carry EXACTLY their designed natural key.
--    A collapsed key is the defect this test exists to catch.
-- =====================================================================================
do $$
declare
  v_table  text;
  v_keydef text;
  v_expected constant jsonb := jsonb_build_object(
    'customer',           'PRIMARY KEY (company_code, customer_code)',
    'vendor',             'PRIMARY KEY (company_code, vendor_code)',
    'merch_group_header', 'PRIMARY KEY (company_code, division_code, mg_type_code)',
    'merch_group_detail', 'PRIMARY KEY (company_code, division_code, mg_type_code, mg_category, mg_code)',
    'season',             'PRIMARY KEY (company_code, division_code, season_code)',
    'salesperson',        'PRIMARY KEY (company_code, salesperson_code)'
  );
begin
  foreach v_table in array array[
    'customer','vendor','merch_group_header','merch_group_detail','season','salesperson'
  ] loop
    if to_regclass('coldlion.' || v_table) is null then
      raise exception 'A FAILED: coldlion.% does not exist', v_table;
    end if;

    select pg_get_constraintdef(oid) into v_keydef
    from pg_constraint
    where conrelid = ('coldlion.' || v_table)::regclass and contype = 'p';

    if v_keydef is distinct from (v_expected ->> v_table) then
      raise exception 'A FAILED: coldlion.% natural key is %, expected %',
        v_table, coalesce(v_keydef, '<none>'), (v_expected ->> v_table);
    end if;
  end loop;

  raise notice 'A PASSED: six master tables, each with its designed natural key.';
end;
$$;

-- =====================================================================================
-- B. The five-part merch-group key BEHAVES. Category is part of source identity,
--    so rows that share the former four-part key survive independently. The
--    three-column relationship to merch_group_header remains enforced.
-- =====================================================================================
do $$
declare
  v_run uuid;
  v_now constant timestamptz := now();
  v_hash_a constant text := repeat('a', 64);
  v_hash_b constant text := repeat('b', 64);
begin
  insert into coldlion.sync_run (endpoint, company_code, requested_by)
  values ('/merchGroupDetails', 'ZZTEST', 'ZZTEST') returning id into v_run;

  insert into coldlion.merch_group_header
    (company_code, division_code, mg_type_code, run_id, fetched_at,
     source_hash, first_seen_at, last_seen_at)
  values
    ('ZZTEST', 'ZZ001', 'Z5', v_run, v_now, v_hash_a, v_now, v_now),
    ('ZZTEST', 'ZZ001', 'Z6', v_run, v_now, v_hash_b, v_now, v_now);

  insert into coldlion.merch_group_detail
    (company_code, division_code, mg_type_code, mg_category, mg_code, run_id, fetched_at,
     source_hash, first_seen_at, last_seen_at)
  values
    ('ZZTEST', 'ZZ001', 'Z5', 'ZA', 'ZP', v_run, v_now, v_hash_a, v_now, v_now),
    ('ZZTEST', 'ZZ001', 'Z5', 'ZB', 'ZP', v_run, v_now, v_hash_b, v_now, v_now),
    ('ZZTEST', 'ZZ001', 'Z6', 'ZA', 'ZP', v_run, v_now, v_hash_b, v_now, v_now);

  if (select count(*) from coldlion.merch_group_detail
       where company_code = 'ZZTEST' and division_code = 'ZZ001' and mg_code = 'ZP') <> 3 then
    raise exception 'B FAILED: type/category identity dimensions collapsed distinct rows';
  end if;

  -- The full five-part key remains unique.
  begin
    insert into coldlion.merch_group_detail
      (company_code, division_code, mg_type_code, mg_category, mg_code, run_id, fetched_at,
       source_hash, first_seen_at, last_seen_at)
    values ('ZZTEST', 'ZZ001', 'Z5', 'ZA', 'ZP', v_run, v_now, v_hash_a, v_now, v_now);
    raise exception 'B FAILED: the same five-part key was accepted twice';
  exception when unique_violation then null;
  end;

  -- Category is mandatory because it participates in durable source identity.
  begin
    insert into coldlion.merch_group_detail
      (company_code, division_code, mg_type_code, mg_code, run_id, fetched_at,
       source_hash, first_seen_at, last_seen_at)
    values ('ZZTEST', 'ZZ001', 'Z5', 'ZN', v_run, v_now, v_hash_a, v_now, v_now);
    raise exception 'B FAILED: a null merchandise-group category was accepted';
  exception when not_null_violation then null;
  end;

  -- The repaired key must not weaken the existing header relationship.
  begin
    insert into coldlion.merch_group_detail
      (company_code, division_code, mg_type_code, mg_category, mg_code, run_id, fetched_at,
       source_hash, first_seen_at, last_seen_at)
    values ('ZZTEST', 'ZZ001', 'Z7', 'ZA', 'ZP', v_run, v_now, v_hash_a, v_now, v_now);
    raise exception 'B FAILED: a detail without its merchandise-group header was accepted';
  exception when foreign_key_violation then null;
  end;

  raise notice 'B PASSED: type and category preserve detail identity and the header link remains enforced.';
end;
$$;

-- =====================================================================================
-- C. season and salesperson: natural key uniqueness, and the landing invariants.
-- =====================================================================================
do $$
declare
  v_run uuid;
  v_now constant timestamptz := now();
  v_hash constant text := repeat('c', 64);
begin
  insert into coldlion.sync_run (endpoint, company_code, requested_by)
  values ('/seasons', 'ZZTEST', 'ZZTEST') returning id into v_run;

  insert into coldlion.season
    (company_code, division_code, season_code, run_id, fetched_at,
     source_hash, first_seen_at, last_seen_at)
  values ('ZZTEST', 'ZZ001', 'ZS1', v_run, v_now, v_hash, v_now, v_now);

  -- The same season code in a DIFFERENT division is a different row: season is
  -- division-scoped, and a two-part key would have merged these.
  insert into coldlion.season
    (company_code, division_code, season_code, run_id, fetched_at,
     source_hash, first_seen_at, last_seen_at)
  values ('ZZTEST', 'ZZ002', 'ZS1', v_run, v_now, v_hash, v_now, v_now);

  if (select count(*) from coldlion.season
       where company_code = 'ZZTEST' and season_code = 'ZS1') <> 2 then
    raise exception 'C FAILED: season is not division-scoped';
  end if;

  begin
    insert into coldlion.season
      (company_code, division_code, season_code, run_id, fetched_at,
       source_hash, first_seen_at, last_seen_at)
    values ('ZZTEST', 'ZZ001', 'ZS1', v_run, v_now, v_hash, v_now, v_now);
    raise exception 'C FAILED: a duplicate season natural key was accepted';
  exception when unique_violation then null;
  end;

  -- EP001 is excluded from the landing layer.
  begin
    insert into coldlion.season
      (company_code, division_code, season_code, run_id, fetched_at,
       source_hash, first_seen_at, last_seen_at)
    values ('ZZTEST', 'EP001', 'ZS9', v_run, v_now, v_hash, v_now, v_now);
    raise exception 'C FAILED: an EP001 season row was accepted';
  exception when check_violation then null;
  end;

  insert into coldlion.salesperson
    (company_code, salesperson_code, last_name, run_id, fetched_at,
     source_hash, first_seen_at, last_seen_at)
  values ('ZZTEST', 'ZR1', 'ZZTEST-LASTNAME', v_run, v_now, v_hash, v_now, v_now);

  begin
    insert into coldlion.salesperson
      (company_code, salesperson_code, run_id, fetched_at,
       source_hash, first_seen_at, last_seen_at)
    values ('ZZTEST', 'ZR1', v_run, v_now, v_hash, v_now, v_now);
    raise exception 'C FAILED: a duplicate salesperson natural key was accepted';
  exception when unique_violation then null;
  end;

  raise notice 'C PASSED: season and salesperson enforce their natural keys.';
end;
$$;

-- =====================================================================================
-- D. Landing invariants on the two new tables: one hash algorithm, sightings
--    ordered, and every row traceable to the run that saw it.
-- =====================================================================================
do $$
declare
  v_run uuid;
  v_now constant timestamptz := now();
  v_hash constant text := repeat('d', 64);
begin
  insert into coldlion.sync_run (endpoint, company_code, requested_by)
  values ('/salespersons', 'ZZTEST', 'ZZTEST') returning id into v_run;

  -- One hash algorithm across the schema: an md5 is not a SHA-256.
  begin
    insert into coldlion.salesperson
      (company_code, salesperson_code, run_id, fetched_at,
       source_hash, first_seen_at, last_seen_at)
    values ('ZZTEST', 'ZR2', v_run, v_now, md5('ZZTEST'), v_now, v_now);
    raise exception 'D FAILED: a non-SHA-256 source_hash was accepted on salesperson';
  exception when check_violation then null;
  end;

  begin
    insert into coldlion.season
      (company_code, division_code, season_code, run_id, fetched_at,
       source_hash, first_seen_at, last_seen_at)
    values ('ZZTEST', 'ZZ003', 'ZS2', v_run, v_now, md5('ZZTEST'), v_now, v_now);
    raise exception 'D FAILED: a non-SHA-256 source_hash was accepted on season';
  exception when check_violation then null;
  end;

  -- last_seen_at can never precede first_seen_at.
  begin
    insert into coldlion.season
      (company_code, division_code, season_code, run_id, fetched_at,
       source_hash, first_seen_at, last_seen_at)
    values ('ZZTEST', 'ZZ003', 'ZS3', v_run, v_now, v_hash, v_now, v_now - interval '1 day');
    raise exception 'D FAILED: last_seen_at was allowed to precede first_seen_at on season';
  exception when check_violation then null;
  end;

  begin
    insert into coldlion.salesperson
      (company_code, salesperson_code, run_id, fetched_at,
       source_hash, first_seen_at, last_seen_at)
    values ('ZZTEST', 'ZR3', v_run, v_now, v_hash, v_now, v_now - interval '1 day');
    raise exception 'D FAILED: last_seen_at was allowed to precede first_seen_at on salesperson';
  exception when check_violation then null;
  end;

  -- Every landed row names the run that produced it.
  begin
    insert into coldlion.salesperson
      (company_code, salesperson_code, run_id, fetched_at,
       source_hash, first_seen_at, last_seen_at)
    values ('ZZTEST', 'ZR4', '00000000-0000-0000-0000-000000000000'::uuid,
            v_now, v_hash, v_now, v_now);
    raise exception 'D FAILED: a salesperson row was landed against a run that does not exist';
  exception when foreign_key_violation then null;
  end;

  raise notice 'D PASSED: one hash algorithm, ordered sightings, run-traceable rows.';
end;
$$;

-- =====================================================================================
-- E. The common landing columns are present on all six master tables, and no
--    per-row `raw` archive leaked back in (owner decision D5).
-- =====================================================================================
do $$
declare
  v_missing text;
begin
  select string_agg(format('%s.%s', t.name, c.needed), ', ')
    into v_missing
  from unnest(array['customer','vendor','merch_group_header','merch_group_detail',
                    'season','salesperson']) as t(name)
  cross join unnest(array['run_id','fetched_at','source_hash',
                          'first_seen_at','last_seen_at']) as c(needed)
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'coldlion' and table_name = t.name and column_name = c.needed
  );

  if v_missing is not null then
    raise exception 'E FAILED: missing common landing column(s): %', v_missing;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'coldlion'
      and table_name in ('customer','vendor','merch_group_header','merch_group_detail',
                         'season','salesperson')
      and column_name = 'raw'
  ) then
    raise exception 'E FAILED: D5 violated — a master landing table carries a raw column';
  end if;

  raise notice 'E PASSED: common landing columns present on all six, no raw archive.';
end;
$$;

-- =====================================================================================
-- F. No interpretation. No resolution/matching columns and no invented curated
--    flag on the six master tables. ColdLion's own `active` field is permitted
--    where ColdLion returns it (owner decision D4); `is_active` / `active_flag`
--    are ours and are forbidden here.
-- =====================================================================================
do $$
declare
  v_offenders text;
begin
  select string_agg(format('%s.%s', table_name, column_name), ', ')
    into v_offenders
  from information_schema.columns
  where table_schema = 'coldlion'
    and table_name in ('customer','vendor','merch_group_header','merch_group_detail',
                       'season','salesperson')
    and (column_name in ('resolution_status','resolved_by','resolved_at','match_status',
                         'licensor_id','property_id','core_id','is_active','active_flag',
                         'parent_licensor_code')
         or column_name like 'resolved%'
         or column_name like 'match_%');

  if v_offenders is not null then
    raise exception 'F FAILED: the landing layer carries curation or invented structure: %', v_offenders;
  end if;

  raise notice 'F PASSED: no resolution, matching or invented curated columns.';
end;
$$;

-- =====================================================================================
-- G. No foreign key leaves the coldlion schema, and none reaches core.*.
-- =====================================================================================
do $$
declare
  v_offenders text;
begin
  select string_agg(format('%s -> %s', con.conrelid::regclass, con.confrelid::regclass), ', ')
    into v_offenders
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_class fc on fc.oid = con.confrelid
  join pg_namespace fn on fn.oid = fc.relnamespace
  where con.contype = 'f' and n.nspname = 'coldlion' and fn.nspname <> 'coldlion';

  if v_offenders is not null then
    raise exception 'G FAILED: a coldlion foreign key points outside the schema: %', v_offenders;
  end if;

  raise notice 'G PASSED: no foreign key leaves coldlion.';
end;
$$;

-- =====================================================================================
-- H. Security posture. This is a raw landing layer: RLS on, NO policy (closed,
--    not row-filtered), no grant to PUBLIC, anon or authenticated, and the
--    loader role can write.
-- =====================================================================================
do $$
declare
  v_table text;
  v_role  text;
  v_priv  text;
begin
  if has_schema_privilege('anon', 'coldlion', 'USAGE')
     or has_schema_privilege('authenticated', 'coldlion', 'USAGE') then
    raise exception 'H FAILED: an application role holds USAGE on schema coldlion';
  end if;

  foreach v_table in array array[
    'customer','vendor','merch_group_header','merch_group_detail','season','salesperson'
  ] loop
    if not (select relrowsecurity from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'coldlion' and c.relname = v_table) then
      raise exception 'H FAILED: RLS is not enabled on coldlion.%', v_table;
    end if;

    if exists (select 1 from pg_policies
               where schemaname = 'coldlion' and tablename = v_table) then
      raise exception 'H FAILED: coldlion.% carries an RLS policy; this layer is closed, not filtered', v_table;
    end if;

    foreach v_role in array array['anon','authenticated'] loop
      foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE'] loop
        if has_table_privilege(v_role, format('coldlion.%I', v_table), v_priv) then
          raise exception 'H FAILED: % holds % on coldlion.%', v_role, v_priv, v_table;
        end if;
      end loop;
    end loop;

    if exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      where n.nspname = 'coldlion' and c.relname = v_table and a.grantee = 0
    ) then
      raise exception 'H FAILED: coldlion.% carries a grant to PUBLIC', v_table;
    end if;

    foreach v_priv in array array['SELECT','INSERT','UPDATE'] loop
      if not has_table_privilege('service_role', format('coldlion.%I', v_table), v_priv) then
        raise exception 'H FAILED: service_role lacks % on coldlion.%', v_priv, v_table;
      end if;
    end loop;
  end loop;

  raise notice 'H PASSED: RLS on, no policies, no application grants, loader can write.';
end;
$$;

-- =====================================================================================
-- I. The two new tables are documented as landing tables closed to applications.
-- =====================================================================================
do $$
declare
  v_table   text;
  v_comment text;
begin
  foreach v_table in array array['season','salesperson'] loop
    select obj_description(('coldlion.' || v_table)::regclass, 'pg_class') into v_comment;
    if v_comment is null or v_comment not ilike '%no grants to application roles%' then
      raise exception 'I FAILED: coldlion.% does not document the landing-layer contract: %',
        v_table, coalesce(v_comment, '<none>');
    end if;

    select col_description(('coldlion.' || v_table)::regclass,
             (select ordinal_position from information_schema.columns
               where table_schema = 'coldlion' and table_name = v_table
                 and column_name = 'source_hash')::int)
      into v_comment;
    if v_comment is null or v_comment not ilike '%before projection%' then
      raise exception 'I FAILED: coldlion.%.source_hash does not record that it covers the COMPLETE fetched record before projection', v_table;
    end if;
  end loop;

  raise notice 'I PASSED: the new landing tables carry their contract in the catalog.';
end;
$$;

-- =====================================================================================
-- J. Issue #2171 — coldlion.division, the durable division dictionary.
--
--    Migration: 20260903200951_coldlion_division_reference_table.sql
--
--    Field disposition came from a LIVE sample on 2026-09-03 (both active=Y and
--    active=N passes; 10 rows, 26 properties), never from `/api-docs`, which
--    types this feed as a bare {"type":"object"}. 24 properties are ingested;
--    `createdUser` and `modUser` are DECLINED, following the owner's 2026-09-03
--    ruling on those two exact field names for `/seasons` and the narrow
--    `/salespersons` projection (#2081 comment 5519623574).
--
--    Every literal below is a labelled synthetic value (ZZTEST / ZZ*). The one
--    real-world literal is `EP001`, which is already published in
--    docs/coldlion-open-questions.md as permanently out of scope.
-- =====================================================================================
do $$
declare
  v_keydef text;
  v_col    text;
  v_projection constant text[] := array[
    'company_code','division_code','division_desc','acc_div_code','edi_division_code',
    'general_ledger_code','item_no_code','manu_facturer_code','duns_no','currency_code',
    'country_code','address1','address2','city','state','zip_code','phone_no','fax_no',
    'upc_current','upc_start','upc_end','active','created_time','mod_time'
  ];
begin
  if to_regclass('coldlion.division') is null then
    raise exception 'J FAILED: coldlion.division does not exist';
  end if;

  select pg_get_constraintdef(oid) into v_keydef
  from pg_constraint
  where conrelid = 'coldlion.division'::regclass and contype = 'p';

  if v_keydef is distinct from 'PRIMARY KEY (company_code, division_code)' then
    raise exception 'J FAILED: coldlion.division natural key is %, expected PRIMARY KEY (company_code, division_code)',
      coalesce(v_keydef, '<none>');
  end if;

  foreach v_col in array v_projection loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'coldlion' and table_name = 'division' and column_name = v_col
    ) then
      raise exception 'J FAILED: coldlion.division is missing approved column %', v_col;
    end if;
  end loop;

  foreach v_col in array array['run_id','fetched_at','source_hash','first_seen_at','last_seen_at'] loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'coldlion' and table_name = 'division' and column_name = v_col
    ) then
      raise exception 'J FAILED: coldlion.division is missing common landing column %', v_col;
    end if;
  end loop;

  raise notice 'J PASSED: coldlion.division exists with the company+division key and all 24 approved columns.';
end;
$$;

-- =====================================================================================
-- K. The DECLINED properties are absent, and no curation column crept in.
--    A later session must not be able to "finish" this projection by inference.
-- =====================================================================================
do $$
declare
  v_found text;
begin
  select string_agg(column_name, ', ' order by column_name) into v_found
  from information_schema.columns
  where table_schema = 'coldlion' and table_name = 'division'
    and (column_name in ('created_user','mod_user','createduser','moduser',
                         'resolution_status','resolved_by','resolved_at','match_status',
                         'licensor_id','property_id','core_id','is_active','active_flag','raw')
         or column_name like 'resolved%'
         or column_name like 'match\_%');

  if v_found is not null then
    raise exception 'K FAILED: coldlion.division carries declined or curation columns: %', v_found;
  end if;

  -- `active` must be the vendor Y/N string, not a boolean we invented.
  if (select data_type from information_schema.columns
      where table_schema = 'coldlion' and table_name = 'division' and column_name = 'active')
     <> 'text' then
    raise exception 'K FAILED: coldlion.division.active is not the raw vendor string; this layer does not interpret';
  end if;

  raise notice 'K PASSED: createdUser/modUser are absent, no curation columns, active is uninterpreted.';
end;
$$;

-- =====================================================================================
-- L. The key BEHAVES. The same division code under two companies is two rows,
--    replay on the natural key is idempotent, and EP001 is refused.
-- =====================================================================================
do $$
declare
  v_run  uuid;
  v_now  constant timestamptz := now();
  v_hash constant text := repeat('d', 64);
begin
  insert into coldlion.sync_run (endpoint, company_code, requested_by)
  values ('/divisions', 'ZZTEST', 'ZZTEST') returning id into v_run;

  -- Same division code, two companies. The live feed does exactly this: CW001
  -- appears under three company codes. A division-only key would merge them.
  insert into coldlion.division
    (company_code, division_code, run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
  values
    ('ZZTEST',  'ZZ001', v_run, v_now, v_hash, v_now, v_now),
    ('ZZTEST2', 'ZZ001', v_run, v_now, v_hash, v_now, v_now);

  if (select count(*) from coldlion.division where division_code = 'ZZ001') <> 2 then
    raise exception 'L FAILED: one division code under two companies did not survive as two rows';
  end if;

  -- Replay of the same natural key is a conflict, not a duplicate row. This is
  -- what makes an upsert loader idempotent.
  begin
    insert into coldlion.division
      (company_code, division_code, run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
    values ('ZZTEST', 'ZZ001', v_run, v_now, v_hash, v_now, v_now);
    raise exception 'L FAILED: the same (company_code, division_code) was accepted twice';
  exception when unique_violation then null;
  end;

  -- A real upsert replay updates in place and does not multiply rows.
  insert into coldlion.division
    (company_code, division_code, run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
  values ('ZZTEST', 'ZZ001', v_run, v_now, v_hash, v_now, v_now + interval '1 hour')
  on conflict (company_code, division_code)
    do update set last_seen_at = excluded.last_seen_at;

  if (select count(*) from coldlion.division where company_code = 'ZZTEST') <> 1 then
    raise exception 'L FAILED: upsert replay did not stay at one row per natural key';
  end if;

  -- EP001 is refused by the table, not merely filtered by a loader.
  begin
    insert into coldlion.division
      (company_code, division_code, run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
    values ('ZZTEST', 'EP001', v_run, v_now, v_hash, v_now, v_now);
    raise exception 'L FAILED: EP001 was accepted; it is permanently out of scope by owner ruling';
  exception when check_violation then null;
  end;

  -- last_seen_at may never precede first_seen_at.
  begin
    insert into coldlion.division
      (company_code, division_code, run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
    values ('ZZTEST', 'ZZ009', v_run, v_now, v_hash, v_now, v_now - interval '1 day');
    raise exception 'L FAILED: last_seen_at was allowed to precede first_seen_at';
  exception when check_violation then null;
  end;

  -- A non-SHA-256 source_hash is refused.
  begin
    insert into coldlion.division
      (company_code, division_code, run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
    values ('ZZTEST', 'ZZ010', v_run, v_now, 'not-a-hash', v_now, v_now);
    raise exception 'L FAILED: a malformed source_hash was accepted';
  exception when check_violation then null;
  end;

  raise notice 'L PASSED: company+division keeps codes apart, replay is idempotent, EP001 and malformed provenance are refused.';
end;
$$;

-- =====================================================================================
-- M. coldlion.division carries the closed-landing posture and documents it.
-- =====================================================================================
do $$
declare
  v_role    text;
  v_priv    text;
  v_comment text;
begin
  if not (select relrowsecurity from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'coldlion' and c.relname = 'division') then
    raise exception 'M FAILED: row level security is not enabled on coldlion.division';
  end if;

  if exists (select 1 from pg_policies
             where schemaname = 'coldlion' and tablename = 'division') then
    raise exception 'M FAILED: coldlion.division carries an RLS policy; this layer is closed, not filtered';
  end if;

  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      if has_table_privilege(v_role, 'coldlion.division', v_priv) then
        raise exception 'M FAILED: % holds % on coldlion.division', v_role, v_priv;
      end if;
    end loop;
  end loop;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where n.nspname = 'coldlion' and c.relname = 'division' and a.grantee = 0
  ) then
    raise exception 'M FAILED: coldlion.division carries a grant to PUBLIC';
  end if;

  foreach v_priv in array array['SELECT','INSERT','UPDATE'] loop
    if not has_table_privilege('service_role', 'coldlion.division', v_priv) then
      raise exception 'M FAILED: service_role lacks % on coldlion.division', v_priv;
    end if;
  end loop;

  select obj_description('coldlion.division'::regclass, 'pg_class') into v_comment;
  if v_comment is null or v_comment not ilike '%no grants to application roles%' then
    raise exception 'M FAILED: coldlion.division does not document the landing-layer contract: %',
      coalesce(v_comment, '<none>');
  end if;

  select col_description('coldlion.division'::regclass,
           (select ordinal_position from information_schema.columns
             where table_schema = 'coldlion' and table_name = 'division'
               and column_name = 'source_hash')::int)
    into v_comment;
  if v_comment is null or v_comment not ilike '%before projection%' then
    raise exception 'M FAILED: coldlion.division.source_hash does not record that it covers the COMPLETE fetched record before projection';
  end if;

  raise notice 'M PASSED: coldlion.division is closed to applications and carries its contract in the catalog.';
end;
$$;


-- =====================================================================================
-- N. Issue #2177 — `/customers` is projected in full.
--    Migration: 20260905104825_coldlion_customer_full_projection_and_salesperson_active.sql
--    Every property of the 2026-09-03 live sample of GET /EhpApi/customers is a
--    column, exactly once. The list is the SAMPLED SHAPE; /api-docs types this
--    feed as a bare object and cannot be used for it.
-- =====================================================================================
do $$
declare
  v_missing text;
  v_expected constant text[] := array[
    'company_code','customer_code','created_time','mod_time','active',
    'customer_desc','vendor_number',
    'address1','address2','address3','ar_customer_code','city',
    'commission_perc1','commission_perc2','country_code','created_user',
    'currency_code','customer_dba','customer_type_code','ds_cat','factor_code',
    'fax_no','gl_code','mod_user','old_customer_code','parent_customer_code',
    'phone_no','region_code','sales_person_code1','sales_person_code2','state',
    'udf01','udf02','udf03','udf04','udf_date01','udf_date02',
    'use_consolidated_invoice','zip_code'
  ];
begin
  select string_agg(needed, ', ' order by needed) into v_missing
  from unnest(v_expected) needed
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'coldlion' and table_name = 'customer' and column_name = needed
  );
  if v_missing is not null then
    raise exception 'N FAILED: coldlion.customer is missing sampled /customers field(s): %', v_missing;
  end if;

  if array_length(v_expected, 1) <> 39 then
    raise exception 'N FAILED: the sampled /customers field list is % long, expected the 39 of the 2026-09-03 sample',
      array_length(v_expected, 1);
  end if;

  raise notice 'N PASSED: all 39 sampled /customers properties are columns.';
end;
$$;

-- =====================================================================================
-- O. Issue #2177 — THE DECLINED-FIELD GATE for coldlion.salesperson.
--
--    Owner ruling #2081 comment 5519623574 (Albert Hazan, 2026-09-03):
--    `/salespersons` stores NAME, CODE, COMPANY and ACTIVE STATUS ONLY. E-mail,
--    telephone, home address, commission and quota are DECLINED — personal data
--    about named people with no established business use. Declined, not pending.
--    Widening requires a NEW owner ruling recorded the same way.
--
--    O1 is a POSITIVE CONTROL: it builds a deliberately DIRTY table shaped like
--    coldlion.salesperson plus declined columns, and fails if the gate predicate
--    does NOT flag it. A gate nobody has seen fail is not evidence, so the proof
--    that this one can fail runs on every CI execution rather than once, by hand,
--    in a session nobody can re-read.
-- =====================================================================================
do $$
declare
  v_flagged text;
begin
  create table coldlion.zz_declined_gate_probe (
    company_code     text not null,
    salesperson_code text not null,
    last_name        text,
    active           text,
    email            text,    -- declined
    phone_no         text,    -- declined
    address1         text,    -- declined
    commission_perc  numeric, -- declined
    quota            text     -- declined
  );

  select string_agg(column_name, ', ' order by column_name) into v_flagged
  from information_schema.columns
  where table_schema = 'coldlion'
    and table_name = 'zz_declined_gate_probe'
    and (
         column_name like '%email%'
      or column_name like '%e_mail%'
      or column_name like '%mail%'
      or column_name like '%phone%'
      or column_name like '%fax%'
      or column_name like '%mobile%'
      or column_name like '%address%'
      or column_name like '%addr%'
      or column_name like '%city%'
      or column_name like '%state%'
      or column_name like '%zip%'
      or column_name like '%postal%'
      or column_name like '%commission%'
      or column_name like '%quota%'
    );

  if v_flagged is null then
    raise exception
      'O1 FAILED: the declined-field gate did not flag a deliberately dirty table. The gate cannot fail, so its silence on the real table proves nothing.';
  end if;

  if v_flagged <> 'address1, commission_perc, email, phone_no, quota' then
    raise exception 'O1 FAILED: the gate flagged %, expected all five planted declined columns', v_flagged;
  end if;

  drop table coldlion.zz_declined_gate_probe;

  raise notice 'O1 PASSED (positive control): the declined-field gate flags a dirty table — %', v_flagged;
end;
$$;

do $$
declare
  v_offending  text;
  v_unexpected text;
  v_missing    text;
  v_allowed constant text[] := array[
    'company_code','salesperson_code','last_name','active',
    'created_time','mod_time',
    'run_id','fetched_at','source_hash','first_seen_at','last_seen_at'
  ];
begin
  -- O2. The same predicate, now against the real table. It must find nothing.
  select string_agg(column_name, ', ' order by column_name) into v_offending
  from information_schema.columns
  where table_schema = 'coldlion'
    and table_name = 'salesperson'
    and (
         column_name like '%email%'
      or column_name like '%e_mail%'
      or column_name like '%mail%'
      or column_name like '%phone%'
      or column_name like '%fax%'
      or column_name like '%mobile%'
      or column_name like '%address%'
      or column_name like '%addr%'
      or column_name like '%city%'
      or column_name like '%state%'
      or column_name like '%zip%'
      or column_name like '%postal%'
      or column_name like '%commission%'
      or column_name like '%quota%'
    );
  if v_offending is not null then
    raise exception
      'O2 FAILED: coldlion.salesperson carries DECLINED personal-data column(s): %. Owner ruling #2081 comment 5519623574 permits name, code, company and active status only.',
      v_offending;
  end if;

  -- O3. The exact permitted set, so a declined field under a name the patterns
  --     do not anticipate is caught too.
  select string_agg(column_name, ', ' order by column_name) into v_unexpected
  from information_schema.columns
  where table_schema = 'coldlion'
    and table_name = 'salesperson'
    and not (column_name = any (v_allowed));
  if v_unexpected is not null then
    raise exception
      'O3 FAILED: coldlion.salesperson carries column(s) outside the owner-approved projection: %',
      v_unexpected;
  end if;

  -- O4. The four approved fields are present, so O2/O3 cannot pass vacuously.
  select string_agg(needed, ', ' order by needed) into v_missing
  from unnest(array['company_code','salesperson_code','last_name','active']) needed
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'coldlion' and table_name = 'salesperson' and column_name = needed
  );
  if v_missing is not null then
    raise exception 'O4 FAILED: coldlion.salesperson is missing owner-approved field(s): %', v_missing;
  end if;

  raise notice 'O PASSED: /salespersons projection is exactly name, code, company, active status.';
end;
$$;

-- =====================================================================================
-- P. Issue #2177 — the ruling is recorded IN THE CATALOG, not only in a file.
--    A future session reading coldlion.salesperson from a database, with no
--    repository to hand, must be told that the narrowness is a decision.
--    Replay is idempotent: re-running the migration adds nothing, because every
--    column is added with `add column if not exists`.
-- =====================================================================================
do $$
declare
  v_comment text;
  v_before  int;
  v_after   int;
begin
  select obj_description('coldlion.salesperson'::regclass, 'pg_class') into v_comment;
  if v_comment is null or v_comment not ilike '%declined%' or v_comment not ilike '%5519623574%' then
    raise exception 'P FAILED: coldlion.salesperson does not record the owner ruling in its comment: %',
      coalesce(v_comment, '<none>');
  end if;

  select obj_description('coldlion.customer'::regclass, 'pg_class') into v_comment;
  if v_comment is null or v_comment not ilike '%5519623574%' then
    raise exception 'P FAILED: coldlion.customer does not record the owner ruling in its comment: %',
      coalesce(v_comment, '<none>');
  end if;

  -- Idempotent replay of the shape this migration adds.
  select count(*) into v_before from information_schema.columns
  where table_schema = 'coldlion' and table_name in ('customer','salesperson');

  alter table coldlion.customer add column if not exists zip_code text;
  alter table coldlion.salesperson add column if not exists active text;

  select count(*) into v_after from information_schema.columns
  where table_schema = 'coldlion' and table_name in ('customer','salesperson');

  if v_after <> v_before then
    raise exception 'P FAILED: replaying the migration column adds changed the column count from % to %',
      v_before, v_after;
  end if;

  raise notice 'P PASSED: the ruling is in the catalog and the column adds replay idempotently.';
end;
$$;

rollback;
