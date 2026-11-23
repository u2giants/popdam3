-- Regression coverage for PopDAM's SKU lookup (popcre/shared-db#6988).
begin;

insert into core.customer (id, name)
values ('69880000-0000-4000-8000-000000000001', 'ZZTEST SKU Lookup Customer');

insert into plm.production_order
  (id, production_order_number, company_id, status, requested_ship_date, source_system, source_id, metadata)
values
  ('69880000-0000-4000-8000-000000000011', 'ZZTEST-6988-PO', '69880000-0000-4000-8000-000000000001',
   'Header Status', '2026-12-15', 'coldlion', 'test-6988-production', '{}'),
  ('69880000-0000-4000-8000-000000000012', 'ZZTEST-6988-PO-NO-DATE', null,
   '', null, null, 'test-6988-production-no-date', '{}'),
  ('69880000-0000-4000-8000-000000000013', 'coldlion/test-6988', null,
   null, null, 'coldlion', 'test-6988-legacy', '{}'),
  ('69880000-0000-4000-8000-000000000014', 'COLDLION-SO-1900006988', null,
   null, null, 'google_order_list', 'test-6988-placeholder', '{"production_order_number_origin":"coldlion_intake_placeholder"}');

insert into plm.production_order_line
  (production_order_id, sku, status, quantity_ordered, cancel_date, source_system, source_id,
   assortment_component_ordinal, metadata)
values
  ('69880000-0000-4000-8000-000000000011', 'ZZTEST-6988-SKU', 'Line Status', 7, '2026-12-01',
   'google_order_list', 'test-6988-direct', null, '{}'),
  ('69880000-0000-4000-8000-000000000011', 'ZZTEST-6988-SKU', null, null, null,
   'google_order_list', 'test-6988-component-1', 1,
   '{"order_list_source":{"spreadsheet_id":"test","tab":"Order","sheet_row":"6988"},
     "order_list_snapshot":{"component_quantity_source":"absent_never_guessed","assortment_parent_quantity":"24"}}'),
  ('69880000-0000-4000-8000-000000000011', 'ZZTEST-6988-SKU', null, null, null,
   'google_order_list', 'test-6988-component-2', 2,
   '{"order_list_source":{"spreadsheet_id":"test","tab":"Order","sheet_row":"6988"},
     "order_list_snapshot":{"component_quantity_source":"absent_never_guessed","assortment_parent_quantity":"24"}}'),
  ('69880000-0000-4000-8000-000000000012', 'ZZTEST-6988-SKU', 'Line Status', 2, '2026-12-01',
   'google_order_list', 'test-6988-no-date', null, '{}'),
  ('69880000-0000-4000-8000-000000000013', 'ZZTEST-6988-SKU', null, 1, null,
   'coldlion', 'test-6988-legacy', null, '{}'),
  ('69880000-0000-4000-8000-000000000014', 'ZZTEST-6988-SKU', null, 1, null,
   'coldlion', 'test-6988-placeholder', null, '{}');

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","app_metadata":{"roles":[]}}', true);

do $tests$
declare
  looked_up record;
begin
  if (select count(*) from api.dam_production_orders_for_sku(' zztest-6988-sku ')) <> 2 then
    raise exception 'Expected exactly two production orders for the normalized SKU';
  end if;

  select * into strict looked_up from api.dam_production_orders_for_sku('ZZTEST-6988-SKU')
  where production_order_number = 'ZZTEST-6988-PO';
  if looked_up.status is distinct from 'Header Status'
     or looked_up.customer_name is distinct from 'ZZTEST SKU Lookup Customer'
     or looked_up.quantity is distinct from 31::numeric
     or looked_up.due_date is distinct from date '2026-12-15' then
    raise exception 'Unexpected production order summary: %', looked_up;
  end if;

  select * into strict looked_up from api.dam_production_orders_for_sku('ZZTEST-6988-SKU')
  where production_order_number = 'ZZTEST-6988-PO-NO-DATE';
  if looked_up.status is distinct from 'Line Status' or looked_up.due_date is not null then
    raise exception 'Expected line status fallback and no requested ship date: %', looked_up;
  end if;
end;
$tests$;

rollback;
