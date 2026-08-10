-- =====================================================================================
-- PopDAM OrderList — forward fix for 20260810010000.
--
-- Issue:  u2giants/shared-db#613 (object claim #624)
-- Scope:  plm.production_order and plm.production_order_line ONLY, both inside claim
--         #624, plus a `create or replace` of public.create_dam_order.
--
-- THE BUG THIS FIXES, AND HOW IT WAS FOUND
-- ----------------------------------------
-- 20260810010000 applied cleanly to preview and every object it created was real.
-- Then the behaviour test tried to create an order with FOUR lines and the second line
-- failed:
--
--   ERROR 23505: duplicate key value violates unique constraint
--                "production_order_line_source_system_source_id_key"
--   DETAIL: Key (source_system, source_id)=(null, null) already exists.
--
-- Both canonical order tables were created in 20260621151024 with
-- `unique nulls not distinct (source_system, source_id)`. Under NULLS NOT DISTINCT,
-- two NULLs are treated as EQUAL, so the constraint means:
--
--   "the entire table may contain AT MOST ONE row that has no legacy source pair."
--
-- For a lookup table seeded only by importers that is harmless, and it went unnoticed
-- for that reason: both tables are still empty. For a business table that PopDAM staff
-- create rows in by hand it is fatal — the first native order line succeeds and the
-- second one, forever after, does not. It is a landmine for any future writer of these
-- tables, not only for OrderList, which is why the constraint itself is corrected here
-- rather than merely worked around in the RPC.
--
-- WHY THE CONSTRAINT IS NOT SIMPLY DROPPED
-- ----------------------------------------
-- The uniqueness is still wanted. `(source_system, source_id)` is what stops an
-- importer inserting the same external record twice, and the Coldlion feed will rely on
-- it. Only the NULL handling is wrong. NULLS DISTINCT (the SQL standard default) keeps
-- the guarantee for every row that HAS a source pair and stops constraining rows that
-- have none — which is the correct reading of "this row has no external identity".
--
-- Note that the real identity surface for OrderList is the pair of source-reference
-- tables added in 20260810010000. These legacy single-pair columns are kept only for
-- backwards compatibility until fix_schema_for_api.md explicitly retires them.
--
-- BOTH HALVES ARE APPLIED DELIBERATELY (approved by the coordinator, 2026-08-09)
-- ------------------------------------------------------------------------------
--   1. Root cause: make both constraints NULLS DISTINCT.
--   2. Belt and braces: public.create_dam_order now stamps every row it writes with
--      source_system = 'popdam_order_list' and a generated source_id, so a natively
--      created order carries a real identity instead of relying on NULLs at all.
-- Half 2 alone was rejected as a band-aid: it would leave the trap armed for the next
-- writer of these tables, who will not have read this file.
--
-- NOT DONE HERE, ON PURPOSE
-- -------------------------
-- `plm.item` carries the identical `unique nulls not distinct (source_system, source_id)`
-- shape and the identical latent bug — it was hit by the same test run. It is NOT
-- touched by this migration. `plm.item` sits outside claim #624 and is coordinated with
-- `fix_schema_for_api.md`; it has been reported to the coordinator to be swept
-- deliberately in its own dispatch. A correct fix in the wrong lane is still a
-- collision.
-- =====================================================================================

begin;

-- -------------------------------------------------------------------------------------
-- 1. Root cause. Rebuild both uniques with the standard NULL semantics.
--
-- Guarded so a re-run is a no-op, and so this cannot silently do nothing if a future
-- migration has already renamed or replaced the constraint: if the expected constraint
-- is absent AND no NULLS DISTINCT replacement exists, the migration RAISES rather than
-- reporting success over an unfixed table.
-- -------------------------------------------------------------------------------------
do $$
declare
  t             text;
  v_conname     text;
  v_notdistinct boolean;
begin
  foreach t in array array['plm.production_order', 'plm.production_order_line']
  loop
    select c.conname, i.indnullsnotdistinct
      into v_conname, v_notdistinct
    from pg_constraint c
    join pg_index i on i.indexrelid = c.conindid
    where c.conrelid = t::regclass
      and c.contype = 'u'
      and (
        select array_agg(a.attname::text order by a.attname)
        from unnest(c.conkey) k
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
      ) = array['source_id', 'source_system']
    limit 1;

    if v_conname is null then
      raise exception
        'expected a unique constraint on (source_system, source_id) for %, found none; refusing to report success over an unfixed table', t;
    end if;

    if v_notdistinct then
      execute format('alter table %s drop constraint %I', t, v_conname);
      execute format(
        'alter table %s add constraint %I unique nulls distinct (source_system, source_id)',
        t, v_conname);
      raise notice 'rebuilt % on % as NULLS DISTINCT', v_conname, t;
    else
      raise notice '% on % is already NULLS DISTINCT; nothing to do', v_conname, t;
    end if;

    v_conname := null;
    v_notdistinct := null;
  end loop;
end;
$$;

comment on constraint production_order_source_system_source_id_key on plm.production_order is
  'NULLS DISTINCT since 20260810060000. Two rows may both have no legacy source pair; two rows may not share the SAME pair. The NULLS NOT DISTINCT original allowed only one source-less order in the whole table.';
comment on constraint production_order_line_source_system_source_id_key on plm.production_order_line is
  'NULLS DISTINCT since 20260810060000. See the matching comment on plm.production_order. The original shape made a second natively created order line impossible.';

-- -------------------------------------------------------------------------------------
-- 2. Belt and braces. Natively created orders carry their own identity.
--
-- Identical to the 20260810010000 body except for the two source columns on each
-- insert. Repeated in full because `create or replace function` has no partial form.
-- -------------------------------------------------------------------------------------
create or replace function public.create_dam_order(
  p_order jsonb,
  p_lines jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = plm, public, core, app, pg_temp
as $$
declare
  v_actor    uuid := auth.uid();
  v_order_id uuid;
  v_line     jsonb;
  v_ordinal  integer := 0;
begin
  if v_actor is null then
    raise exception 'create_dam_order: authentication required' using errcode = '42501';
  end if;

  perform plm.assert_dam_order_keys(p_order, plm.dam_order_allowed_header_keys(), 'header');

  if coalesce(btrim(p_order ->> 'production_order_number'), '') = '' then
    raise exception 'create_dam_order: production_order_number is required' using errcode = '23514';
  end if;

  -- The id is minted first so the header and every one of its lines share one stable
  -- native identity root. `popdam_order_list` is deliberately a DIFFERENT source system
  -- from `google_order_list` and `coldlion`: a natively created order was never in the
  -- spreadsheet and must never be mistaken for an imported one during reconciliation.
  v_order_id := gen_random_uuid();

  insert into plm.production_order (
    id, production_order_number, status, company_id, factory_id,
    order_date, requested_ship_date, actual_ship_date,
    seal_container_date, sent_po_date, vendor_delivery_date,
    booking_state, etd, eta, warehouse_date,
    container_booking_group, mbl, close_tracking, metadata,
    source_system, source_id
  )
  values (
    v_order_id,
    btrim(p_order ->> 'production_order_number'),
    nullif(btrim(coalesce(p_order ->> 'status', '')), ''),
    (p_order ->> 'company_id')::uuid,
    (p_order ->> 'factory_id')::uuid,
    (p_order ->> 'order_date')::date,
    (p_order ->> 'requested_ship_date')::date,
    (p_order ->> 'actual_ship_date')::date,
    (p_order ->> 'seal_container_date')::date,
    (p_order ->> 'sent_po_date')::date,
    (p_order ->> 'vendor_delivery_date')::date,
    nullif(btrim(coalesce(p_order ->> 'booking_state', '')), ''),
    (p_order ->> 'etd')::date,
    (p_order ->> 'eta')::date,
    (p_order ->> 'warehouse_date')::date,
    nullif(btrim(coalesce(p_order ->> 'container_booking_group', '')), ''),
    nullif(btrim(coalesce(p_order ->> 'mbl', '')), ''),
    coalesce((p_order ->> 'close_tracking')::boolean, false),
    coalesce(p_order -> 'metadata', '{}'::jsonb)
      || jsonb_build_object('created_by', v_actor, 'created_via', 'popdam_order_list'),
    'popdam_order_list',
    'popdam:order:' || v_order_id::text
  );

  -- The canonical order also gets a row in the real identity surface, so a later
  -- Coldlion claim resolves against the same table it uses for imported orders.
  insert into plm.production_order_source_ref
    (production_order_id, source_system, source_id, is_primary)
  values
    (v_order_id, 'popdam_order_list', 'popdam:order:' || v_order_id::text, true);

  if p_lines is not null and jsonb_typeof(p_lines) = 'array' then
    for v_line in select * from jsonb_array_elements(p_lines)
    loop
      perform plm.assert_dam_order_keys(v_line, plm.dam_order_allowed_line_keys(), 'line');
      v_ordinal := v_ordinal + 1;

      insert into plm.production_order_line (
        production_order_id, line_number, sku, quantity_ordered, quantity_shipped,
        unit_cost, status, order_person, order_type, customer_suffix, customer_po_number,
        assortment_id, assortment_component_ordinal, order_depth_inches, case_pack,
        cases_reported, ship_to, start_ship_date, start_ship_raw, cancel_date, cancel_raw,
        cargo_forecast_date, cargo_forecast_raw, test_report, professional_photos,
        contractual_sample_reorder, source_style_type, metadata,
        source_system, source_id
      )
      values (
        v_order_id,
        nullif(btrim(coalesce(v_line ->> 'line_number', '')), ''),
        nullif(btrim(coalesce(v_line ->> 'sku', '')), ''),
        (v_line ->> 'quantity_ordered')::numeric,
        (v_line ->> 'quantity_shipped')::numeric,
        (v_line ->> 'unit_cost')::numeric,
        nullif(btrim(coalesce(v_line ->> 'status', '')), ''),
        nullif(btrim(coalesce(v_line ->> 'order_person', '')), ''),
        nullif(btrim(coalesce(v_line ->> 'order_type', '')), ''),
        nullif(btrim(coalesce(v_line ->> 'customer_suffix', '')), ''),
        nullif(btrim(coalesce(v_line ->> 'customer_po_number', '')), ''),
        nullif(btrim(coalesce(v_line ->> 'assortment_id', '')), ''),
        (v_line ->> 'assortment_component_ordinal')::integer,
        (v_line ->> 'order_depth_inches')::numeric,
        (v_line ->> 'case_pack')::numeric,
        (v_line ->> 'cases_reported')::numeric,
        nullif(btrim(coalesce(v_line ->> 'ship_to', '')), ''),
        (v_line ->> 'start_ship_date')::date,
        nullif(btrim(coalesce(v_line ->> 'start_ship_raw', '')), ''),
        (v_line ->> 'cancel_date')::date,
        nullif(btrim(coalesce(v_line ->> 'cancel_raw', '')), ''),
        (v_line ->> 'cargo_forecast_date')::date,
        nullif(btrim(coalesce(v_line ->> 'cargo_forecast_raw', '')), ''),
        nullif(btrim(coalesce(v_line ->> 'test_report', '')), ''),
        nullif(btrim(coalesce(v_line ->> 'professional_photos', '')), ''),
        coalesce((v_line ->> 'contractual_sample_reorder')::boolean, false),
        nullif(btrim(lower(coalesce(v_line ->> 'source_style_type', ''))), ''),
        coalesce(v_line -> 'metadata', '{}'::jsonb)
          || jsonb_build_object('created_by', v_actor, 'created_via', 'popdam_order_list'),
        'popdam_order_list',
        'popdam:order:' || v_order_id::text || ':line:' || v_ordinal::text
      );
      -- item_id is deliberately NOT settable here. A product link is only ever created
      -- by public.link_dam_order_line, which proves the SKU + type resolves uniquely.
    end loop;
  end if;

  return v_order_id;
end;
$$;

revoke all on function public.create_dam_order(jsonb, jsonb) from public, anon;
grant execute on function public.create_dam_order(jsonb, jsonb) to authenticated, service_role;

comment on function public.create_dam_order(jsonb, jsonb) is
  'PopDAM OrderList create. Whitelisted fields only; item links are NOT settable here (use link_dam_order_line). Stamps source_system = popdam_order_list and a deterministic native source_id on the order, every line, and a primary order source ref.';

commit;
