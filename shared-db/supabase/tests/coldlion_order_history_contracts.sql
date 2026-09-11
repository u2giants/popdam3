-- Rolled-back structural contracts for issue #2173: the redesigned ColdLion sales
-- history. Everything here is synthetic - the item numbers, orders and tokens are
-- invented - so nothing customer-identifying or licensed enters this public repository.
--
-- The shape being proven is the exploded one: ColdLion never returns the sales-order
-- line. It returns one row per component SKU with the parent's totals repeated on every
-- row (docs/business-rules-erp-data.md §10). So the contracts are:
--   1. The four-part key (salesOrderNo, salesOrderLineNo, itemNo, subItemNo) does not
--      collide, and order + line ALONE is not identity.
--   2. Every component has exactly one parent version, enforced by a mandatory FK.
--   3. A many-component line stays ONE parent row - repeated parent totals are a header
--      field, not a multiplication.
--   4. Document-list tokens survive a round-trip, and an unaligned date is refused
--      rather than invented.
--   5. Neither table may reach into coldlion.item_header or core.*.
begin;

do $$
declare
  v_name text;
begin
  foreach v_name in array array[
    'order_history_line','order_history_component',
    'order_history_invoice_ref','order_history_pick_ticket_ref'
  ] loop
    if to_regclass('coldlion.' || v_name) is null then
      raise exception 'missing coldlion.%', v_name;
    end if;

    -- D5: no per-row raw archive on a feed table.
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'coldlion' and table_name = v_name and column_name = 'raw'
    ) then
      raise exception 'D5 violated: coldlion.% has a raw column', v_name;
    end if;

    if not (select relrowsecurity from pg_class where oid = ('coldlion.' || v_name)::regclass) then
      raise exception 'coldlion.% has no row security', v_name;
    end if;

    if exists (
      select 1 from information_schema.role_table_grants
      where table_schema = 'coldlion' and table_name = v_name
        and grantee in ('anon','authenticated','PUBLIC')
    ) then
      raise exception 'an application role can reach coldlion.%', v_name;
    end if;
  end loop;

  -- The line number the vendor exposed on 2026-09-01. Its absence was the defect.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'coldlion' and table_name = 'order_history_line'
      and column_name = 'sales_order_line_no'
  ) then
    raise exception 'order_history_line still has no sales_order_line_no';
  end if;

  -- Identity is order + line + MASTER ITEM + line hash. Order + line alone is not it.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'coldlion.order_history_line'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) like '%NULLS NOT DISTINCT%'
      and pg_get_constraintdef(oid) like '%sales_order_no%sales_order_line_no%master_item_no%line_source_hash%'
  ) then
    raise exception 'corrected sales-history line identity is missing';
  end if;

  -- Every component belongs to exactly one parent version.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'coldlion.order_history_component'::regclass and contype = 'f'
      and confrelid = 'coldlion.order_history_line'::regclass
  ) then
    raise exception 'components have no mandatory parent version';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'coldlion' and table_name = 'order_history_component'
      and column_name = 'line_id' and is_nullable = 'YES'
  ) then
    raise exception 'a component may exist without a parent version';
  end if;

  -- No FK into the current item master: discontinued historical items are absent there.
  if exists (
    select 1 from pg_constraint c
    where c.contype = 'f'
      and c.conrelid in (
        'coldlion.order_history_line'::regclass,
        'coldlion.order_history_component'::regclass,
        'coldlion.order_history_invoice_ref'::regclass,
        'coldlion.order_history_pick_ticket_ref'::regclass)
      and c.confrelid = 'coldlion.item_header'::regclass
  ) then
    raise exception 'sales history was chained to the current item master';
  end if;

  -- No FK from landing into curated tables, at all.
  if exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_class rt on rt.oid = c.confrelid
    join pg_namespace rn on rn.oid = rt.relnamespace
    where c.contype = 'f' and n.nspname = 'coldlion' and rn.nspname = 'core'
  ) then
    raise exception 'coldlion landing has a foreign key into core';
  end if;

  -- D2 as narrowed by D14: merch groups are component-grain here, never line-grain,
  -- and sales history models six slots, not the item side's fourteen.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'coldlion' and table_name = 'order_history_line'
      and column_name ~ '^(sub_)?merch_group[0-9]'
  ) then
    raise exception 'D2 violated: a merch-group column leaked onto the sales-history line';
  end if;
  if (select count(*) from information_schema.columns
      where table_schema = 'coldlion' and table_name = 'order_history_component'
        and column_name ~ '^merch_group[0-9]') <> 6 then
    raise exception 'D14 violated: prepack component merchGroup01-06 are not all kept';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'coldlion' and table_name = 'order_history_component'
      and column_name ~ '^(sub_)?merch_group(0[7-9]|1[0-4])'
  ) then
    raise exception 'the item-side 14-slot rule was applied to sales history';
  end if;

  -- The per-SKU quantities §10.3 says are the ones to read.
  if (select count(*) from information_schema.columns
      where table_schema = 'coldlion' and table_name = 'order_history_component'
        and column_name in ('order_qty','invoice_qty')) <> 2 then
    raise exception 'per-design quantities are missing from the component grain';
  end if;

  -- Document tokens are text. A comma-separated list typed as a number truncates.
  if (select data_type from information_schema.columns
      where table_schema = 'coldlion' and table_name = 'order_history_invoice_ref'
        and column_name = 'invoice_no') <> 'text' then
    raise exception 'invoice tokens are not stored as text';
  end if;
  if (select data_type from information_schema.columns
      where table_schema = 'coldlion' and table_name = 'order_history_pick_ticket_ref'
        and column_name = 'pick_ticket_no') <> 'text' then
    raise exception 'pick-ticket tokens are not stored as text';
  end if;

  -- No inferred document type anywhere (§10.8 / plan §8).
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'coldlion'
      and table_name in ('order_history_line','order_history_component',
                         'order_history_invoice_ref','order_history_pick_ticket_ref')
      and column_name in ('document_type','source_document','doc_type')
  ) then
    raise exception 'an inferred source-document type was stored';
  end if;

  -- Every run_id foreign key used by the redesigned history grain has a leading
  -- index, so deleting or reconciling a sync run cannot degrade into four scans.
  if (select count(*) from pg_indexes
      where schemaname = 'coldlion'
        and indexname in (
          'coldlion_order_history_line_run_idx',
          'coldlion_order_history_component_run_idx',
          'coldlion_order_history_invoice_ref_run_idx',
          'coldlion_order_history_pick_ticket_ref_run_idx')) <> 4 then
    raise exception 'one or more order-history run_id foreign keys lacks an index';
  end if;
end $$;

do $$
declare
  v_run uuid;
  v_line uuid;
  v_other_line uuid;
  v_comp_a uuid;
  v_comp_b uuid;
begin
  insert into coldlion.sync_run(endpoint, company_code, requested_by, started_at)
  values ('/orderHistory', 'TESTCO', 'contract-test', now())
  returning id into v_run;

  -- A prepack line: one parent, two component designs, parent totals repeated by the
  -- vendor on both exploded rows and stored ONCE here.
  insert into coldlion.order_history_line(
    company_code, sales_order_no, sales_order_line_no, master_item_no, label_code,
    pre_pack_code, line_qty, prepack_qty, line_source_hash, run_id, fetched_at)
  values ('TESTCO', 9001, 1, 'PACK-1', 'BC', 'PPK-1', 1750, 7,
          repeat('a', 64), v_run, now())
  returning id into v_line;

  insert into coldlion.order_history_component(
    line_id, sub_item_no, sub_label_code, line_price, quantity, order_qty, invoice_qty,
    merch_group01, sub_merch_group01, component_source_hash, run_id, fetched_at)
  values (v_line, 'SUB-A', 'BC', 7.0, 1, 250, 250, 'MG-A', 'SMG-A', repeat('b', 64), v_run, now())
  returning id into v_comp_a;

  insert into coldlion.order_history_component(
    line_id, sub_item_no, sub_label_code, line_price, quantity, order_qty, invoice_qty,
    merch_group01, sub_merch_group01, component_source_hash, run_id, fetched_at)
  values (v_line, 'SUB-B', 'BC', 2.0, 1, 250, 250, 'MG-B', 'SMG-B', repeat('c', 64), v_run, now())
  returning id into v_comp_b;

  if (select count(*) from coldlion.order_history_line where sales_order_no = 9001) <> 1 then
    raise exception 'a multi-component sales line fanned out its parent';
  end if;
  if (select count(*) from coldlion.order_history_component where line_id = v_line) <> 2 then
    raise exception 'component designs were merged';
  end if;
  -- The parent total is stored once and is NOT the sum of its components.
  if (select line_qty from coldlion.order_history_line where id = v_line) <> 1750
     or (select sum(order_qty) from coldlion.order_history_component where line_id = v_line) <> 500 then
    raise exception 'parent totals and per-design quantities were confused';
  end if;

  -- Replay of the same parent version is the same row.
  begin
    insert into coldlion.order_history_line(
      company_code, sales_order_no, sales_order_line_no, master_item_no, label_code,
      pre_pack_code, line_qty, prepack_qty, line_source_hash, run_id, fetched_at)
    values ('TESTCO', 9001, 1, 'PACK-1', 'BC', 'PPK-1', 1750, 7,
            repeat('a', 64), v_run, now());
    raise exception 'a line replay duplicated the parent version';
  exception when unique_violation then null;
  end;

  -- A DIFFERENT line projection of the same order line is a separate VERSION, not a
  -- merge - and that is exactly why the hash is part of the key.
  insert into coldlion.order_history_line(
    company_code, sales_order_no, sales_order_line_no, master_item_no, label_code,
    pre_pack_code, line_qty, prepack_qty, line_source_hash, run_id, fetched_at)
  values ('TESTCO', 9001, 1, 'PACK-1', 'BC', 'PPK-1', 1800, 7,
          repeat('d', 64), v_run, now());
  if (select count(*) from coldlion.order_history_line
      where sales_order_no = 9001 and sales_order_line_no = 1) <> 2 then
    raise exception 'two differing line projections were silently merged';
  end if;

  -- ORDER + LINE ALONE IS NOT IDENTITY. A different item on the same order and line -
  -- the 179-group case from the corpus - must coexist.
  insert into coldlion.order_history_line(
    company_code, sales_order_no, sales_order_line_no, master_item_no,
    line_qty, line_source_hash, run_id, fetched_at)
  values ('TESTCO', 9001, 1, 'PLAIN-1', 40, repeat('e', 64), v_run, now())
  returning id into v_other_line;

  -- salesOrderLineNo = 0 is the prepack-explosion marker, not missing data (§10.4).
  insert into coldlion.order_history_line(
    company_code, sales_order_no, sales_order_line_no, master_item_no,
    line_qty, line_source_hash, run_id, fetched_at)
  values ('TESTCO', 9002, 0, 'PACK-2', 12, repeat('f', 64), v_run, now());
  begin
    insert into coldlion.order_history_line(
      company_code, sales_order_no, sales_order_line_no, master_item_no,
      line_qty, line_source_hash, run_id, fetched_at)
    values ('TESTCO', 9003, -1, 'PACK-3', 12, repeat('0', 64), v_run, now());
    raise exception 'a negative line number was accepted';
  exception when check_violation then null;
  end;

  -- A non-prepack row has one component whose sub item is NULL; NULLS NOT DISTINCT
  -- makes its replay idempotent rather than duplicating it.
  insert into coldlion.order_history_component(
    line_id, sub_item_no, line_price, order_qty, invoice_qty,
    component_source_hash, run_id, fetched_at)
  values (v_other_line, null, 3.09, 40, 40, repeat('1', 64), v_run, now());
  begin
    insert into coldlion.order_history_component(
      line_id, sub_item_no, line_price, order_qty, invoice_qty,
      component_source_hash, run_id, fetched_at)
    values (v_other_line, null, 3.09, 40, 40, repeat('1', 64), v_run, now());
    raise exception 'a null-sub-item component replay duplicated';
  exception when unique_violation then null;
  end;

  -- A component may not be orphaned or adopted by a stranger.
  begin
    insert into coldlion.order_history_component(
      line_id, sub_item_no, component_source_hash, run_id, fetched_at)
    values (gen_random_uuid(), 'SUB-X', repeat('2', 64), v_run, now());
    raise exception 'a component was created without a real parent version';
  exception when foreign_key_violation then null;
  end;

  -- DOCUMENT LIST ROUND-TRIP. 'INV-1,INV-2,INV-3' with three aligned dates.
  update coldlion.order_history_component
     set invoice_no_string = 'INV-1,INV-2,INV-3',
         invoice_date_string = '2026-06-02,2026-06-03,2026-06-04',
         pick_ticket_no_string = 'PT-1,PT-2'
   where id = v_comp_a;

  insert into coldlion.order_history_invoice_ref(
    line_id, component_id, ordinal, invoice_no, invoice_date_token, invoice_date,
    date_alignment_proven, run_id, fetched_at)
  values (v_line, v_comp_a, 1, 'INV-1', '2026-06-02', date '2026-06-02', true, v_run, now()),
         (v_line, v_comp_a, 2, 'INV-2', '2026-06-03', date '2026-06-03', true, v_run, now()),
         (v_line, v_comp_a, 3, 'INV-3', '2026-06-04', date '2026-06-04', true, v_run, now());

  insert into coldlion.order_history_pick_ticket_ref(
    line_id, component_id, ordinal, pick_ticket_no, run_id, fetched_at)
  values (v_line, v_comp_a, 1, 'PT-1', v_run, now()),
         (v_line, v_comp_a, 2, 'PT-2', v_run, now());

  if (select string_agg(invoice_no, ',' order by ordinal)
        from coldlion.order_history_invoice_ref where component_id = v_comp_a)
     is distinct from (select invoice_no_string from coldlion.order_history_component where id = v_comp_a) then
    raise exception 'invoice-number list did not survive the round trip';
  end if;
  if (select string_agg(pick_ticket_no, ',' order by ordinal)
        from coldlion.order_history_pick_ticket_ref where component_id = v_comp_a)
     is distinct from (select pick_ticket_no_string from coldlion.order_history_component where id = v_comp_a) then
    raise exception 'pick-ticket list did not survive the round trip';
  end if;

  -- An ordinal identifies one position in one ordered payload list. A different
  -- token at the same position must not create a second, contradictory position.
  begin
    insert into coldlion.order_history_invoice_ref(
      line_id, component_id, ordinal, invoice_no, run_id, fetched_at)
    values (v_line, v_comp_a, 1, 'DIFFERENT-INVOICE', v_run, now());
    raise exception 'two invoice tokens occupied the same ordinal';
  exception when unique_violation then null;
  end;

  begin
    insert into coldlion.order_history_pick_ticket_ref(
      line_id, component_id, ordinal, pick_ticket_no, run_id, fetched_at)
    values (v_line, v_comp_a, 1, 'DIFFERENT-PICK', v_run, now());
    raise exception 'two pick-ticket tokens occupied the same ordinal';
  exception when unique_violation then null;
  end;

  -- A date may not be attached unless its alignment was proven. Two numbers and three
  -- dates is a mismatch, and inventing the pairing would fabricate an invoice date.
  begin
    insert into coldlion.order_history_invoice_ref(
      line_id, component_id, ordinal, invoice_no, invoice_date_token, invoice_date,
      date_alignment_proven, run_id, fetched_at)
    values (v_line, v_comp_b, 1, 'INV-9', '2026-06-02', date '2026-06-02', false, v_run, now());
    raise exception 'an unaligned invoice date was attached to a token';
  exception when check_violation then null;
  end;

  -- The unaligned case is still recorded, with both lists kept and the mismatch flagged.
  update coldlion.order_history_component
     set invoice_no_string = 'INV-9,INV-10',
         invoice_date_string = '2026-06-02,2026-06-03,2026-06-04',
         document_list_cardinality_mismatch = true
   where id = v_comp_b;
  insert into coldlion.order_history_invoice_ref(
    line_id, component_id, ordinal, invoice_no, run_id, fetched_at)
  values (v_line, v_comp_b, 1, 'INV-9',  v_run, now()),
         (v_line, v_comp_b, 2, 'INV-10', v_run, now());
  if (select count(*) from coldlion.order_history_invoice_ref
      where component_id = v_comp_b and invoice_date is not null) <> 0 then
    raise exception 'a pairing was invented for mismatched document lists';
  end if;

  -- A token may not claim a component that belongs to a different line.
  begin
    insert into coldlion.order_history_pick_ticket_ref(
      line_id, component_id, ordinal, pick_ticket_no, run_id, fetched_at)
    values (v_other_line, v_comp_a, 1, 'PT-9', v_run, now());
    raise exception 'a document token crossed from one line to another';
  exception when foreign_key_violation then null;
  end;

  -- A blank token is not a token.
  begin
    insert into coldlion.order_history_invoice_ref(
      line_id, ordinal, invoice_no, run_id, fetched_at)
    values (v_line, 1, '   ', v_run, now());
    raise exception 'a blank invoice token was accepted';
  exception when check_violation then null;
  end;

  -- EP001 is excluded by constraint, not only by loader convention.
  begin
    insert into coldlion.order_history_line(
      company_code, sales_order_no, sales_order_line_no, master_item_no, division_code,
      line_qty, line_source_hash, run_id, fetched_at)
    values ('TESTCO', 9004, 1, 'PACK-4', 'EP001', 5, repeat('3', 64), v_run, now());
    raise exception 'EP001 entered sales history';
  exception when check_violation then null;
  end;

  -- Removing a parent version takes its whole grain with it: no orphan components and
  -- no orphan document tokens.
  delete from coldlion.order_history_line where id = v_line;
  if (select count(*) from coldlion.order_history_component where line_id = v_line) <> 0
     or (select count(*) from coldlion.order_history_invoice_ref where line_id = v_line) <> 0
     or (select count(*) from coldlion.order_history_pick_ticket_ref where line_id = v_line) <> 0 then
    raise exception 'deleting a parent version left orphaned sales-history rows';
  end if;
end $$;

rollback;
