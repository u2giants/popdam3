-- Rolled-back structural contracts for issue #2863 (ColdLion landing unit 5b).
-- Gate: plan_coldlion_landing_schema_completion.md section 9 Step 6 - documented grain
-- proof from live sampling, complete field disposition, idempotent replay, and no
-- unexplained duplicate collapse. Evidence: docs/coldlion-unit-5b-grain-proof-20260915.md.
begin;

do $$
declare
  v_count integer;
begin
  -- 1. Both tables exist.
  if to_regclass('coldlion.prepack_detail') is null then
    raise exception 'missing coldlion.prepack_detail';
  end if;
  if to_regclass('coldlion.prod_detail') is null then
    raise exception 'missing coldlion.prod_detail';
  end if;

  -- 2. D5: no per-row raw archive on either feed table.
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'coldlion'
    and table_name in ('prepack_detail','prod_detail')
    and column_name = 'raw';
  if v_count <> 0 then
    raise exception 'D5 violated: unit 5b feed table has a raw column';
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
    and t.relname in ('prepack_detail','prod_detail')
    and rn.nspname <> 'coldlion';
  if v_count <> 0 then
    raise exception 'unit 5b landing has % FK(s) outside coldlion', v_count;
  end if;

  -- 4. Every row is attributable to the pull that produced it.
  select count(*) into v_count
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  join pg_class rt on rt.oid = c.confrelid
  where c.contype = 'f'
    and n.nspname = 'coldlion'
    and t.relname in ('prepack_detail','prod_detail')
    and rt.relname = 'sync_run';
  if v_count <> 2 then
    raise exception 'unit 5b tables must both reference coldlion.sync_run (found %)', v_count;
  end if;

  -- 5. COMPLETE FIELD DISPOSITION. Every sampled source field has a column and no column
  --    was invented. Counts are the 2026-09-15 live sample: /prepackDetail 18 fields
  --    (companyCode included in the payload), /proddetails 21 fields plus the
  --    request-stamped company_code its payload omits. Provenance adds run_id,
  --    fetched_at, source_hash, first_seen_at and last_seen_at to each.
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'coldlion' and table_name = 'prepack_detail';
  if v_count <> 23 then
    raise exception 'coldlion.prepack_detail must carry 18 source + 5 provenance columns, found %', v_count;
  end if;

  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'coldlion' and table_name = 'prod_detail';
  if v_count <> 27 then
    raise exception 'coldlion.prod_detail must carry 21 source + request-stamped company_code + 5 provenance columns, found %', v_count;
  end if;

  -- 5b. The duplicate-cased itemPrice / ItemPrice pair must both survive. Folding them
  --     would silently discard a source field.
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'coldlion' and table_name = 'prepack_detail'
    and column_name in ('item_price','item_price_capitalized');
  if v_count <> 2 then
    raise exception 'prepack_detail folded ColdLion itemPrice and ItemPrice into one column';
  end if;

  -- 6. GRAIN. /prepackDetail has NO vendor row id; the smallest proven source identity is
  --    company + prepack code + the vendor line sequence, 456 distinct over 456 rows.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'coldlion.prepack_detail'::regclass and contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (company_code, prepack_code, sequence_no)'
  ) then
    raise exception 'coldlion.prepack_detail grain is not (company_code, prepack_code, sequence_no)';
  end if;

  --    /proddetails proved TWO independent identities, 166 distinct over 166 each. The
  --    vendor row id is the primary key; the line identity is asserted separately so a
  --    future pull that breaks it fails visibly instead of collapsing two lines.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'coldlion.prod_detail'::regclass and contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (company_code, pkey)'
  ) then
    raise exception 'coldlion.prod_detail grain is not (company_code, pkey)';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'coldlion.prod_detail'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (company_code, prod_order_no, prod_line_seq)'
  ) then
    raise exception 'coldlion.prod_detail does not assert the second proven identity (prod_order_no, prod_line_seq)';
  end if;

  -- 7. The empty-date marker must be storable as NULL, so no source date column may be
  --    NOT NULL. The source date columns are declared timestamptz, not date, so this
  --    must match on the declared type or it examines nothing. fetched_at /
  --    first_seen_at / last_seen_at are loader-set and are deliberately NOT NULL.
  select count(*) into v_count
  from pg_attribute a
  where a.attrelid in (to_regclass('coldlion.prepack_detail'), to_regclass('coldlion.prod_detail'))
    and a.attnum > 0 and not a.attisdropped
    and a.atttypid = 'timestamptz'::regtype
    and a.attname in ('created_time','mod_time');
  if v_count <> 4 then
    raise exception 'expected 4 source timestamptz columns (created_time, mod_time on both tables), found %', v_count;
  end if;

  select count(*) into v_count
  from pg_attribute a
  where a.attrelid in (to_regclass('coldlion.prepack_detail'), to_regclass('coldlion.prod_detail'))
    and a.attnum > 0 and not a.attisdropped
    and a.atttypid = 'timestamptz'::regtype
    and a.attname in ('created_time','mod_time')
    and a.attnotnull;
  if v_count <> 0 then
    raise exception '% source date column(s) are NOT NULL; the 1900-01-01 empty marker must land as NULL', v_count;
  end if;

  -- 8. ColdLion sends '' rather than null, so no unit 5b column may forbid a blank.
  select count(*) into v_count
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where c.contype = 'c' and n.nspname = 'coldlion'
    and t.relname in ('prepack_detail','prod_detail')
    and pg_get_constraintdef(c.oid) like '%btrim%';
  if v_count <> 0 then
    raise exception 'unit 5b rejects live blank source values via % non-blank check(s)', v_count;
  end if;

  -- 9. Transactional feeds: the phases 2-6 EP001 exclusion must NOT be copied here - it
  --    would fail the load instead of filtering it.
  select count(*) into v_count
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where c.contype = 'c' and n.nspname = 'coldlion'
    and t.relname in ('prepack_detail','prod_detail')
    and pg_get_constraintdef(c.oid) like '%EP001%';
  if v_count <> 0 then
    raise exception 'unit 5b must not exclude EP001 structurally; these are transactional feeds';
  end if;

  -- 10. No application role may reach the landing layer.
  select count(*) into v_count
  from information_schema.role_table_grants
  where table_schema = 'coldlion'
    and table_name in ('prepack_detail','prod_detail')
    and grantee in ('anon','authenticated','PUBLIC');
  if v_count <> 0 then
    raise exception 'unit 5b landing tables are reachable by an application role';
  end if;

  select count(*) into v_count
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'coldlion' and c.relname in ('prepack_detail','prod_detail')
    and c.relrowsecurity;
  if v_count <> 2 then
    raise exception 'row level security is not enabled on both unit 5b tables';
  end if;

  -- 11. The grain proof must stay attached to the objects.
  if coalesce(obj_description('coldlion.prepack_detail'::regclass, 'pg_class'), '') not like '%456 rows%'
     or coalesce(obj_description('coldlion.prod_detail'::regclass, 'pg_class'), '') not like '%166 rows%' then
    raise exception 'unit 5b table comments no longer carry the live grain proof';
  end if;
end $$;

-- 12. BEHAVIOUR: idempotent replay, and duplicate collapse only where it was proven.
do $$
declare
  v_run uuid;
  v_run2 uuid;
begin
  insert into coldlion.sync_run(endpoint, requested_by)
  values ('/prepackDetail', 'coldlion_prepack_prod_detail_landing_contracts')
  returning id into v_run;

  insert into coldlion.sync_run(endpoint, requested_by)
  values ('/proddetails', 'coldlion_prepack_prod_detail_landing_contracts')
  returning id into v_run2;

  -- Two lines of one prepack are two rows, not a collision.
  insert into coldlion.prepack_detail(
    company_code, prepack_code, sequence_no, item_no, quantity,
    run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
  values
    ('TESTCO', 'PPK0001', 1, 'ITEM-1', 2, v_run, now(), repeat('a',64), now(), now()),
    ('TESTCO', 'PPK0001', 2, 'ITEM-2', 1, v_run, now(), repeat('b',64), now(), now());

  if (select count(*) from coldlion.prepack_detail where prepack_code = 'PPK0001') <> 2 then
    raise exception 'prepack line sequence collapsed two recipe lines into one';
  end if;

  -- The same line pulled again is an update, not a second row.
  insert into coldlion.prepack_detail(
    company_code, prepack_code, sequence_no, item_no, quantity,
    run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
  values ('TESTCO', 'PPK0001', 1, 'ITEM-1', 3, v_run, now(), repeat('c',64), now(), now())
  on conflict (company_code, prepack_code, sequence_no) do update
    set quantity     = excluded.quantity,
        source_hash  = excluded.source_hash,
        last_seen_at = excluded.last_seen_at;

  if (select count(*) from coldlion.prepack_detail where prepack_code = 'PPK0001') <> 2
     or (select quantity from coldlion.prepack_detail
         where prepack_code = 'PPK0001' and sequence_no = 1) <> 3 then
    raise exception 'prepack_detail replay was not idempotent';
  end if;

  -- The same prepack code under a different company is a different row.
  insert into coldlion.prepack_detail(
    company_code, prepack_code, sequence_no, item_no, quantity,
    run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
  values ('OTHERCO', 'PPK0001', 1, 'ITEM-9', 1, v_run, now(), repeat('d',64), now(), now());

  if (select count(*) from coldlion.prepack_detail where prepack_code = 'PPK0001') <> 3 then
    raise exception 'company_code did not separate two companies on one prepack code';
  end if;

  -- Blank descriptive codes are live on this feed and must be storable.
  insert into coldlion.prepack_detail(
    company_code, prepack_code, sequence_no, item_no, dim_code, label_code, detail_prepack,
    item_price, item_price_capitalized,
    run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
  values ('TESTCO', 'PPK0002', 1, 'ITEM-3', '', '', '', 4.25, 4.25,
          v_run, now(), repeat('e',64), now(), now());

  -- Two lines of one production order are two rows; the vendor row id keeps them apart.
  insert into coldlion.prod_detail(
    company_code, pkey, prod_order_no, prod_line_seq, item_no, prod_qty,
    run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
  values
    ('TESTCO', 800001, 990001, 1, 'ITEM-1', 100, v_run2, now(), repeat('1',64), now(), now()),
    ('TESTCO', 800002, 990001, 2, 'ITEM-1', 50,  v_run2, now(), repeat('2',64), now(), now());

  if (select count(*) from coldlion.prod_detail where prod_order_no = 990001) <> 2 then
    raise exception 'prod_detail collapsed two lines of one production order';
  end if;

  -- The same line pulled again is an update, not a second row.
  insert into coldlion.prod_detail(
    company_code, pkey, prod_order_no, prod_line_seq, item_no, prod_qty,
    run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
  values ('TESTCO', 800001, 990001, 1, 'ITEM-1', 120, v_run2, now(), repeat('3',64), now(), now())
  on conflict (company_code, pkey) do update
    set prod_qty     = excluded.prod_qty,
        source_hash  = excluded.source_hash,
        last_seen_at = excluded.last_seen_at;

  if (select count(*) from coldlion.prod_detail where prod_order_no = 990001) <> 2
     or (select prod_qty from coldlion.prod_detail where pkey = 800001) <> 120 then
    raise exception 'prod_detail replay was not idempotent';
  end if;

  -- The same pkey under a different company is a different row.
  insert into coldlion.prod_detail(
    company_code, pkey, prod_order_no, prod_line_seq, item_no, prod_qty,
    run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
  values ('OTHERCO', 800001, 990009, 1, 'ITEM-8', 10, v_run2, now(), repeat('4',64), now(), now());

  if (select count(*) from coldlion.prod_detail where pkey = 800001) <> 2 then
    raise exception 'request-stamped company_code did not separate two companies on one pkey';
  end if;

  -- A NEW vendor row id that reuses an existing (prodOrderNo, prodLineSeq) must be a
  -- visible conflict. Both identities were proven; neither may silently break.
  begin
    insert into coldlion.prod_detail(
      company_code, pkey, prod_order_no, prod_line_seq, item_no, prod_qty,
      run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
    values ('TESTCO', 800003, 990001, 1, 'ITEM-X', 7, v_run2, now(), repeat('5',64), now(), now());
    raise exception 'a second row reused (prod_order_no, prod_line_seq) without failing';
  exception when unique_violation then
    null;
  end;

  -- A DIFFERING payload on the prepack key must be a visible conflict, never a silent
  -- second row: that is the case the grain proof does not cover.
  begin
    insert into coldlion.prepack_detail(
      company_code, prepack_code, sequence_no, item_no, quantity,
      run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
    values ('TESTCO', 'PPK0001', 1, 'ITEM-DIFFERENT', 9, v_run, now(), repeat('6',64), now(), now());
    raise exception 'a differing payload on (company_code, prepack_code, sequence_no) was accepted as a new row';
  exception when unique_violation then
    null;
  end;

  -- last_seen_at can never precede first_seen_at.
  begin
    insert into coldlion.prod_detail(
      company_code, pkey, prod_order_no, prod_line_seq,
      run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
    values ('TESTCO', 800004, 990002, 1, v_run2, now(), repeat('7',64), now(), now() - interval '1 day');
    raise exception 'prod_detail accepted last_seen_at before first_seen_at';
  exception when check_violation then
    null;
  end;

  -- A non-hex source hash is not a hash.
  begin
    insert into coldlion.prepack_detail(
      company_code, prepack_code, sequence_no,
      run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
    values ('TESTCO', 'PPK0003', 1, v_run, now(), 'not-a-sha256', now(), now());
    raise exception 'prepack_detail accepted a malformed source_hash';
  exception when check_violation then
    null;
  end;
end $$;

rollback;
