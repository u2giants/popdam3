-- #5004 / claim #5031: link a ColdLion line to a Google line with no customer
-- derived-from: 20261029023554
-- Owner ruling, Albert Hazan, 2026-10-29: "if one ColdLion line matches two
-- Google lines that's a problem and has to go into the Triage section." The
-- live case (Spencer Gifts, customer PO 315063, SKU VDC83HDFAN01) sits on a
-- Google line whose order has no customer link, so the guided link refused it
-- as "a different customer". Linking now also accepts a Google line with NO
-- customer when its customer PO and SKU match the ColdLion line exactly. The
-- function body is otherwise 20261029023554's; grants are unchanged.

begin;

do $dependencies$
begin
  if to_regprocedure('public.resolve_coldlion_triage(uuid,text,uuid)') is null then
    raise exception '#5004 requires public.resolve_coldlion_triage from 20261029023554';
  end if;
end;
$dependencies$;

create or replace function public.resolve_coldlion_triage(p_line uuid, p_action text, p_target uuid default null)
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
    update dam.production_order_snapshot set production_order_line_id = p_target
     where production_order_line_id = p_line;
    delete from plm.production_order_line where id = p_line;
    return 'Linked to the Google line.';
  end if;

  raise exception 'resolve_coldlion_triage: unknown action %', p_action using errcode = '22023';
end;
$$;

commit;
