-- u2giants/popdam3#1298 stage S2 (claim: popcre/shared-db#6993).
-- derived-from: 20261203000000, 20261201100000
-- PopDAM now reads DesignFlow production orders through
-- api.dam_production_orders_for_sku (popcre/shared-db#6987) and no longer
-- copies them (u2giants/popdam3#1296), so its copy tables go. The two dam
-- snapshot placeholders were created in 20260621151024 and never written by
-- anything; two functions only tidy dam.production_order_snapshot, so those
-- statements are removed from the live definitions (nothing else changes).

-- clear_dam_buy_sheet_import: identical to the live definition (md5 of body verified 2026-11-23)
-- except the dam.production_order_snapshot statement is removed.
CREATE OR REPLACE FUNCTION public.clear_dam_buy_sheet_import(p_import_id uuid DEFAULT NULL::uuid, p_apply boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plm', 'public', 'core', 'dam', 'pg_temp'
AS $function$
declare
  v_actor    uuid := auth.uid();
  v_imp      dam.order_buy_sheet_import%rowtype;
  v_created  uuid[];
  v_updated  jsonb;
  v_orders   uuid[];
  v_empty    uuid[];
  v_r        jsonb;
begin
  if v_actor is null then
    raise exception 'clear_dam_buy_sheet_import: authentication required' using errcode = '42501';
  end if;
  -- #6520 sandbox-only guard: refuses everywhere the enable row is absent
  -- (production); the preview/sandbox database carries it as data.
  if not exists (
    select 1 from public.admin_config
     where key = 'SANDBOX_ENABLED_TOOLS'
       and value @> '["clear_dam_buy_sheet_import"]'::jsonb
  ) then
    raise exception 'clear_dam_buy_sheet_import: sandbox-only tool, not enabled on this database (admin_config.SANDBOX_ENABLED_TOOLS)'
      using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('import_dam_buy_sheet'));
  if p_import_id is null then
    select * into v_imp from dam.order_buy_sheet_import
     where imported_by = v_actor order by imported_at desc, id desc limit 1;
  else
    select * into v_imp from dam.order_buy_sheet_import where id = p_import_id;
  end if;
  if v_imp.id is null then
    raise exception 'clear_dam_buy_sheet_import: no buy-sheet import to clear' using errcode = 'P0002';
  end if;
  if v_imp.imported_by is distinct from v_actor then
    raise exception 'clear_dam_buy_sheet_import: only the person who uploaded this buy sheet can clear it' using errcode = '42501';
  end if;

  -- Lines this import created: still carrying its own popdam_buy_sheet ref.
  select coalesce(array_agg(distinct l.id), '{}') into v_created
    from jsonb_array_elements(v_imp.result) r
    join plm.production_order_line l on l.id = (r ->> 'line_id')::uuid
   where r ->> 'outcome' = 'new' and l.source_system = 'popdam_buy_sheet'
     and exists (select 1 from plm.production_order_line_source_ref s
                  where s.production_order_line_id = l.id and s.source_system = 'popdam_buy_sheet'
                    and s.source_id = coalesce(r ->> 'source_ref', l.source_id));
  -- Lines this import updated, with what to restore.
  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_updated
    from jsonb_array_elements(v_imp.result) r
   where r ->> 'outcome' = 'updated' and r ->> 'line_id' is not null
     and exists (select 1 from plm.production_order_line l where l.id = (r ->> 'line_id')::uuid);
  select coalesce(array_agg(distinct production_order_id), '{}') into v_orders
    from plm.production_order_line where id = any (v_created);
  -- Orders the import created that would be left with no lines.
  select coalesce(array_agg(o.id), '{}') into v_empty
    from plm.production_order o
   where o.id = any (v_orders) and o.source_system = 'popdam_buy_sheet'
     and o.metadata ->> 'created_via' = 'popdam_buy_sheet'
     and not exists (select 1 from plm.production_order_line l
                      where l.production_order_id = o.id and not (l.id = any (v_created)));

  if exists (select 1 from plm.production_order_line_source_ref s
              where s.source_system = 'coldlion'
                and (s.production_order_line_id = any (v_created)
                     or s.production_order_line_id in (select (u ->> 'line_id')::uuid from jsonb_array_elements(v_updated) u))) then
    raise exception 'clear_dam_buy_sheet_import: a line from this buy sheet is now linked to ColdLion; nothing was cleared' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(v_imp.result) r
               join plm.production_order_line l on l.id = (r ->> 'line_id')::uuid
               join plm.production_order o on o.id = l.production_order_id
              where l.id = any (v_created) and nullif(btrim(coalesce(r ->> 'order_number', '')), '') is null
                and btrim(o.production_order_number) <> '') then
    raise exception 'clear_dam_buy_sheet_import: a real PO number has since been put on an order from this buy sheet; nothing was cleared' using errcode = 'P0001';
  end if;

  if p_apply then
    delete from plm.production_order_line_source_ref where production_order_line_id = any (v_created);
    delete from plm.production_order_line where id = any (v_created);
    for v_r in select * from jsonb_array_elements(v_updated)
    loop
      update plm.production_order_line
         set quantity_ordered = (v_r ->> 'previous_quantity')::numeric,
             metadata = coalesce(metadata, '{}'::jsonb) - 'buy_sheet',
             assortment_id = case when coalesce((v_r ->> 'assortment_set')::boolean, false)
                                  then v_r ->> 'previous_assortment_id' else assortment_id end,
             case_pack = case when v_r ? 'previous_case_pack' then (v_r ->> 'previous_case_pack')::numeric else case_pack end,
             item_id = case when v_r ? 'previous_item_id' then (v_r ->> 'previous_item_id')::uuid else item_id end,
             master_data_match_status = case when v_r ? 'previous_match_status'
                                             then v_r ->> 'previous_match_status' else master_data_match_status end,
             updated_at = now()
       where id = (v_r ->> 'line_id')::uuid;
      delete from plm.production_order_line_source_ref
       where production_order_line_id = (v_r ->> 'line_id')::uuid and source_system = 'popdam_buy_sheet'
         and (v_r ->> 'source_ref' is null or source_id = v_r ->> 'source_ref');
    end loop;
    delete from plm.production_order_source_ref where production_order_id = any (v_empty);
    delete from dam.order_tracking_ext where order_id = any (v_empty);
    delete from plm.production_order where id = any (v_empty);
    delete from dam.order_buy_sheet_import where id = v_imp.id;
  end if;

  return jsonb_build_object(
    'applied', p_apply, 'import_id', v_imp.id, 'file_name', v_imp.file_name,
    'imported_at', v_imp.imported_at,
    'lines_to_delete', cardinality(v_created),
    'lines_to_restore', jsonb_array_length(v_updated),
    'orders_to_delete', cardinality(v_empty));
end;
$function$;

-- resolve_coldlion_triage: identical to the live definition (md5 of body verified 2026-11-23)
-- except the dam.production_order_snapshot statement is removed.
CREATE OR REPLACE FUNCTION public.resolve_coldlion_triage(p_line uuid, p_action text, p_target uuid DEFAULT NULL::uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'plm', 'public', 'pg_temp'
    AS $_$
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
    -- A Google line imported without a customer link is still the same line
    -- when its customer PO (unpadded, as the automatic merge compares it) and
    -- SKU match exactly (a blank PO or SKU never matches); any other
    -- customer difference is refused.
    if (select company_id from plm.production_order where id = v_target.production_order_id) is distinct from v_order.company_id
       and not coalesce((select company_id from plm.production_order where id = v_target.production_order_id) is null
                and nullif(btrim(v_line.sku), '') is not null
                and v_target.sku = v_line.sku
                and nullif(ltrim(btrim(v_line.customer_po_number), '0'), '') is not null
                and nullif(ltrim(btrim(v_target.customer_po_number), '0'), '') = nullif(ltrim(btrim(v_line.customer_po_number), '0'), ''), false) then
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
    delete from plm.production_order_line where id = p_line;
    return 'Linked to the Google line.';
  end if;

  raise exception 'resolve_coldlion_triage: unknown action %', p_action using errcode = '22023';
end;
$_$;

drop table if exists public.prod_order_headers_raw;
drop table if exists public.prod_order_headers_current;
drop table if exists public.prod_order_sync_runs;
drop table if exists dam.production_order_snapshot;
drop table if exists dam.erp_item_snapshot;
