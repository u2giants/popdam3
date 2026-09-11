-- =====================================================================================
-- Contract tests for issue #2174 - ColdLion production history: three-stage agreement,
-- component evidence, the last* lookup separation, and retention.
--
-- Every block below fails loudly if the claim it names is false. Structure follows the
-- unit-3 contract files (coldlion_order_history_contracts.sql).
--
-- CONTRACTS PROVEN HERE
--   1. The returned stage must equal the requested stage; a mismatch aborts.
--   2. Only ISS, INTRAN and REC are accepted stages.
--   3. Components and last* lookups have a mandatory parent, and the parent's deletion
--      cascades to them - no orphans.
--   4. A multi-component line stays ONE parent row; parent totals are not summed.
--   5. component_quantities_asserted is refused when the component quantities do not
--      sum to the parent total, and accepted when they do.
--   6. lastProdCost can never be confused with this order's cost: no order-cost column
--      exists on the lookup table, at most one lookup per line may be selected, and a
--      selection with no recorded rule is refused.
--   7. salesOrderNo = 0 yields sales_order_link_present = false.
--   8. The 1900-01-01 empty-date marker is refused.
--   9. EP001 is refused.
--  10. Retention prunes only the oldest version of a four-version partition and then
--      refuses; a single backfill baseline is never pruned; an ambiguity flag stops
--      pruning of the whole partition.
--  11. Closed landing posture: RLS on, no anon/authenticated grants, no raw column.
--  12. No FK to coldlion.item_header and no FK from coldlion into core.
--  13. The documented non-prepack grain is storable: prepack_item_no is nullable and a
--      component with NULL prepack_item_no and a real sub_item_no is accepted, while a
--      blank prepack_item_no is still refused.
-- =====================================================================================

begin;

-- -------------------------------------------------------------------------------------
-- Catalog contracts
-- -------------------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_count integer;
begin
  -- Tables exist.
  if to_regclass('coldlion.prod_history_line') is null
     or to_regclass('coldlion.prod_history_component') is null
     or to_regclass('coldlion.prod_history_last_lookup') is null then
    raise exception 'FAIL: a coldlion.prod_history_* table is missing';
  end if;

  -- No raw column anywhere (landing rule D5).
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'coldlion'
      and table_name in ('prod_history_line','prod_history_component','prod_history_last_lookup')
      and column_name = 'raw'
  ) then
    raise exception 'FAIL: a prod_history table carries a raw column';
  end if;

  -- CONTRACT 11: RLS enabled on all three.
  select count(*) into v_count
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'coldlion'
    and c.relname in ('prod_history_line','prod_history_component','prod_history_last_lookup')
    and c.relrowsecurity;
  if v_count <> 3 then
    raise exception 'FAIL: expected RLS on 3 prod_history tables, found %', v_count;
  end if;

  -- CONTRACT 11: no application-role grants.
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'coldlion'
      and table_name in ('prod_history_line','prod_history_component','prod_history_last_lookup')
      and grantee in ('anon','authenticated','PUBLIC')
  ) then
    raise exception 'FAIL: an application role holds a grant on a prod_history table';
  end if;

  -- CONTRACT 1: the stage-agreement check exists and compares the two stage columns.
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint where conname = 'coldlion_prod_history_line_stage_agreement';
  if v_def is null then
    raise exception 'FAIL: the stage-agreement check constraint is missing';
  end if;
  if v_def not like '%requested_stage_code%' or v_def not like '%stage_code%' then
    raise exception 'FAIL: the stage-agreement check does not compare the two stage columns: %', v_def;
  end if;

  -- Both stage columns are NOT NULL: an absent requested stage would make the
  -- agreement vacuous.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'coldlion' and table_name = 'prod_history_line'
      and column_name in ('stage_code','requested_stage_code')
      and is_nullable = 'YES'
  ) then
    raise exception 'FAIL: a stage column on prod_history_line is nullable';
  end if;

  -- company_code is NOT NULL: companyCode is 100% populated in the feed and a
  -- production line with no company cannot be partitioned for retention.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'coldlion' and table_name = 'prod_history_line'
      and column_name = 'company_code' and is_nullable = 'YES'
  ) then
    raise exception 'FAIL: prod_history_line.company_code is nullable';
  end if;

  -- CONTRACT 13: prepack_item_no MUST be nullable - a documented non-prepack row has
  -- an empty prepackItemNo and still carries subItemNo, so NOT NULL would refuse it.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'coldlion' and table_name = 'prod_history_component'
      and column_name = 'prepack_item_no' and is_nullable = 'NO'
  ) then
    raise exception 'FAIL: prod_history_component.prepack_item_no is NOT NULL, which refuses documented non-prepack rows';
  end if;

  -- Identity uniqueness under NULLS NOT DISTINCT on all three tables.
  foreach v_def in array array[
    'coldlion_prod_history_line_identity_unique',
    'coldlion_prod_history_component_identity_unique',
    'coldlion_prod_history_last_lookup_identity_unique'
  ] loop
    if not exists (
      select 1 from pg_constraint
      where conname = v_def
        and pg_get_constraintdef(oid) like '%NULLS NOT DISTINCT%'
    ) then
      raise exception 'FAIL: % is missing or is not NULLS NOT DISTINCT', v_def;
    end if;
  end loop;

  -- CONTRACT 4: prod_line_seq is part of the line identity, so two buy lines on one
  -- order can never merge.
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint where conname = 'coldlion_prod_history_line_identity_unique';
  if v_def not like '%prod_line_seq%' or v_def not like '%stage_code%' then
    raise exception 'FAIL: line identity does not include prod_line_seq and stage_code: %', v_def;
  end if;

  -- CONTRACT 3: mandatory, non-nullable parent FK on both children.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'coldlion.prod_history_component'::regclass and contype = 'f'
      and confrelid = 'coldlion.prod_history_line'::regclass
  ) then
    raise exception 'FAIL: prod_history_component has no FK to prod_history_line';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'coldlion.prod_history_last_lookup'::regclass and contype = 'f'
      and confrelid = 'coldlion.prod_history_line'::regclass
  ) then
    raise exception 'FAIL: prod_history_last_lookup has no FK to prod_history_line';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'coldlion'
      and table_name in ('prod_history_component','prod_history_last_lookup')
      and column_name = 'line_id' and is_nullable = 'YES'
  ) then
    raise exception 'FAIL: a child line_id is nullable, which would permit an orphan';
  end if;

  -- CONTRACT 3: both parent FKs cascade, so a removed parent leaves no orphan.
  select count(*) into v_count
  from pg_constraint
  where conrelid in ('coldlion.prod_history_component'::regclass,
                     'coldlion.prod_history_last_lookup'::regclass)
    and contype = 'f' and confdeltype = 'c';
  if v_count <> 2 then
    raise exception 'FAIL: expected 2 ON DELETE CASCADE parent FKs, found %', v_count;
  end if;

  -- CONTRACT 12: no FK to item_header (discontinued items are legitimately absent).
  if exists (
    select 1 from pg_constraint
    where conrelid in (
            'coldlion.prod_history_line'::regclass,
            'coldlion.prod_history_component'::regclass,
            'coldlion.prod_history_last_lookup'::regclass)
      and contype = 'f'
      and confrelid = to_regclass('coldlion.item_header')
  ) then
    raise exception 'FAIL: a prod_history table has a foreign key to coldlion.item_header';
  end if;

  -- CONTRACT 12: no FK from these landing tables into core.
  if exists (
    select 1
    from pg_constraint con
    join pg_class ref on ref.oid = con.confrelid
    join pg_namespace refn on refn.oid = ref.relnamespace
    where con.conrelid in (
            'coldlion.prod_history_line'::regclass,
            'coldlion.prod_history_component'::regclass,
            'coldlion.prod_history_last_lookup'::regclass)
      and con.contype = 'f' and refn.nspname = 'core'
  ) then
    raise exception 'FAIL: a prod_history table has a foreign key into core';
  end if;

  -- CONTRACT 6: no order-cost column name exists on the lookup table.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'coldlion' and table_name = 'prod_history_last_lookup'
      and column_name in ('prod_cost','ext_cost','total_prod_cost','ppk_detail_cost','order_cost')
  ) then
    raise exception 'FAIL: an order-cost column exists on the last* lookup table';
  end if;
  -- ... and the order costs really do live on the line.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'coldlion' and table_name = 'prod_history_line'
      and column_name = 'ext_cost'
  ) then
    raise exception 'FAIL: prod_history_line.ext_cost is missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'coldlion' and table_name = 'prod_history_last_lookup'
      and column_name = 'last_prod_cost'
  ) then
    raise exception 'FAIL: prod_history_last_lookup.last_prod_cost is missing';
  end if;

  -- CONTRACT 6: at most one selected lookup per line, enforced by a partial unique index.
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'coldlion'
      and indexname = 'coldlion_prod_history_last_lookup_one_selected_idx'
      and indexdef like '%UNIQUE%' and indexdef like '%WHERE%is_selected_lookup%'
  ) then
    raise exception 'FAIL: the one-selected-lookup-per-line partial unique index is missing';
  end if;

  -- The three guards exist as triggers, not as documentation.
  if not exists (select 1 from pg_trigger
                 where tgrelid = 'coldlion.prod_history_line'::regclass
                   and tgname = 'prod_history_component_quantity_guard') then
    raise exception 'FAIL: the component-quantity guard trigger is missing';
  end if;
  if not exists (select 1 from pg_trigger
                 where tgrelid = 'coldlion.prod_history_component'::regclass
                   and tgname = 'prod_history_component_immutable_when_asserted') then
    raise exception 'FAIL: the component-immutability trigger is missing';
  end if;
  if not exists (select 1 from pg_trigger
                 where tgrelid = 'coldlion.prod_history_line'::regclass
                   and tgname = 'prod_history_line_retention_guard') then
    raise exception 'FAIL: the retention guard trigger is missing';
  end if;

  -- All fourteen ppkMerchGroup slots and their descriptions are carried.
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'coldlion' and table_name = 'prod_history_component'
    and column_name ~ '^ppk_merch_group[0-9]{2}(_desc)?$';
  if v_count <> 28 then
    raise exception 'FAIL: expected 28 ppk_merch_group columns, found %', v_count;
  end if;
end $$;

-- -------------------------------------------------------------------------------------
-- Behavioural contracts
-- -------------------------------------------------------------------------------------
do $$
declare
  v_run uuid;
  v_line uuid;
  v_line_b uuid;
  v_base timestamptz := timestamptz '2026-09-01 00:00:00+00';
  v_ids uuid[] := '{}';
  v_id uuid;
  v_count integer;
  v_link boolean;
  h64 text := repeat('a', 64);
begin
  insert into coldlion.sync_run (endpoint, requested_by, status, started_at)
  values ('/prodHistory', 'issue-2174-contract', 'running', now())
  returning id into v_run;

  -- CONTRACT 1: a returned stage that differs from the requested stage aborts.
  begin
    insert into coldlion.prod_history_line
      (company_code, prod_order_no, prod_line_seq, requested_stage_code, stage_code,
       source_observed_at, line_source_hash, run_id, fetched_at)
    values ('EDGEHOME', 90001, 1, 'REC', 'ISS', v_base, repeat('b',64), v_run, now());
    raise exception 'FAIL: a stage mismatch (requested REC, returned ISS) was accepted';
  exception when check_violation then null;
  end;

  -- CONTRACT 2: a fourth stage does not exist.
  begin
    insert into coldlion.prod_history_line
      (company_code, prod_order_no, prod_line_seq, requested_stage_code, stage_code,
       source_observed_at, line_source_hash, run_id, fetched_at)
    values ('EDGEHOME', 90001, 1, 'SHIPPED', 'SHIPPED', v_base, repeat('c',64), v_run, now());
    raise exception 'FAIL: an invented stage code was accepted';
  exception when check_violation then null;
  end;

  -- CONTRACT 8: the 1900-01-01 empty-date marker is refused.
  begin
    insert into coldlion.prod_history_line
      (company_code, prod_order_no, prod_line_seq, requested_stage_code, stage_code,
       ship_date, source_observed_at, line_source_hash, run_id, fetched_at)
    values ('EDGEHOME', 90001, 1, 'ISS', 'ISS', date '1900-01-01', v_base,
            repeat('d',64), v_run, now());
    raise exception 'FAIL: the 1900-01-01 empty-date marker was stored as a real date';
  exception when check_violation then null;
  end;

  -- CONTRACT 9: EP001 is refused.
  begin
    insert into coldlion.prod_history_line
      (company_code, prod_order_no, prod_line_seq, requested_stage_code, stage_code,
       division_code, source_observed_at, line_source_hash, run_id, fetched_at)
    values ('EDGEHOME', 90001, 1, 'ISS', 'ISS', 'EP001', v_base, repeat('e',64), v_run, now());
    raise exception 'FAIL: an EP001 production line was accepted';
  exception when check_violation then null;
  end;

  -- A well-formed line, with salesOrderNo = 0.
  insert into coldlion.prod_history_line
    (company_code, prod_order_no, prod_line_seq, requested_stage_code, stage_code,
     division_code, sales_order_no, total_ppk_qty, ext_cost,
     source_observed_at, line_source_hash, run_id, fetched_at)
  values ('EDGEHOME', 90004, 1, 'ISS', 'ISS', 'CW001', 0, 4500, 1234.56,
          v_base, repeat('1',64), v_run, now())
  returning id into v_line;

  -- CONTRACT 7: 0 means no link, not a key.
  select sales_order_link_present into v_link
  from coldlion.prod_history_line where id = v_line;
  if v_link is not false then
    raise exception 'FAIL: salesOrderNo = 0 did not yield sales_order_link_present = false';
  end if;

  -- CONTRACT 4: a second buy line on the SAME order is a separate parent row.
  insert into coldlion.prod_history_line
    (company_code, prod_order_no, prod_line_seq, requested_stage_code, stage_code,
     total_ppk_qty, source_observed_at, line_source_hash, run_id, fetched_at)
  values ('EDGEHOME', 90004, 2, 'ISS', 'ISS', 3000, v_base, repeat('2',64), v_run, now())
  returning id into v_line_b;

  select count(*) into v_count
  from coldlion.prod_history_line
  where company_code = 'EDGEHOME' and prod_order_no = 90004;
  if v_count <> 2 then
    raise exception 'FAIL: two prodLineSeq values did not produce two parent rows (found %)', v_count;
  end if;

  -- CONTRACT 3: a component with no parent is refused.
  begin
    insert into coldlion.prod_history_component
      (line_id, prepack_item_no, ppk_detail_qty, component_source_hash, run_id, fetched_at)
    values (gen_random_uuid(), 'PPK-ORPHAN', 1, repeat('3',64), v_run, now());
    raise exception 'FAIL: an orphan component was accepted';
  exception when foreign_key_violation then null;
  end;

  -- CONTRACT 3: a lookup with no parent is refused.
  begin
    insert into coldlion.prod_history_last_lookup
      (line_id, last_prod_cost, lookup_source_hash, run_id, fetched_at)
    values (gen_random_uuid(), 3.00, repeat('4',64), v_run, now());
    raise exception 'FAIL: an orphan last* lookup was accepted';
  exception when foreign_key_violation then null;
  end;

  -- CONTRACT 4: two components of one line stay under ONE parent, and the parent total
  -- is stored once - it is not the sum of anything the components carry on their own.
  insert into coldlion.prod_history_component
    (line_id, prepack_item_no, ppk_detail_qty, line_price, component_source_hash, run_id, fetched_at)
  values (v_line, 'PPK-A', 1500, 2.50, repeat('5',64), v_run, now()),
         (v_line, 'PPK-B', 2000, 3.75, repeat('6',64), v_run, now());

  select count(*) into v_count
  from coldlion.prod_history_line where id = v_line;
  if v_count <> 1 then
    raise exception 'FAIL: a two-component line did not stay one parent row';
  end if;

  -- CONTRACT 13: the documented NON-PREPACK grain - prepackItemNo empty, subItemNo
  -- still present - must be storable. This is the shape a /prodHistory loader meets on
  -- roughly a quarter of real rows.
  insert into coldlion.prod_history_component
    (line_id, prepack_item_no, sub_item_no, ppk_detail_qty, line_price,
     component_source_hash, run_id, fetched_at)
  values (v_line_b, null, 'SUB-NONPREPACK', 3000, 1.25, repeat('a',64), v_run, now());

  if not exists (
    select 1 from coldlion.prod_history_component
    where line_id = v_line_b and prepack_item_no is null and sub_item_no = 'SUB-NONPREPACK'
  ) then
    raise exception 'FAIL: a non-prepack component (NULL prepack_item_no, real sub_item_no) was not stored';
  end if;

  -- CONTRACT 13: a BLANK prepack_item_no is still refused - empty must be normalised to
  -- NULL, never stored as '' masquerading as a prepack item number.
  begin
    insert into coldlion.prod_history_component
      (line_id, prepack_item_no, sub_item_no, ppk_detail_qty,
       component_source_hash, run_id, fetched_at)
    values (v_line_b, '   ', 'SUB-BLANK', 1, repeat('b',64), v_run, now());
    raise exception 'FAIL: a blank prepack_item_no was stored instead of being normalised to NULL';
  exception when check_violation then null;
  end;

  delete from coldlion.prod_history_component
   where line_id = v_line_b and sub_item_no = 'SUB-NONPREPACK';

  -- CONTRACT 5: 1500 + 2000 = 3500, not the parent's 4500, so the assertion is refused.
  begin
    update coldlion.prod_history_line
       set component_quantities_asserted = true
     where id = v_line;
    raise exception 'FAIL: component quantities were asserted despite a mismatched sum';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  -- CONTRACT 5: with a third component the sum matches and the assertion is accepted.
  insert into coldlion.prod_history_component
    (line_id, prepack_item_no, ppk_detail_qty, component_source_hash, run_id, fetched_at)
  values (v_line, 'PPK-C', 1000, repeat('7',64), v_run, now());

  update coldlion.prod_history_line
     set component_quantities_asserted = true
   where id = v_line;

  if not (select component_quantities_asserted
            from coldlion.prod_history_line where id = v_line) then
    raise exception 'FAIL: a matching component sum did not permit the assertion';
  end if;

  -- CONTRACT 5: the evidence behind an assertion cannot then be rewritten.
  begin
    delete from coldlion.prod_history_component
     where line_id = v_line and prepack_item_no = 'PPK-C';
    raise exception 'FAIL: component evidence was deleted while its line asserted its quantities';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  update coldlion.prod_history_line
     set component_quantities_asserted = false where id = v_line;

  -- CONTRACT 5: a line with no components at all cannot assert anything.
  begin
    update coldlion.prod_history_line
       set component_quantities_asserted = true where id = v_line_b;
    raise exception 'FAIL: a line with no components asserted its component quantities';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  -- CONTRACT 6: the last* copies coexist; neither is aggregated.
  insert into coldlion.prod_history_last_lookup
    (line_id, last_prod_cost, lookup_source_hash, run_id, fetched_at)
  values (v_line, 3.00, repeat('8',64), v_run, now()),
         (v_line, 3.60, repeat('9',64), v_run, now());

  select count(*) into v_count
  from coldlion.prod_history_last_lookup where line_id = v_line;
  if v_count <> 2 then
    raise exception 'FAIL: the 3.00/3.60 lastProdCost fan-out did not survive as two rows';
  end if;

  -- CONTRACT 6: selecting a copy without recording the rule is refused.
  begin
    update coldlion.prod_history_last_lookup
       set is_selected_lookup = true
     where line_id = v_line and last_prod_cost = 3.60;
    raise exception 'FAIL: a lookup was selected with no recorded selection_rule';
  exception when check_violation then null;
  end;

  update coldlion.prod_history_last_lookup
     set is_selected_lookup = true,
         selection_rule = 'max(last_prod_date), then max(last_prod_cost), then lookup_source_hash'
   where line_id = v_line and last_prod_cost = 3.60;

  -- CONTRACT 6: a second selected copy for the same line is refused, so the two costs
  -- can never both be read as this order's cost.
  begin
    update coldlion.prod_history_last_lookup
       set is_selected_lookup = true, selection_rule = 'another rule'
     where line_id = v_line and last_prod_cost = 3.00;
    raise exception 'FAIL: two selected last* lookups were permitted on one line';
  exception when unique_violation then null;
  end;

  -- CONTRACT 3 / 10: even a childless single-version line cannot be deleted - the
  -- retention guard refuses, so nothing is quietly removed by hand.
  begin
    delete from coldlion.prod_history_line where id = v_line_b;
    raise exception 'FAIL: a single-version partition was pruned';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;

-- CONTRACT 10: retention.
do $$
declare
  v_run uuid;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_count integer;
  v_base timestamptz := timestamptz '2026-09-01 00:00:00+00';
begin
  insert into coldlion.sync_run (endpoint, requested_by, status, started_at)
  values ('/prodHistory', 'issue-2174-contract', 'running', now())
  returning id into v_run;

  -- Four versions of ONE purchase line in one stage.
  for i in 1..4 loop
    insert into coldlion.prod_history_line
      (company_code, prod_order_no, prod_line_seq, requested_stage_code, stage_code,
       source_observed_at, source_version_seq, line_source_hash, run_id, fetched_at)
    values ('EDGEHOME', 91000, 1, 'REC', 'REC',
            v_base + (i || ' hours')::interval, i,
            lpad(i::text, 64, '0'), v_run, now())
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  -- A version of the SAME order and line at a DIFFERENT stage is a different partition
  -- and must not be counted towards the newest-three of the REC partition.
  insert into coldlion.prod_history_line
    (company_code, prod_order_no, prod_line_seq, requested_stage_code, stage_code,
     source_observed_at, source_version_seq, line_source_hash, run_id, fetched_at)
  values ('EDGEHOME', 91000, 1, 'ISS', 'ISS', v_base, 1, lpad('9', 64, '0'), v_run, now());

  -- Only the oldest may go: pruning the newest is refused.
  begin
    delete from coldlion.prod_history_line where id = v_ids[4];
    raise exception 'FAIL: the newest version of a partition was pruned';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  -- The oldest of four is pruned.
  delete from coldlion.prod_history_line where id = v_ids[1];

  select count(*) into v_count
  from coldlion.prod_history_line
  where company_code = 'EDGEHOME' and prod_order_no = 91000 and stage_code = 'REC';
  if v_count <> 3 then
    raise exception 'FAIL: expected 3 REC versions to remain, found %', v_count;
  end if;

  -- And then it stops: three is the floor.
  begin
    delete from coldlion.prod_history_line where id = v_ids[2];
    raise exception 'FAIL: retention pruned a partition down below three versions';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  -- The one ISS version - a lone baseline-shaped partition - is untouched.
  begin
    delete from coldlion.prod_history_line
     where company_code = 'EDGEHOME' and prod_order_no = 91000 and stage_code = 'ISS';
    raise exception 'FAIL: a single-version partition was pruned';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  -- CONTRACT 10: a backfill baseline is refused even in a FOUR-version partition, where
  -- the newest-three floor would otherwise let the oldest row go. This is the claim the
  -- column and function comments make, tested on the case that can actually break it.
  declare
    v_bl_ids uuid[] := '{}';
    v_bl_id uuid;
  begin
    for i in 1..4 loop
      insert into coldlion.prod_history_line
        (company_code, prod_order_no, prod_line_seq, requested_stage_code, stage_code,
         source_observed_at, source_version_seq, line_source_hash, run_id, fetched_at,
         is_backfill_baseline)
      values ('EDGEHOME', 91500, 1, 'REC', 'REC',
              v_base + (i || ' hours')::interval, i,
              lpad('b' || i::text, 64, '0'), v_run, now(),
              i = 1)
      returning id into v_bl_id;
      v_bl_ids := v_bl_ids || v_bl_id;
    end loop;

    begin
      delete from coldlion.prod_history_line where id = v_bl_ids[1];
      raise exception 'FAIL: a backfill baseline was pruned from a four-version partition';
    exception when raise_exception then
      if sqlerrm like 'FAIL:%' then raise; end if;
    end;
  end;

  -- An ambiguity flag anywhere in the partition stops pruning entirely, even of the
  -- oldest row, even though the partition holds four versions.
  insert into coldlion.prod_history_line
    (company_code, prod_order_no, prod_line_seq, requested_stage_code, stage_code,
     source_observed_at, source_version_seq, line_source_hash, run_id, fetched_at,
     retention_identity_ambiguous)
  values ('EDGEHOME', 91000, 1, 'REC', 'REC',
          v_base + interval '9 hours', 9, lpad('8', 64, '0'), v_run, now(), true);

  begin
    delete from coldlion.prod_history_line where id = v_ids[2];
    raise exception 'FAIL: retention pruned a partition flagged ambiguous';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;

rollback;
