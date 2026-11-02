-- Synthetic isolated-DB fixtures; never run against a shared database.
insert into plm.item values
 ('99999999-9999-4999-8999-000000000001','ZZ-WORKFLOW','ZZ-WORKFLOW','coldlion','{"companyCode":"ZZ"}'),
 ('99999999-9999-4999-8999-000000000002','ZZ-WORKFLOW','ZZ-WORKFLOW','coldlion','{"companyCode":"ZZ"}');
insert into public.style_tracker_rows values
 ('99999999-9999-4999-8999-000000000011',' zz-workflow ','licensed','{"test_report":false,"professional_photos":false}',false,null,null,null,null);
insert into plm.style_tracker_item_bridge values
 ('99999999-9999-4999-8999-000000000021','99999999-9999-4999-8999-000000000002','99999999-9999-4999-8999-000000000011','licensed');
DO $$ declare f jsonb; begin
 select facts into f from dam.orderlist_product_facts('99999999-9999-4999-8999-000000000001','licensed');
 assert f->>'source'='master_data' and f->>'test_report'='false' and f->>'professional_photos'='false','unique fallback';
 assert (select facts->>'source' from dam.orderlist_product_facts('99999999-9999-4999-8999-000000000001','generic'))='unavailable','wrong catalog';
 assert (select facts->>'source' from dam.orderlist_product_facts('99999999-9999-4999-8999-000000000001',null))='unavailable','absent catalog';

 update plm.item set item_number=' ',style_number=' ' where id='99999999-9999-4999-8999-000000000001';
 update public.style_tracker_rows set sku=' ';
 assert (select facts->>'source' from dam.orderlist_product_facts('99999999-9999-4999-8999-000000000001','licensed'))='unavailable','blank style never falls back';
 update plm.item set item_number='ZZ-WORKFLOW',style_number='ZZ-WORKFLOW' where id='99999999-9999-4999-8999-000000000001';
 update public.style_tracker_rows set sku=' zz-workflow ';
 update plm.item set raw='{"companyCode":"OTHER"}' where id='99999999-9999-4999-8999-000000000002';
 assert (select facts->>'source' from dam.orderlist_product_facts('99999999-9999-4999-8999-000000000001','licensed'))='unavailable','company isolation';
 update plm.item set raw='{"companyCode":"ZZ"}' where id='99999999-9999-4999-8999-000000000002';
 insert into public.style_tracker_rows select '99999999-9999-4999-8999-000000000012',sku,tracker_type,row_data,discontinued,license_status,licensor,customer,default_vendor from public.style_tracker_rows;
 insert into plm.style_tracker_item_bridge values ('99999999-9999-4999-8999-000000000022','99999999-9999-4999-8999-000000000002','99999999-9999-4999-8999-000000000012','licensed');
 assert (select facts->>'source' from dam.orderlist_product_facts('99999999-9999-4999-8999-000000000001','licensed'))='ambiguous','equal-facts duplicate tracker abstains';
 update plm.style_tracker_item_bridge set plm_item_id='99999999-9999-4999-8999-000000000001' where id='99999999-9999-4999-8999-000000000021';
 update public.style_tracker_rows set row_data='{"test_report":null,"AI":"true"}' where id='99999999-9999-4999-8999-000000000011';
 select facts into f from dam.orderlist_product_facts('99999999-9999-4999-8999-000000000001','licensed');
 assert f->>'source'='master_data' and f->>'test_report' is null,'exact named null wins';
 update plm.style_tracker_item_bridge set plm_item_id='99999999-9999-4999-8999-000000000001';
 assert (select facts->>'source' from dam.orderlist_product_facts('99999999-9999-4999-8999-000000000001','licensed'))='ambiguous','exact conflicts never fall back';
end $$;
insert into plm.production_order_line values ('99999999-9999-4999-8999-000000000031','ZZ-ITEM',null),('99999999-9999-4999-8999-000000000032','ZZ-OTHER',null);
insert into plm.production_order_line_source_ref values ('99999999-9999-4999-8999-000000000031','coldlion',true,'coldlion:so:9123456:line:1');
insert into coldlion.sync_run values ('99999999-9999-4999-8999-000000000071',now()),('99999999-9999-4999-8999-000000000072',now()-interval '1 day');
insert into coldlion.intake_order_line values ('99999999-9999-4999-8999-000000000041','EDGEHOME',9123456,1,'ZZ-PO','ZZ-ITEM','99999999-9999-4999-8999-000000000071');
insert into plm.history_fixture values ('EDGEHOME',9123456,'ZZ-PO','ZZ-ITEM',null,null,'00123','99999999-9999-4999-8999-000000000051');
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-000000000099',false);
DO $$ declare code text; begin
 select vendor_code into code from public.get_dam_order_vendor_ids(array['99999999-9999-4999-8999-000000000031']::uuid[]);
 assert code='00123','Vendor ID preserves leading zeroes';
 assert (select vendor_code from public.get_dam_order_vendor_ids(array['99999999-9999-4999-8999-000000000032']::uuid[])) is null,'missing source stays blank';
 insert into plm.history_fixture select company_code,sales_order_no,prod_reference_no,item_no,sub_item_no,component_id,null,'99999999-9999-4999-8999-000000000052' from plm.history_fixture;
 assert (select vendor_code from public.get_dam_order_vendor_ids(array['99999999-9999-4999-8999-000000000031']::uuid[])) is null,'mixed blank source abstains';
 update plm.history_fixture set vendor_code='00999' where line_id='99999999-9999-4999-8999-000000000052';
 assert (select vendor_code from public.get_dam_order_vendor_ids(array['99999999-9999-4999-8999-000000000031']::uuid[])) is null,'conflicting codes abstain';
 delete from plm.history_fixture where line_id='99999999-9999-4999-8999-000000000052';

 update plm.production_order_line set assortment_id='ZZ-PACK' where id='99999999-9999-4999-8999-000000000031';
 update coldlion.intake_order_line set master_item_no='ZZ-PACK';
 update plm.history_fixture set item_no='ZZ-PACK',sub_item_no='ZZ-ITEM',component_id='99999999-9999-4999-8999-000000000061';
 assert (select vendor_code from public.get_dam_order_vendor_ids(array['99999999-9999-4999-8999-000000000031']::uuid[]))='00123','assortment exact component';
 update plm.history_fixture set sub_item_no='ZZ-OTHER';
 assert (select vendor_code from public.get_dam_order_vendor_ids(array['99999999-9999-4999-8999-000000000031']::uuid[])) is null,'wrong assortment component abstains';
 update plm.history_fixture set sub_item_no='ZZ-ITEM';
 insert into coldlion.intake_order_line select '99999999-9999-4999-8999-000000000042',company_code,sales_order_no,sales_order_line_no,'ZZ-CONFLICT',master_item_no,last_seen_run from coldlion.intake_order_line;
 assert (select vendor_code from public.get_dam_order_vendor_ids(array['99999999-9999-4999-8999-000000000031']::uuid[])) is null,'same-run conflicting intake abstains';
 update coldlion.intake_order_line set last_seen_run='99999999-9999-4999-8999-000000000072' where prod_reference_no='ZZ-CONFLICT';
 assert (select vendor_code from public.get_dam_order_vendor_ids(array['99999999-9999-4999-8999-000000000031']::uuid[]))='00123','older intake does not override latest';
 update plm.history_fixture set sales_order_no=9123457;
 assert (select vendor_code from public.get_dam_order_vendor_ids(array['99999999-9999-4999-8999-000000000031']::uuid[])) is null,'other order cannot supply vendor';
 begin perform * from public.get_dam_order_vendor_ids(array_fill(gen_random_uuid(),array[1501])); raise exception 'oversized accepted'; exception when invalid_parameter_value then null; end;
 begin perform * from public.get_dam_order_vendor_ids(array[null]::uuid[]); raise exception 'null id accepted'; exception when invalid_parameter_value then null; end;
 perform set_config('request.jwt.claim.sub','',false);
 begin perform * from public.get_dam_order_vendor_ids(array[]::uuid[]); raise exception 'anonymous accepted'; exception when insufficient_privilege then null; end;
 assert not has_function_privilege('anon','public.get_dam_order_vendor_ids(uuid[])','execute'),'anonymous grant absent';
 assert has_function_privilege('authenticated','public.get_dam_order_vendor_ids(uuid[])','execute'),'staff grant present';
end $$;
select 'OrderList real-function fixture assertions passed';
