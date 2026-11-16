-- Contract for public.import_dam_buy_sheet / dam.order_buy_sheet_import
-- (migration 20261110190600_dam_order_buy_sheet_import.sql). No fixtures: the
-- behaviour (match, update, held, idempotent re-upload) is exercised by the
-- PopDAM app tests and live dry run; this file pins the security shape.
do $$
declare v_def boolean; v_rls boolean;
begin
  select prosecdef into v_def from pg_proc
   where oid = 'public.import_dam_buy_sheet(uuid,text,text,jsonb,jsonb,jsonb,boolean,jsonb)'::regprocedure;
  if not v_def then raise exception 'import_dam_buy_sheet must be security definer'; end if;
  if has_function_privilege('anon', 'public.import_dam_buy_sheet(uuid,text,text,jsonb,jsonb,jsonb,boolean,jsonb)', 'execute') then
    raise exception 'anon must not execute import_dam_buy_sheet';
  end if;
  if not has_function_privilege('authenticated', 'public.import_dam_buy_sheet(uuid,text,text,jsonb,jsonb,jsonb,boolean,jsonb)', 'execute') then
    raise exception 'authenticated must execute import_dam_buy_sheet';
  end if;
  select relrowsecurity into v_rls from pg_class where oid = 'dam.order_buy_sheet_import'::regclass;
  if not v_rls then raise exception 'dam.order_buy_sheet_import must have RLS enabled'; end if;
  if has_table_privilege('authenticated', 'dam.order_buy_sheet_import', 'select')
     or has_table_privilege('anon', 'dam.order_buy_sheet_import', 'select') then
    raise exception 'browser roles must not read dam.order_buy_sheet_import directly';
  end if;
  begin
    perform public.import_dam_buy_sheet(gen_random_uuid(), 'x', repeat('a', 64), '{}', '[{"sku":"X","delivery_date":"2026-01-01","quantity":1}]', '{}', false);
    raise exception 'unauthenticated call was not refused';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Behaviour (review finding #6010): claim one existing line, hold an
-- ambiguous one, re-upload changes nothing and inserts nothing. Rolled back.
begin;
select set_config('request.jwt.claims', '{"sub":"b5e00000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
declare
  v_customer uuid; v_order uuid; v_line uuid; v_res jsonb; v_lines jsonb; v_before integer; v_after integer;
begin
  insert into core.customer (name, status) values ('BuySheet Contract ' || gen_random_uuid(), 'active') returning id into v_customer;
  insert into plm.production_order (production_order_number, company_id, metadata)
  values ('BSCT-1', v_customer, '{}') returning id into v_order;
  insert into plm.production_order_line (production_order_id, line_number, sku, start_ship_date)
  values (v_order, '1', 'BSCTSTYLE01', '2026-12-10') returning id into v_line;
  insert into plm.production_order_line (production_order_id, line_number, sku, start_ship_date)
  values (v_order, '2', 'BSCTSTYLE02', '2026-12-10'), (v_order, '3', 'BSCTSTYLE02', '2026-12-10');
  v_lines := '[{"sku":"bsctstyle01 ","delivery_date":"2026-12-10","quantity":600,"case_pack":4,"group":"g1"},
               {"sku":"BSCTSTYLE02","delivery_date":"2026-12-10","quantity":100,"case_pack":4,"group":"g1"},
               {"sku":"BSCTSTYLE03","delivery_date":"2026-12-10","quantity":100,"case_pack":4,"group":"g1"}]';

  v_res := public.import_dam_buy_sheet(v_customer, 'c.xlsx', repeat('b', 64), '{}', v_lines, '{}', false);
  if v_res -> 'counts' <> '{"held": 2, "updated": 1}'::jsonb then
    raise exception 'preview counts wrong: %', v_res -> 'counts';
  end if;
  if (select quantity_ordered from plm.production_order_line where id = v_line) is not null then
    raise exception 'preview wrote';
  end if;

  select count(*) into v_before from plm.production_order_line where production_order_id = v_order;
  v_res := public.import_dam_buy_sheet(v_customer, 'c.xlsx', repeat('b', 64), '{"rows":[]}', v_lines, '{}', true);
  if (select quantity_ordered from plm.production_order_line where id = v_line) <> 600 then
    raise exception 'claimed line not updated';
  end if;
  if not exists (select 1 from dam.order_buy_sheet_import where id = (v_res ->> 'import_id')::uuid) then
    raise exception 'import not recorded';
  end if;

  v_res := public.import_dam_buy_sheet(v_customer, 'c.xlsx', repeat('b', 64), '{"rows":[]}', v_lines, '{}', true);
  if v_res -> 'counts' <> '{"held": 2, "unchanged": 1}'::jsonb then
    raise exception 're-upload counts wrong: %', v_res -> 'counts';
  end if;
  select count(*) into v_after from plm.production_order_line where production_order_id = v_order;
  if v_after <> v_before then raise exception 're-upload inserted lines'; end if;

  -- Order numbers (plm.guard_production_po_number already forbids duplicate
  -- numbers): another customer's number is held, a free number creates the order, an existing own number gets the line.
  insert into plm.production_order (production_order_number, company_id, metadata)
  values ('BSCT-OTHER', null, '{"customer_name":"Someone Else"}'), ('BSCT-2', v_customer, '{}');
  v_lines := '[{"sku":"BSCTNEW02","delivery_date":"2026-12-20","quantity":10,"group":"other"},
               {"sku":"BSCTNEW03","delivery_date":"2026-12-20","quantity":10,"group":"free"},
               {"sku":"BSCTNEW04","delivery_date":"2026-12-20","quantity":10,"group":"own"}]';
  v_res := public.import_dam_buy_sheet(v_customer, 'c.xlsx', repeat('b', 64), '{}', v_lines,
    '{"other":"BSCT-OTHER","free":"BSCT-NEW","own":"BSCT-2"}', true);
  if v_res -> 'counts' <> '{"held": 1, "new": 2}'::jsonb then
    raise exception 'order-number counts wrong: %', v_res -> 'lines';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_res -> 'lines') r
                 where r ->> 'sku' = 'BSCTNEW02' and r ->> 'reason' like '%another customer%') then
    raise exception 'order-number hold reasons wrong: %', v_res -> 'lines';
  end if;
  if (select count(*) from plm.production_order where production_order_number = 'BSCT-NEW' and company_id = v_customer) <> 1
     or not exists (select 1 from plm.production_order_line where sku = 'BSCTNEW04'
                                 and production_order_id = (select id from plm.production_order where production_order_number = 'BSCT-2')) then
    raise exception 'new order / existing own order not used';
  end if;

  -- Revision of an already-imported sheet (shared-db#6025): a changed quantity
  -- on a claimed line, or a new style on an order an earlier import filled, is
  -- 'revision'; apply refuses the whole sheet and writes nothing.
  v_lines := '[{"sku":"BSCTSTYLE01","delivery_date":"2026-12-10","quantity":650,"group":"g1"},
               {"sku":"BSCTADDED","delivery_date":"2026-12-10","quantity":5,"group":"g1"},
               {"sku":"BSCTNEW05","delivery_date":"2026-12-20","quantity":10,"group":"fresh"}]';
  v_res := public.import_dam_buy_sheet(v_customer, 'c.xlsx', repeat('c', 64), '{}', v_lines,
    '{"g1":"BSCT-1","fresh":"BSCT-FRESH"}', false);
  if v_res -> 'counts' <> '{"new": 1, "revision": 2}'::jsonb then
    raise exception 'revision preview counts wrong: %', v_res -> 'lines';
  end if;
  select count(*) into v_before from dam.order_buy_sheet_import;
  begin
    perform public.import_dam_buy_sheet(v_customer, 'c.xlsx', repeat('c', 64), '{}', v_lines,
      '{"g1":"BSCT-1","fresh":"BSCT-FRESH"}', true);
    raise exception 'revision apply was not refused';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%revised buy sheets are not supported%' then raise; end if;
  end;
  if (select quantity_ordered from plm.production_order_line where id = v_line) <> 600
     or exists (select 1 from plm.production_order where production_order_number = 'BSCT-FRESH')
     or (select count(*) from dam.order_buy_sheet_import) <> v_before then
    raise exception 'refused revision wrote something';
  end if;

  -- A claimed line whose order is voided afterwards is held, not updated.
  update plm.production_order set voided_at = now() where id = v_order;
  v_res := public.import_dam_buy_sheet(v_customer, 'c.xlsx', repeat('b', 64), '{}',
    '[{"sku":"BSCTSTYLE01","delivery_date":"2026-12-10","quantity":700,"group":"g1"}]', '{}', true);
  if v_res -> 'counts' <> '{"held": 1}'::jsonb or (select quantity_ordered from plm.production_order_line where id = v_line) <> 600 then
    raise exception 'voided order line was not held: %', v_res;
  end if;
end $$;
rollback;

-- Master SKU instead of a D-number, and Clear (shared-db#6476). Rolled back.
begin;
select set_config('request.jwt.claims', '{"sub":"b5e00000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
declare
  v_customer uuid; v_order uuid; v_line uuid; v_res jsonb; v_lines jsonb; v_imp uuid;
begin
  if not has_function_privilege('authenticated', 'public.clear_dam_buy_sheet_import(uuid,boolean)', 'execute')
     or has_function_privilege('anon', 'public.clear_dam_buy_sheet_import(uuid,boolean)', 'execute') then
    raise exception 'clear_dam_buy_sheet_import grants wrong';
  end if;
  if to_regprocedure('public.import_dam_buy_sheet(uuid,text,text,jsonb,jsonb,jsonb,boolean)') is not null then
    raise exception 'old 7-argument import_dam_buy_sheet still exists';
  end if;
  insert into core.customer (name, status) values ('BuySheet MSKU ' || gen_random_uuid(), 'active') returning id into v_customer;
  insert into plm.production_order (production_order_number, company_id, metadata)
  values ('BSMS-1', v_customer, '{}') returning id into v_order;
  insert into plm.production_order_line (production_order_id, line_number, sku, start_ship_date, quantity_ordered)
  values (v_order, '1', 'BSMSOLD01', '2026-12-10', 50) returning id into v_line;
  -- Ordinary headers still need a number.
  begin
    insert into plm.production_order (production_order_number, company_id, metadata) values ('', v_customer, '{}');
    raise exception 'blank number accepted outside buy-sheet import';
  exception when check_violation then null;
  end;
  v_lines := '[{"sku":"BSMSNEW01","delivery_date":"2026-12-10","quantity":120,"group":"2026-12-10|1"},
               {"sku":"BSMSNEW02","delivery_date":"2026-12-10","quantity":60,"group":"2026-12-10|1"},
               {"sku":"BSMSOLD01","delivery_date":"2026-12-10","quantity":80,"group":"2026-12-10|1"},
               {"sku":"BSMSNEW03","delivery_date":"2026-12-20","quantity":10,"group":"2026-12-20|1"}]';
  v_res := public.import_dam_buy_sheet(v_customer, 'm.xlsx', repeat('d', 64), '{}', v_lines, '{}', false,
                                       '{"2026-12-10|1":" ma1234 "}');
  if v_res -> 'counts' <> '{"held": 1, "new": 2, "updated": 1}'::jsonb then
    raise exception 'master-sku preview counts wrong: %', v_res -> 'lines';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_res -> 'lines') r where r ->> 'sku' = 'BSMSNEW03'
                   and r ->> 'reason' = 'type the master SKU (assortment #) from JamieLynn for this pack') then
    raise exception 'missing master SKU hold reason wrong: %', v_res -> 'lines';
  end if;
  v_res := public.import_dam_buy_sheet(v_customer, 'm.xlsx', repeat('d', 64), '{}', v_lines, '{}', true,
                                       '{"2026-12-10|1":" ma1234 "}');
  v_imp := (v_res ->> 'import_id')::uuid;
  if (select count(distinct o.id) from plm.production_order_line l join plm.production_order o on o.id = l.production_order_id
       where l.sku in ('BSMSNEW01', 'BSMSNEW02') and o.production_order_number = '' and l.assortment_id = 'MA1234'
         and o.source_id = 'buysheet:order:' || repeat('d', 64) || ':2026-12-10|1') <> 1
     or (select count(*) from plm.production_order_line where sku in ('BSMSNEW01', 'BSMSNEW02')) <> 2 then
    raise exception 'blank-number order with assortment not created';
  end if;
  if (select assortment_id from plm.production_order_line where id = v_line) is distinct from 'MA1234'
     or not exists (select 1 from jsonb_array_elements(v_res -> 'lines') r where r ->> 'master_sku' = 'MA1234') then
    raise exception 'updated line assortment / master_sku echo wrong';
  end if;

  -- Non-uploader refused.
  perform set_config('request.jwt.claims', '{"sub":"b5e00000-0000-4000-8000-000000000003","role":"authenticated"}', true);
  begin
    perform public.clear_dam_buy_sheet_import(v_imp, false);
    raise exception 'non-uploader clear not refused';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', '{"sub":"b5e00000-0000-4000-8000-000000000002","role":"authenticated"}', true);

  v_res := public.clear_dam_buy_sheet_import(null, false);
  if (v_res ->> 'import_id')::uuid <> v_imp or (v_res ->> 'lines_to_delete')::int <> 2
     or (v_res ->> 'lines_to_restore')::int <> 1 or (v_res ->> 'orders_to_delete')::int <> 1 then
    raise exception 'clear preview wrong: %', v_res;
  end if;
  v_res := public.clear_dam_buy_sheet_import(v_imp, true);
  if exists (select 1 from plm.production_order_line where sku in ('BSMSNEW01', 'BSMSNEW02'))
     or exists (select 1 from plm.production_order where source_id like 'buysheet:order:' || repeat('d', 64) || ':%')
     or exists (select 1 from dam.order_buy_sheet_import where id = v_imp)
     or exists (select 1 from plm.production_order_line_source_ref r where r.production_order_line_id = v_line and r.source_system = 'popdam_buy_sheet') then
    raise exception 'clear apply left rows behind';
  end if;
  if (select quantity_ordered from plm.production_order_line where id = v_line) <> 50
     or (select assortment_id from plm.production_order_line where id = v_line) is not null
     or (select metadata ? 'buy_sheet' from plm.production_order_line where id = v_line) then
    raise exception 'updated line not restored';
  end if;

  -- A real PO put on a blank order later blocks Clear.
  v_res := public.import_dam_buy_sheet(v_customer, 'm.xlsx', repeat('e', 64), '{}',
    '[{"sku":"BSMSNEW09","delivery_date":"2026-12-10","quantity":5,"group":"g"}]', '{}', true, '{"g":"MA9"}');
  update plm.production_order set production_order_number = 'D-BSMS-' || left(gen_random_uuid()::text, 8)
   where source_id = 'buysheet:order:' || repeat('e', 64) || ':g';
  begin
    perform public.clear_dam_buy_sheet_import((v_res ->> 'import_id')::uuid, true);
    raise exception 'clear after PO was not refused';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%real PO number%' then raise; end if;
  end;
end $$;
rollback;
