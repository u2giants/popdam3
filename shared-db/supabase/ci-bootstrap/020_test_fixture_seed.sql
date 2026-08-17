-- =====================================================================================
-- SYNTHETIC TEST-FIXTURE SEED  --  CI-ONLY BOOTSTRAP, NOT A MIGRATION
-- =====================================================================================
-- WHAT THIS IS
-- ------------
-- Eleven of the forty contract tests do not assert anything about seeded rows -- they
-- assert RLS, grants, merge behaviour and read contracts, and they need a few reference
-- rows merely to have something to act ON. An empty database has none by definition, so
-- those eleven were quarantined (issue #754). This file supplies exactly those rows and
-- nothing else.
--
-- EVERY ROW BELOW IS INVENTED. THIS IS NOT NEGOTIABLE.
-- ----------------------------------------------------
-- No production row is copied here. No real person, customer, vendor, factory, licensor
-- or property name appears. Every email address uses the RFC 2606 reserved `.invalid`
-- top-level domain, which cannot resolve and cannot belong to anyone. Every name is
-- prefixed `ZZ Fixture` so that if one of these rows ever turns up in a real database it
-- is instantly identifiable as test scaffolding that escaped.
--
-- If you need a new fixture row, INVENT IT. Do not copy one from preview or production
-- "just to get the shape right" -- the shape is in supabase/migrations, and the PII
-- forward guard will catch you.
--
-- WHERE IT RUNS
-- -------------
-- Only .github/workflows/database-contract-tests.yml applies this, and only to the
-- throwaway Supabase stack inside the runner, after the migration replay. It is not in
-- supabase/migrations/ and must never be applied to preview or production.
--
-- WHY THE ROWS ARE SHAPED THIS WAY
-- --------------------------------
--   * FOUR profiles, not one. db_data_admin_read_contracts needs four distinct active
--     authenticated profiles and picks them by `order by created_at`, so the four are
--     given explicit, distinct created_at values -- otherwise `now()` makes all four
--     identical and the test's "second admin" is nondeterministic.
--   * Each profile has an auth.users row, because app.profile.auth_user_id is a foreign
--     key to it and the tests impersonate via `request.jwt.claim.sub`.
--   * Roles are NOT seeded here: 20260621150815_app_core.sql already inserts all six.
--   * app.app_access is NOT seeded here: every test that needs a grant makes and revokes
--     its own inside its own transaction, which is the behaviour under test.
-- =====================================================================================

set client_min_messages = warning;

do $fixture$
declare
  v_ids uuid[] := array[
    '00000000-7541-4000-8000-000000000001'::uuid,
    '00000000-7541-4000-8000-000000000002'::uuid,
    '00000000-7541-4000-8000-000000000003'::uuid,
    '00000000-7541-4000-8000-000000000004'::uuid
  ];
  v_i int;
  v_licensor_id uuid;
  v_property_id uuid;
  v_customer_id uuid;
  v_factory_id uuid;
begin
  -- ---------------------------------------------------------------------------------
  -- Four authenticated, active profiles.
  -- ---------------------------------------------------------------------------------
  for v_i in 1 .. array_length(v_ids, 1) loop
    -- THE INVITATION IS NOT OPTIONAL SCAFFOLDING. `public.handle_new_user()` is a real
    -- pre-adoption trigger on auth.users, and it REFUSES any Google or email/password
    -- signup that has no open invitation row: "Access denied: no valid invitation found".
    -- That guard is correct and must not be disabled to make a fixture load -- a seed that
    -- switches off the thing under test is worse than no seed. So the fixture goes in
    -- through the real front door: invite, then create the user.
    insert into public.invitations (email)
    values (format('zz-fixture-user-%s@fixture.invalid', v_i))
    on conflict do nothing;

    insert into auth.users (id, email)
    values (v_ids[v_i], format('zz-fixture-user-%s@fixture.invalid', v_i))
    on conflict (id) do nothing;

    insert into app.profile (auth_user_id, email, display_name, provider, status, created_at)
    values (
      v_ids[v_i],
      format('zz-fixture-user-%s@fixture.invalid', v_i),
      format('ZZ Fixture User %s', v_i),
      'fixture',
      'active',
      timestamptz '2000-01-01 00:00:00+00' + (v_i * interval '1 minute')
    )
    on conflict (auth_user_id) do update
      set status = 'active',
          created_at = excluded.created_at;
  end loop;

  -- ---------------------------------------------------------------------------------
  -- One canonical Licensor and one Property beneath it.
  --
  -- EVERY FIXTURE ROW CARRIES AN EXPLICIT `code`, AND THAT IS NOT COSMETIC. core.licensor
  -- is declared `unique nulls not distinct (code)`, so at most ONE row in the whole table
  -- may have a null code. A fixture that omits the code silently consumes that single
  -- slot, and the next test to insert a licensor without one dies on
  -- "duplicate key value violates unique constraint licensor_code_key". That is exactly
  -- what happened to clickup_task_import_contracts.sql on the first run of this seed --
  -- a passing test broken by fixture data, which is the worst way for a seed to fail.
  -- core.property, core.customer and core.factory carry the same rule on their own code
  -- columns. If you add a fixture row to any of them, give it a code.
  -- ---------------------------------------------------------------------------------
  select id into v_licensor_id from core.licensor where name = 'ZZ Fixture Licensor';
  if v_licensor_id is null then
    insert into plm.licensing_write_authorization
      (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash, actor, protected_columns, expires_at)
    values
      (pg_backend_pid(), txid_current(), 'core.licensor', 'licensing_review_create', gen_random_uuid(), repeat('c', 64),
       'ci-synthetic-fixture', array['name','code','status'], clock_timestamp() + interval '1 minute');
    insert into core.licensor (name, code) values ('ZZ Fixture Licensor', 'ZZFXL')
    returning id into v_licensor_id;
  end if;

  select id into v_property_id
  from core.property
  where name = 'ZZ Fixture Property' and licensor_id = v_licensor_id;
  if v_property_id is null then
    insert into plm.licensing_write_authorization
      (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash, actor, protected_columns, expires_at)
    values
      (pg_backend_pid(), txid_current(), 'core.property', 'licensing_review_create', gen_random_uuid(), repeat('d', 64),
       'ci-synthetic-fixture', array['licensor_id','name','code','status'], clock_timestamp() + interval '1 minute');
    insert into core.property (licensor_id, name, code, status)
    values (v_licensor_id, 'ZZ Fixture Property', 'ZZFXP', 'potential')
    returning id into v_property_id;
  end if;

  -- ---------------------------------------------------------------------------------
  -- One Customer and one Factory (the "Vendor" side of db_data_admin_extensions).
  -- ---------------------------------------------------------------------------------
  select id into v_customer_id from core.customer where name = 'ZZ Fixture Customer';
  if v_customer_id is null then
    -- No `code` here: core.customer is core.company renamed, and it never had that
    -- column. core.licensor, core.property and core.factory do, and they need it.
    insert into core.customer (name) values ('ZZ Fixture Customer')
    returning id into v_customer_id;
  end if;

  select id into v_factory_id from core.factory where name = 'ZZ Fixture Factory';
  if v_factory_id is null then
    insert into core.factory (name, code) values ('ZZ Fixture Factory', 'ZZFXV')
    returning id into v_factory_id;
  end if;

  -- ---------------------------------------------------------------------------------
  -- One ColdLion source ref against the fixture Licensor. The ColdLion readiness breaker
  -- test looks up source_system='coldlion' / source_table='merchGroupDetails' and needs
  -- something to resolve. The source_id is a made-up string, not a ColdLion identifier.
  -- ---------------------------------------------------------------------------------
  insert into core.taxonomy_source_ref (entity_table, entity_id, source_system, source_table, source_id)
  values ('licensor', v_licensor_id, 'coldlion', 'merchGroupDetails', 'ZZ-FIXTURE-0001')
  on conflict do nothing;

  raise notice 'fixture seed applied: 4 profiles, 1 licensor, 1 property, 1 customer, 1 factory, 1 coldlion source ref';
end
$fixture$;

-- CI-only compatibility helper. The contract runner invokes this inside the same
-- transaction as legacy tests that create synthetic canonical rows. It is absent from
-- every deployed database because ci-bootstrap files are never migrations.
create or replace function public.ci_authorize_licensing_contract_test()
returns void
language plpgsql
security definer
set search_path = pg_catalog, plm, core
as $ci_auth$
declare
  v_table regclass;
  v_columns text[];
  v_subset text[];
  v_mask integer;
  v_i integer;
  v_copy integer;
begin
  for v_table, v_columns in
    values
      ('core.licensor'::regclass, array['name','code','status']::text[]),
      ('core.property'::regclass, array['licensor_id','name','code','status']::text[])
  loop
    for v_mask in 1..((1 << cardinality(v_columns)) - 1) loop
      v_subset := '{}'::text[];
      for v_i in 1..cardinality(v_columns) loop
        if (v_mask & (1 << (v_i - 1))) <> 0 then
          v_subset := array_append(v_subset, v_columns[v_i]);
        end if;
      end loop;
      for v_copy in 1..100 loop
        insert into plm.licensing_write_authorization
          (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash, actor, protected_columns, expires_at)
        values
          (pg_backend_pid(), txid_current(), v_table, 'canonical_merge', gen_random_uuid(), repeat('e', 64),
           'ci-legacy-contract-compatibility', v_subset, clock_timestamp() + interval '10 minutes');
      end loop;
    end loop;
  end loop;
end;
$ci_auth$;

revoke all on function public.ci_authorize_licensing_contract_test() from public, anon, authenticated, service_role;
