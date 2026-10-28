-- #4858 (owner 2026-10-27): every component's Case Pack is the whole carton's
-- piece count; one physical parent's cartons are counted once, never summed.
begin;

insert into plm.production_order(id,production_order_number,source_system,source_id,metadata)
values ('48580000-0000-4000-8000-000000000001','TEST-COLDLION-CASEPACK-4858','coldlion','test-casepack-4858',
        '{"customer_name":"Test case pack"}');

insert into plm.production_order_line
 (id,production_order_id,sku,quantity_ordered,case_pack,order_type,source_system,source_id,
  assortment_id,assortment_component_ordinal,metadata)
values
 ('48580000-0000-4000-8000-000000000011','48580000-0000-4000-8000-000000000001','TEST-PACK-A',1000,4,'FOB','coldlion',
  'coldlion:so:1900004858:line:1:component:1','TEST-ASSORTMENT',1,'{"line_qty":4000,"master_item_no":"TEST-ASSORTMENT"}'),
 ('48580000-0000-4000-8000-000000000012','48580000-0000-4000-8000-000000000001','TEST-PACK-B',1000,4,'FOB','coldlion',
  'coldlion:so:1900004858:line:1:component:2','TEST-ASSORTMENT',2,'{"line_qty":4000,"master_item_no":"TEST-ASSORTMENT"}'),
 ('48580000-0000-4000-8000-000000000013','48580000-0000-4000-8000-000000000001','TEST-PACK-C',1000,4,'FOB','coldlion',
  'coldlion:so:1900004858:line:1:component:3','TEST-ASSORTMENT',3,'{"line_qty":4000,"master_item_no":"TEST-ASSORTMENT"}'),
 ('48580000-0000-4000-8000-000000000015','48580000-0000-4000-8000-000000000001','TEST-PACK-D',1000,4,'FOB','coldlion',
  'coldlion:so:1900004858:line:1:component:4','TEST-ASSORTMENT',4,'{"line_qty":4000,"master_item_no":"TEST-ASSORTMENT"}'),
 ('48580000-0000-4000-8000-000000000014','48580000-0000-4000-8000-000000000001','TEST-DIRECT-PACK',12,4,'FOB','coldlion',
  'coldlion:so:1900004858:line:2:component:1',null,null,'{"line_qty":12,"master_item_no":"TEST-DIRECT-PACK"}');

do $tests$
declare n integer; t record;
begin
  select count(distinct assortment_parent_key) into n from api.dam_order_list
   where order_id='48580000-0000-4000-8000-000000000001' and assortment_component_ordinal is not null;
  if n<>1 then raise exception 'Four component designs must share one physical carton group'; end if;
  select count(*) into n from api.dam_order_list
   where order_id='48580000-0000-4000-8000-000000000001' and assortment_component_ordinal is not null
     and case_pack=4 and assortment_parent_quantity=4000 and assortment_parent_cases=1000
     and cases_reported is null and cases_error is null;
  if n<>4 then raise exception 'Every design must carry the whole-carton pack and the same 1000 physical cartons'; end if;
  select * into strict t from dam.dam_order_tracking where order_id='48580000-0000-4000-8000-000000000001';
  if t.total_cases is distinct from 1003::numeric or t.unknown_case_groups<>0 then
    raise exception 'Expected 1000 assortment cartons plus 3 direct-item cartons, got %',t.total_cases; end if;
end;
$tests$;

-- A conflicting whole-carton total must stay explicitly unknown.
update plm.production_order_line set case_pack=3 where id='48580000-0000-4000-8000-000000000012';
do $tests$
declare t record;
begin
  select * into strict t from dam.dam_order_tracking where order_id='48580000-0000-4000-8000-000000000001';
  if t.total_cases is not null or t.unknown_case_groups<>1 then
    raise exception 'Inconsistent carton totals must not publish a complete carton total'; end if;
end;
$tests$;

update plm.production_order_line set case_pack=null where id='48580000-0000-4000-8000-000000000012';
do $tests$
declare t record;
begin
  select * into strict t from dam.dam_order_tracking where order_id='48580000-0000-4000-8000-000000000001';
  if t.total_cases is not null or t.unknown_case_groups<>1 then
    raise exception 'Missing carton total must keep the physical group unknown'; end if;
end;
$tests$;

-- Existing Google/manual assortment behavior is independently covered by
-- dam_order_sheets_integration.sql, including differing parent packs.
rollback;
