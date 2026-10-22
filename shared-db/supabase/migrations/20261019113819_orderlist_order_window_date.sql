-- Work issue #4336; exact object claim #4482 (version 20261019113819).
-- derived-from: 20261009073649
-- Full-result OrderList SO received date for sorting and the 12-month window.
-- The date rule is unchanged from public.get_dam_order_sales_order_dates: exact primary
-- ColdLion references, company EDGEHOME, one non-null full timestamp per Sales Order,
-- America/New_York date. Missing or conflicting stamps stay blank.
-- order_window_date falls back to Sent PO, then Start Ship, then Prod PO Date, when the SO date is blank. Null only when all four are blank.
begin;

-- Drift guard: replace only the exact view this file was derived from (20261009073649).
do $dependencies$
begin
  if not exists (
    select 1 from pg_catalog.pg_class c
    where c.oid = to_regclass('api.dam_order_list') and c.relkind = 'v'
      and c.reloptions @> array['security_invoker=true']
  ) then
    raise exception '#4336 requires the security-invoker OrderList view';
  end if;
  if (select count(*) from pg_catalog.pg_attribute a
      where a.attrelid = 'api.dam_order_list'::regclass and a.attnum > 0 and not a.attisdropped) <> 90
     or (select a.attname from pg_catalog.pg_attribute a
         where a.attrelid = 'api.dam_order_list'::regclass and a.attnum = 90) <> 'snapshot_contractual_sample_reorder'
     or (select a.attname from pg_catalog.pg_attribute a
         where a.attrelid = 'api.dam_order_list'::regclass and a.attnum = 76) <> 'coldlion_source_id' then
    raise exception '#4336 OrderList view drifted from 20261009073649 (expected 90 columns)';
  end if;
  if position('coldlion_ref.is_primary' in lower(pg_get_viewdef('api.dam_order_list'::regclass))) = 0 then
    raise exception '#4336 requires primary-only ColdLion references in OrderList';
  end if;
  if to_regtype('timestamp with time zone') is distinct from (select a.atttypid::regtype from pg_catalog.pg_attribute a
      where a.attrelid = 'coldlion.order_history_line'::regclass and a.attname = 'created_time' and not a.attisdropped)
     or to_regtype('bigint') is distinct from (select a.atttypid::regtype from pg_catalog.pg_attribute a
      where a.attrelid = 'coldlion.order_history_line'::regclass and a.attname = 'sales_order_no' and not a.attisdropped) then
    raise exception '#4336 coldlion.order_history_line columns changed';
  end if;
end;
$dependencies$;

create or replace function dam.orderlist_sales_order_received_date(p_coldlion_source_id text)
returns date
language sql stable strict security definer
set search_path = pg_catalog
as $$
  select case when count(*) = count(h.created_time)
    and count(distinct h.created_time) = 1
    and min(h.created_time) > timestamptz '2000-01-01 00:00:00+00'
  then (min(h.created_time) at time zone 'America/New_York')::date end
  from coldlion.order_history_line h
  where h.company_code = 'EDGEHOME'
    and h.sales_order_no = case
      when p_coldlion_source_id ~ '^coldlion:so:[1-9][0-9]{0,17}:line:[0-9]{1,10}:component:[1-9][0-9]{0,9}$'
      then split_part(p_coldlion_source_id, ':', 3)::bigint end
$$;

revoke all on function dam.orderlist_sales_order_received_date(text) from public, anon;
grant execute on function dam.orderlist_sales_order_received_date(text) to authenticated, service_role;
comment on function dam.orderlist_sales_order_received_date(text) is
  'OrderList SO received date for one primary ColdLion source reference. Same rule as get_dam_order_sales_order_dates. #4336.';

create or replace view api.dam_order_list with (security_invoker=true) as
SELECT pol.id AS order_line_id,
    po.id AS order_id,
    po.production_order_number,
    case when po.source_system='coldlion' and po.production_order_number like 'coldlion/%' then po.status else dam.orderlist_po_status(pol.order_type,pol.sku,pol.assortment_id,coalesce(pol.quantity_ordered,parent.quantity),pol.case_pack,po.close_tracking,po.booking_state,po.etd,case when ext.crd_override_set then po.vendor_delivery_date else coalesce(po.vendor_delivery_date,po.seal_container_date) end,po.sent_po_date,po.production_order_number) end AS order_status,
    po.company_id,
    coalesce(cust.customer_name,nullif(po.metadata->>'customer_name','')) AS customer_name,
    po.factory_id,
    coalesce(fact.vendor_name,nullif(po.metadata->>'order_vendor_name','')) AS vendor_name,
    po.metadata ->> 'ordering_company'::text AS ordering_company,
    po.order_date,
    po.sent_po_date,
    case when ext.crd_override_set then po.vendor_delivery_date else coalesce(po.vendor_delivery_date,po.seal_container_date) end AS seal_container_date,
    po.vendor_delivery_date,
    po.requested_ship_date,
    po.actual_ship_date,
    po.booking_state,
    po.etd,
    po.eta,
    case when ext.eta_override_set then po.eta+5 else coalesce(po.eta+5,po.warehouse_date) end AS warehouse_date,
    po.container_booking_group,
    po.mbl,
    po.close_tracking,
    po.voided_at AS order_voided_at,
    po.void_reason AS order_void_reason,
    pol.line_number,
    pol.order_person,
    pol.order_type,
    case when pol.order_type='David Sample' then 'David' when pol.order_type='Contractual Sample' then 'CONT' else coalesce(customer_settings.suffix,pol.customer_suffix) end AS customer_suffix,
    pol.customer_po_number,
    pol.assortment_id,
    pol.assortment_component_ordinal,
    pol.sku,
    pol.sku_normalized,
    pol.quantity_ordered,
    pol.quantity_shipped,
    pol.unit_cost,
    pol.order_depth_inches,
    pol.case_pack,
    case when pol.case_pack>0 and pol.quantity_ordered is not null and pol.quantity_ordered>=pol.case_pack then pol.quantity_ordered/pol.case_pack end AS cases_reported,
    pol.ship_to,
    pol.start_ship_date,
    pol.start_ship_raw,
    pol.cancel_date,
    pol.cancel_raw,
    dam.orderlist_cargo_forecast(pol.order_type,pol.ship_to,pol.start_ship_date) AS cargo_forecast_date,
    case when nullif(btrim(pol.order_type),'') is null then null when pol.start_ship_date is null then 'NoDate' when dam.orderlist_cargo_forecast(pol.order_type,pol.ship_to,pol.start_ship_date) is null then 'N/A' end AS cargo_forecast_raw,
    case when product.facts->>'source'='master_data' then product.facts->>'test_report' when pol.item_id is null then pol.test_report end AS test_report,
    case when product.facts->>'source'='master_data' then product.facts->>'professional_photos' when pol.item_id is null then pol.professional_photos end AS professional_photos,
    case when product.facts->>'source'='master_data' then (product.facts->>'contractual_sample_reorder')::boolean when pol.item_id is null then pol.contractual_sample_reorder end AS contractual_sample_reorder,
    pol.status AS line_status,
    pol.voided_at AS line_voided_at,
    pol.void_reason AS line_void_reason,
    pol.source_style_type,
    pol.master_data_match_status,
    pol.item_id,
    item.item_number,
    item.style_number AS item_style_number,
    item.name AS item_name,
    item.description AS item_description,
    (product.facts->>'bridge_id')::uuid AS style_tracker_bridge_id,
    (product.facts->>'tracker_id')::uuid AS style_tracker_row_id,
    product.facts->>'tracker_type' AS master_data_tracker_type,
    item.description AS master_data_description,
    product.facts->>'license_status' AS master_data_license_status,
    product.facts->>'licensor' AS master_data_licensor,
    product.facts->>'default_vendor' AS master_data_default_vendor,
    product.facts->>'customer' AS master_data_customer,
    pol.metadata #>> '{order_list_snapshot,sku}'::text[] AS snapshot_sku,
    pol.metadata #>> '{order_list_snapshot,description}'::text[] AS snapshot_description,
    pol.metadata #>> '{order_list_snapshot,license_status}'::text[] AS snapshot_license_status,
    pol.metadata #>> '{order_list_snapshot,style_type}'::text[] AS snapshot_style_type,
    coalesce(pol.metadata #>> '{order_list_source,sheet_row}',pol.metadata #>> '{order_list_snapshot,source_row}') AS snapshot_source_row,
    pol.item_id IS NULL AS item_link_missing,
    pol.item_id IS NOT NULL AND pol.source_style_type IS NOT NULL
      AND NOT EXISTS(select 1 from plm.style_tracker_item_bridge b where b.plm_item_id=pol.item_id and b.tracker_type=pol.source_style_type)
      AND EXISTS(select 1 from plm.style_tracker_item_bridge b where b.plm_item_id=pol.item_id) AS item_link_type_mismatch,
    google_ref.source_id AS google_source_id,
    coldlion_ref.source_id AS coldlion_source_id,
    pol.created_at AS line_created_at,
    pol.updated_at AS line_updated_at,
    case when pol.item_id is null then 'at_import' else product.facts->>'source' end AS product_workflow_source,
    product.facts->>'sample_vendor' AS master_data_sample_vendor,
    sample.depth_inches AS sample_depth_inches,
    case when pol.case_pack=0 then 'Wrong Input' when pol.case_pack<0 then 'Wrong Input' when coalesce(pol.quantity_ordered,parent.quantity) is not null and pol.case_pack>coalesce(pol.quantity_ordered,parent.quantity) then 'Wrong QTY' end AS cases_error,
    parent.quantity AS assortment_parent_quantity,
    case when parent.physical_key is not null and parent.quantity>=pol.case_pack and pol.case_pack>0 then parent.quantity/pol.case_pack end AS assortment_parent_cases,
    parent.physical_key AS assortment_parent_key,
    sample.depth_raw AS sample_depth_raw,
    sample.source_row_number AS sample_depth_source_row,
    pol.test_report AS snapshot_test_report,
    pol.professional_photos AS snapshot_professional_photos,
    pol.contractual_sample_reorder AS snapshot_contractual_sample_reorder,
    so_date.sales_order_received_date,
    coalesce(so_date.sales_order_received_date, po.sent_po_date, pol.start_ship_date, po.order_date) AS order_window_date
   FROM plm.production_order_line pol
     JOIN plm.production_order po ON po.id = pol.production_order_id
     LEFT JOIN dam.dam_order_list_customer_directory cust ON cust.customer_id = po.company_id
     LEFT JOIN dam.dam_order_list_vendor_directory fact ON fact.vendor_id = po.factory_id
     LEFT JOIN dam.order_tracking_ext ext ON ext.order_id=po.id
     LEFT JOIN plm.item item ON item.id = pol.item_id
     LEFT JOIN LATERAL (select (select f.facts from dam.orderlist_product_facts(pol.item_id,pol.source_style_type) f) as facts offset 0) product ON true
     LEFT JOIN LATERAL (
       select case when pol.assortment_component_ordinal is not null and pol.metadata #>> '{order_list_snapshot,component_quantity_source}'='absent_never_guessed'
         then dam.orderlist_parse_number(pol.metadata #>> '{order_list_snapshot,assortment_parent_quantity}') end as quantity,
         case when pol.assortment_component_ordinal is not null and pol.metadata #>> '{order_list_snapshot,component_quantity_source}'='absent_never_guessed'
           and nullif(pol.metadata #>> '{order_list_source,spreadsheet_id}','') is not null
           and nullif(pol.metadata #>> '{order_list_source,tab}','') is not null
           and nullif(pol.metadata #>> '{order_list_source,sheet_row}','') is not null
           then jsonb_build_array(pol.metadata #>> '{order_list_source,spreadsheet_id}',pol.metadata #>> '{order_list_source,tab}',pol.metadata #>> '{order_list_source,sheet_row}')::text end as physical_key
     ) parent ON true
     LEFT JOIN dam.orderlist_sample_depth sample ON sample.sku_normalized=pol.sku_normalized AND sample.customer_normalized=lower(btrim(coalesce(cust.customer_name,nullif(po.metadata->>'customer_name',''))))
     LEFT JOIN dam.orderlist_customer_settings customer_settings ON customer_settings.customer_normalized=lower(btrim(coalesce(cust.customer_name,nullif(po.metadata->>'customer_name',''))))
     LEFT JOIN plm.production_order_line_source_ref google_ref ON google_ref.production_order_line_id = pol.id AND google_ref.source_system = 'google_order_list'::text AND google_ref.is_primary
     LEFT JOIN plm.production_order_line_source_ref coldlion_ref ON coldlion_ref.production_order_line_id = pol.id AND coldlion_ref.source_system = 'coldlion'::text AND coldlion_ref.is_primary
     LEFT JOIN LATERAL (select dam.orderlist_sales_order_received_date(coldlion_ref.source_id) AS sales_order_received_date) so_date ON true;

commit;
