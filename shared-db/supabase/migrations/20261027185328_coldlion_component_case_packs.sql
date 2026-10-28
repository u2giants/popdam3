-- ColdLion assortment cartons counted once per physical parent, #4858 / claim #4927
-- (supersedes retired claim #4860 and never-applied version 20261027010036).
-- derived-from: 20261019113819
-- Owner 2026-10-27 (relaying Yuchen): "It Should show the total total pieces in
-- the whole carton." Every assortment component's Case Pack is the whole
-- carton's piece count, so the existing parent-quantity / case-pack formula and
-- the existing once-per-parent tracking total (20261009073649) already apply.
-- This change only gives source-only ColdLion components their physical parent
-- (sales order, line, master item) and its line quantity. dam.dam_order_tracking
-- is re-created below with its current body from 20261009073649, byte-for-byte,
-- so it binds to the replaced OrderList view. No columns, grants or security
-- modes change.
-- For those components the per-design cases column is left NULL (the parent's
-- cartons are assortment_parent_cases, counted once), Wrong QTY compares the
-- whole-carton pack with the parent quantity, and order status never borrows the
-- parent quantity for a design whose own quantity is missing.
-- Data correction remains application-owned, exact-preimage and recoverable.

begin;

do $dependencies$
begin
  if not exists (
    select 1 from pg_catalog.pg_class c
    where c.oid = to_regclass('api.dam_order_list') and c.relkind = 'v'
      and c.reloptions @> array['security_invoker=true']
  ) or not exists (
    select 1 from pg_catalog.pg_class c
    where c.oid = to_regclass('dam.dam_order_tracking') and c.relkind = 'v'
      and c.reloptions @> array['security_invoker=true']
  ) then
    raise exception '#4858 requires the security-invoker OrderList and tracking views';
  end if;
  if (select count(*) from pg_catalog.pg_attribute a
      where a.attrelid = 'api.dam_order_list'::regclass and a.attnum > 0 and not a.attisdropped) <> 92
     or (select a.attname from pg_catalog.pg_attribute a
         where a.attrelid = 'api.dam_order_list'::regclass and a.attnum = 92) <> 'order_window_date'
     or not exists (select 1 from pg_catalog.pg_attribute a
         where a.attrelid = 'api.dam_order_list'::regclass and a.attname = 'assortment_parent_key' and not a.attisdropped) then
    raise exception '#4858 OrderList view drifted from 20261019113819 (expected 92 columns)';
  end if;
end;
$dependencies$;

create or replace view api.dam_order_list with (security_invoker=true) as
SELECT pol.id AS order_line_id,
    po.id AS order_id,
    po.production_order_number,
    case when po.source_system='coldlion' and po.production_order_number like 'coldlion/%' then po.status else dam.orderlist_po_status(pol.order_type,pol.sku,pol.assortment_id,coalesce(pol.quantity_ordered,case when (pol.source_system='coldlion' and pol.assortment_component_ordinal is not null and not (pol.metadata ? 'order_list_source') and pol.source_id ~ '^coldlion:so:[1-9][0-9]*:line:[0-9]+:component:[1-9][0-9]*$') then null else parent.quantity end),pol.case_pack,po.close_tracking,po.booking_state,po.etd,case when ext.crd_override_set then po.vendor_delivery_date else coalesce(po.vendor_delivery_date,po.seal_container_date) end,po.sent_po_date,po.production_order_number) end AS order_status,
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
    case when (pol.source_system='coldlion' and pol.assortment_component_ordinal is not null and not (pol.metadata ? 'order_list_source') and pol.source_id ~ '^coldlion:so:[1-9][0-9]*:line:[0-9]+:component:[1-9][0-9]*$') then null else case when pol.case_pack>0 and pol.quantity_ordered is not null and pol.quantity_ordered>=pol.case_pack then pol.quantity_ordered/pol.case_pack end end AS cases_reported,
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
    case when pol.case_pack=0 then 'Wrong Input' when pol.case_pack<0 then 'Wrong Input' when (pol.source_system='coldlion' and pol.assortment_component_ordinal is not null and not (pol.metadata ? 'order_list_source') and pol.source_id ~ '^coldlion:so:[1-9][0-9]*:line:[0-9]+:component:[1-9][0-9]*$') then case when parent.quantity is not null and pol.case_pack>parent.quantity then 'Wrong QTY' end when coalesce(pol.quantity_ordered,parent.quantity) is not null and pol.case_pack>coalesce(pol.quantity_ordered,parent.quantity) then 'Wrong QTY' end AS cases_error,
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
       select case when pol.source_system='coldlion' and pol.assortment_component_ordinal is not null and not (pol.metadata ? 'order_list_source') and pol.source_id ~ '^coldlion:so:[1-9][0-9]*:line:[0-9]+:component:[1-9][0-9]*$' then dam.orderlist_parse_number(pol.metadata->>'line_qty') when pol.assortment_component_ordinal is not null and pol.metadata #>> '{order_list_snapshot,component_quantity_source}'='absent_never_guessed'
         then dam.orderlist_parse_number(pol.metadata #>> '{order_list_snapshot,assortment_parent_quantity}') end as quantity,
         case when pol.source_system='coldlion' and pol.assortment_component_ordinal is not null and not (pol.metadata ? 'order_list_source') and pol.source_id ~ '^coldlion:so:[1-9][0-9]*:line:[0-9]+:component:[1-9][0-9]*$' then jsonb_build_array('coldlion',split_part(pol.source_id,':',3),split_part(pol.source_id,':',5),pol.metadata->>'master_item_no')::text when pol.assortment_component_ordinal is not null and pol.metadata #>> '{order_list_snapshot,component_quantity_source}'='absent_never_guessed'
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

create or replace view dam.dam_order_tracking with (security_invoker=true) as
select po.id as order_id,po.production_order_number,po.order_date,po.voided_at as order_voided_at,
  coalesce(cust.customer_name,nullif(po.metadata->>'customer_name','')) as customer_name,coalesce(fact.vendor_name,nullif(po.metadata->>'order_vendor_name','')) as vendor_name,po.factory_id,po.company_id,
  lines.line_count,lines.total_cases,lines.invalid_case_lines,lines.missing_test_reports,lines.missing_photos,
  lines.unresolved_product_lines,lines.order_type,lines.start_ship_date,lines.cancel_date,lines.cargo_forecast_date,
  lines.customer_po_number,lines.customer_suffix,lines.components,
  po.sent_po_date,case when ext.crd_override_set then po.vendor_delivery_date else coalesce(po.vendor_delivery_date,po.seal_container_date) end as vendor_delivery_date,
  case when case when ext.crd_override_set then po.vendor_delivery_date else coalesce(po.vendor_delivery_date,po.seal_container_date) end is not null then (case when ext.crd_override_set then po.vendor_delivery_date else coalesce(po.vendor_delivery_date,po.seal_container_date) end) +
    case lines.order_type when 'FOB' then 5 when 'POE' then 21 when 'C Stock' then 27 end end as seal_container_forecast,
  po.booking_state,po.etd,po.eta,case when ext.eta_override_set then po.eta+5 else coalesce(po.eta+5,po.warehouse_date) end as warehouse_date,
  case when lines.order_type='FOB' then null
    when lines.order_type='POE' then po.eta-lines.cancel_date
    else (case when ext.eta_override_set then po.eta+5 else coalesce(po.eta+5,po.warehouse_date) end)-lines.cancel_date end as days_delay,
  case when lines.order_type='POE' and coalesce(cust.customer_name,nullif(po.metadata->>'customer_name',''))='Burlington' and ext.worksheet_done is not true
    then po.eta-current_date-5 end as worksheet_days_remaining,
  po.container_booking_group,po.mbl,po.close_tracking,
  ext.agent,ext.cbm,ext.comment,ext.vessel,ext.sent_to_coldlion,ext.worksheet_done,ext.inspection_passed,ext.inspection_note,
  ext.document_invoice,ext.document_packing_list,ext.document_bill_of_lading,ext.document_tsca,ext.document_lacey_act,
  ext.document_telex,ext.request_wire,ext.payment_note,ext.updated_at as tracking_updated_at,
  case when ext.inspection_passed is not null then 'S'||(ext.inspection_passed-date '1899-12-30')::text||'-'||substring(po.production_order_number from 2) end as svn_number,
  case when left(po.container_booking_group,2)='BN' then po.container_booking_group||','||po.production_order_number end as booking_string,
  case when lines.order_type='FOB' then 'FOB' when lines.order_type='POE' and po.eta is null then 'no ETA'
    when lines.order_type is not null and lines.cancel_date is null then 'no cancel date'
    when lines.order_type is not null and po.eta is null then 'no WHS Date' end as days_delay_status,
  case when lines.line_count=0 then 'No order lines' when lines.order_type is null then 'Mixed or sample order types' when case when ext.crd_override_set then po.vendor_delivery_date else coalesce(po.vendor_delivery_date,po.seal_container_date) end is null then 'No date' when lines.order_type not in ('FOB','POE','C Stock') then 'N/A' end as seal_container_forecast_status,lines.unknown_case_groups
from plm.production_order po
left join lateral (
  with scoped as materialized (
    select * from api.dam_order_list l where l.order_id=po.id and l.order_voided_at is null and l.line_voided_at is null
  ), physical as materialized (
    select case when count(distinct case_pack)=1 and count(case_pack)=count(*)
        and count(distinct assortment_parent_quantity)=1 and count(assortment_parent_quantity)=count(*)
        and min(case_pack)>0 and min(assortment_parent_quantity)>=min(case_pack)
      then min(assortment_parent_quantity)/min(case_pack) end as cases
    from scoped where assortment_parent_key is not null
      and order_type is distinct from 'Contractual Sample' and order_type is distinct from 'David Sample'
    group by assortment_parent_key
    union all
    select cases_reported from scoped where assortment_parent_key is null
      and order_type is distinct from 'Contractual Sample' and order_type is distinct from 'David Sample'
  )
  select count(*) as line_count,
    (select case when count(cases)=count(*) then coalesce(sum(cases),0) end from physical) as total_cases,
    (select count(*) from physical where cases is null) as unknown_case_groups,
    count(*) filter(where cases_error is not null) as invalid_case_lines,
    count(*) filter(where dam.orderlist_parse_boolean(test_report) is not true) as missing_test_reports,
    count(*) filter(where dam.orderlist_parse_boolean(professional_photos) is not true) as missing_photos,
    count(*) filter(where product_workflow_source is distinct from 'master_data') as unresolved_product_lines,
    case when count(distinct order_type) filter(where order_type not in('Contractual Sample','David Sample'))=1
      then min(order_type) filter(where order_type not in('Contractual Sample','David Sample')) end as order_type,
    min(start_ship_date) as start_ship_date,min(cancel_date) as cancel_date,min(cargo_forecast_date) as cargo_forecast_date,
    string_agg(distinct customer_po_number,E'\n' order by customer_po_number) as customer_po_number,
    string_agg(distinct customer_suffix,E'\n' order by customer_suffix) as customer_suffix,
    jsonb_agg(jsonb_build_object('line_id',order_line_id,'sku',sku,'assortment',assortment_id,'quantity',quantity_ordered,
      'case_pack',case_pack,'cases',cases_reported,'order_depth_inches',order_depth_inches,'ship_to',ship_to,'start_ship_date',start_ship_date,'cancel_date',cancel_date,'customer_po_number',customer_po_number,'cases_error',cases_error,'description',item_description,'license_status',master_data_license_status,'workflow_source',product_workflow_source,'test_report',test_report,
      'professional_photos',professional_photos,'parent_cases',assortment_parent_cases,'parent_quantity',assortment_parent_quantity,'sample_depth_raw',sample_depth_raw,'sample_depth_source_row',sample_depth_source_row,'contractual_sample_reorder',contractual_sample_reorder,'snapshot_test_report',snapshot_test_report,'snapshot_professional_photos',snapshot_professional_photos,'snapshot_contractual_sample_reorder',snapshot_contractual_sample_reorder,'sample_depth_inches',sample_depth_inches,'default_vendor',master_data_default_vendor,'sample_vendor',master_data_sample_vendor)
      order by assortment_id nulls last,assortment_component_ordinal nulls last,line_number,order_line_id) as components
  from scoped
) lines on true
left join dam.dam_order_list_customer_directory cust on cust.customer_id=po.company_id
left join dam.dam_order_list_vendor_directory fact on fact.vendor_id=po.factory_id
left join dam.order_tracking_ext ext on ext.order_id=po.id
where not (coalesce(po.source_system='coldlion',false) and coalesce(po.production_order_number like 'coldlion/%',false));

commit;
