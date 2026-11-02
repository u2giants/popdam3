-- Synthetic, rollback-only contract. No business source rows are used.
begin;
set local session_replication_role=replica;
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-000000000099',true);
insert into plm.production_order(id,production_order_number,source_system,source_id)
values('99999999-9999-4999-8999-000000000001','ZZ-RECIPE-PO','zz-test','ZZ-RECIPE-PO');
insert into plm.production_order_line(id,production_order_id,sku,customer_po_number,assortment_id,metadata,source_system,source_id)
values('99999999-9999-4999-8999-000000000002','99999999-9999-4999-8999-000000000001','ZZ-RAW','ZZ-PO','ZZ-PACK',jsonb_build_object('component_source_hash',repeat('b',64)),'zz-test','ZZ-RECIPE-LINE');
insert into plm.production_order_line_source_ref(id,production_order_line_id,source_system,source_id,is_primary,metadata)
values('99999999-9999-4999-8999-000000000003','99999999-9999-4999-8999-000000000002','coldlion','coldlion:so:9123456:line:1:component:1',true,'{"sub_item_no":"ZZ-RAW"}');
insert into coldlion.sync_run(id,endpoint,requested_by,started_at)
values('99999999-9999-4999-8999-000000000004','/zz-recipe-test','zz-test',now());
insert into coldlion.intake_order_line(id,company_code,sales_order_no,sales_order_line_no,master_item_no,po_number,line_source_hash,first_seen_run,last_seen_run,fetched_at)
values('99999999-9999-4999-8999-000000000005','EDGEHOME',9123456,1,'ZZ-PACK','ZZ-PO',repeat('a',64),'99999999-9999-4999-8999-000000000004','99999999-9999-4999-8999-000000000004',now());
insert into coldlion.intake_order_component(id,line_id,sub_item_no,quantity,component_source_hash,first_seen_run,last_seen_run,fetched_at)
values('99999999-9999-4999-8999-000000000006','99999999-9999-4999-8999-000000000005','ZZ-RAW',2,repeat('b',64),'99999999-9999-4999-8999-000000000004','99999999-9999-4999-8999-000000000004',now());
DO $$ declare q numeric; begin
 select assortment_sku_quantity into q from public.get_dam_order_assortment_quantities(array['99999999-9999-4999-8999-000000000002']::uuid[]);
 assert q=2,'existing direct hash contract preserved';
 update plm.production_order_line set metadata=jsonb_build_object('coldlion_linked_from',jsonb_build_object(
   'source_id','coldlion:so:9123456:line:1:component:1','sku','ZZ-RAW','assortment_id','ZZ-PACK','metadata',jsonb_build_object('component_source_hash',repeat('b',64)))) where id='99999999-9999-4999-8999-000000000002';
 assert (select assortment_sku_quantity from public.get_dam_order_assortment_quantities(array['99999999-9999-4999-8999-000000000002']::uuid[]))=2,'preserved exact source preimage supplies hash';
 update plm.production_order_line set metadata=jsonb_set(metadata,'{coldlion_linked_from,source_id}','"coldlion:so:9123457:line:1:component:1"') where id='99999999-9999-4999-8999-000000000002';
 assert (select assortment_sku_quantity from public.get_dam_order_assortment_quantities(array['99999999-9999-4999-8999-000000000002']::uuid[])) is null,'different order preimage cannot supply hash';
 update plm.production_order_line set sku='ZZ-CORRECTED',metadata=jsonb_build_object('component_source_hash',repeat('b',64)) where id='99999999-9999-4999-8999-000000000002';
 update plm.production_order_line_source_ref set metadata=metadata||jsonb_build_object('orderlist_source_correction',jsonb_build_object(
   'version',1,'source_id',source_id,'original_sku','ZZ-RAW','canonical_sku','ZZ-CORRECTED',
   'original_customer_po','ZZ-PO','canonical_customer_po','ZZ-PO','evidence_ref','ZZ-TEST')) where id='99999999-9999-4999-8999-000000000003';
 assert (select assortment_sku_quantity from public.get_dam_order_assortment_quantities(array['99999999-9999-4999-8999-000000000002']::uuid[]))=2,'exact source-specific correction resolves raw SKU';
 update plm.production_order_line_source_ref set metadata=jsonb_set(metadata,'{orderlist_source_correction,original_customer_po}','"ZZ-WRONG"') where id='99999999-9999-4999-8999-000000000003';
 assert (select assortment_sku_quantity from public.get_dam_order_assortment_quantities(array['99999999-9999-4999-8999-000000000002']::uuid[])) is null,'wrong original PO abstains';
 update plm.production_order_line_source_ref set metadata=jsonb_set(jsonb_set(metadata,'{orderlist_source_correction,original_customer_po}','"ZZ-PO"'),'{orderlist_source_correction,canonical_customer_po}','"ZZ-WRONG"') where id='99999999-9999-4999-8999-000000000003';
 assert (select assortment_sku_quantity from public.get_dam_order_assortment_quantities(array['99999999-9999-4999-8999-000000000002']::uuid[])) is null,'wrong canonical PO abstains';
 update plm.production_order_line_source_ref set metadata=jsonb_set(metadata,'{orderlist_source_correction,canonical_customer_po}','"ZZ-PO"') where id='99999999-9999-4999-8999-000000000003';
 update plm.production_order_line set metadata=jsonb_set(metadata,'{component_source_hash}',to_jsonb(repeat('c',64))) where id='99999999-9999-4999-8999-000000000002';
 assert (select assortment_sku_quantity from public.get_dam_order_assortment_quantities(array['99999999-9999-4999-8999-000000000002']::uuid[])) is null,'wrong hash never falls back to current catalog';
 update plm.production_order_line set metadata=jsonb_build_object('component_source_hash',repeat('b',64),'coldlion_linked_from',jsonb_build_object(
   'source_id','coldlion:so:9123456:line:1:component:1','sku','ZZ-CORRECTED','assortment_id','ZZ-PACK','metadata',jsonb_build_object('component_source_hash',repeat('c',64)))) where id='99999999-9999-4999-8999-000000000002';
 assert (select assortment_sku_quantity from public.get_dam_order_assortment_quantities(array['99999999-9999-4999-8999-000000000002']::uuid[]))=2,'existing top-level hash retains precedence';
 update plm.production_order_line_source_ref set metadata=jsonb_set(metadata,'{orderlist_source_correction,original_sku}','"ZZ-UNTRUSTED"') where id='99999999-9999-4999-8999-000000000003';
 assert (select assortment_sku_quantity from public.get_dam_order_assortment_quantities(array['99999999-9999-4999-8999-000000000002']::uuid[])) is null,'correction must agree with immutable raw component identity';

 -- Apply input and multiplicity contracts to the replacement reader itself.
 assert (select count(*) from public.get_dam_order_assortment_quantities(array['99999999-9999-4999-8999-000000000002','99999999-9999-4999-8999-000000000002']::uuid[]))=1,'duplicate IDs return one line';
 assert (select count(*) from public.get_dam_order_assortment_quantities(array_fill('99999999-9999-4999-8999-000000000002'::uuid,array[1500])))=1,'1500 IDs accepted';
 begin perform * from public.get_dam_order_assortment_quantities(array_fill('99999999-9999-4999-8999-000000000002'::uuid,array[1501])); raise exception 'oversize IDs accepted'; exception when invalid_parameter_value then null; end;
 begin perform * from public.get_dam_order_assortment_quantities(null); raise exception 'null array accepted'; exception when invalid_parameter_value then null; end;
 begin perform * from public.get_dam_order_assortment_quantities(array[null::uuid]); raise exception 'null ID accepted'; exception when invalid_parameter_value then null; end;
 assert not exists(select from public.get_dam_order_assortment_quantities(array[]::uuid[])),'empty IDs return no lines';
 -- Source-free Google rows retain the explicitly labelled unique current recipe.
 insert into plm.production_order_line(id,production_order_id,sku,customer_po_number,assortment_id,metadata,source_system,source_id)
 values('99999999-9999-4999-8999-000000000007','99999999-9999-4999-8999-000000000001','ZZ-CATALOG-SKU','ZZ-PO','ZZ-CATALOG-PACK','{}','zz-test','ZZ-CATALOG-LINE');
 insert into coldlion.item_detail(company_code,division_code,item_no,item_pkey,pre_pack_code,run_id,fetched_at,source_hash,first_seen_at,last_seen_at)
 values('EDGEHOME','ZZ-DIV','ZZ-CATALOG-PACK','ZZ-ITEM-1','ZZ-CATALOG-CODE','99999999-9999-4999-8999-000000000004',now(),repeat('d',64),now(),now());
 insert into coldlion.prepack_detail(company_code,prepack_code,sequence_no,division_code,item_no,quantity,detail_prepack,run_id,fetched_at,source_hash,first_seen_at,last_seen_at)
 values('EDGEHOME','ZZ-CATALOG-CODE',1,'ZZ-DIV','ZZ-CATALOG-SKU',3,'','99999999-9999-4999-8999-000000000004',now(),repeat('e',64),now(),now());
 assert exists(select from public.get_dam_order_assortment_quantities(array['99999999-9999-4999-8999-000000000007']::uuid[]) where assortment_sku_quantity=3 and quantity_source='current_recipe'),'unique catalog quantity remains labelled';
 insert into coldlion.item_detail(company_code,division_code,item_no,item_pkey,pre_pack_code,run_id,fetched_at,source_hash,first_seen_at,last_seen_at)
 values('EDGEHOME','ZZ-DIV-2','ZZ-CATALOG-PACK','ZZ-ITEM-2','ZZ-OTHER-CODE','99999999-9999-4999-8999-000000000004',now(),repeat('f',64),now(),now());
 assert exists(select from public.get_dam_order_assortment_quantities(array['99999999-9999-4999-8999-000000000007']::uuid[]) where assortment_sku_quantity is null and quantity_source is null),'multiple catalog manifests abstain even if only one contains SKU';
 perform set_config('request.jwt.claim.sub','',true);
 begin perform * from public.get_dam_order_assortment_quantities(array[]::uuid[]);raise exception 'anonymous accepted';exception when insufficient_privilege then null;end;
end $$;
rollback;
