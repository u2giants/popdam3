-- Run on an isolated integration database or governed PREVIEW, never production.
-- Fixtures and edits are always rolled back. Unknowns remain unknown.
begin;

do $tests$
declare actual text;
begin
  if dam.orderlist_parse_boolean('FALSE') is distinct from false
    or dam.orderlist_parse_boolean(' TRUE ') is distinct from true
    or dam.orderlist_parse_boolean('pending') is not null
    or dam.orderlist_parse_boolean(null) is not null then
    raise exception 'Boolean status parsing lost false or invented a result';
  end if;
  if dam.orderlist_license_status('{}',false) is distinct from 'No Info'
    or dam.orderlist_license_status('{"R":"2026-01-01"}',false) is distinct from 'Concept Approved'
    or dam.orderlist_license_status('{"concept_approval":"2026-01-01","production_approval":"2026-02-01"}',false) is distinct from 'Production Approved'
    or dam.orderlist_license_status('{"AC":"2026-02-01"}',true) is distinct from 'Discontinue' then
    raise exception 'Licensed status priority differs from source milestone logic';
  end if;
  if dam.orderlist_cargo_forecast('C Stock','NJ','2026-02-20') is distinct from date '2026-01-14'
    or dam.orderlist_cargo_forecast('FOB','NJ','2026-02-20') is distinct from date '2026-02-13'
    or dam.orderlist_cargo_forecast('POE','CA','2026-02-20') is distinct from date '2026-01-28'
    or dam.orderlist_cargo_forecast('POE','UNKNOWN','2026-02-20') is not null then
    raise exception 'Cargo forecasts must calculate each line independently';
  end if;
  actual:=dam.orderlist_po_status('FOB','TEST-SKU',null,12,6,false,'Booked',null,null,null,'TEST-PO');
  if actual is distinct from 'Booked FOB' then raise exception 'FOB booking priority failed'; end if;
  actual:=dam.orderlist_po_status('POE','TEST-SKU',null,12,6,false,'Booked','2026-01-01',null,null,'TEST-PO');
  if actual is distinct from 'Confirmed Booking' then raise exception 'ETD must outrank booking state'; end if;
  actual:=dam.orderlist_po_status('POE','TEST-SKU',null,12,6,true,'Booked','2026-01-01',null,null,'TEST-PO');
  if actual is distinct from 'Close tracking' then raise exception 'Closed tracking must outrank shipping states'; end if;
  if not exists(select 1 from pg_proc where oid='dam.orderlist_product_facts(uuid,text)'::regprocedure and proretset and prosqlbody is not null and not prosecdef and proconfig is null) then
    raise exception 'Product facts must keep its bound, invoker SQL table-function body'; end if;
  if has_function_privilege('anon','public.update_dam_order_tracking(uuid,jsonb)','execute')
    or has_table_privilege('anon','dam.dam_order_tracking','select') then
    raise exception 'Anonymous access is forbidden';
  end if;
end;
$tests$;

create temp table integration_ids(key text primary key,id uuid default gen_random_uuid());
insert into integration_ids(key) values('item'),('licensed'),('duplicate'),('generic'),('order'),('line'),('sample-line'),('coldlion-order'),('coldlion-line');

insert into plm.item(id,item_number,description,name,source_system,source_id)
select id,'TEST-INTEGRATION-SKU','Canonical Item Master description','Canonical name','integration_test','integration-fixture-item' from integration_ids where key='item';
insert into public.style_tracker_rows(id,source_workbook_id,source_sheet,source_row_number,tracker_type,description,license_status,default_vendor,discontinued,row_data)
select id,'integration-test','License.Style',900001,'licensed','Outdated tracker description','Outdated cached status','TEST-PRIMARY-VENDOR',false,
  '{"sample_vendor":"TEST-SAMPLE-VENDOR","professional_photos":true,"test_report":false,"contractual_samples_reorder":true,"concept_approval":"2026-01-01"}'::jsonb
from integration_ids where key='licensed';
insert into plm.style_tracker_item_bridge(style_tracker_row_id,source_workbook_id,source_sheet,tracker_type,plm_item_id)
select s.id,'integration-test','License.Style','licensed',i.id from integration_ids s cross join integration_ids i where s.key='licensed' and i.key='item';
insert into plm.production_order(id,production_order_number,sent_po_date,eta,close_tracking,metadata)
select id,'TEST-INTEGRATION-PO',current_date,'2026-04-10',false,'{"customer_name":"Test-Customer","order_vendor_name":"Test-Vendor"}'::jsonb from integration_ids where key='order';
insert into plm.production_order_line(id,production_order_id,item_id,sku,quantity_ordered,case_pack,order_type,source_style_type,test_report,professional_photos)
select l.id,o.id,i.id,'TEST-INTEGRATION-SKU',24,6,'POE','licensed','true','false'
from integration_ids l cross join integration_ids o cross join integration_ids i where l.key='line' and o.key='order' and i.key='item';
insert into plm.production_order_line(id,production_order_id,sku,quantity_ordered,case_pack,order_type)
select l.id,o.id,'TEST-SAMPLE-SKU',6,6,'Contractual Sample'
from integration_ids l cross join integration_ids o where l.key='sample-line' and o.key='order';

do $tests$
declare r record; tracking record;
begin
  select * into strict r from api.dam_order_list where order_line_id=(select id from integration_ids where key='line');
  if r.item_description is distinct from 'Canonical Item Master description' or r.master_data_description is distinct from 'Canonical Item Master description'
    or r.master_data_license_status is distinct from 'Concept Approved' or r.test_report is distinct from 'false' or r.professional_photos is distinct from 'true'
    or r.master_data_sample_vendor is distinct from 'TEST-SAMPLE-VENDOR' or r.contractual_sample_reorder is distinct from true
    or r.cases_reported is distinct from 4 or r.order_status is distinct from 'Sent PO'
    or r.snapshot_test_report is distinct from 'true' or r.snapshot_professional_photos is distinct from 'false' then raise exception 'Live Master Data outputs or computed cases failed'; end if;
  select * into strict tracking from dam.dam_order_tracking where order_id=r.order_id;
  if tracking.total_cases is distinct from 4 or tracking.line_count is distinct from 2 or tracking.missing_test_reports is distinct from 2
    or tracking.missing_photos is distinct from 1
    or (select c->>'workflow_source' from jsonb_array_elements(tracking.components) c where c->>'sku'='TEST-INTEGRATION-SKU') is distinct from 'master_data'
    or tracking.warehouse_date is distinct from date '2026-04-15' then
    raise exception 'PO aggregate duplicated components or lost missing-value warnings';
  end if;
  -- Clearing a current status must not resurrect the imported value.
  update public.style_tracker_rows set row_data=row_data||'{"AI":true,"AH":true,"test_report":null,"professional_photos":false,"production_approval":"2026-03-01"}'::jsonb
    where id=(select id from integration_ids where key='licensed');
  select * into strict r from api.dam_order_list where order_line_id=r.order_line_id;
  if r.test_report is not null or r.professional_photos is distinct from 'false' or r.master_data_license_status is distinct from 'Production Approved' then
    raise exception 'Current edits/clears must reach OrderList without rewriting order lines';
  end if;
  if (select test_report from plm.production_order_line where id=r.order_line_id) is distinct from 'true' then
    raise exception 'Integration must not rewrite historical imported facts';
  end if;
end;
$tests$;

-- Two conflicting tracker rows linked to one item must become a visible unknown,
-- not two order rows or an arbitrary selected product value.
insert into public.style_tracker_rows(id,source_workbook_id,source_sheet,source_row_number,tracker_type,description,license_status,default_vendor,discontinued,row_data)
select id,'integration-test','License.Style',900002,'licensed','Another tracker','No Info','OTHER-VENDOR',false,'{}'::jsonb from integration_ids where key='duplicate';
insert into plm.style_tracker_item_bridge(style_tracker_row_id,source_workbook_id,source_sheet,tracker_type,plm_item_id)
select s.id,'integration-test','License.Style','licensed',i.id from integration_ids s cross join integration_ids i where s.key='duplicate' and i.key='item';
do $tests$
declare r record;
begin
  select * into strict r from api.dam_order_list where order_line_id=(select id from integration_ids where key='line');
  if r.product_workflow_source is distinct from 'ambiguous' or r.master_data_default_vendor is not null or r.test_report is not null
    or r.item_description is distinct from 'Canonical Item Master description'
    or r.snapshot_test_report is distinct from 'true' or r.snapshot_professional_photos is distinct from 'false' then
    raise exception 'Conflicting tracker facts must abstain while preserving the canonical item';
  end if;
end;
$tests$;

insert into plm.production_order(id,production_order_number,source_system,status)
select id,'coldlion/SO-TEST','coldlion','confirmed' from integration_ids where key='coldlion-order';
do $tests$
begin
  if exists(select 1 from dam.dam_order_tracking where order_id=(select id from integration_ids where key='coldlion-order')) then
    raise exception 'Sales-history placeholders are not production PO tracking records';
  end if;
end;
$tests$;

insert into plm.production_order_line(id,production_order_id,sku,quantity_ordered,case_pack,order_type)
select l.id,o.id,'TEST-SALES-SKU',12,6,'FOB' from integration_ids l cross join integration_ids o where l.key='coldlion-line' and o.key='coldlion-order';
do $tests$
begin
  if (select order_status from api.dam_order_list where order_line_id=(select id from integration_ids where key='coldlion-line')) is distinct from 'confirmed' then
    raise exception 'Sales-history status must remain the ERP status'; end if;
end;
$tests$;

-- The write guards must actually fire, not merely be present in source text.
-- Test-only synthetic account: use the repository's invitation-gate fixture pattern.
-- Restore normal trigger behavior immediately, before any access/write assertion.
set local session_replication_role=replica;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000001','order-integration-fixture@example.invalid') on conflict(id) do nothing;
set local session_replication_role=origin;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":[]}}';
do $tests$
begin
  if auth.uid() is distinct from '00000000-0000-4000-8000-000000000001'::uuid or app.has_role('administrator'::app.app_role) is true then
    raise exception 'Non-administrator fixture is not an authenticated normal user'; end if;
  begin
    perform public.update_dam_order_tracking((select id from integration_ids where key='order'),'{}');
    raise exception 'A normal user unexpectedly changed PO tracking';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.upsert_dam_order_sample_depth('TEST-SKU','TEST-CUSTOMER',1);
    raise exception 'A normal user unexpectedly changed sample depth';
  exception when insufficient_privilege then null;
  end;
end;
$tests$;

set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["administrator"]}}';
do $tests$
declare v_order_id uuid := (select id from integration_ids where key='order'); r record; invalid_number text;
begin
  perform public.update_dam_order_tracking(v_order_id,'{"sent_po_date":"2026-03-01","vendor_delivery_date":"2026-03-15","booking_state":"Booked","etd":"2026-03-20","comment":"Reviewed fixture","worksheet_done":true,"inspection_passed":"2026-04-01","container_booking_group":"BN-TEST"}');
  select * into strict r from dam.dam_order_tracking where dam.dam_order_tracking.order_id=v_order_id;
  if r.sent_po_date is distinct from date '2026-03-01' or r.comment is distinct from 'Reviewed fixture' or r.worksheet_done is distinct from true then
    raise exception 'Administrator tracking edit did not persist atomically';
  end if;
  if r.inspection_passed is distinct from date '2026-04-01' or r.svn_number is distinct from 'S'||(date '2026-04-01'-date '1899-12-30')::text||'-EST-INTEGRATION-PO' or r.booking_string is distinct from 'BN-TEST,TEST-INTEGRATION-PO' then
    raise exception 'Inspection date and derived SVN/booking references differ from Sheets';
  end if;
  perform public.update_dam_order_tracking(v_order_id,'{"close_tracking":true}');
  if (select order_status from api.dam_order_list where order_line_id=(select id from integration_ids where key='line')) is distinct from 'Close tracking' then
    raise exception 'Current close-tracking must update line status'; end if;
  perform public.update_dam_order_tracking(v_order_id,'{"close_tracking":null}');
  if (select close_tracking from plm.production_order where id=v_order_id) is distinct from false then
    raise exception 'Null close-tracking must reopen'; end if;
  perform public.update_dam_order_tracking(v_order_id,'{"close_tracking":true}');
  perform public.update_dam_order_tracking(v_order_id,'{"close_tracking":""}');
  if (select close_tracking from plm.production_order where id=v_order_id) is distinct from false then
    raise exception 'Blank close-tracking must reopen'; end if;
  perform public.update_dam_order_tracking(v_order_id,'{"comment":null}');
  select * into strict r from dam.dam_order_tracking where dam.dam_order_tracking.order_id=v_order_id;
  if r.comment is not null or r.sent_po_date is distinct from date '2026-03-01' then
    raise exception 'Explicit clearing must preserve omitted fields';
  end if;
  begin
    perform public.update_dam_order_tracking(v_order_id,'{"production_order_number":"WRONG"}');
    raise exception 'Tracking unexpectedly changed protected identity';
  exception when insufficient_privilege then null; end;
  begin
    perform public.update_dam_order_tracking(v_order_id,'{"comment":"Must roll back","eta":"not-a-date"}');
    raise exception 'Invalid tracking date was accepted';
  exception when invalid_datetime_format then null; end;
  if exists(select 1 from dam.dam_order_tracking where dam.dam_order_tracking.order_id=v_order_id and comment='Must roll back') then
    raise exception 'Failed tracking patch partially wrote other fields';
  end if;
  if (select license_status from public.get_dam_style_tracker_license_status(array[(select id from integration_ids where key='licensed')])) is distinct from 'Production Approved' then
    raise exception 'Master Data and OrderList must use the same live milestone status';
  end if;
  begin
    perform public.get_dam_style_tracker_license_status(array_fill(v_order_id,array[1001]));
    raise exception 'Master status request exceeded bounded capacity';
  exception when invalid_parameter_value then null; end;
  foreach invalid_number in array array['NaN','Infinity','-Infinity','0','-1'] loop
    begin
      perform public.upsert_dam_order_sample_depth('NONFINITE-TEST','TEST-CUSTOMER',invalid_number::numeric);
      raise exception 'Nonpositive/nonfinite sample depth accepted: %',invalid_number;
    exception when check_violation then null; end;
  end loop;
  foreach invalid_number in array array['NaN','Infinity','-Infinity','-1'] loop
    begin
      perform public.update_dam_order_tracking(v_order_id,jsonb_build_object('cbm',invalid_number,'comment','INVALID-NUMBER-PATCH'));
      raise exception 'Negative/nonfinite tracking volume accepted: %',invalid_number;
    exception when check_violation then null; end;
  end loop;
  if exists(select 1 from dam.order_tracking_ext where order_id=v_order_id and comment='INVALID-NUMBER-PATCH') then
    raise exception 'Rejected numeric patch partly wrote tracking'; end if;
  perform public.update_dam_order_tracking(v_order_id,'{"cbm":0}');
  if (select cbm from dam.order_tracking_ext where order_id=v_order_id) is distinct from 0::numeric then
    raise exception 'Zero volume is a valid manual input'; end if;
  perform public.upsert_dam_order_sample_depth(' TEST-INTEGRATION-SKU ',' Test-Customer ',1.5);
  if not exists(select 1 from api.dam_order_sample_depth where sku_normalized='test-integration-sku' and customer_normalized='test-customer' and depth_inches=1.5) then
    raise exception 'Customer-specific sample depth normalized incorrectly';
  end if;
  perform public.upsert_dam_order_customer_settings(' Test-Customer ','TEST');
  select * into strict r from api.dam_order_list where order_line_id=(select id from integration_ids where key='line');
  if r.customer_name is distinct from 'Test-Customer' or r.vendor_name is distinct from 'Test-Vendor' or r.customer_suffix is distinct from 'TEST' or r.sample_depth_inches is distinct from 1.5 then
    raise exception 'Preserved source names must resolve customer settings and sample depth without guessing directory identities';
  end if;
  perform public.update_dam_order_tracking(v_order_id,jsonb_build_object('sent_po_date',current_date));
  if not exists(select 1 from api.dam_order_vendor_statistics where vendor_name='Test-Vendor' and order_count=1 and activity_status='Active') then
    raise exception 'Vendor statistics must include source-labelled POs whose directory identity is unresolved';
  end if;
  update plm.production_order set warehouse_date='2026-01-01' where id=v_order_id;
  perform public.update_dam_order_tracking(v_order_id,'{"eta":"2026-04-20"}');
  if (select warehouse_date from dam.dam_order_tracking where order_id=v_order_id) is distinct from date '2026-04-25' then
    raise exception 'Current ETA must drive warehouse forecast rather than a stale imported forecast';
  end if;

  if not exists(select 1 from api.dam_order_customer_settings where customer_normalized='test-customer' and suffix='TEST') then
    raise exception 'Customer suffix did not persist';
  end if;
end;
$tests$;

-- Non-primary historical source identities must never multiply visible lines.
insert into plm.production_order_line_source_ref(production_order_line_id,source_system,source_id,is_primary)
select id,'google_order_list','integration-ref-'||n,n=1 from integration_ids cross join generate_series(1,3) n where key='line';
do $tests$
begin
  if (select count(*) from api.dam_order_list where order_line_id=(select id from integration_ids where key='line')) is distinct from 1::bigint
    or (select google_source_id from api.dam_order_list where order_line_id=(select id from integration_ids where key='line')) is distinct from 'integration-ref-1' then
    raise exception 'Non-primary source identities multiplied an order line'; end if;
end;
$tests$;

-- Source parent cases count once even with multiple linked assortment components.
insert into integration_ids(key) values('parent-order'),('parent-a'),('parent-b'),('parent-c');
insert into plm.production_order(id,production_order_number,seal_container_date)
select id,'TEST-PARENT-PO','2026-03-15' from integration_ids where key='parent-order';
insert into plm.production_order_line(id,production_order_id,sku,quantity_ordered,case_pack,order_type,assortment_id,assortment_component_ordinal,metadata)
select l.id,o.id,'TEST-COMPONENT',null,6,'POE','TEST-AS',case l.key when 'parent-a' then 1 else 2 end,
  jsonb_build_object('order_list_source',jsonb_build_object('spreadsheet_id','TEST','tab','Order','sheet_row',case l.key when 'parent-c' then 20 else 10 end),
    'order_list_snapshot',jsonb_build_object('assortment_parent_quantity','24','component_quantity_source','absent_never_guessed'))
from integration_ids l cross join integration_ids o where l.key in ('parent-a','parent-b','parent-c') and o.key='parent-order';
do $tests$
declare r record;
begin
  select * into strict r from dam.dam_order_tracking where order_id=(select id from integration_ids where key='parent-order');
  if r.total_cases is distinct from 8::numeric or r.line_count is distinct from 3::bigint or r.unknown_case_groups is distinct from 0::bigint
    or r.seal_container_forecast is distinct from date '2026-04-05' or r.seal_container_forecast_status is not null then
    raise exception 'Physical source parents must count once and CRD fallback must drive forecasts'; end if;
  if exists(select 1 from api.dam_order_list where order_id=r.order_id and quantity_ordered is not null) then
    raise exception 'Component quantities were invented from the assortment parent'; end if;
  update plm.production_order_line set case_pack=12 where id=(select id from integration_ids where key='parent-b');
  select * into strict r from dam.dam_order_tracking where order_id=r.order_id;
  if r.total_cases is not null or r.unknown_case_groups is distinct from 1::bigint then
    raise exception 'Conflicting component packs must not publish a complete physical case total'; end if;
  perform public.update_dam_order_tracking(r.order_id,'{"vendor_delivery_date":null}');
  select * into strict r from dam.dam_order_tracking where order_id=r.order_id;
  if r.vendor_delivery_date is not null or r.seal_container_forecast is not null or r.seal_container_forecast_status is distinct from 'No date' then
    raise exception 'Explicit CRD clearing resurrected a legacy date'; end if;
  if (select seal_container_date from plm.production_order where id=r.order_id) is distinct from date '2026-03-15' then
    raise exception 'Current clearing rewrote the original compatibility date'; end if;
  update plm.production_order set warehouse_date='2026-02-20' where id=r.order_id;
  perform public.update_dam_order_tracking(r.order_id,'{"eta":null}');
  if (select warehouse_date from dam.dam_order_tracking where order_id=r.order_id) is not null then
    raise exception 'Explicit ETA clearing resurrected a legacy warehouse forecast'; end if;
  if dam.orderlist_parse_number('NaN') is not null or dam.orderlist_parse_number('bad') is not null
    or dam.orderlist_parse_number('24') is distinct from 24::numeric then raise exception 'Unsafe source numeric parsing'; end if;
  if dam.orderlist_license_status('{"production_approval":null,"AC":"2026-01-01"}',false) is distinct from 'No Info' then
    raise exception 'An explicit current milestone clear resurrected an old spreadsheet letter'; end if;
  perform public.update_dam_order_tracking(r.order_id,'{"inspection_passed":"2026-01-01"}');
  perform public.update_dam_order_tracking(r.order_id,'{"inspection_passed":""}');
  if (select inspection_passed from dam.dam_order_tracking where order_id=r.order_id) is not null then
    raise exception 'Blank date must clear without affecting other fields'; end if;
  if (select count(*) from public.get_dam_order_tracking(0,1,'TEST-PARENT-PO',false)) is distinct from 1::bigint then
    raise exception 'Bounded tracking page failed'; end if;
  begin
    perform public.get_dam_order_tracking(0,201,null,false); raise exception 'Oversized tracking request accepted';
  exception when invalid_parameter_value then null; end;
end;
$tests$;

insert into public.style_tracker_rows(id,source_workbook_id,source_sheet,source_row_number,tracker_type,license_status,row_data)
select id,'integration-test','Generic.Style',900003,'generic','Stale Generic Status','{}'::jsonb from integration_ids where key='generic';
do $tests$
begin
  if (select license_status from public.get_dam_style_tracker_license_status(array[(select id from integration_ids where key='generic')])) is distinct from 'Generic Item' then
    raise exception 'Master Data generic status must match OrderList'; end if;
end;
$tests$;

insert into integration_ids(key) values('sample-only-order'),('sample-only-line');
insert into plm.production_order(id,production_order_number)
select id,'TEST-SAMPLE-ONLY-PO' from integration_ids where key='sample-only-order';
insert into plm.production_order_line(id,production_order_id,sku,quantity_ordered,case_pack,order_type)
select l.id,o.id,'TEST-SAMPLE-ONLY-SKU',6,6,'Contractual Sample' from integration_ids l cross join integration_ids o where l.key='sample-only-line' and o.key='sample-only-order';
do $tests$
begin
  if (select total_cases from dam.dam_order_tracking where order_id=(select id from integration_ids where key='sample-only-order')) is distinct from 0::numeric then
    raise exception 'An order with only excluded samples has zero production cases'; end if;
  if exists(select 1 from public.get_dam_order_tracking(0,200,'TEST-%-LITERAL',false)) then
    raise exception 'Tracking search treated a literal wildcard as a pattern'; end if;
end;
$tests$;

-- Missing and wrong-catalog workflow facts remain unknown, with explicit import evidence.
delete from plm.style_tracker_item_bridge where style_tracker_row_id=(select id from integration_ids where key='duplicate');
update plm.production_order_line set metadata='{"order_list_source":{"sheet_row":42},"order_list_snapshot":{"source_row":7}}'::jsonb where id=(select id from integration_ids where key='line');
do $tests$
declare r record;
begin
  select * into strict r from api.dam_order_list where order_line_id=(select id from integration_ids where key='line');
  if r.snapshot_source_row is distinct from '42' or r.item_link_type_mismatch is distinct from false then
    raise exception 'Source-row precedence or matched-catalog flag failed'; end if;
  update plm.production_order_line set source_style_type='generic' where id=r.order_line_id;
  select * into strict r from api.dam_order_list where order_line_id=r.order_line_id;
  if r.item_link_type_mismatch is distinct from true or r.product_workflow_source is distinct from 'unavailable'
    or r.test_report is not null or r.professional_photos is not null or r.snapshot_test_report is distinct from 'true' then
    raise exception 'Wrong catalog must abstain without losing imported history'; end if;
  update plm.production_order_line set source_style_type='licensed' where id=r.order_line_id;
  delete from plm.style_tracker_item_bridge where style_tracker_row_id=(select id from integration_ids where key='licensed');
  select * into strict r from api.dam_order_list where order_line_id=r.order_line_id;
  if r.item_link_type_mismatch is distinct from false or r.product_workflow_source is distinct from 'unavailable'
    or r.test_report is not null or r.professional_photos is not null or r.snapshot_professional_photos is distinct from 'false' then
    raise exception 'Unavailable workflow must preserve separate import evidence'; end if;
  if (select customer_suffix from api.dam_order_list where order_line_id=(select id from integration_ids where key='sample-line')) is distinct from 'CONT' then
    raise exception 'Contractual sample suffix override failed'; end if;
  update plm.production_order_line set order_type='David Sample' where id=(select id from integration_ids where key='sample-line');
  if (select customer_suffix from api.dam_order_list where order_line_id=(select id from integration_ids where key='sample-line')) is distinct from 'David' then
    raise exception 'David sample suffix override failed'; end if;
  update plm.production_order_line set quantity_ordered=0 where id=(select id from integration_ids where key='parent-c');
  select * into strict r from api.dam_order_list where order_line_id=(select id from integration_ids where key='parent-c');
  if r.cases_reported is not null or r.cases_error is distinct from 'Wrong QTY' then
    raise exception 'Zero quantity below pack must remain an invalid case total'; end if;
end;
$tests$;

grant select on integration_ids to authenticated;
do $fixture_privilege$
begin
  if not has_schema_privilege('authenticated',pg_my_temp_schema(),'usage') then
    raise exception 'Authenticated fixture cannot read its temporary schema'; end if;
end;
$fixture_privilege$;
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":[]}}';
set local role authenticated;
do $viewer$
declare r record;
begin
  select * into strict r from api.dam_order_list where order_line_id=(select id from integration_ids where key='line');
  if r.item_description is distinct from 'Canonical Item Master description' then raise exception 'Authenticated item projection unavailable'; end if;
  select * into strict r from dam.dam_order_tracking where order_id=(select id from integration_ids where key='order');
  if r.line_count is distinct from 2::bigint then raise exception 'Authenticated PO view unavailable'; end if;
  if (select count(*) from public.get_dam_order_tracking(0,1,'TEST-PARENT-PO',false)) is distinct from 1::bigint then raise exception 'Authenticated bounded RPC unavailable'; end if;
  perform 1 from api.dam_order_vendor_statistics limit 1;
  begin
    perform public.update_dam_order_tracking(r.order_id,'{"comment":"DENIED"}'); raise exception 'Viewer tracking edit was accepted';
  exception when insufficient_privilege then null; end;
end;
$viewer$;
reset role;
rollback;
