-- =====================================================================================
-- PopDAM OrderList — "input fields only" write contract (issue #1772).
--
-- Covers migration 20260831045020_popdam_orderlist_input_only_write_contract.sql.
--
-- HOW TO RUN
--   Against any database that carries the migrations, including the ephemeral
--   from-empty database used by .github/workflows/database-contract-tests.yml:
--       psql "$URL" -f supabase/tests/dam_order_input_only_write_contract.sql
--
-- WHY IT IS SHAPED THIS WAY, AND WHY IT NEEDS NO FIXTURES
--   The whole enforcement point of this change is a single call inside each RPC:
--       perform plm.assert_dam_order_keys(<payload>, <whitelist>(), '<header|line>');
--   Everything downstream of that call is pre-existing behaviour that other tests
--   already cover. So this file exercises the guard ITSELF, on the exact whitelists the
--   RPCs pass it. That needs no authenticated session, no customer, no item and no
--   order row — which is precisely why it can run in the from-empty lane and be
--   trusted there, instead of joining the eleven files in ci-quarantine.txt.
--
--   That trust is only earned because 20260831045020 opens with a fail-closed probe of
--   the objects its base creates. Without it the two-pass replay would re-apply the base
--   AFTER this migration and this file would be asserting against the superseded
--   whitelists. If you ever see this file fail with the OLD field list, that probe is
--   what regressed -- do not quarantine this file, and do not weaken the assertions.
--
--   Every negative case catches errcode 42501 SPECIFICALLY. A test that caught
--   `when others` would score a typo, a missing function or a permission error as a
--   working guard, which is the failure mode this repository has shipped before.
--
--   Sections A and B assert the whitelists SET-EQUAL to the expected lists in both
--   directions. A one-directional containment check would pass while a field silently
--   stayed writable, and a matching COUNT would pass while two fields swapped.
--
-- SIDE EFFECTS
--   None. No row is written or read. `plm.assert_dam_order_keys` and both whitelist
--   functions are IMMUTABLE and touch no table.
-- =====================================================================================

\set ON_ERROR_STOP on

-- -------------------------------------------------------------------------------------
-- A. The header whitelist is EXACTLY the user-input header fields.
--    production_order_number (Google yellow column B) must be ABSENT: it is
--    creation-only, and its absence here is what makes it immutable after creation.
-- -------------------------------------------------------------------------------------
do $t$
declare
  expected text[] := array['company_id', 'metadata', 'void_reason', 'voided'];
  actual   text[] := plm.dam_order_allowed_header_keys();
  extra    text;
  missing  text;
begin
  select string_agg(k, ', ' order by k) into extra
  from unnest(actual) k where k <> all (expected);

  select string_agg(k, ', ' order by k) into missing
  from unnest(expected) k where k <> all (actual);

  if extra is not null then
    raise exception 'header whitelist admits field(s) that are not user inputs: %', extra;
  end if;
  if missing is not null then
    raise exception 'header whitelist has lost user-input field(s): %', missing;
  end if;

  if 'production_order_number' = any (actual) then
    raise exception 'production_order_number is creation-only and must not be in the shared header whitelist';
  end if;

  raise notice 'A ok: header whitelist is exactly %', array_to_string(expected, ', ');
end;
$t$;

-- -------------------------------------------------------------------------------------
-- B. The line whitelist is EXACTLY the Google blue line inputs, plus the patch target,
--    the metadata bag, the void controls and the ambiguity discriminator.
-- -------------------------------------------------------------------------------------
do $t$
declare
  expected text[] := array[
    'id',
    'order_person',            -- J
    'order_type',              -- K
    'customer_po_number',      -- N
    'assortment_id',           -- O
    'sku',                     -- P
    'order_depth_inches',      -- R
    'quantity_ordered',        -- U
    'case_pack',               -- V
    'ship_to',                 -- X
    'start_ship_date',         -- Y
    'cancel_date',             -- Z
    'source_style_type',
    'metadata',
    'void_reason', 'voided'
  ];
  actual  text[] := plm.dam_order_allowed_line_keys();
  extra   text;
  missing text;
begin
  select string_agg(k, ', ' order by k) into extra
  from unnest(actual) k where k <> all (expected);

  select string_agg(k, ', ' order by k) into missing
  from unnest(expected) k where k <> all (actual);

  if extra is not null then
    raise exception 'line whitelist admits field(s) that are not user inputs: %', extra;
  end if;
  if missing is not null then
    raise exception 'line whitelist has lost user-input field(s): %', missing;
  end if;

  raise notice 'B ok: line whitelist is exactly % fields', array_length(expected, 1);
end;
$t$;

-- -------------------------------------------------------------------------------------
-- C. Every ALLOWED key passes the guard, one at a time.
--    One-at-a-time matters: a whole-payload check would pass even if the guard only
--    ever looked at the first key.
-- -------------------------------------------------------------------------------------
do $t$
declare
  k text;
begin
  foreach k in array plm.dam_order_allowed_header_keys() || array['production_order_number']
  loop
    begin
      perform plm.assert_dam_order_keys(jsonb_build_object(k, 'x'),
                plm.dam_order_allowed_header_keys() || array['production_order_number'],
                'header');
    exception when insufficient_privilege then
      raise exception 'create-time header key % was refused but must be accepted', k;
    end;
  end loop;

  foreach k in array plm.dam_order_allowed_line_keys()
  loop
    begin
      perform plm.assert_dam_order_keys(jsonb_build_object(k, 'x'),
                plm.dam_order_allowed_line_keys(), 'line');
    exception when insufficient_privilege then
      raise exception 'line key % was refused but must be accepted', k;
    end;
  end loop;

  raise notice 'C ok: every allowed key is accepted individually';
end;
$t$;

-- -------------------------------------------------------------------------------------
-- D. Every AUTOMATIC / LOOKUP / TRACKING / HELPER / DIAGNOSTIC field is refused, with
--    errcode 42501 specifically. The two lists below are the complete set of fields the
--    20260810010000 whitelists admitted and this change removes.
-- -------------------------------------------------------------------------------------
do $t$
declare
  header_automatic text[] := array[
    'status', 'factory_id', 'order_date', 'requested_ship_date', 'actual_ship_date',
    'seal_container_date', 'sent_po_date', 'vendor_delivery_date', 'booking_state',
    'etd', 'eta', 'warehouse_date', 'container_booking_group', 'mbl', 'close_tracking'
  ];
  line_automatic text[] := array[
    'line_number', 'quantity_shipped', 'unit_cost', 'status', 'customer_suffix',
    'assortment_component_ordinal', 'cases_reported', 'start_ship_raw', 'cancel_raw',
    'cargo_forecast_date', 'cargo_forecast_raw', 'test_report', 'professional_photos',
    'contractual_sample_reorder'
  ];
  k       text;
  refused boolean;
begin
  foreach k in array header_automatic
  loop
    refused := false;
    begin
      perform plm.assert_dam_order_keys(jsonb_build_object(k, 'x'),
                plm.dam_order_allowed_header_keys(), 'header');
    exception when insufficient_privilege then
      refused := true;
    end;
    if not refused then
      raise exception 'automatic header field % is still writable through the user RPCs', k;
    end if;
  end loop;

  foreach k in array line_automatic
  loop
    refused := false;
    begin
      perform plm.assert_dam_order_keys(jsonb_build_object(k, 'x'),
                plm.dam_order_allowed_line_keys(), 'line');
    exception when insufficient_privilege then
      refused := true;
    end;
    if not refused then
      raise exception 'automatic line field % is still writable through the user RPCs', k;
    end if;
  end loop;

  -- The create-time augmentation must not leak into the update path either.
  refused := false;
  begin
    perform plm.assert_dam_order_keys(
              jsonb_build_object('production_order_number', 'x'),
              plm.dam_order_allowed_header_keys(), 'header');
  exception when insufficient_privilege then
    refused := true;
  end;
  if not refused then
    raise exception 'production_order_number is still writable after creation';
  end if;

  raise notice 'D ok: % automatic header fields, % automatic line fields and the immutable order number are all refused with 42501',
    array_length(header_automatic, 1), array_length(line_automatic, 1);
end;
$t$;

-- -------------------------------------------------------------------------------------
-- E. The RPC bodies actually consult the whitelists, and only create_dam_order carries
--    the creation-only augmentation. Read from pg_get_functiondef, so a body that
--    stopped calling the guard cannot pass sections C and D and still ship.
-- -------------------------------------------------------------------------------------
do $t$
declare
  create_def text;
  update_def text;
begin
  select pg_get_functiondef('public.create_dam_order(jsonb, jsonb)'::regprocedure) into create_def;
  select pg_get_functiondef('public.update_dam_order(uuid, jsonb, jsonb)'::regprocedure) into update_def;

  if create_def not like '%dam_order_allowed_header_keys()%'
     or create_def not like '%dam_order_allowed_line_keys()%' then
    raise exception 'create_dam_order no longer consults both whitelists';
  end if;
  if update_def not like '%dam_order_allowed_header_keys()%'
     or update_def not like '%dam_order_allowed_line_keys()%' then
    raise exception 'update_dam_order no longer consults both whitelists';
  end if;

  if create_def not like '%production_order_number%' then
    raise exception 'create_dam_order lost its creation-only production_order_number handling';
  end if;
  if update_def like '%production_order_number%' then
    raise exception 'update_dam_order references production_order_number; it must be creation-only';
  end if;

  raise notice 'E ok: both RPCs consult the whitelists; the order number is creation-only';
end;
$t$;

-- -------------------------------------------------------------------------------------
-- F. The exposure posture is unchanged by this migration: anon holds no EXECUTE on
--    either RPC, and both remain SECURITY DEFINER with a pinned search_path.
-- -------------------------------------------------------------------------------------
do $t$
declare
  bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ')
    into bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('create_dam_order', 'update_dam_order')
    and has_function_privilege('anon', p.oid, 'execute');
  if bad is not null then
    raise exception 'anon can execute %', bad;
  end if;

  select string_agg(p.proname, ', ')
    into bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('create_dam_order', 'update_dam_order')
    and (not p.prosecdef
         or p.proconfig is null
         or not exists (select 1 from unnest(p.proconfig) c where c like 'search\_path=%'));
  if bad is not null then
    raise exception 'security definer / pinned search_path lost on %', bad;
  end if;

  raise notice 'F ok: anon has no execute; both RPCs are SECURITY DEFINER with a pinned search_path';
end;
$t$;

\echo 'dam_order_input_only_write_contract: ALL SECTIONS PASSED'
