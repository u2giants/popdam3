-- Synthetic fixture contract. Preview/disposable database only; rolled back.
begin;
set local session_replication_role=replica;
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-000000000099',true);
insert into plm.production_order(id,production_order_number,source_system,source_id)
values('99999999-9999-4999-8999-000000000001','ZZ-EDITOR-PO','zz-test','ZZ-EDITOR-PO');
insert into plm.production_order_line(id,production_order_id,sku,customer_po_number,source_system,source_id,source_style_type,metadata)
values ('99999999-9999-4999-8999-000000000002','99999999-9999-4999-8999-000000000001','ZZ-RAW','ZZ-OLD-PO','zz-test','ZZ-EDITOR-LINE','licensed','{}');
insert into plm.production_order_line_source_ref(id,production_order_line_id,source_system,source_id,is_primary,metadata)
values('99999999-9999-4999-8999-000000000003','99999999-9999-4999-8999-000000000002','coldlion','coldlion:so:9123456:line:1:component:1',true,'{"master_item_no":"ZZ-RAW","sub_item_no":"ZZ-RAW","sub_label_code":"ZZ"}');
insert into coldlion.sync_run(id,endpoint,requested_by,started_at)
values('99999999-9999-4999-8999-000000000004','/zz-editor-test','zz-test',now());
insert into coldlion.intake_order_line(id,company_code,sales_order_no,sales_order_line_no,master_item_no,po_number,line_source_hash,first_seen_run,last_seen_run,fetched_at)
values('99999999-9999-4999-8999-000000000005','EDGEHOME',9123456,1,'ZZ-RAW','ZZ-OLD-PO',repeat('a',64),'99999999-9999-4999-8999-000000000004','99999999-9999-4999-8999-000000000004',now());
insert into coldlion.intake_order_component(id,line_id,sub_item_no,sub_label_code,component_source_hash,first_seen_run,last_seen_run,fetched_at)
values('99999999-9999-4999-8999-000000000006','99999999-9999-4999-8999-000000000005','ZZ-RAW','ZZ',repeat('b',64),'99999999-9999-4999-8999-000000000004','99999999-9999-4999-8999-000000000004',now());
insert into plm.item(id,source_system,source_id,item_number,style_number)
values('99999999-9999-4999-8999-000000000007','zz-test','ZZ-EDITOR-ITEM','ZZ-FIXED','ZZ-FIXED');
insert into public.style_tracker_rows(id,source_sheet,tracker_type,sku)
values('99999999-9999-4999-8999-000000000008','ZZ-EDITOR','licensed','ZZ-FIXED');
insert into plm.style_tracker_item_bridge(id,style_tracker_row_id,source_workbook_id,source_sheet,tracker_type,sku,plm_item_id)
values('99999999-9999-4999-8999-000000000009','99999999-9999-4999-8999-000000000008','ZZ-EDITOR','ZZ-EDITOR','licensed','ZZ-FIXED','99999999-9999-4999-8999-000000000007');
DO $$ declare c jsonb; begin
 perform public.update_dam_order('99999999-9999-4999-8999-000000000001','{}','[{"id":"99999999-9999-4999-8999-000000000002","sku":"ZZ-FIXED","customer_po_number":"ZZ-NEW-PO","source_style_type":" Licensed "}]');
 select metadata->'orderlist_source_correction' into c from plm.production_order_line_source_ref where id='99999999-9999-4999-8999-000000000003';
 assert c->>'original_sku'='ZZ-RAW' and c->>'original_customer_po'='ZZ-OLD-PO' and c->>'canonical_sku'='ZZ-FIXED' and c->>'canonical_customer_po'='ZZ-NEW-PO','first editor save source-bound';
 assert (select item_id from plm.production_order_line where id='99999999-9999-4999-8999-000000000002')='99999999-9999-4999-8999-000000000007','changed SKU relinks exact style/catalog';
 perform public.update_dam_order('99999999-9999-4999-8999-000000000001','{}','[{"id":"99999999-9999-4999-8999-000000000002","source_style_type":"Licensed"}]');
 assert (select source_style_type='licensed' and item_id='99999999-9999-4999-8999-000000000007' from plm.production_order_line where id='99999999-9999-4999-8999-000000000002'),'recasing uses normalized stored catalog';
 perform public.update_dam_order('99999999-9999-4999-8999-000000000001','{}','[{"id":"99999999-9999-4999-8999-000000000002","source_style_type":null}]');
 assert (select source_style_type is null and item_id is null and master_data_match_status='unmatched' from plm.production_order_line where id='99999999-9999-4999-8999-000000000002'),'cleared catalog cannot retain or assign item';
 perform public.update_dam_order('99999999-9999-4999-8999-000000000001','{}','[{"id":"99999999-9999-4999-8999-000000000002","source_style_type":" LICENSED "}]');
 assert (select source_style_type='licensed' and item_id='99999999-9999-4999-8999-000000000007' from plm.production_order_line where id='99999999-9999-4999-8999-000000000002'),'restored normalized catalog relinks exact item';
 perform public.update_dam_order('99999999-9999-4999-8999-000000000001','{}','[{"id":"99999999-9999-4999-8999-000000000002","customer_po_number":"ZZ-NEWER-PO"}]');
 select metadata->'orderlist_source_correction' into c from plm.production_order_line_source_ref where id='99999999-9999-4999-8999-000000000003';
 assert c->>'original_customer_po'='ZZ-OLD-PO' and c->>'canonical_customer_po'='ZZ-NEWER-PO','repeat edit retains raw original';
 update coldlion.intake_order_line set po_number='ZZ-CHANGED-SOURCE' where id='99999999-9999-4999-8999-000000000005';
 begin
  perform public.update_dam_order('99999999-9999-4999-8999-000000000001','{}','[{"id":"99999999-9999-4999-8999-000000000002","customer_po_number":"ZZ-REJECT"}]');
  raise exception 'changed source accepted';
 exception when invalid_parameter_value then null; end;
 assert (select customer_po_number from plm.production_order_line where id='99999999-9999-4999-8999-000000000002')='ZZ-NEWER-PO','source refusal is atomic';
 update coldlion.intake_order_line set po_number='ZZ-OLD-PO' where id='99999999-9999-4999-8999-000000000005';
 begin
  perform public.update_dam_order('99999999-9999-4999-8999-000000000001','{}','[{"id":"99999999-9999-4999-8999-000000000002","metadata":{"orderlist_google_correction":{}}}]');
  raise exception 'forged correction accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.update_dam_order('99999999-9999-4999-8999-000000000001','{}','[{"id":"99999999-9999-4999-8999-000000000002","sku":null}]');
  raise exception 'unusable empty source correction accepted';
 exception when invalid_parameter_value then null; end;
 perform public.update_dam_order('99999999-9999-4999-8999-000000000001','{}','[{"id":"99999999-9999-4999-8999-000000000002","sku":"ZZ-NO-LINK"}]');
 assert (select item_id is null and master_data_match_status='unmatched' from plm.production_order_line where id='99999999-9999-4999-8999-000000000002'),'old item never retained for different SKU';
 delete from plm.production_order_line_source_ref where id='99999999-9999-4999-8999-000000000003';
 insert into plm.production_order_line_source_ref(id,production_order_line_id,source_system,source_id,is_primary,metadata)
 values('99999999-9999-4999-8999-000000000010','99999999-9999-4999-8999-000000000002','google_order_list','order:row:999999',true,'{}');
 perform public.update_dam_order('99999999-9999-4999-8999-000000000001','{}','[{"id":"99999999-9999-4999-8999-000000000002","customer_po_number":"ZZ-GOOGLE-EDIT"}]');
 perform public.update_dam_order('99999999-9999-4999-8999-000000000001','{}','[{"id":"99999999-9999-4999-8999-000000000002","customer_po_number":"ZZ-GOOGLE-REPEAT"}]');
 select metadata->'orderlist_google_correction' into c from plm.production_order_line where id='99999999-9999-4999-8999-000000000002';
 assert c->'original'->>'customer_po_number'='ZZ-NEWER-PO' and c->'corrected'->>'customer_po_number'='ZZ-GOOGLE-REPEAT','Google original retained on repeated save';
 perform set_config('request.jwt.claim.sub','',true);
 begin
  perform public.update_dam_order('99999999-9999-4999-8999-000000000001','{}','[]'); raise exception 'anonymous accepted';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
