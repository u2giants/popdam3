-- derived-from: 20261110194619
-- Second forward fix (review finding popcre/shared-db#6017): keep trimmed
-- style matching on the tracker side (upper(btrim(sku)), as before), hold a
-- line whose parent order was voided, take one global import lock so two
-- uploads cannot both create the same new order number, and scope the
-- existing-order lookup to the validated customer. The other-customer hold
-- is null-safe: an order with no company id and another customer's name was
-- not held before (NOT of NULL), which could add a duplicate order number.

create or replace function public.import_dam_buy_sheet(
  p_customer_id   uuid,
  p_file_name     text,
  p_file_sha256   text,
  p_raw_sheet     jsonb,
  p_lines         jsonb,
  p_order_numbers jsonb default '{}'::jsonb,
  p_apply         boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = plm, public, core, dam, pg_temp
as $$
declare
  v_actor      uuid := auth.uid();
  v_customer   text;
  v_line       jsonb;
  v_sku        text;
  v_date       date;
  v_qty        numeric;
  v_case_pack  numeric;
  v_group      text;
  v_ref        text;
  v_line_id    uuid;
  v_order_id   uuid;
  v_n          integer;
  v_item       uuid;
  v_status     text;
  v_old        record;
  v_prev       numeric;
  v_number     text;
  v_meta       jsonb;
  v_results    jsonb := '[]'::jsonb;
  v_outcome    text;
  v_reason     text;
  v_import_id  uuid;
begin
  if v_actor is null then
    raise exception 'import_dam_buy_sheet: authentication required' using errcode = '42501';
  end if;
  select name into v_customer from core.customer where id = p_customer_id;
  if v_customer is null then
    raise exception 'import_dam_buy_sheet: unknown customer' using errcode = '23503';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0
     or jsonb_array_length(p_lines) > 2000 then
    raise exception 'import_dam_buy_sheet: p_lines must be a non-empty array of at most 2000 lines' using errcode = '22023';
  end if;
  if coalesce(p_file_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'import_dam_buy_sheet: file_sha256 must be a lowercase sha-256' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_order_numbers, '{}'::jsonb)) <> 'object' then
    raise exception 'import_dam_buy_sheet: p_order_numbers must be an object' using errcode = '22023';
  end if;

  -- One import at a time across customers, so two uploads can never both
  -- create the same new order number; a concurrent upload waits.
  perform pg_advisory_xact_lock(hashtext('import_dam_buy_sheet'));

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_sku := upper(btrim(coalesce(v_line ->> 'sku', '')));
    v_date := (v_line ->> 'delivery_date')::date;
    v_qty := (v_line ->> 'quantity')::numeric;
    v_case_pack := nullif(v_line ->> 'case_pack', '')::numeric;
    v_group := coalesce(v_line ->> 'group', '');
    if v_sku = '' or v_date is null or v_qty is null or v_qty < 0 then
      raise exception 'import_dam_buy_sheet: every line needs sku, delivery_date and a non-negative quantity' using errcode = '22023';
    end if;
    v_ref := 'buysheet:' || p_customer_id::text || ':' || lower(v_sku) || ':' || to_char(v_date, 'YYYY-MM-DD');
    v_line_id := null; v_outcome := null; v_reason := null; v_number := null; v_prev := null;

    -- 1. A line this import created or claimed before.
    select r.production_order_line_id into v_line_id
      from plm.production_order_line_source_ref r
     where r.source_system = 'popdam_buy_sheet' and r.source_id = v_ref;

    -- 2. Exactly one active line of this customer, style and start ship date.
    if v_line_id is null then
      select count(*), (array_agg(l.id))[1] into v_n, v_line_id
        from plm.production_order_line l
        join plm.production_order o on o.id = l.production_order_id
       where l.voided_at is null and o.voided_at is null
         and l.status is distinct from 'cancelled'
         and l.sku_normalized = lower(v_sku)
         and l.start_ship_date = v_date
         and (o.company_id = p_customer_id
              or (o.company_id is null and lower(btrim(o.metadata ->> 'customer_name')) = lower(v_customer)));
      if v_n > 1 then
        v_line_id := null; v_outcome := 'held'; v_reason := 'several OrderList lines share this customer, style and ship date';
      end if;
    end if;

    if v_outcome is null and v_line_id is not null then
      select l.id, l.quantity_ordered, l.case_pack, coalesce(l.voided_at, o.voided_at) as voided_at, l.item_id, o.production_order_number
        into v_old
        from plm.production_order_line l join plm.production_order o on o.id = l.production_order_id
       where l.id = v_line_id;
      v_number := v_old.production_order_number;
      v_prev := v_old.quantity_ordered;
      if v_old.voided_at is not null then
        v_outcome := 'held'; v_reason := 'the line this sheet created earlier, or its order, was voided';
      elsif exists (select 1 from plm.production_order_line_source_ref r
                     where r.production_order_line_id = v_line_id and r.source_system = 'coldlion'
                       and r.source_id ~ '^coldlion:so:') then
        v_outcome := 'held'; v_reason := 'the official PO is already on this line (ColdLion)';
      elsif v_old.quantity_ordered is not distinct from v_qty
            and (v_case_pack is null or v_old.case_pack is not distinct from v_case_pack)
            and exists (select 1 from plm.production_order_line_source_ref r
                         where r.production_order_line_id = v_line_id
                           and r.source_system = 'popdam_buy_sheet' and r.source_id = v_ref) then
        v_outcome := 'unchanged';
      else
        v_outcome := 'updated';
      end if;
    elsif v_outcome is null and v_qty = 0 then
      v_outcome := 'skipped'; v_reason := 'no quantity for this delivery';
    elsif v_outcome is null then
      v_number := nullif(btrim(coalesce(p_order_numbers ->> v_group, '')), '');
      if v_number is null then
        v_outcome := 'held'; v_reason := 'no OrderList order number typed for this pack and delivery';
      elsif (select count(*) from plm.production_order o
              where upper(btrim(o.production_order_number)) = upper(v_number) and o.voided_at is null) > 1 then
        v_outcome := 'held'; v_reason := 'several OrderList orders are numbered ' || v_number;
      elsif exists (select 1 from plm.production_order o
                     where upper(btrim(o.production_order_number)) = upper(v_number)
                       and (o.voided_at is not null
                            or not (coalesce(o.company_id = p_customer_id, false)
                                    or (o.company_id is null
                                        and coalesce(lower(btrim(o.metadata ->> 'customer_name')) = lower(v_customer), false))))) then
        v_outcome := 'held'; v_reason := 'order number ' || v_number || ' belongs to another customer or is voided';
      else
        v_outcome := 'new';
      end if;
    end if;

    -- Item link: exact SKU, unique item, never fuzzy. update_dam_order also
    -- qualifies by catalog; a buy sheet names none, so the catalog applies only
    -- when the line carries source_style_type, and a style whose two catalogs
    -- resolve to different items is reported ambiguous (not linked).
    select count(distinct b.plm_item_id), (array_agg(distinct b.plm_item_id))[1] into v_n, v_item
      from plm.style_tracker_item_bridge b
      join public.style_tracker_rows t on t.id = b.style_tracker_row_id
     where upper(btrim(t.sku)) = v_sku and b.plm_item_id is not null and t.tracker_type = b.tracker_type
       and (nullif(btrim(lower(coalesce(v_line ->> 'source_style_type', ''))), '') is null
            or b.tracker_type = btrim(lower(v_line ->> 'source_style_type')));
    v_status := case when v_n = 1 then 'matched' when v_n > 1 then 'ambiguous' else 'unmatched' end;
    if v_n <> 1 then v_item := null; end if;

    v_meta := jsonb_build_object('buy_sheet', jsonb_build_object(
      'customer_id', p_customer_id, 'file_name', p_file_name, 'file_sha256', p_file_sha256,
      'delivery_date', v_date, 'quantity', v_qty, 'case_pack', v_case_pack,
      'source', v_line - 'sku' - 'delivery_date' - 'quantity' - 'case_pack',
      'imported_by', v_actor, 'imported_at', now()));

    if p_apply and v_outcome = 'updated' then
      update plm.production_order_line
         set quantity_ordered = v_qty,
             case_pack = coalesce(v_case_pack, case_pack),
             metadata = coalesce(metadata, '{}'::jsonb) || v_meta,
             item_id = coalesce(item_id, v_item),
             master_data_match_status = case when item_id is null then v_status else master_data_match_status end,
             updated_at = now()
       where id = v_line_id;
      insert into plm.production_order_line_source_ref (production_order_line_id, source_system, source_id, is_primary)
      values (v_line_id, 'popdam_buy_sheet', v_ref, false)
      on conflict (source_system, source_id) do nothing;
    elsif p_apply and v_outcome = 'new' then
      select o.id into v_order_id from plm.production_order o
       where upper(btrim(o.production_order_number)) = upper(v_number) and o.voided_at is null
         and (o.company_id = p_customer_id
              or (o.company_id is null and lower(btrim(o.metadata ->> 'customer_name')) = lower(v_customer)));
      if v_order_id is null then
        v_order_id := gen_random_uuid();
        insert into plm.production_order (id, production_order_number, company_id, metadata, source_system, source_id)
        values (v_order_id, v_number, p_customer_id,
                jsonb_build_object('customer_name', v_customer, 'created_by', v_actor,
                                   'created_via', 'popdam_buy_sheet'),
                'popdam_buy_sheet', 'buysheet:order:' || v_order_id::text);
        insert into plm.production_order_source_ref (production_order_id, source_system, source_id, is_primary)
        values (v_order_id, 'popdam_buy_sheet', 'buysheet:order:' || v_order_id::text, true);
      end if;
      v_line_id := gen_random_uuid();
      insert into plm.production_order_line (
        id, production_order_id, line_number, sku, quantity_ordered, case_pack, order_type,
        start_ship_date, item_id, master_data_match_status, metadata, source_system, source_id)
      values (
        v_line_id, v_order_id,
        (select coalesce(max(nullif(regexp_replace(line_number, '[^0-9]', '', 'g'), '')::integer), 0) + 1
           from plm.production_order_line where production_order_id = v_order_id)::text,
        v_sku, v_qty, v_case_pack, 'FOB', v_date, v_item, v_status,
        v_meta || jsonb_build_object('created_by', v_actor, 'created_via', 'popdam_buy_sheet'),
        'popdam_buy_sheet', v_ref);
      insert into plm.production_order_line_source_ref (production_order_line_id, source_system, source_id, is_primary)
      values (v_line_id, 'popdam_buy_sheet', v_ref, true);
    end if;

    v_results := v_results || jsonb_build_object(
      'sku', v_sku, 'delivery_date', v_date, 'quantity', v_qty, 'group', v_group,
      'outcome', v_outcome, 'reason', v_reason, 'order_number', v_number,
      'previous_quantity', v_prev,
      'line_id', case when v_outcome in ('updated', 'unchanged', 'held') or p_apply then v_line_id end,
      'item_match', v_status);
  end loop;

  if p_apply then
    insert into dam.order_buy_sheet_import
      (customer_id, file_name, file_sha256, raw_sheet, parsed_lines, order_numbers, result, imported_by)
    values (p_customer_id, p_file_name, p_file_sha256, p_raw_sheet, p_lines,
            coalesce(p_order_numbers, '{}'::jsonb), v_results, v_actor)
    returning id into v_import_id;
  end if;

  return jsonb_build_object(
    'applied', p_apply, 'import_id', v_import_id, 'customer', v_customer,
    'counts', (select jsonb_object_agg(k, n) from (
                 select r ->> 'outcome' as k, count(*) as n from jsonb_array_elements(v_results) r group by 1) c),
    'unmatched_styles', (select coalesce(jsonb_agg(distinct r ->> 'sku'), '[]'::jsonb)
                           from jsonb_array_elements(v_results) r where r ->> 'item_match' <> 'matched'),
    'lines', v_results);
end;
$$;
revoke all on function public.import_dam_buy_sheet(uuid, text, text, jsonb, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.import_dam_buy_sheet(uuid, text, text, jsonb, jsonb, jsonb, boolean) to authenticated, service_role;
comment on function public.import_dam_buy_sheet(uuid, text, text, jsonb, jsonb, jsonb, boolean) is
  'PopDAM OrderList customer buy-sheet import (Burlington HFC). p_apply=false previews; true writes and records dam.order_buy_sheet_import. Identity = customer + style + delivery date via popdam_buy_sheet line refs, else exactly one active customer/style/start-ship line; ambiguous, ColdLion-SO-linked, voided or unnumbered lines are held. Item links: exact SKU, one unique item (catalog-qualified when source_style_type is given), else unmatched/ambiguous.';
