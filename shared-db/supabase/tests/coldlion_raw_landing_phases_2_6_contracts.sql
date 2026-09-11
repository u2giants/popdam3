-- Rolled-back structural contracts for issue #1184 phases 2-6.
begin;

do $$
declare
  v_name text;
  v_count integer;
begin
  foreach v_name in array array[
    'merch_group_header','merch_group_detail','item_header','item_merch_group','item_detail',
    'order_history_line','order_history_component','prod_history_line','prod_history_component',
    'prod_history_last_lookup','customer','vendor'
  ] loop
    if to_regclass('coldlion.' || v_name) is null then
      raise exception 'missing coldlion.%', v_name;
    end if;
  end loop;

  if to_regclass('coldlion.item_image_content') is not null then
    raise exception 'owner-cancelled image-byte table exists';
  end if;

  select count(*) into v_count
  from information_schema.columns
  where table_schema='coldlion'
    and table_name in ('merch_group_header','merch_group_detail','item_header','item_merch_group','item_detail',
      'order_history_line','order_history_component','prod_history_line','prod_history_component',
      'prod_history_last_lookup','customer','vendor')
    and column_name='raw';
  if v_count <> 0 then raise exception 'D5 violated: feed table has raw column'; end if;

  select count(*) into v_count
  from pg_constraint c
  join pg_class t on t.oid=c.conrelid
  join pg_namespace n on n.oid=t.relnamespace
  join pg_class rt on rt.oid=c.confrelid
  join pg_namespace rn on rn.oid=rt.relnamespace
  where c.contype='f' and n.nspname='coldlion' and rn.nspname='core';
  if v_count <> 0 then raise exception 'coldlion landing has % FK(s) into core', v_count; end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='coldlion.merch_group_detail'::regclass and contype='p'
      and pg_get_constraintdef(oid) =
        'PRIMARY KEY (company_code, division_code, mg_type_code, mg_category, mg_code)'
  ) then raise exception 'five-part merch-group identity missing'; end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='coldlion.item_merch_group'::regclass
      and pg_get_constraintdef(oid) like '%slot_no >= 1%slot_no <= 14%'
  ) then raise exception 'all fourteen item merch-group slots are not enforced'; end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='coldlion' and table_name='item_detail' and column_name in ('color_code','size_code')
  ) then raise exception 'D12 violated: colour/size leaked into item_detail'; end if;

  -- The sales-history grain was redesigned in 20260905105038 (issue #2173): identity now
  -- carries the vendor's salesOrderLineNo, and components hang off a surrogate parent id.
  -- The full contract lives in coldlion_order_history_contracts.sql; this is the anchor.
  if not exists (
    select 1 from pg_constraint
    where conrelid='coldlion.order_history_line'::regclass and contype='u'
      and pg_get_constraintdef(oid) like '%NULLS NOT DISTINCT%sales_order_no%sales_order_line_no%master_item_no%line_source_hash%'
  ) then raise exception 'resolved orderHistory identity/version contract missing'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='coldlion' and table_name='order_history_line' and column_name='line_cancelled_qty'
  ) then raise exception 'D13 lineCancelledQty missing'; end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='coldlion' and table_name in ('order_history_line','prod_history_line')
      and column_name ~ '^merch_group[0-9]'
  ) then raise exception 'D2 line-level merch-group field leaked into history'; end if;

  if (select count(*) from information_schema.columns where table_schema='coldlion'
      and table_name='prod_history_component' and column_name like 'ppk_merch_group%') <> 28 then
    raise exception 'component ppk merch-group code/description columns incomplete';
  end if;

  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='coldlion' and c.relkind='r'
      and c.relname not in ('sync_run','window_ledger','change_log') and not c.relrowsecurity
  ) then raise exception 'a new landing table lacks RLS'; end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema='coldlion' and grantee in ('anon','authenticated')
      and table_name not in ('sync_run','window_ledger','change_log')
  ) then raise exception 'application role has a ColdLion landing grant'; end if;
end $$;

-- Behavioral refusal: retired division cannot land in division-scoped masters.
do $$
declare v_run uuid;
begin
  insert into coldlion.sync_run(endpoint,requested_by) values('/items','contract') returning id into v_run;
  begin
    insert into coldlion.item_header(company_code,division_code,item_no,run_id,fetched_at,source_hash,first_seen_at,last_seen_at)
    values('EDGEHOME','EP001','X',v_run,now(),repeat('a',64),now(),now());
    raise exception 'EP001 unexpectedly accepted';
  exception when check_violation then null;
  end;

  insert into coldlion.item_header(company_code,division_code,item_no,run_id,fetched_at,source_hash,first_seen_at,last_seen_at)
  values('EDGEHOME','CW001','01',v_run,now(),repeat('b',64),now(),now()),
        ('EDGEHOME','SP001','01',v_run,now(),repeat('c',64),now(),now());
  if (select count(*) from coldlion.item_header where item_no='01') <> 2 then
    raise exception 'division-specific item identity collapsed';
  end if;
end $$;

-- Per-grain history hashes: flattened component/lookup variations never fan out
-- extra parent lines, nullable labels replay idempotently, and stage is identity.
do $$
declare
  v_run uuid;
  v_line uuid;
  v_prod_line uuid;
begin
  insert into coldlion.sync_run(endpoint,requested_by)
  values('/orderHistory','history-grain-contract') returning id into v_run;

  insert into coldlion.order_history_line(
    company_code,sales_order_no,sales_order_line_no,master_item_no,label_code,
    line_qty,prepack_qty,line_source_hash,run_id,fetched_at)
  values('EDGEHOME',9001,1,'PACK-1',null,12,12,repeat('d',64),v_run,now())
  returning id into v_line;

  insert into coldlion.order_history_component(
    line_id,sub_item_no,sub_label_code,line_price,quantity,
    component_source_hash,run_id,fetched_at)
  values
    (v_line,'COMP-A',null,3.09,5,repeat('e',64),v_run,now()),
    (v_line,'COMP-B',null,3.64,7,repeat('f',64),v_run,now());

  if (select count(*) from coldlion.order_history_line where sales_order_no=9001) <> 1
     or (select count(*) from coldlion.order_history_component where line_id=v_line) <> 2 then
    raise exception 'multi-component sales line fanned out its parent';
  end if;

  begin
    insert into coldlion.order_history_line(
      company_code,sales_order_no,sales_order_line_no,master_item_no,label_code,
      line_qty,prepack_qty,line_source_hash,run_id,fetched_at)
    values('EDGEHOME',9001,1,'PACK-1',null,12,12,repeat('d',64),v_run,now());
    raise exception 'nullable-label replay duplicated';
  exception when unique_violation then null;
  end;

  -- Production history now follows the issue #2174 shape: a surrogate parent id, child
  -- FKs to it, and the requested/returned stage agreement. The invariants asserted here
  -- are unchanged - child-grain variation must not fan out the parent, and the stage is
  -- part of line identity.
  insert into coldlion.prod_history_line(
    company_code,prod_order_no,prod_line_seq,requested_stage_code,stage_code,
    prod_order_qty,source_observed_at,line_source_hash,run_id,fetched_at)
  values('EDGEHOME',7001,1,'ISS','ISS',12,now(),repeat('1',64),v_run,now())
  returning id into v_prod_line;

  insert into coldlion.prod_history_line(
    company_code,prod_order_no,prod_line_seq,requested_stage_code,stage_code,
    prod_order_qty,source_observed_at,line_source_hash,run_id,fetched_at)
  values('EDGEHOME',7001,1,'REC','REC',12,now(),repeat('1',64),v_run,now());

  insert into coldlion.prod_history_component(
    line_id,prepack_item_no,sub_item_no,line_price,
    component_source_hash,run_id,fetched_at)
  values
    (v_prod_line,'COMP-A','SUB-A',4.10,repeat('2',64),v_run,now()),
    (v_prod_line,'COMP-B','SUB-B',4.20,repeat('3',64),v_run,now());

  insert into coldlion.prod_history_last_lookup(
    line_id,last_prod_ref_no,last_prod_cost,
    lookup_source_hash,run_id,fetched_at)
  values
    (v_prod_line,'OLD',3.25,repeat('4',64),v_run,now()),
    (v_prod_line,'NEW',3.50,repeat('5',64),v_run,now());

  if (select count(*) from coldlion.prod_history_line
        where prod_order_no=7001 and stage_code='ISS') <> 1
     or (select count(*) from coldlion.prod_history_component
        where line_id=v_prod_line) <> 2
     or (select count(*) from coldlion.prod_history_last_lookup
        where line_id=v_prod_line) <> 2 then
    raise exception 'production component/last lookup variation fanned out its parent';
  end if;

  if (select count(*) from coldlion.prod_history_line where prod_order_no=7001) <> 2 then
    raise exception 'stage identity collapsed identical production payloads';
  end if;
end $$;

rollback;
