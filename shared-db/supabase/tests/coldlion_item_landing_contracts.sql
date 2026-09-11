-- Issue #2172 — contract tests for the corrected ColdLion ITEM landing structures.
--
-- Migration: 20260905014719_coldlion_item_landing_structures.sql
-- Plan gate: plan_coldlion_landing_schema_completion.md §9 Step 3 — "two identical
-- item numbers in different divisions survive; a cleared slot disappears; every
-- approved live field maps once; ignored fields map nowhere; an unknown field causes
-- refusal."
--
-- Everything below is invented and rolled back. CI replays every migration into an
-- EMPTY database, so no fixture may depend on a pre-existing row. Every literal is a
-- labelled synthetic value (ZZ*), never a real company, division, item, SKU or
-- merchandise-group code.

begin;

-- =====================================================================================
-- A. Identity. The item is company + division + item number; the SKU is that plus
--    itemPkey; the slot is that plus item_pkey scope plus slot number, NULLS NOT
--    DISTINCT. A collapsed key at any level is the defect this block exists to catch.
-- =====================================================================================
do $$
declare
  v_keydef text;
begin
  select pg_get_constraintdef(oid) into v_keydef
  from pg_constraint where conrelid = 'coldlion.item_header'::regclass and contype = 'p';
  if v_keydef is distinct from 'PRIMARY KEY (company_code, division_code, item_no)' then
    raise exception 'A FAILED: item_header key is %, expected the three-part item key',
      coalesce(v_keydef, '<none>');
  end if;

  select pg_get_constraintdef(oid) into v_keydef
  from pg_constraint where conrelid = 'coldlion.item_detail'::regclass and contype = 'p';
  if v_keydef is distinct from
     'PRIMARY KEY (company_code, division_code, item_no, item_pkey)' then
    raise exception 'A FAILED: item_detail key is %, expected the four-part SKU key',
      coalesce(v_keydef, '<none>');
  end if;

  select pg_get_constraintdef(oid) into v_keydef
  from pg_constraint
  where conrelid = 'coldlion.item_merch_group'::regclass
    and conname = 'item_merch_group_slot_identity';
  if v_keydef is distinct from
     'UNIQUE NULLS NOT DISTINCT (company_code, division_code, item_no, item_pkey, slot_no)'
  then
    raise exception 'A FAILED: slot identity is %, expected the NULLS NOT DISTINCT five-part key',
      coalesce(v_keydef, '<none>');
  end if;

  raise notice 'A PASSED: item, SKU and slot identities are each the designed key.';
end;
$$;

-- =====================================================================================
-- B. THE GATE, PART 1 — two identical item numbers in different divisions survive.
--    Measured live on 2026-09-03: 20 real item numbers occur under more than one
--    division inside one company. A two-part key would silently merge them.
-- =====================================================================================
do $$
declare
  v_run  uuid;
  v_now  constant timestamptz := now();
  v_hash constant text := repeat('a', 64);
  v_n    int;
begin
  insert into coldlion.sync_run (endpoint, company_code, requested_by)
  values ('/items', 'ZZTEST', 'ZZTEST') returning id into v_run;

  insert into coldlion.item_header
    (company_code, division_code, item_no, run_id, fetched_at,
     source_hash, first_seen_at, last_seen_at)
  values
    ('ZZTEST', 'ZZ001', 'ZZITEM1', v_run, v_now, v_hash, v_now, v_now),
    ('ZZTEST', 'ZZ002', 'ZZITEM1', v_run, v_now, v_hash, v_now, v_now);

  select count(*) into v_n
  from coldlion.item_header
  where company_code = 'ZZTEST' and item_no = 'ZZITEM1';

  if v_n <> 2 then
    raise exception 'B FAILED: same item number in two divisions collapsed to % row(s)', v_n;
  end if;

  raise notice 'B PASSED: cross-division item numbers survive as separate items.';
end;
$$;

-- =====================================================================================
-- C. THE GATE, PART 2 — merchandise groups are ROWS at BOTH grains, all fourteen
--    slots, and a cleared slot DISAPPEARS. The header slot and the SKU slot are
--    independent: D16 forbids reading the component's licensor/property from the
--    parent, so the two must be separately storable and separately deletable.
-- =====================================================================================
do $$
declare
  v_run  uuid;
  v_now  constant timestamptz := now();
  v_hash constant text := repeat('b', 64);
  v_slot int;
  v_n    int;
begin
  insert into coldlion.sync_run (endpoint, company_code, requested_by)
  values ('/itemDetails', 'ZZTEST', 'ZZTEST') returning id into v_run;

  insert into coldlion.item_header
    (company_code, division_code, item_no, run_id, fetched_at,
     source_hash, first_seen_at, last_seen_at)
  values ('ZZTEST', 'ZZ003', 'ZZITEM2', v_run, v_now, v_hash, v_now, v_now);

  insert into coldlion.item_detail
    (company_code, division_code, item_no, item_pkey, run_id, fetched_at,
     source_hash, first_seen_at, last_seen_at)
  values ('ZZTEST', 'ZZ003', 'ZZITEM2', 'ZZPKEY1', v_run, v_now, v_hash, v_now, v_now);

  -- All fourteen slots at the item-header grain (item_pkey IS NULL) ...
  for v_slot in 1..14 loop
    insert into coldlion.item_merch_group
      (company_code, division_code, item_no, item_pkey, slot_no, mg_code, mg_desc,
       run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
    values ('ZZTEST', 'ZZ003', 'ZZITEM2', null, v_slot, 'ZZH' || v_slot, 'ZZ header desc',
            v_run, v_now, v_hash, v_now, v_now);
  end loop;

  -- ... and all fourteen at the SKU grain, with DIFFERENT codes in the same slots.
  for v_slot in 1..14 loop
    insert into coldlion.item_merch_group
      (company_code, division_code, item_no, item_pkey, slot_no, mg_code, mg_desc,
       run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
    values ('ZZTEST', 'ZZ003', 'ZZITEM2', 'ZZPKEY1', v_slot, 'ZZD' || v_slot, 'ZZ sku desc',
            v_run, v_now, v_hash, v_now, v_now);
  end loop;

  select count(*) into v_n from coldlion.item_merch_group where item_no = 'ZZITEM2';
  if v_n <> 28 then
    raise exception 'C FAILED: expected 14 header + 14 SKU slots, got %', v_n;
  end if;

  -- Slot 15 is not a slot.
  begin
    insert into coldlion.item_merch_group
      (company_code, division_code, item_no, item_pkey, slot_no, mg_code,
       run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
    values ('ZZTEST', 'ZZ003', 'ZZITEM2', null, 15, 'ZZH15',
            v_run, v_now, v_hash, v_now, v_now);
    raise exception 'C FAILED: a fifteenth merchandise-group slot was accepted';
  exception when check_violation then null;
  end;

  -- Replay of a header-scoped slot must not duplicate it. This is what NULLS NOT
  -- DISTINCT buys: an ordinary UNIQUE would treat every NULL item_pkey as distinct
  -- and let the same header slot be written again and again.
  begin
    insert into coldlion.item_merch_group
      (company_code, division_code, item_no, item_pkey, slot_no, mg_code,
       run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
    values ('ZZTEST', 'ZZ003', 'ZZITEM2', null, 5, 'ZZH5',
            v_run, v_now, v_hash, v_now, v_now);
    raise exception 'C FAILED: a header-scoped slot was duplicated on replay';
  exception when unique_violation then null;
  end;

  -- A CLEARED SLOT DISAPPEARS. The loader clears slot 05 on the SKU only; the
  -- header's slot 05 is untouched, and no blank stand-in is left behind.
  delete from coldlion.item_merch_group
  where item_no = 'ZZITEM2' and item_pkey = 'ZZPKEY1' and slot_no = 5;

  select count(*) into v_n
  from coldlion.item_merch_group
  where item_no = 'ZZITEM2' and item_pkey = 'ZZPKEY1' and slot_no = 5;
  if v_n <> 0 then
    raise exception 'C FAILED: the cleared SKU slot did not disappear';
  end if;

  select count(*) into v_n
  from coldlion.item_merch_group
  where item_no = 'ZZITEM2' and item_pkey is null and slot_no = 5;
  if v_n <> 1 then
    raise exception 'C FAILED: clearing a SKU slot also removed the item-header slot';
  end if;

  -- And a blank code may not be used to FAKE a cleared slot.
  begin
    insert into coldlion.item_merch_group
      (company_code, division_code, item_no, item_pkey, slot_no, mg_code,
       run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
    values ('ZZTEST', 'ZZ003', 'ZZITEM2', 'ZZPKEY1', 5, '   ',
            v_run, v_now, v_hash, v_now, v_now);
    raise exception 'C FAILED: a blank merchandise-group code was accepted as a slot';
  exception when check_violation then null;
  end;

  -- Deleting the SKU takes its slots with it and leaves the header's alone.
  delete from coldlion.item_detail where item_no = 'ZZITEM2' and item_pkey = 'ZZPKEY1';

  select count(*) into v_n
  from coldlion.item_merch_group where item_no = 'ZZITEM2' and item_pkey is not null;
  if v_n <> 0 then
    raise exception 'C FAILED: SKU slots outlived their SKU (% left)', v_n;
  end if;

  select count(*) into v_n
  from coldlion.item_merch_group where item_no = 'ZZITEM2' and item_pkey is null;
  if v_n <> 14 then
    raise exception 'C FAILED: deleting a SKU removed % of the item-header slots', 14 - v_n;
  end if;

  raise notice 'C PASSED: 14 slots at both grains, independent, and a cleared slot disappears.';
end;
$$;

-- =====================================================================================
-- D. A SKU-scoped slot cannot be invented for a SKU that does not exist, and the
--    parent FK on item_detail is retained. Otherwise component taxonomy could be
--    written against nothing and would read as authoritative.
-- =====================================================================================
do $$
declare
  v_run  uuid;
  v_now  constant timestamptz := now();
  v_hash constant text := repeat('c', 64);
begin
  insert into coldlion.sync_run (endpoint, company_code, requested_by)
  values ('/itemDetails', 'ZZTEST', 'ZZTEST') returning id into v_run;

  insert into coldlion.item_header
    (company_code, division_code, item_no, run_id, fetched_at,
     source_hash, first_seen_at, last_seen_at)
  values ('ZZTEST', 'ZZ004', 'ZZITEM3', v_run, v_now, v_hash, v_now, v_now);

  begin
    insert into coldlion.item_merch_group
      (company_code, division_code, item_no, item_pkey, slot_no, mg_code,
       run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
    values ('ZZTEST', 'ZZ004', 'ZZITEM3', 'ZZNOSUCHPKEY', 6, 'ZZX6',
            v_run, v_now, v_hash, v_now, v_now);
    raise exception 'D FAILED: a slot was accepted for a non-existent SKU';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into coldlion.item_detail
      (company_code, division_code, item_no, item_pkey, run_id, fetched_at,
       source_hash, first_seen_at, last_seen_at)
    values ('ZZTEST', 'ZZ004', 'ZZNOSUCHITEM', 'ZZPKEY9', v_run, v_now,
            v_hash, v_now, v_now);
    raise exception 'D FAILED: a SKU was accepted with no parent item';
  exception when foreign_key_violation then null;
  end;

  raise notice 'D PASSED: SKU and slot parents are enforced.';
end;
$$;

-- =====================================================================================
-- E. THE GATE, PART 3 — every approved field maps ONCE, and ignored fields map
--    NOWHERE. The inline merchandise-group columns are gone from item_detail (they
--    are now rows, so the same fact is not stored twice), the approved descriptions
--    have landed, and a sample of the owner-DECLINED fields has no column anywhere.
-- =====================================================================================
do $$
declare
  v_col text;
  v_n   int;
begin
  select count(*) into v_n
  from information_schema.columns
  where table_schema = 'coldlion' and table_name in ('item_header', 'item_detail')
    and column_name like 'merch\_group%';
  if v_n <> 0 then
    raise exception 'E FAILED: % inline merch-group column(s) remain on the item tables', v_n;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'coldlion' and table_name = 'item_detail'
      and column_name = 'label_desc'
  ) then
    raise exception 'E FAILED: item_detail.label_desc (owner ruling 2026-09-03, #2081 comment 5526450180) is missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'coldlion' and table_name = 'item_merch_group'
      and column_name = 'mg_desc'
  ) then
    raise exception 'E FAILED: item_merch_group.mg_desc (owner ruling 2026-09-03, #2081 comment 5526450180) is missing';
  end if;

  -- Owner-DECLINED fields from docs/coldlion-field-decisions-20260819.csv. If one of
  -- these ever acquires a column it was ingested without a decision, and under D5
  -- that is not recoverable by deletion later.
  foreach v_col in array array[
    'catalog01', 'catalog14', 'cost_component1', 'created_user', 'mod_user',
    'item_price_e', 'item_price_h', 'tax_exempt', 'vendor_code', 'old_item_no',
    'color_code', 'size_code', 'warehouse_sku', 'variant_sku', 'gtin', 'isbn', 'ean'
  ] loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'coldlion'
        and table_name in ('item_header', 'item_detail', 'item_merch_group')
        and column_name = v_col
    ) then
      raise exception 'E FAILED: declined field % has a column on an item table', v_col;
    end if;
  end loop;

  raise notice 'E PASSED: approved fields map once, declined fields map nowhere.';
end;
$$;

-- =====================================================================================
-- F. Descriptions are EVIDENCE, NEVER KEYS. No primary key, unique constraint or
--    index on any of the three tables may reference a description column. This is
--    the structural half of "an unknown field causes refusal": the loader refuses
--    unknown fields, and the schema refuses to let a description become identity.
-- =====================================================================================
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s.%s', c.conrelid::regclass, c.conname), ', ')
  into v_bad
  from pg_constraint c
  join lateral unnest(c.conkey) k(attnum) on true
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
  where c.conrelid in (
          'coldlion.item_header'::regclass,
          'coldlion.item_detail'::regclass,
          'coldlion.item_merch_group'::regclass)
    and c.contype in ('p', 'u')
    and (a.attname like '%_desc' or a.attname like '%_desc%');

  if v_bad is not null then
    raise exception 'F FAILED: a description column participates in identity: %', v_bad;
  end if;

  raise notice 'F PASSED: no description column participates in any key.';
end;
$$;

-- =====================================================================================
-- G. Closed landing posture. No application role may read any of the three tables,
--    and row level security stays on. A promotion contract (plan Step 8) is the only
--    sanctioned way out of this schema.
-- =====================================================================================
do $$
declare
  v_t text;
begin
  foreach v_t in array array['item_header', 'item_detail', 'item_merch_group'] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'coldlion' and c.relname = v_t and c.relrowsecurity
    ) then
      raise exception 'G FAILED: coldlion.% has row level security disabled', v_t;
    end if;

    if exists (
      select 1 from information_schema.role_table_grants
      where table_schema = 'coldlion' and table_name = v_t
        and grantee in ('PUBLIC', 'anon', 'authenticated')
    ) then
      raise exception 'G FAILED: coldlion.% is granted to an application role', v_t;
    end if;
  end loop;

  raise notice 'G PASSED: the item landing tables stay closed to applications.';
end;
$$;

rollback;
