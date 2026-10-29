-- ColdLion reconciliation triage, #5004 / claim #5005
-- derived-from: 20261028224921
-- Owner request, Albert Hazan, 2026-10-28: "i need a triage section for yuchen
-- to be able to easily see everything that needs to be reconciled and an easy
-- way to reconcile it, being guided". Two things need a person:
--   * a merged line whose ColdLion quantity or Import PO disagrees with the
--     Google value (#4931 shows them as a red boxed pair), and
--   * a ColdLion line left on its COLDLION-SO placeholder because no single
--     Google line matched it.
-- public.resolve_coldlion_triage is the one guided resolver for both. The
-- OrderList view keeps 20261028224921's body with two changes: a disagreement
-- the resolver marked "Google is right" (metadata.coldlion_reviewed holding
-- ColdLion's CURRENT value) is no longer reported — a later, different ColdLion
-- value reports again — and a new last column, coldlion_unmatched, marks a live
-- placeholder line nobody has decided on yet. No grants or security modes change
-- on the view.

begin;

do $dependencies$
begin
  if not exists (
    select 1 from pg_catalog.pg_class c
    where c.oid = to_regclass('api.dam_order_list') and c.relkind = 'v'
      and c.reloptions @> array['security_invoker=true']
  ) then
    raise exception '#5004 requires the security-invoker OrderList view';
  end if;
  if (select count(*) from pg_catalog.pg_attribute a
      where a.attrelid = 'api.dam_order_list'::regclass and a.attnum > 0 and not a.attisdropped) <> 94
     or (select a.attname from pg_catalog.pg_attribute a
         where a.attrelid = 'api.dam_order_list'::regclass and a.attnum = 94) <> 'coldlion_import_po' then
    raise exception '#5004 OrderList view drifted from 20261028224921 (expected 94 columns)';
  end if;
  if to_regprocedure('public.resolve_coldlion_triage(uuid,text,uuid)') is not null then
    raise exception '#5004 public.resolve_coldlion_triage already exists';
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
    coalesce(so_date.sales_order_received_date, po.sent_po_date, pol.start_ship_date, po.order_date) AS order_window_date,
    case when jsonb_typeof(pol.metadata #> '{coldlion_values,quantity_ordered}')='number'
          and (pol.metadata #>> '{coldlion_values,quantity_ordered}')::numeric is distinct from pol.quantity_ordered
          and pol.metadata #> '{coldlion_reviewed,quantity_ordered}' is distinct from pol.metadata #> '{coldlion_values,quantity_ordered}'
         then (pol.metadata #>> '{coldlion_values,quantity_ordered}')::numeric end AS coldlion_quantity_ordered,
    case when nullif(btrim(pol.metadata #>> '{coldlion_values,import_po}'),'') is not null
          and lower(btrim(pol.metadata #>> '{coldlion_values,import_po}')) is distinct from lower(btrim(po.production_order_number))
          and pol.metadata #> '{coldlion_reviewed,import_po}' is distinct from pol.metadata #> '{coldlion_values,import_po}'
         then btrim(pol.metadata #>> '{coldlion_values,import_po}') end AS coldlion_import_po,
    (po.metadata ->> 'production_order_number_origin' = 'coldlion_intake_placeholder'
      and po.production_order_number ~ '^COLDLION-SO-[0-9]+$'
      and pol.voided_at is null and po.voided_at is null
      and coldlion_ref.id is not null and google_ref.id is null
      and coalesce(pol.metadata ->> 'coldlion_kept_separate', '') <> 'true') AS coldlion_unmatched
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

-- The guided resolver. Every action re-checks that the item still needs the
-- decision it answers, so a stale screen can never apply an old choice.
--   keep_google_quantity / keep_google_import_po  Google is right: remember
--       ColdLion's current value as reviewed; the Google value stays.
--   use_coldlion_quantity   ColdLion is right: the line takes its quantity.
--   use_coldlion_import_po  ColdLion is right: the line moves to the existing
--       OrderList order carrying that Import PO, for the same customer.
--   link_google_line        p_target is the same customer's Google line this
--       ColdLion placeholder line is: the same move the automatic merge makes for one
--       pair (ColdLion refs and snapshots move, the placeholder line goes; its
--       full row is kept on the Google line under metadata.coldlion_linked_from).
--   keep_separate           the ColdLion line has no Google line; it stays its
--       own row and leaves the list.
create function public.resolve_coldlion_triage(p_line uuid, p_action text, p_target uuid default null)
returns text
language plpgsql
security definer
set search_path = plm, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_line plm.production_order_line;
  v_order plm.production_order;
  v_target plm.production_order_line;
  v_cl jsonb;
  v_dest uuid;
  v_n int;
  v_stamp jsonb;
begin
  if v_actor is null then
    raise exception 'resolve_coldlion_triage: authentication required' using errcode = '42501';
  end if;
  select * into v_line from plm.production_order_line where id = p_line for update;
  if not found then
    raise exception 'This line no longer exists — refresh the list.' using errcode = 'P0002';
  end if;
  select * into v_order from plm.production_order where id = v_line.production_order_id;
  -- Only a line that really carries a ColdLion line can be reconciled:
  -- coldlion_values alone is metadata a user could have written.
  if not exists (select 1 from plm.production_order_line_source_ref r
                  where r.production_order_line_id = p_line and r.source_system = 'coldlion') then
    raise exception 'This line has no ColdLion line, so there is nothing to reconcile.' using errcode = '22023';
  end if;
  v_cl := v_line.metadata -> 'coldlion_values';
  v_stamp := jsonb_build_object('by', v_actor, 'at', now());

  if p_action in ('keep_google_quantity', 'use_coldlion_quantity') then
    if jsonb_typeof(v_cl -> 'quantity_ordered') <> 'number'
       or (v_cl ->> 'quantity_ordered')::numeric is not distinct from v_line.quantity_ordered
       or v_line.metadata #> '{coldlion_reviewed,quantity_ordered}' is not distinct from v_cl -> 'quantity_ordered' then
      raise exception 'This quantity no longer needs a decision — refresh the list.' using errcode = '22023';
    end if;
    if p_action = 'use_coldlion_quantity' then
      update plm.production_order_line set quantity_ordered = (v_cl ->> 'quantity_ordered')::numeric,
             metadata = metadata || jsonb_build_object('coldlion_resolved_quantity', v_stamp || jsonb_build_object('from', v_line.quantity_ordered)),
             updated_at = now()
       where id = p_line;
      return format('Quantity changed to %s.', v_cl ->> 'quantity_ordered');
    end if;
    update plm.production_order_line
       set metadata = jsonb_set(metadata || jsonb_build_object('coldlion_reviewed', coalesce(metadata -> 'coldlion_reviewed', '{}'::jsonb)),
                                '{coldlion_reviewed,quantity_ordered}', v_cl -> 'quantity_ordered')
                      || jsonb_build_object('coldlion_resolved_quantity', v_stamp),
           updated_at = now()
     where id = p_line;
    return format('Kept the Google quantity %s.', v_line.quantity_ordered);
  end if;

  if p_action in ('keep_google_import_po', 'use_coldlion_import_po') then
    if nullif(btrim(v_cl ->> 'import_po'), '') is null
       or lower(btrim(v_cl ->> 'import_po')) is not distinct from lower(btrim(v_order.production_order_number))
       or v_line.metadata #> '{coldlion_reviewed,import_po}' is not distinct from v_cl -> 'import_po' then
      raise exception 'This Import PO no longer needs a decision — refresh the list.' using errcode = '22023';
    end if;
    if p_action = 'use_coldlion_import_po' then
      -- The destination comes from ColdLion's own order history, never from
      -- metadata alone: the newest retained prod_reference_no of this line's
      -- ColdLion sales order line must still be the value on screen.
      if not exists (
        select 1
          from plm.production_order_line_source_ref r
          cross join lateral (
            select nullif(btrim(h.prod_reference_no), '') as import_po
              from coldlion.order_history_line h
             where r.source_id ~ '^coldlion:so:[0-9]+:line:[0-9]+:'
               and h.sales_order_no = split_part(r.source_id, ':', 3)::bigint
               and h.sales_order_line_no = split_part(r.source_id, ':', 5)::integer
             order by h.fetched_at desc, h.created_at desc, h.id
             limit 1) oh
         where r.production_order_line_id = p_line and r.source_system = 'coldlion'
           and lower(oh.import_po) = lower(btrim(v_cl ->> 'import_po'))) then
        raise exception 'ColdLion no longer shows Import PO % for this line — refresh the list.', btrim(v_cl ->> 'import_po') using errcode = '22023';
      end if;
      -- Historical duplicate Import PO numbers are grandfathered, so the
      -- destination is the one open order with that number for THIS customer.
      select count(*), min(id::text)::uuid into v_n, v_dest from plm.production_order
       where lower(btrim(production_order_number)) = lower(btrim(v_cl ->> 'import_po')) and voided_at is null
         and company_id is not distinct from v_order.company_id;
      if v_n <> 1 then
        if v_n = 0 and exists (select 1 from plm.production_order
                                where lower(btrim(production_order_number)) = lower(btrim(v_cl ->> 'import_po')) and voided_at is null) then
          raise exception 'Order % belongs to a different customer, so this line was not moved. Check ColdLion.', btrim(v_cl ->> 'import_po') using errcode = '22023';
        end if;
        raise exception 'There is no single OrderList order % to move this line to. Create it first, or keep the Google Import PO.', btrim(v_cl ->> 'import_po') using errcode = '22023';
      end if;
      update plm.production_order_line set production_order_id = v_dest,
             metadata = metadata || jsonb_build_object('coldlion_resolved_import_po', v_stamp || jsonb_build_object('from', v_order.production_order_number)),
             updated_at = now()
       where id = p_line;
      return format('Line moved from %s to %s.', v_order.production_order_number, btrim(v_cl ->> 'import_po'));
    end if;
    update plm.production_order_line
       set metadata = jsonb_set(metadata || jsonb_build_object('coldlion_reviewed', coalesce(metadata -> 'coldlion_reviewed', '{}'::jsonb)),
                                '{coldlion_reviewed,import_po}', v_cl -> 'import_po')
                      || jsonb_build_object('coldlion_resolved_import_po', v_stamp),
           updated_at = now()
     where id = p_line;
    return format('Kept the Google Import PO %s.', v_order.production_order_number);
  end if;

  if p_action in ('link_google_line', 'keep_separate') then
    if coalesce(v_order.metadata ->> 'production_order_number_origin', '') <> 'coldlion_intake_placeholder'
       or v_order.production_order_number !~ '^COLDLION-SO-[0-9]+$'
       or v_line.voided_at is not null
       or coalesce(v_line.metadata ->> 'coldlion_kept_separate', '') = 'true'
       or not exists (select 1 from plm.production_order_line_source_ref r where r.production_order_line_id = p_line and r.source_system = 'coldlion')
       or exists (select 1 from plm.production_order_line_source_ref r where r.production_order_line_id = p_line and r.source_system <> 'coldlion') then
      raise exception 'This ColdLion line no longer needs a decision — refresh the list.' using errcode = '22023';
    end if;
    if p_action = 'keep_separate' then
      update plm.production_order_line
         set metadata = metadata || jsonb_build_object('coldlion_kept_separate', true, 'coldlion_resolved_separate', v_stamp),
             updated_at = now()
       where id = p_line;
      return 'Kept as its own ColdLion row.';
    end if;
    select * into v_target from plm.production_order_line where id = p_target for update;
    if not found
       or v_target.voided_at is not null
       or not exists (select 1 from plm.production_order_line_source_ref r where r.production_order_line_id = p_target and r.source_system = 'google_order_list')
       or exists (select 1 from plm.production_order_line_source_ref r where r.production_order_line_id = p_target and r.source_system = 'coldlion')
       or exists (select 1 from plm.production_order p where p.id = v_target.production_order_id and p.production_order_number ~ '^COLDLION-SO-') then
      raise exception 'That Google line cannot take a ColdLion line (it is gone, voided, or already linked). Pick another.' using errcode = '22023';
    end if;
    if (select company_id from plm.production_order where id = v_target.production_order_id) is distinct from v_order.company_id then
      raise exception 'That Google line is for a different customer, so it was not linked. Pick another.' using errcode = '22023';
    end if;
    update plm.production_order_line g
       set quantity_ordered = coalesce(g.quantity_ordered, v_line.quantity_ordered),
           metadata = coalesce(g.metadata, '{}'::jsonb)
                      || jsonb_build_object('coldlion_linked_from', to_jsonb(v_line) || jsonb_build_object('linked_by', v_actor, 'linked_at', now()))
                      || case when v_line.quantity_ordered is not null and g.metadata -> 'coldlion_values' is null
                              then jsonb_build_object('coldlion_values', jsonb_build_object('quantity_ordered', v_line.quantity_ordered, 'import_po', null))
                              else '{}'::jsonb end,
           updated_at = now()
     where g.id = p_target;
    update plm.production_order_line_source_ref set production_order_line_id = p_target
     where production_order_line_id = p_line and source_system = 'coldlion';
    update dam.production_order_snapshot set production_order_line_id = p_target
     where production_order_line_id = p_line;
    delete from plm.production_order_line where id = p_line;
    return 'Linked to the Google line.';
  end if;

  raise exception 'resolve_coldlion_triage: unknown action %', p_action using errcode = '22023';
end;
$$;

revoke all on function public.resolve_coldlion_triage(uuid, text, uuid) from public, anon;
grant execute on function public.resolve_coldlion_triage(uuid, text, uuid) to authenticated, service_role;
comment on function public.resolve_coldlion_triage(uuid, text, uuid) is
  'Guided ColdLion reconciliation (#5004): resolve one OrderList line flagged by api.dam_order_list (coldlion_quantity_ordered, coldlion_import_po or coldlion_unmatched). Returns a plain-language result.';

commit;
