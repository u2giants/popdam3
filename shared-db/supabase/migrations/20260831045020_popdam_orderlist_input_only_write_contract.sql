-- =====================================================================================
-- PopDAM OrderList — enforce the Google "input vs automatic" colour contract in the
-- database RPCs.
--
-- Issue:  u2giants/shared-db#1772   Object claim: #1849
--
-- derived-from: 20260810010000, 20260810060000
--
-- WHAT THIS CHANGES, IN ONE LINE
--   The two whitelists that public.create_dam_order / public.update_dam_order check
--   their payloads against are narrowed to the fields a human actually types in the
--   Google workbook. Everything the workbook computes, looks up, or feeds from
--   tracking stops being writable through these two browser-reachable RPCs.
--
-- WHY THE WHITELISTS WERE TOO WIDE
--   20260810010000 built the RPCs from the SHAPE of plm.production_order[_line]: every
--   column that existed became a whitelisted key. That is the wrong source of truth.
--   The authority is the workbook's own colour coding, inspected 2026-08-28:
--     * BLUE   header cells are human inputs.
--     * LIGHT GRAY cells are automatic lookup / calculation / tracking values; several
--       of them literally read "This is an automatic column".
--     * DARK GRAY cells are derived PO-writing helpers.
--   A browser caller could therefore overwrite tracking dates, booking state, shipped
--   quantities, unit cost, cargo forecast and the derived helper fields — values whose
--   only correct source is a feed or a calculation. Nothing rejected it, because the
--   whitelist said the column existed.
--
-- THE BLUE INPUT COLUMNS, AND WHERE EACH ONE LIVES HERE
--   J Order Person      -> line.order_person
--   K Order Type        -> line.order_type
--   L Customer          -> header.company_id      (canonical id, never customer text)
--   N Customer PO #     -> line.customer_po_number
--   O Assortment ID     -> line.assortment_id
--   P Style #           -> line.sku
--   R Order Depth       -> line.order_depth_inches
--   U Quantity          -> line.quantity_ordered
--   V Case Pack         -> line.case_pack
--   X Ship To           -> line.ship_to
--   Y Start Ship Date   -> line.start_ship_date
--   Z Cancel Date       -> line.cancel_date
--
--   B Import PO # is YELLOW: needed to CREATE an order, immutable afterwards. It maps
--   to header.production_order_number and is therefore NOT in the shared header
--   whitelist. create_dam_order adds it to the allowed set for its own call only, so
--   update_dam_order now refuses it with the same 42501 contract as any other
--   non-writable field. That refusal is the immutability rule, expressed in the one
--   place a browser can reach.
--
-- WHAT IS DELIBERATELY KEPT WRITABLE, AND WHY
--   * `metadata` — the application's own jsonb bag, merged rather than replaced. It is
--     not a workbook column and carries no calculated business value.
--   * `void_reason` / `voided` — the correction controls. The issue names them as
--     valid; voiding is how a mistake is fixed without a delete RPC existing.
--   * `source_style_type` — automatic MATCHING EVIDENCE in the workbook, kept writable
--     on purpose as the minimum safe discriminator for a genuinely ambiguous
--     Licensed/Generic Style #. It resolves an ambiguity; it does not carry a business
--     value. Nothing else derived becomes writable to serve it.
--   * `id` on a line patch — the patch target, not a field.
--
-- WHAT STOPS BEING WRITABLE THROUGH THESE RPCs
--   header: production_order_number (update only), status, factory_id, order_date,
--           requested_ship_date, actual_ship_date, seal_container_date, sent_po_date,
--           vendor_delivery_date, booking_state, etd, eta, warehouse_date,
--           container_booking_group, mbl, close_tracking
--   line:   line_number, quantity_shipped, unit_cost, status, customer_suffix,
--           assortment_component_ordinal, cases_reported, start_ship_raw, cancel_raw,
--           cargo_forecast_date, cargo_forecast_raw, test_report, professional_photos,
--           contractual_sample_reorder
--
-- LINE NUMBERS ARE NOW DERIVED, NOT SUPPLIED
--   `line_number` leaves the whitelist, so create_dam_order stamps it from the position
--   of the line in p_lines (1, 2, 3 …) — the same ordinal it already uses to mint the
--   native source_id. The capability is preserved; only the ability to type an
--   arbitrary line number is removed. Nothing else in the create path changes.
--
-- WHAT THIS DOES **NOT** TOUCH
--   No table, column, constraint, index, policy or grant changes. Service ingestion and
--   import paths are untouched: they write the canonical tables directly or through
--   their own SECURITY DEFINER loaders and never call these two user RPCs (verified by
--   searching this repository for both names — the only non-migration reference is a
--   comment in 20260810110000). plm.assert_dam_order_keys, public.link_dam_order_line
--   and api.dam_order_list are unchanged. The 42501 refusal contract is unchanged.
--
-- WHY FULL BODIES ARE REPEATED
--   `create or replace function` has no partial form. public.create_dam_order is
--   re-derived from its current body on `main` (20260810060000); public.update_dam_order
--   and both whitelist functions are re-derived from theirs (20260810010000). Both
--   bases are named in the machine-readable declaration above.
-- =====================================================================================

begin;

-- -------------------------------------------------------------------------------------
-- 0. FAIL CLOSED IF THE BASES ARE NOT HERE YET.
--
-- This is not decoration and it is not defensive habit. It is what makes the contract
-- test below provable in CI, and it was added because a reviewer showed the change was
-- otherwise unverifiable.
--
-- `.github/workflows/database-contract-tests.yml` replays migrations in two passes: pass
-- one applies everything from empty and records what failed; pass two replays ONLY that
-- failure list, in filename order, AFTER every pass-one success.
-- 20260810010000_popdam_order_list_contract.sql cannot replay from empty -- its
-- api.dam_order_list selects from public.style_tracker_rows, which no migration in this
-- repository creates -- so it is always a pass-one failure and a pass-two success.
--
-- Everything below is `create or replace function` in sql/plpgsql, and PostgreSQL does
-- not resolve table names inside a function body at creation time. So without this probe
-- this file would apply happily in pass one, and pass two would then re-apply
-- 20260810010000 on top of it and REINSTATE the very whitelists this migration exists to
-- remove.
--
-- Be precise about what that costs, because the first draft of this comment was not.
-- The contract test beside this file is NOT quarantined, so in the no-probe world it
-- asserts against the reinstated wide whitelists and the lane goes RED, loudly. The
-- danger is not a silent green here and now; it is that the only two ways to get a green
-- lane without this probe were to quarantine the test -- which the quarantine charter
-- forbids, because that file is for tests that cannot hold from empty, not for parking a
-- test that found a real defect -- or to weaken the assertions. A silent green IS the
-- outcome for any future change in this position that has no test or a quarantined one,
-- which is why the harness behaviour is filed as a defect in its own right; but for THIS
-- file the honest statement is that the probe is what makes a green lane both achievable
-- and truthful.
--
-- The probe forces this file onto the pass-two list too, where filename order puts it
-- after its base and the narrowed definitions survive. On any database that applies
-- migrations in order -- preview, production, and a correct from-empty replay -- the
-- objects exist and the probe is a no-op.
--
-- It deliberately does NOT probe public.create_dam_order: 20260810060000 also defines
-- that one and can plant it in pass one, which would let this file slip through. Every
-- object named here is created ONLY by 20260810010000.
-- -------------------------------------------------------------------------------------
do $probe$
begin
  perform plm.dam_order_allowed_header_keys();
  perform plm.dam_order_allowed_line_keys();
  perform 'public.update_dam_order(uuid, jsonb, jsonb)'::regprocedure;
exception when undefined_function or undefined_table or invalid_schema_name then
  raise exception using
    errcode = '42883',
    message = '20260831045020 requires 20260810010000_popdam_order_list_contract.sql to be applied first',
    detail  = 'This migration narrows whitelists that 20260810010000 defines. Applying it before its base would leave the wide definitions in force.',
    hint    = 'Apply migrations in filename order.';
end;
$probe$;

-- -------------------------------------------------------------------------------------
-- 1. The whitelists. One place, so the RPCs and the contract tests cannot drift apart.
-- -------------------------------------------------------------------------------------
create or replace function plm.dam_order_allowed_header_keys()
returns text[]
language sql
immutable
as $$
  -- Google column L (Customer) as a canonical id, plus the application metadata bag and
  -- the void correction controls. `production_order_number` (yellow column B) is NOT
  -- here: create_dam_order adds it for creation only, which makes it immutable after.
  select array[
    'company_id',
    'metadata',
    'void_reason', 'voided'
  ]::text[];
$$;

create or replace function plm.dam_order_allowed_line_keys()
returns text[]
language sql
immutable
as $$
  -- Google blue columns J, K, N, O, P, R, U, V, X, Y, Z, plus the patch target `id`,
  -- the metadata bag, the void controls, and the ambiguity discriminator.
  select array[
    'id',
    'order_person',              -- J
    'order_type',                -- K
    'customer_po_number',        -- N
    'assortment_id',             -- O
    'sku',                       -- P  Style #
    'order_depth_inches',        -- R
    'quantity_ordered',          -- U
    'case_pack',                 -- V
    'ship_to',                   -- X
    'start_ship_date',           -- Y
    'cancel_date',               -- Z
    'source_style_type',         -- Licensed/Generic discriminator, not a business value
    'metadata',
    'void_reason', 'voided'
  ]::text[];
$$;

revoke all on function plm.dam_order_allowed_header_keys() from public;
revoke all on function plm.dam_order_allowed_line_keys()   from public;
grant execute on function plm.dam_order_allowed_header_keys() to authenticated, service_role;
grant execute on function plm.dam_order_allowed_line_keys()   to authenticated, service_role;

comment on function plm.dam_order_allowed_header_keys() is
  'Order-header fields a user may write through public.create_dam_order / public.update_dam_order. Derived from the Google OrderList blue input colouring (issue #1772), not from the table shape. production_order_number is creation-only and is added by create_dam_order itself.';
comment on function plm.dam_order_allowed_line_keys() is
  'Order-line fields a user may write through public.create_dam_order / public.update_dam_order: Google OrderList blue columns J, K, N, O, P, R, U, V, X, Y, Z, plus the patch target id, the metadata bag, the void controls, and source_style_type as the Licensed/Generic ambiguity discriminator (issue #1772).';

-- -------------------------------------------------------------------------------------
-- 2. create — identity plus user inputs only.
--
-- Re-derivation of the 20260810060000 body. The differences are exactly: the header
-- whitelist gains 'production_order_number' for this call only; the automatic header
-- and line columns leave the INSERT column lists so the table defaults apply; and
-- line_number is derived from the ordinal.
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

  -- Creation identity (yellow column B) is accepted here and nowhere else.
  perform plm.assert_dam_order_keys(
            p_order,
            plm.dam_order_allowed_header_keys() || array['production_order_number'],
            'header');

  if coalesce(btrim(p_order ->> 'production_order_number'), '') = '' then
    raise exception 'create_dam_order: production_order_number is required' using errcode = '23514';
  end if;

  -- The id is minted first so the header and every one of its lines share one stable
  -- native identity root. `popdam_order_list` is deliberately a DIFFERENT source system
  -- from `google_order_list` and `coldlion`: a natively created order was never in the
  -- spreadsheet and must never be mistaken for an imported one during reconciliation.
  v_order_id := gen_random_uuid();

  insert into plm.production_order (
    id, production_order_number, company_id, metadata,
    source_system, source_id
  )
  values (
    v_order_id,
    btrim(p_order ->> 'production_order_number'),
    (p_order ->> 'company_id')::uuid,
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
        production_order_id, line_number, sku, quantity_ordered,
        order_person, order_type, customer_po_number,
        assortment_id, order_depth_inches, case_pack, ship_to,
        start_ship_date, cancel_date, source_style_type, metadata,
        source_system, source_id
      )
      values (
        v_order_id,
        v_ordinal::text,
        nullif(btrim(coalesce(v_line ->> 'sku', '')), ''),
        (v_line ->> 'quantity_ordered')::numeric,
        nullif(btrim(coalesce(v_line ->> 'order_person', '')), ''),
        nullif(btrim(coalesce(v_line ->> 'order_type', '')), ''),
        nullif(btrim(coalesce(v_line ->> 'customer_po_number', '')), ''),
        nullif(btrim(coalesce(v_line ->> 'assortment_id', '')), ''),
        (v_line ->> 'order_depth_inches')::numeric,
        (v_line ->> 'case_pack')::numeric,
        nullif(btrim(coalesce(v_line ->> 'ship_to', '')), ''),
        (v_line ->> 'start_ship_date')::date,
        (v_line ->> 'cancel_date')::date,
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
  'PopDAM OrderList create. Accepts creation identity (production_order_number), the Google blue input fields, the metadata bag and source_style_type only; every automatic, lookup, tracking, helper and diagnostic field is refused with 42501 (issue #1772). Line numbers are derived from position. Item links are NOT settable here (use link_dam_order_line). Stamps source_system = popdam_order_list and a deterministic native source_id on the order, every line, and a primary order source ref.';

-- -------------------------------------------------------------------------------------
-- 3. update — user inputs only. production_order_number is now refused here.
--
-- Re-derivation of the 20260810010000 body with every automatic assignment removed.
-- The "only keys actually PRESENT are written" shape is unchanged.
-- -------------------------------------------------------------------------------------
create or replace function public.update_dam_order(
  p_order_id     uuid,
  p_order_patch  jsonb default '{}'::jsonb,
  p_line_patches jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = plm, public, core, app, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_patch jsonb;
  v_line_id uuid;
  v_hit int;
begin
  if v_actor is null then
    raise exception 'update_dam_order: authentication required' using errcode = '42501';
  end if;

  if not exists (select 1 from plm.production_order where id = p_order_id) then
    raise exception 'update_dam_order: order % not found', p_order_id using errcode = 'P0002';
  end if;

  perform plm.assert_dam_order_keys(coalesce(p_order_patch, '{}'::jsonb),
                                    plm.dam_order_allowed_header_keys(), 'header');

  -- Only keys actually PRESENT in the patch are written, so a partial patch can never
  -- blank a field the caller did not mention.
  update plm.production_order po set
    company_id  = case when p_order_patch ? 'company_id'
                       then (p_order_patch ->> 'company_id')::uuid else po.company_id end,
    metadata    = case when p_order_patch ? 'metadata'
                       then po.metadata || (p_order_patch -> 'metadata') else po.metadata end,
    void_reason = case when p_order_patch ? 'void_reason'
                       then nullif(btrim(coalesce(p_order_patch ->> 'void_reason','')),'') else po.void_reason end,
    voided_at   = case when p_order_patch ? 'voided'
                       then case when (p_order_patch ->> 'voided')::boolean then now() else null end
                       else po.voided_at end,
    voided_by   = case when p_order_patch ? 'voided'
                       then case when (p_order_patch ->> 'voided')::boolean then v_actor else null end
                       else po.voided_by end,
    updated_at  = now()
  where po.id = p_order_id;

  if p_line_patches is not null and jsonb_typeof(p_line_patches) = 'array' then
    for v_patch in select * from jsonb_array_elements(p_line_patches)
    loop
      perform plm.assert_dam_order_keys(v_patch, plm.dam_order_allowed_line_keys(), 'line');

      v_line_id := (v_patch ->> 'id')::uuid;
      if v_line_id is null then
        raise exception 'update_dam_order: every line patch needs an id' using errcode = '22023';
      end if;

      update plm.production_order_line pol set
        sku                = case when v_patch ? 'sku' then nullif(btrim(coalesce(v_patch->>'sku','')),'') else pol.sku end,
        quantity_ordered   = case when v_patch ? 'quantity_ordered' then (v_patch->>'quantity_ordered')::numeric else pol.quantity_ordered end,
        order_person       = case when v_patch ? 'order_person' then nullif(btrim(coalesce(v_patch->>'order_person','')),'') else pol.order_person end,
        order_type         = case when v_patch ? 'order_type' then nullif(btrim(coalesce(v_patch->>'order_type','')),'') else pol.order_type end,
        customer_po_number = case when v_patch ? 'customer_po_number' then nullif(btrim(coalesce(v_patch->>'customer_po_number','')),'') else pol.customer_po_number end,
        assortment_id      = case when v_patch ? 'assortment_id' then nullif(btrim(coalesce(v_patch->>'assortment_id','')),'') else pol.assortment_id end,
        order_depth_inches = case when v_patch ? 'order_depth_inches' then (v_patch->>'order_depth_inches')::numeric else pol.order_depth_inches end,
        case_pack          = case when v_patch ? 'case_pack' then (v_patch->>'case_pack')::numeric else pol.case_pack end,
        ship_to            = case when v_patch ? 'ship_to' then nullif(btrim(coalesce(v_patch->>'ship_to','')),'') else pol.ship_to end,
        start_ship_date    = case when v_patch ? 'start_ship_date' then (v_patch->>'start_ship_date')::date else pol.start_ship_date end,
        cancel_date        = case when v_patch ? 'cancel_date' then (v_patch->>'cancel_date')::date else pol.cancel_date end,
        source_style_type  = case when v_patch ? 'source_style_type' then nullif(btrim(lower(coalesce(v_patch->>'source_style_type',''))),'') else pol.source_style_type end,
        metadata           = case when v_patch ? 'metadata' then pol.metadata || (v_patch->'metadata') else pol.metadata end,
        void_reason        = case when v_patch ? 'void_reason' then nullif(btrim(coalesce(v_patch->>'void_reason','')),'') else pol.void_reason end,
        voided_at          = case when v_patch ? 'voided'
                                  then case when (v_patch->>'voided')::boolean then now() else null end
                                  else pol.voided_at end,
        voided_by          = case when v_patch ? 'voided'
                                  then case when (v_patch->>'voided')::boolean then v_actor else null end
                                  else pol.voided_by end,
        updated_at         = now()
      where pol.id = v_line_id
        and pol.production_order_id = p_order_id;

      get diagnostics v_hit = row_count;
      if v_hit = 0 then
        raise exception 'update_dam_order: line % does not belong to order %', v_line_id, p_order_id
          using errcode = 'P0002';
      end if;
    end loop;
  end if;

  return p_order_id;
end;
$$;

revoke all on function public.update_dam_order(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.update_dam_order(uuid, jsonb, jsonb) to authenticated, service_role;

comment on function public.update_dam_order(uuid, jsonb, jsonb) is
  'PopDAM OrderList update. Accepts the Google blue input fields, canonical company_id, the metadata bag, source_style_type and the void controls only. production_order_number is creation-only and is refused here, as is every automatic, lookup, tracking, helper and diagnostic field, with errcode 42501 (issue #1772).';

commit;
