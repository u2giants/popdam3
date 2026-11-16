-- derived-from: 20261118120000
-- shared-db#6476, review finding #6480 on PR #6477 (not yet in production):
-- 1. the blank buy-sheet order identity now includes the customer:
--    source_id 'buysheet:order:<customer>:<sha>:<group>';
-- 2. the import records previous case_pack, item_id and match status of each
--    updated line, and Clear restores them too;
-- 3. the PO guard checks order identity before the blank branch, and a blank
--    number may stay blank only on a popdam_buy_sheet row whose source_id is unchanged.
-- Typed-number limitation (finding 4): a cleared order's typed PO stays reserved
-- by design (20261013201822); the master-SKU path is unaffected.

create or replace function plm.guard_production_po_number()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  next_po text := plm.normalize_production_po_number(new.production_order_number);
  claimed_po text;
  admitted_id uuid;
begin
  if tg_op = 'UPDATE' and new.id is distinct from old.id then
    raise exception 'An existing order identity cannot be changed.' using errcode = '23514';
  end if;
  if next_po is null or next_po = '' then
    -- Buy-sheet orders wait for their PO (owner rule 2026-11-16, shared-db#6476).
    if next_po = '' and new.source_system = 'popdam_buy_sheet'
       and (tg_op = 'INSERT'
            or (plm.normalize_production_po_number(old.production_order_number) = ''
                and old.source_system = 'popdam_buy_sheet'
                and new.source_id is not distinct from old.source_id)) then
      return new;
    end if;
    raise exception 'A production PO number is required.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id then
      raise exception 'An existing order identity cannot be changed.' using errcode = '23514';
    end if;
    -- Existing historical reuse is grandfathered by identity, never by date or role.
    if next_po = plm.normalize_production_po_number(old.production_order_number) then
      return new;
    end if;
    -- A blank buy-sheet order receives its PO once; the number is reserved below.
    if plm.normalize_production_po_number(old.production_order_number) is distinct from '' then
      raise exception 'An existing production PO number cannot be changed.' using errcode = '23514';
    end if;
  end if;

  -- An exact-ID INSERT ... ON CONFLICT UPDATE can update the same existing order.
  -- A deleted order no longer qualifies, so its number cannot be recycled.
  if tg_op = 'INSERT' and exists (select 1 from plm.production_order p
             where p.id = new.id and plm.normalize_production_po_number(p.production_order_number) = next_po) then
    return new;
  end if;

  -- The primary key waits on concurrent reservations and permits only one winner.
  insert into plm.production_po_reservation(normalized_po) values (next_po)
  on conflict (normalized_po) do nothing returning normalized_po into claimed_po;
  if claimed_po is not null then return new; end if;

  update plm.production_po_legacy_admission
     set used_at = clock_timestamp()
   where order_id = new.id and normalized_po = next_po and used_at is null
   returning order_id into admitted_id;
  if admitted_id is not null then return new; end if;

  raise exception 'This production PO number has already been used. Enter a new number.'
    using errcode = '23505', constraint = 'production_po_no_reuse';
end;
$function$;
revoke all on function plm.guard_production_po_number() from public, anon, authenticated, service_role;
comment on function plm.guard_production_po_number() is
  'Atomic no-reuse enforcement for every canonical header writer; preserves existing historical duplicates and immutable identities. Punctuation and leading zeros are significant. Only a popdam_buy_sheet header may be blank, and a blank number may be set once to a new reserved number (shared-db#6476).';

create or replace function public.import_dam_buy_sheet(
  p_customer_id   uuid,
  p_file_name     text,
  p_file_sha256   text,
  p_raw_sheet     jsonb,
  p_lines         jsonb,
  p_order_numbers jsonb default '{}'::jsonb,
  p_apply         boolean default false,
  p_master_skus   jsonb default '{}'::jsonb
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
  v_skus       text[];
  v_cands      jsonb;
  v_items      jsonb;
  v_type       text;
  v_status     text;
  v_old        record;
  v_prev       numeric;
  v_number     text;
  v_meta       jsonb;
  v_results    jsonb := '[]'::jsonb;
  v_outcome    text;
  v_reason     text;
  v_import_id  uuid;
  v_claimed    boolean;
  v_prior      uuid[];
  v_line_order uuid;
  v_master     text;
  v_prev_asst  text;
  v_order_new  boolean;
  v_order_src  text;
  v_prev_cp    numeric;
  v_prev_item  uuid;
  v_prev_ms    text;
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
  if jsonb_typeof(coalesce(p_master_skus, '{}'::jsonb)) <> 'object' then
    raise exception 'import_dam_buy_sheet: p_master_skus must be an object' using errcode = '22023';
  end if;

  -- One import at a time across customers, so two uploads can never both
  -- create the same new order number; a concurrent upload waits.
  perform pg_advisory_xact_lock(hashtext('import_dam_buy_sheet'));

  -- Set-based lookups, once per call (a per-line scan of the order and
  -- style-tracker tables ran ~0.1 s per line and broke the 8 s API limit).
  select array_agg(distinct upper(btrim(x ->> 'sku'))) into v_skus
    from jsonb_array_elements(p_lines) x;
  select coalesce(jsonb_object_agg(k, ids), '{}'::jsonb) into v_cands from (
    select upper(btrim(l.sku)) || '|' || l.start_ship_date::text as k, jsonb_agg(l.id) as ids
      from plm.production_order o
      join plm.production_order_line l on l.production_order_id = o.id
     where l.voided_at is null and o.voided_at is null
       and l.status is distinct from 'cancelled'
       and l.start_ship_date is not null
       and upper(btrim(l.sku)) = any (v_skus)
       and (o.company_id = p_customer_id
            or (o.company_id is null and lower(btrim(o.metadata ->> 'customer_name')) = lower(v_customer)))
     group by 1) c;
  select coalesce(jsonb_object_agg(sku, pairs), '{}'::jsonb) into v_items from (
    select upper(btrim(t.sku)) as sku,
           jsonb_agg(distinct jsonb_build_object('type', b.tracker_type, 'item', b.plm_item_id)) as pairs
      from public.style_tracker_rows t
      join plm.style_tracker_item_bridge b on b.style_tracker_row_id = t.id and b.tracker_type = t.tracker_type
     where b.plm_item_id is not null and upper(btrim(t.sku)) = any (v_skus)
     group by 1) i;

  -- Orders an earlier buy-sheet import already wrote to (taken before this
  -- call writes anything, so its own lines never count).
  select coalesce(array_agg(distinct l.production_order_id), '{}') into v_prior
    from plm.production_order_line_source_ref r
    join plm.production_order_line l on l.id = r.production_order_line_id
   where r.source_system = 'popdam_buy_sheet';

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
    v_claimed := false; v_line_order := null; v_prev_asst := null; v_order_new := false;
    v_prev_cp := null; v_prev_item := null; v_prev_ms := null;
    v_master := nullif(upper(btrim(coalesce(p_master_skus ->> v_group, ''))), '');
    v_order_src := 'buysheet:order:' || p_customer_id::text || ':' || p_file_sha256 || ':' || v_group;

    -- 1. A line this import created or claimed before.
    select r.production_order_line_id into v_line_id
      from plm.production_order_line_source_ref r
     where r.source_system = 'popdam_buy_sheet' and r.source_id = v_ref;
    v_claimed := v_line_id is not null;

    -- 2. Exactly one active line of this customer, style and start ship date.
    if v_line_id is null then
      v_n := coalesce(jsonb_array_length(v_cands -> (v_sku || '|' || v_date::text)), 0);
      v_line_id := (v_cands -> (v_sku || '|' || v_date::text) ->> 0)::uuid;
      if v_n > 1 then
        v_line_id := null; v_outcome := 'held'; v_reason := 'several OrderList lines share this customer, style and ship date';
      end if;
    end if;

    if v_outcome is null and v_line_id is not null then
      select l.id, l.production_order_id, l.quantity_ordered, l.case_pack, coalesce(l.voided_at, o.voided_at) as voided_at, l.item_id, o.production_order_number, l.assortment_id, l.master_data_match_status
        into v_old
        from plm.production_order_line l join plm.production_order o on o.id = l.production_order_id
       where l.id = v_line_id;
      v_number := v_old.production_order_number;
      v_line_order := v_old.production_order_id;
      v_prev := v_old.quantity_ordered;
      v_prev_asst := v_old.assortment_id;
      v_prev_cp := v_old.case_pack; v_prev_item := v_old.item_id; v_prev_ms := v_old.master_data_match_status;
      if v_old.voided_at is not null then
        v_outcome := 'held'; v_reason := 'the line this sheet created earlier, or its order, was voided';
      elsif exists (select 1 from plm.production_order_line_source_ref r
                     where r.production_order_line_id = v_line_id and r.source_system = 'coldlion'
                       and r.source_id ~ '^coldlion:so:') then
        v_outcome := 'held'; v_reason := 'the official PO is already on this line (ColdLion)';
      elsif v_old.quantity_ordered is not distinct from v_qty
            and (v_case_pack is null or v_old.case_pack is not distinct from v_case_pack)
            and (v_master is null or v_old.assortment_id is not distinct from v_master)
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
        -- Owner rule 2026-11-16: buy-sheet lines go in under the master SKU
        -- (assortment #) without a production PO; the D-number comes later.
        if v_master is null then
          v_outcome := 'held'; v_reason := 'type the master SKU (assortment #) from JamieLynn for this pack';
        else
          v_outcome := 'new';
        end if;
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

    -- Revision of an already-imported sheet (owner rule 2026-11-10).
    if v_outcome in ('updated', 'new') then
      if v_outcome = 'new' and v_number is not null then
        select o.id into v_line_order from plm.production_order o
         where upper(btrim(o.production_order_number)) = upper(v_number) and o.voided_at is null;
      elsif v_outcome = 'new' then
        select o.id into v_line_order from plm.production_order o
         where o.source_system = 'popdam_buy_sheet' and o.source_id = v_order_src;
      end if;
      if v_claimed or v_line_order = any(v_prior) then
        v_outcome := 'revision';
        v_reason := 'this sheet changes order ' || coalesce(nullif(btrim(v_number), ''), '(no PO yet)')
                    || ', which an earlier buy-sheet upload already filled; revised buy sheets are not supported yet';
      end if;
    end if;

    -- Item link: exact SKU, unique item, never fuzzy. update_dam_order also
    -- qualifies by catalog; a buy sheet names none, so the catalog applies only
    -- when the line carries source_style_type, and a style whose two catalogs
    -- resolve to different items is reported ambiguous (not linked).
    v_type := nullif(btrim(lower(coalesce(v_line ->> 'source_style_type', ''))), '');
    select count(distinct p ->> 'item'), (array_agg(distinct (p ->> 'item')::uuid))[1] into v_n, v_item
      from jsonb_array_elements(coalesce(v_items -> v_sku, '[]'::jsonb)) p
     where v_type is null or p ->> 'type' = v_type;
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
             assortment_id = coalesce(v_master, assortment_id),
             master_data_match_status = case when item_id is null then v_status else master_data_match_status end,
             updated_at = now()
       where id = v_line_id;
      insert into plm.production_order_line_source_ref (production_order_line_id, source_system, source_id, is_primary)
      values (v_line_id, 'popdam_buy_sheet', v_ref, false)
      on conflict (source_system, source_id) do nothing;
    elsif p_apply and v_outcome = 'new' and v_number is null then
      -- One blank-numbered order per customer + file + pack group, reused on re-run.
      v_order_id := null;
      select o.id into v_order_id from plm.production_order o
       where o.source_system = 'popdam_buy_sheet' and o.source_id = v_order_src;
      if v_order_id is null then
        v_order_id := gen_random_uuid();
        v_order_new := true;
        insert into plm.production_order (id, production_order_number, company_id, metadata, source_system, source_id)
        values (v_order_id, '', p_customer_id,
                jsonb_build_object('customer_name', v_customer, 'created_by', v_actor,
                                   'created_via', 'popdam_buy_sheet'),
                'popdam_buy_sheet', v_order_src);
        insert into plm.production_order_source_ref (production_order_id, source_system, source_id, is_primary)
        values (v_order_id, 'popdam_buy_sheet', v_order_src, true);
      end if;
    elsif p_apply and v_outcome = 'new' then
      select o.id into v_order_id from plm.production_order o
       where upper(btrim(o.production_order_number)) = upper(v_number) and o.voided_at is null
         and (o.company_id = p_customer_id
              or (o.company_id is null and lower(btrim(o.metadata ->> 'customer_name')) = lower(v_customer)));
      if v_order_id is null then
        v_order_new := true;
        v_order_id := gen_random_uuid();
        insert into plm.production_order (id, production_order_number, company_id, metadata, source_system, source_id)
        values (v_order_id, v_number, p_customer_id,
                jsonb_build_object('customer_name', v_customer, 'created_by', v_actor,
                                   'created_via', 'popdam_buy_sheet'),
                'popdam_buy_sheet', 'buysheet:order:' || v_order_id::text);
        insert into plm.production_order_source_ref (production_order_id, source_system, source_id, is_primary)
        values (v_order_id, 'popdam_buy_sheet', 'buysheet:order:' || v_order_id::text, true);
      end if;
    end if;
    if p_apply and v_outcome = 'new' then
      v_line_id := gen_random_uuid();
      insert into plm.production_order_line (
        id, production_order_id, line_number, sku, quantity_ordered, case_pack, order_type,
        start_ship_date, item_id, master_data_match_status, assortment_id, metadata, source_system, source_id)
      values (
        v_line_id, v_order_id,
        (select coalesce(max(nullif(regexp_replace(line_number, '[^0-9]', '', 'g'), '')::integer), 0) + 1
           from plm.production_order_line where production_order_id = v_order_id)::text,
        v_sku, v_qty, v_case_pack, 'FOB', v_date, v_item, v_status, v_master,
        v_meta || jsonb_build_object('created_by', v_actor, 'created_via', 'popdam_buy_sheet'),
        'popdam_buy_sheet', v_ref);
      insert into plm.production_order_line_source_ref (production_order_line_id, source_system, source_id, is_primary)
      values (v_line_id, 'popdam_buy_sheet', v_ref, true);
    end if;

    v_results := v_results || jsonb_build_object(
      'sku', v_sku, 'delivery_date', v_date, 'quantity', v_qty, 'group', v_group,
      'outcome', v_outcome, 'reason', v_reason, 'order_number', v_number,
      'previous_quantity', v_prev,
      'master_sku', v_master, 'previous_assortment_id', v_prev_asst,
      'previous_case_pack', case when v_outcome = 'updated' then v_prev_cp end,
      'previous_item_id', case when v_outcome = 'updated' then v_prev_item end,
      'previous_match_status', case when v_outcome = 'updated' then v_prev_ms end,
      'assortment_set', v_master is not null and v_outcome in ('new', 'updated'),
      'source_ref', v_ref, 'order_created', v_order_new,
      'line_id', case when v_outcome in ('updated', 'unchanged', 'held') or p_apply then v_line_id end,
      'item_match', v_status);
  end loop;

  if p_apply and exists (select 1 from jsonb_array_elements(v_results) r where r ->> 'outcome' = 'revision') then
    raise exception 'import_dam_buy_sheet: this sheet revises a buy sheet that was already imported; revised buy sheets are not supported yet, nothing was imported'
      using errcode = 'P0001', hint = 'Do not enter the changes by hand. Report the revised sheet so revision handling can be built.';
  end if;

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
revoke all on function public.import_dam_buy_sheet(uuid, text, text, jsonb, jsonb, jsonb, boolean, jsonb) from public, anon;
grant execute on function public.import_dam_buy_sheet(uuid, text, text, jsonb, jsonb, jsonb, boolean, jsonb) to authenticated, service_role;
comment on function public.import_dam_buy_sheet(uuid, text, text, jsonb, jsonb, jsonb, boolean, jsonb) is
  'PopDAM OrderList customer buy-sheet import (Burlington HFC). p_apply=false previews; true writes and records dam.order_buy_sheet_import. Identity = customer + style + delivery date via popdam_buy_sheet line refs, else exactly one active customer/style/start-ship line; ambiguous, ColdLion-SO-linked or voided lines are held. A new line goes to the typed OrderList order number for its pack group, else (owner rule 2026-11-16, shared-db#6476) under one blank-numbered order per customer + file + group with assortment_id = the group master SKU from p_master_skus; with neither it is held. A line that would change or add to an order an earlier buy-sheet import filled is a revision and apply refuses the sheet. Item links: exact SKU, one unique item (catalog-qualified when source_style_type is given), else unmatched/ambiguous.';

create or replace function public.clear_dam_buy_sheet_import(
  p_import_id uuid default null,
  p_apply     boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = plm, public, core, dam, pg_temp
as $$
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
    delete from dam.production_order_snapshot where production_order_line_id = any (v_created);
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
$$;
revoke all on function public.clear_dam_buy_sheet_import(uuid, boolean) from public, anon;
grant execute on function public.clear_dam_buy_sheet_import(uuid, boolean) to authenticated, service_role;
comment on function public.clear_dam_buy_sheet_import(uuid, boolean) is
  'PopDAM buy-sheet Clear (shared-db#6476): the uploader undoes one import (default: their latest). p_apply=false previews counts; true deletes the lines it created and the then-empty orders it created, restores quantity/assortment/metadata on lines it updated, and deletes the import record. Refused when a line is now ColdLion-linked or a created order has since received a PO number.';
