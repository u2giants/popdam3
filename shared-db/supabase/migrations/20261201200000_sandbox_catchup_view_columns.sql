-- Sandbox catch-up batch 17 (#6356): DesignFlow sandbox (xupnyeifmpsacrqahwwm) ONLY. Never apply to shared preview or production.
-- Production appended columns to four existing views (api.source_resolution core licensor/franchise ids; ColdLion
-- history and merch-group row ids). Same definitions and options as production; api.source_resolution also gets
-- production's grants (the sandbox had none).
-- derived-from: none

create or replace view api.source_resolution with (security_invoker=true) as
 SELECT source_system,
    entity_kind,
    source_id,
    core_property_id,
    core_character_id,
    core_style_guide_id,
    dam_asset_id,
    resolution_status,
    resolution_reason,
    resolved_at,
    resolved_by,
    updated_at,
        CASE
            WHEN (resolution_status = 'matched'::text) THEN plm.source_resolution_target_missing(entity_kind, core_property_id, core_character_id, core_style_guide_id, dam_asset_id, core_licensor_id, core_franchise_id)
            ELSE false
        END AS target_missing,
    core_licensor_id,
    core_franchise_id
   FROM plm.source_resolution r;

create or replace view plm.coldlion_item_merch_group with (security_invoker=false,security_barrier=true) as
 SELECT company_code,
    division_code,
    item_no,
    slot_no,
    mg_code,
    last_seen_at,
    id,
    item_pkey
   FROM coldlion.item_merch_group g;

create or replace view plm.coldlion_sales_history with (security_invoker=false,security_barrier=true) as
 SELECT l.company_code,
    l.division_code,
    l.sales_order_no,
    l.sales_order_line_no,
    l.customer_code,
    l.customer_desc,
    l.po_number,
    l.sales_person_code1,
    l.start_date,
    l.cancel_date,
    l.master_item_no,
    l.label_code,
    l.pre_pack_code,
    l.warehouse_code,
    l.prod_cost,
    l.prod_reference_no,
    c.sub_item_no,
    c.sub_label_code,
    c.line_price,
    c.quantity AS component_qty,
    c.order_qty,
    c.invoice_qty,
    c.ship_qty,
    c.order_amount,
    c.ship_amount,
    l.id AS line_id,
    c.id AS component_id
   FROM (coldlion.order_history_line l
     JOIN coldlion.order_history_component c ON ((c.line_id = l.id)));

create or replace view plm.coldlion_prod_history with (security_invoker=false,security_barrier=true) as
 SELECT l.company_code,
    l.division_code,
    l.prod_order_no,
    l.prod_line_seq,
    l.stage_code,
    l.requested_stage_code,
    l.prod_type_code,
    l.customer_code,
    l.customer_desc,
    l.vendor_code,
    l.vendor_desc,
    l.item_no,
    l.short_item_no,
    l.label_code,
    l.pre_pack_code,
    l.warehouse_code,
    l.warehouse_sku,
    l.prod_country,
    l.freight_forwarder_code,
    l.arrival_port_code,
    l.sales_order_no,
    l.sales_order_link_present,
    l.prod_reference_no,
    l.cust_po_number,
    l.prod_order_date,
    l.due_date,
    l.ship_date,
    l.receive_date,
    l.prod_order_qty,
    l.prepack_qty,
    l.total_ppk_qty,
    l.prod_cost,
    l.ext_cost,
    l.total_prod_cost,
    c.prepack_item_no,
    c.prepack_item_pkey,
    c.prepack_division_code,
    c.sub_item_no,
    c.line_price,
    c.ppk_detail_qty,
    c.ppk_detail_cost,
    l.id AS line_id,
    c.id AS component_id
   FROM (coldlion.prod_history_line l
     LEFT JOIN coldlion.prod_history_component c ON ((c.line_id = l.id)));

revoke all on table api.source_resolution from public, anon, authenticated, service_role;
grant all on table api.source_resolution to service_role;
grant select on table api.source_resolution to authenticated;
