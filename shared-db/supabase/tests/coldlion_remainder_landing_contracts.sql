-- Rolled-back structural contracts for issue #2175 (ColdLion landing unit 5a).
-- Gate: plan_coldlion_landing_schema_completion.md section 9 Step 6 - documented grain
-- proof from live sampling, complete field disposition, idempotent replay, and no
-- unexplained duplicate collapse.
begin;

do $$
declare
  v_count integer;
begin
  -- 1. Both tables exist, and the owner-cancelled image-byte table still does not.
  if to_regclass('coldlion.inventory') is null then
    raise exception 'missing coldlion.inventory';
  end if;
  if to_regclass('coldlion.prod_tracking') is null then
    raise exception 'missing coldlion.prod_tracking';
  end if;
  if to_regclass('coldlion.item_image_content') is not null then
    raise exception 'owner-cancelled image-byte table exists';
  end if;

  -- 2. D5: no per-row raw archive on either feed table.
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'coldlion'
    and table_name in ('inventory','prod_tracking')
    and column_name = 'raw';
  if v_count <> 0 then
    raise exception 'D5 violated: unit 5a feed table has a raw column';
  end if;

  -- 3. The landing layer never points at curated tables.
  select count(*) into v_count
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  join pg_class rt on rt.oid = c.confrelid
  join pg_namespace rn on rn.oid = rt.relnamespace
  where c.contype = 'f'
    and n.nspname = 'coldlion'
    and t.relname in ('inventory','prod_tracking')
    and rn.nspname <> 'coldlion';
  if v_count <> 0 then
    raise exception 'unit 5a landing has % FK(s) outside coldlion', v_count;
  end if;

  -- 4. Every row is attributable to the pull that produced it.
  select count(*) into v_count
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  join pg_class rt on rt.oid = c.confrelid
  where c.contype = 'f'
    and n.nspname = 'coldlion'
    and t.relname in ('inventory','prod_tracking')
    and rt.relname = 'sync_run';
  if v_count <> 2 then
    raise exception 'unit 5a tables must both reference coldlion.sync_run (found %)', v_count;
  end if;

  -- 5. COMPLETE FIELD DISPOSITION. Every sampled source field has a column and no
  --    column was invented. Counts are the 2026-09-02 live sample: /inventory 12 fields,
  --    /prodtracking 51. Provenance adds run_id, fetched_at, source_hash, first_seen_at
  --    and last_seen_at to each. /inventory carries one further column, the
  --    request-stamped company_code, because its payload omits companyCode.
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'coldlion' and table_name = 'inventory';
  if v_count <> 18 then
    raise exception 'coldlion.inventory must carry 12 source + request-stamped company_code + 5 provenance columns, found %', v_count;
  end if;

  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'coldlion' and table_name = 'prod_tracking';
  if v_count <> 56 then
    raise exception 'coldlion.prod_tracking must carry 51 source + 5 provenance columns, found %', v_count;
  end if;

  -- 6. GRAIN. /inventory is identified by request-stamped company plus itemPkey plus
  --    warehouse - never by itemPkey alone, which was proven non-unique (7,412 / 8,754).
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'coldlion.inventory'::regclass and contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (company_code, item_pkey, warehouse_code)'
  ) then
    raise exception 'coldlion.inventory grain is not (company_code, item_pkey, warehouse_code)';
  end if;

  --    /prodtracking is identified by company plus prodOrderNo, measured over the whole
  --    3,922-row feed.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'coldlion.prod_tracking'::regclass and contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (company_code, prod_order_no)'
  ) then
    raise exception 'coldlion.prod_tracking grain is not (company_code, prod_order_no)';
  end if;

  -- 7. The empty-date marker must be storable as NULL, so no date column may be NOT NULL.
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'coldlion' and table_name in ('inventory','prod_tracking')
    and data_type = 'date' and is_nullable = 'NO';
  if v_count <> 0 then
    raise exception '% date column(s) are NOT NULL; the 1900-01-01 empty marker must land as NULL', v_count;
  end if;

  -- 8. ColdLion sends '' rather than null, so no unit 5a column may forbid a blank.
  select count(*) into v_count
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where c.contype = 'c' and n.nspname = 'coldlion'
    and t.relname in ('inventory','prod_tracking')
    and pg_get_constraintdef(c.oid) like '%btrim%';
  if v_count <> 0 then
    raise exception 'unit 5a rejects live blank source values via % non-blank check(s)', v_count;
  end if;

  -- 9. Both feeds carry live EP001 rows, so the phases 2-6 exclusion must NOT be copied
  --    here - it would fail the load instead of filtering it.
  select count(*) into v_count
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where c.contype = 'c' and n.nspname = 'coldlion'
    and t.relname in ('inventory','prod_tracking')
    and pg_get_constraintdef(c.oid) like '%EP001%';
  if v_count <> 0 then
    raise exception 'unit 5a must not exclude EP001 structurally; both feeds contain EP001 rows';
  end if;

  -- 10. No application role may reach the landing layer.
  select count(*) into v_count
  from information_schema.role_table_grants
  where table_schema = 'coldlion'
    and table_name in ('inventory','prod_tracking')
    and grantee in ('anon','authenticated','PUBLIC');
  if v_count <> 0 then
    raise exception 'unit 5a landing tables are reachable by an application role';
  end if;

  select count(*) into v_count
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'coldlion' and c.relname in ('inventory','prod_tracking')
    and c.relrowsecurity;
  if v_count <> 2 then
    raise exception 'row level security is not enabled on both unit 5a tables';
  end if;

  -- 11. The grain proof and the inert-filter finding must stay attached to the objects.
  if coalesce(obj_description('coldlion.inventory'::regclass, 'pg_class'), '') not like '%8,754%'
     or coalesce(obj_description('coldlion.prod_tracking'::regclass, 'pg_class'), '') not like '%INERT%' then
    raise exception 'unit 5a table comments no longer carry the live grain proof';
  end if;
end $$;

-- 12. BEHAVIOUR: idempotent replay, and duplicate collapse only where it was proven.
do $$
declare
  v_run uuid;
  v_run2 uuid;
begin
  insert into coldlion.sync_run(endpoint, requested_by)
  values ('/inventory', 'coldlion_remainder_landing_contracts')
  returning id into v_run;

  insert into coldlion.sync_run(endpoint, requested_by)
  values ('/prodtracking', 'coldlion_remainder_landing_contracts')
  returning id into v_run2;

  -- One item stocked in two warehouses is two rows, not a collision.
  insert into coldlion.inventory(
    company_code, item_pkey, warehouse_code, item_no, inventory_qty,
    run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
  values
    ('TESTCO', 900001, 'WH-A', 'ITEM-1', 5, v_run, now(), repeat('a',64), now(), now()),
    ('TESTCO', 900001, 'WH-B', 'ITEM-1', 7, v_run, now(), repeat('b',64), now(), now());

  if (select count(*) from coldlion.inventory where item_pkey = 900001) <> 2 then
    raise exception 'itemPkey identity collapsed two warehouse positions into one';
  end if;

  -- The same position pulled again is an update, not a second row.
  insert into coldlion.inventory(
    company_code, item_pkey, warehouse_code, item_no, inventory_qty,
    run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
  values ('TESTCO', 900001, 'WH-A', 'ITEM-1', 9, v_run, now(), repeat('c',64), now(), now())
  on conflict (company_code, item_pkey, warehouse_code) do update
    set inventory_qty = excluded.inventory_qty,
        source_hash   = excluded.source_hash,
        last_seen_at  = excluded.last_seen_at;

  if (select count(*) from coldlion.inventory where item_pkey = 900001) <> 2
     or (select inventory_qty from coldlion.inventory
         where item_pkey = 900001 and warehouse_code = 'WH-A') <> 9 then
    raise exception 'inventory replay was not idempotent';
  end if;

  -- The same itemPkey under a different company is a different row.
  insert into coldlion.inventory(
    company_code, item_pkey, warehouse_code, item_no, inventory_qty,
    run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
  values ('OTHERCO', 900001, 'WH-A', 'ITEM-1', 3, v_run, now(), repeat('d',64), now(), now());

  if (select count(*) from coldlion.inventory where item_pkey = 900001) <> 3 then
    raise exception 'request-stamped company_code did not separate two companies on one itemPkey';
  end if;

  -- Blank descriptive codes and negative quantities are live and must be storable.
  insert into coldlion.inventory(
    company_code, item_pkey, warehouse_code, item_no, dim_code, label_code, prepack_code,
    inventory_qty, run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
  values ('TESTCO', 900002, '', 'ITEM-2', '', '', '', -4, v_run, now(), repeat('e',64), now(), now());

  -- A production order replayed with an identical payload collapses; that is the ONLY
  -- collapse this grain was proven to perform.
  insert into coldlion.prod_tracking(
    company_code, prod_order_no, vendor_code, prod_qty, order_date,
    run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
  values ('TESTCO', 990001, 'V-1', 100, null, v_run2, now(), repeat('1',64), now(), now());

  insert into coldlion.prod_tracking(
    company_code, prod_order_no, vendor_code, prod_qty, order_date,
    run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
  values ('TESTCO', 990001, 'V-1', 100, null, v_run2, now(), repeat('1',64), now(), now())
  on conflict (company_code, prod_order_no) do update
    set last_seen_at = excluded.last_seen_at;

  if (select count(*) from coldlion.prod_tracking where prod_order_no = 990001) <> 1 then
    raise exception 'prod_tracking replay was not idempotent';
  end if;

  -- The same prodOrderNo under a different company is a different order.
  insert into coldlion.prod_tracking(
    company_code, prod_order_no, vendor_code, prod_qty,
    run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
  values ('OTHERCO', 990001, 'V-2', 50, v_run2, now(), repeat('2',64), now(), now());

  if (select count(*) from coldlion.prod_tracking where prod_order_no = 990001) <> 2 then
    raise exception 'company_code did not separate two companies on one prodOrderNo';
  end if;

  -- A DIFFERING payload on the proven key must be a visible conflict, never a silent
  -- second row: that is the case the grain proof does not cover.
  begin
    insert into coldlion.prod_tracking(
      company_code, prod_order_no, vendor_code, prod_qty,
      run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
    values ('TESTCO', 990001, 'V-DIFFERENT', 999, v_run2, now(), repeat('3',64), now(), now());
    raise exception 'a differing payload on (company_code, prod_order_no) was accepted as a new row';
  exception when unique_violation then
    null;
  end;

  -- last_seen_at can never precede first_seen_at.
  begin
    insert into coldlion.prod_tracking(
      company_code, prod_order_no, run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
    values ('TESTCO', 990002, v_run2, now(), repeat('4',64), now(), now() - interval '1 day');
    raise exception 'prod_tracking accepted last_seen_at before first_seen_at';
  exception when check_violation then
    null;
  end;

  -- A non-hex source hash is not a hash.
  begin
    insert into coldlion.inventory(
      company_code, item_pkey, warehouse_code,
      run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
    values ('TESTCO', 900003, 'WH-A', v_run, now(), 'not-a-sha256', now(), now());
    raise exception 'inventory accepted a malformed source_hash';
  exception when check_violation then
    null;
  end;
end $$;

rollback;
