-- =====================================================================================
-- WildBrain and NBCU landing -- Licensing read access.
--
-- Migration: 20260819151510_wildbrain_nbcu_licensing_read_access.sql
-- Issue:     u2giants/shared-db #1249 (OWNER RULING)
-- Claim:     u2giants/shared-db #1252, reserved version 20260819151510
--
-- OWNER RULING (Albert Hazan, in chat, 2026-08-19), verbatim:
--     "scrape data should be visible to Licensing department users."
--
-- GRANTS AND POLICIES ONLY. No table, column, index, constraint, function, trigger,
-- view or default privilege is created, altered or dropped by this file, and it loads
-- no data. u2giants/shared-db is a PUBLIC repository and no WildBrain or NBCU value
-- appears here.
--
-- WHAT WAS WRONG
--   Every other licensed landing schema in `plm` already admits Licensing:
--   sega_*, peanuts_*, dcp_*, wb_* all carry `grant select ... to authenticated` plus
--   the house read policy, and pmt_* carries an equivalent one. WildBrain (11 tables,
--   20260819014639) and NBCU (17 tables, 20260810070000 + 20260811070000) granted
--   `service_role` and nothing else, and carried no policy for `authenticated` at all.
--   A Licensing user could not read one row of either. That is what this file fixes,
--   and it is the whole of what this file does.
--
-- THE PREDICATE IS COPIED, NOT RETYPED
--   The `using (...)` expression below was copied character for character out of
--   20260819015333_sega_dsi_source_landing.sql, which itself matches policy plm_read in
--   20260621151155_api_rls_realtime.sql. Licensed source material is readable by the
--   same population that already reads plm, and by nobody else. The assertion block at
--   the end of this file compares each new policy's stored expression against the
--   already-applied Sega policy's stored expression and fails the migration if a single
--   one of the 28 differs -- so a subtle divergence cannot survive this migration even
--   if someone edits the text above.
--
-- A GRANT IS NOT A POLICY AND A POLICY IS NOT A GRANT (AGENTS.md section 11)
--   Both are needed and neither is sufficient. `authenticated` holds no table privilege
--   on these tables today, so a policy alone would still fail with
--   "permission denied for table" (42501); and the grant alone would be refused by RLS,
--   which is enabled on all 28 tables. Both are issued below and both are asserted.
--
-- ADD ONLY. NOTHING IS NARROWED.
--   * The 28 existing `<table>_service_read` policies are NOT dropped, replaced or
--     renamed. The assertion block proves all 28 are still present afterwards, AND that
--     each one still carries its original `using (true)` expression -- a name that
--     survives while its predicate is quietly rewritten to `using (false)` would be a
--     silently broken loader, and service_role's BYPASSRLS means no behavioural test
--     could catch it.
--   * The immutability mechanism is untouched: `authenticated` receives SELECT and only
--     SELECT, service_role's grants are not changed, and the assertion block proves both.
--   * anon receives nothing and is asserted to hold nothing.
--   * Sega, Peanuts, DCP, Warner, Paramount and Disney OPA are NOT touched. Paramount's
--     wider predicate (it also admits `designer`) is left exactly as it is: narrowing it
--     would take access away from designers, which nobody asked for.
--     DISNEY OPA IS ALREADY CORRECT AND MUST BE LEFT ALONE. Migration
--     20260807190000_opa_security_and_view_corrections.sql:71-79 dropped the original
--     over-broad `using (true)` policy on plm.opa_property_character and recreated
--     `opa_property_character_read` with the house predicate on 2026-08-07; that is
--     applied to production. This file must not add, drop or rewrite
--     `opa_property_character_read`, and the contract test asserts it still admits
--     exactly the same three arms the house predicate admits.
--
-- EXPLICIT PER-TABLE STATEMENTS, NOT A LOOP
--   20260810070000 issued the NBCU grants through `execute format('... plm.%I ...')`.
--   That is exactly how the inert-grant defect of 20260810080000 stayed invisible: the
--   privilege model is not readable in the file, and the object claim cannot be checked
--   against it. Every statement below names its table.
--
-- WHAT THIS DOES NOT DO
--   `plm` is NOT exposed through PostgREST (production `pgrst.db_schemas` is
--   `public, graphql_public, api, crm, pim, core, app` -- AGENTS.md section 8.1), so this
--   makes the DATABASE permission correct over a direct SQL connection. It does not put
--   WildBrain or NBCU data on any screen; an `api.*` read surface is a separate access
--   decision and is not taken here.
--   Whether the real Licensing staff accounts actually carry the `licensing` role is a
--   DATA question about app.user_role, not a schema one, and is not answerable from this
--   repository.
-- =====================================================================================

-- WILDBRAIN (11 tables)

-- plm.wildbrain_capture
grant select on plm.wildbrain_capture to authenticated;
create policy wildbrain_capture_plm_read on plm.wildbrain_capture
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.wildbrain_era
grant select on plm.wildbrain_era to authenticated;
create policy wildbrain_era_plm_read on plm.wildbrain_era
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.wildbrain_creative_group
grant select on plm.wildbrain_creative_group to authenticated;
create policy wildbrain_creative_group_plm_read on plm.wildbrain_creative_group
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.wildbrain_asset_category
grant select on plm.wildbrain_asset_category to authenticated;
create policy wildbrain_asset_category_plm_read on plm.wildbrain_asset_category
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.wildbrain_asset_nature
grant select on plm.wildbrain_asset_nature to authenticated;
create policy wildbrain_asset_nature_plm_read on plm.wildbrain_asset_nature
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.wildbrain_character
grant select on plm.wildbrain_character to authenticated;
create policy wildbrain_character_plm_read on plm.wildbrain_character
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.wildbrain_asset
grant select on plm.wildbrain_asset to authenticated;
create policy wildbrain_asset_plm_read on plm.wildbrain_asset
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.wildbrain_asset_character
grant select on plm.wildbrain_asset_character to authenticated;
create policy wildbrain_asset_character_plm_read on plm.wildbrain_asset_character
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.wildbrain_guide
grant select on plm.wildbrain_guide to authenticated;
create policy wildbrain_guide_plm_read on plm.wildbrain_guide
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.wildbrain_guide_alias
grant select on plm.wildbrain_guide_alias to authenticated;
create policy wildbrain_guide_alias_plm_read on plm.wildbrain_guide_alias
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.wildbrain_asset_guide
grant select on plm.wildbrain_asset_guide to authenticated;
create policy wildbrain_asset_guide_plm_read on plm.wildbrain_asset_guide
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- NBCU (17 tables)

-- plm.nbcu_capture
grant select on plm.nbcu_capture to authenticated;
create policy nbcu_capture_plm_read on plm.nbcu_capture
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.nbcu_right
grant select on plm.nbcu_right to authenticated;
create policy nbcu_right_plm_read on plm.nbcu_right
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.nbcu_scope
grant select on plm.nbcu_scope to authenticated;
create policy nbcu_scope_plm_read on plm.nbcu_scope
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.nbcu_property
grant select on plm.nbcu_property to authenticated;
create policy nbcu_property_plm_read on plm.nbcu_property
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.nbcu_ip_family
grant select on plm.nbcu_ip_family to authenticated;
create policy nbcu_ip_family_plm_read on plm.nbcu_ip_family
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.nbcu_character
grant select on plm.nbcu_character to authenticated;
create policy nbcu_character_plm_read on plm.nbcu_character
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.nbcu_style_guide
grant select on plm.nbcu_style_guide to authenticated;
create policy nbcu_style_guide_plm_read on plm.nbcu_style_guide
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.nbcu_asset
grant select on plm.nbcu_asset to authenticated;
create policy nbcu_asset_plm_read on plm.nbcu_asset
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.nbcu_asset_metadata_value
grant select on plm.nbcu_asset_metadata_value to authenticated;
create policy nbcu_asset_metadata_value_plm_read on plm.nbcu_asset_metadata_value
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.nbcu_asset_scope
grant select on plm.nbcu_asset_scope to authenticated;
create policy nbcu_asset_scope_plm_read on plm.nbcu_asset_scope
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.nbcu_ip_family_property
grant select on plm.nbcu_ip_family_property to authenticated;
create policy nbcu_ip_family_property_plm_read on plm.nbcu_ip_family_property
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.nbcu_property_character
grant select on plm.nbcu_property_character to authenticated;
create policy nbcu_property_character_plm_read on plm.nbcu_property_character
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.nbcu_asset_property
grant select on plm.nbcu_asset_property to authenticated;
create policy nbcu_asset_property_plm_read on plm.nbcu_asset_property
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.nbcu_asset_character
grant select on plm.nbcu_asset_character to authenticated;
create policy nbcu_asset_character_plm_read on plm.nbcu_asset_character
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.nbcu_asset_style_guide
grant select on plm.nbcu_asset_style_guide to authenticated;
create policy nbcu_asset_style_guide_plm_read on plm.nbcu_asset_style_guide
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.nbcu_style_guide_property
grant select on plm.nbcu_style_guide_property to authenticated;
create policy nbcu_style_guide_property_plm_read on plm.nbcu_style_guide_property
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.nbcu_asset_ip_family
grant select on plm.nbcu_asset_ip_family to authenticated;
create policy nbcu_asset_ip_family_plm_read on plm.nbcu_asset_ip_family
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- =====================================================================================
-- ASSERTIONS. The migration fails if any of the 28 tables did not end up in exactly the
-- intended state. 20260810080000 exists because a grant statement that reads correctly
-- can be a silent no-op, so the outcome is read back from the catalog here rather than
-- assumed from the fact that the statements above ran.
-- =====================================================================================
do $$
declare
  t         text;
  v_fail    integer := 0;
  v_n       integer;
  v_qual    text;
  v_ref     text;
  v_svc_ref text;
  v_tables  text[] := array[
    'wildbrain_capture','wildbrain_era','wildbrain_creative_group',
    'wildbrain_asset_category','wildbrain_asset_nature','wildbrain_character',
    'wildbrain_asset','wildbrain_asset_character','wildbrain_guide',
    'wildbrain_guide_alias','wildbrain_asset_guide',
    'nbcu_capture','nbcu_right','nbcu_scope','nbcu_property','nbcu_ip_family',
    'nbcu_character','nbcu_style_guide','nbcu_asset','nbcu_asset_metadata_value',
    'nbcu_asset_scope','nbcu_ip_family_property','nbcu_property_character',
    'nbcu_asset_property','nbcu_asset_character','nbcu_asset_style_guide',
    'nbcu_style_guide_property','nbcu_asset_ip_family'];
begin
  if array_length(v_tables, 1) <> 28 then
    raise exception 'assertion list is % tables, expected the 28 named in claim #1252',
      array_length(v_tables, 1);
  end if;

  -- The reference expression: the ALREADY-APPLIED Sega policy, read from the catalog.
  -- Reading it rather than writing it out again is the point -- a typo in this block
  -- cannot make the comparison pass.
  select qual into v_ref from pg_policies
   where schemaname = 'plm' and tablename = 'sega_capture'
     and policyname = 'sega_capture_plm_read';
  if v_ref is null then
    raise exception 'policy sega_capture_plm_read is missing; there is no house predicate '
      'to compare the 28 new policies against and this migration cannot verify itself';
  end if;

  -- The second reference: the permissive service-read expression, also read from an
  -- already-applied policy this file does not touch. Every <table>_service_read on the 28
  -- tables was created as `using (true)`, so they must all still equal this.
  select qual into v_svc_ref from pg_policies
   where schemaname = 'plm' and tablename = 'sega_capture'
     and policyname = 'sega_capture_service_read';
  if v_svc_ref is null then
    raise exception 'policy sega_capture_service_read is missing; there is no reference '
      'service-read expression to compare the 28 surviving policies against';
  end if;

  foreach t in array v_tables loop
    -- 1. THE GRANT. authenticated must hold SELECT.
    if not has_table_privilege('authenticated', format('plm.%I', t), 'SELECT') then
      v_fail := v_fail + 1;
      raise warning 'FAIL authenticated holds no SELECT on plm.% -- the grant was a no-op', t;
    end if;

    -- 2. ADD ONLY. authenticated must hold SELECT and NOTHING ELSE. Listing the
    --    privilege types explicitly would go stale (MAINTAIN arrived in PostgreSQL 17),
    --    so anything that is not SELECT is counted, whatever it is called.
    select count(*) into v_n from information_schema.role_table_grants
     where table_schema = 'plm' and table_name = t
       and grantee = 'authenticated' and privilege_type <> 'SELECT';
    if v_n <> 0 then
      v_fail := v_fail + 1;
      raise warning 'FAIL authenticated holds % non-SELECT privilege(s) on plm.% -- this '
        'migration must widen READS only', v_n, t;
    end if;

    -- 3. anon still holds nothing at all.
    select count(*) into v_n from information_schema.role_table_grants
     where table_schema = 'plm' and table_name = t
       and grantee in ('anon', 'PUBLIC');
    if v_n <> 0 then
      v_fail := v_fail + 1;
      raise warning 'FAIL anon/PUBLIC hold % grant(s) on plm.%', v_n, t;
    end if;

    -- 4. THE POLICY. It exists, it is SELECT, and it applies to authenticated only.
    select count(*) into v_n from pg_policies
     where schemaname = 'plm' and tablename = t and policyname = t || '_plm_read'
       and cmd = 'SELECT' and permissive = 'PERMISSIVE'
       and roles = array['authenticated']::name[];
    if v_n <> 1 then
      v_fail := v_fail + 1;
      raise warning 'FAIL policy %_plm_read on plm.% is missing, is not a permissive '
        'SELECT policy, or does not apply to authenticated alone', t, t;
    end if;

    -- 5. THE PREDICATE IS THE HOUSE PREDICATE, compared against Sega's stored expression.
    select qual into v_qual from pg_policies
     where schemaname = 'plm' and tablename = t and policyname = t || '_plm_read';
    if v_qual is distinct from v_ref then
      v_fail := v_fail + 1;
      raise warning 'FAIL policy %_plm_read has predicate %, which differs from the house '
        'predicate %', t, coalesce(v_qual, '<null>'), v_ref;
    end if;

    -- 6. NOTHING WAS TAKEN AWAY. The pre-existing service_role read policy survives --
    --    name, command, role AND EXPRESSION. Checking only the name would let a
    --    `_service_read` rewritten to `using (false)` pass, and service_role carries
    --    BYPASSRLS, so no behavioural test would ever notice the loader's read path had
    --    been silently disabled.
    select count(*) into v_n from pg_policies
     where schemaname = 'plm' and tablename = t and policyname = t || '_service_read'
       and cmd = 'SELECT' and roles = array['service_role']::name[];
    if v_n <> 1 then
      v_fail := v_fail + 1;
      raise warning 'FAIL policy %_service_read on plm.% no longer exists in its original '
        'form -- this migration must not touch it', t, t;
    end if;

    select qual into v_qual from pg_policies
     where schemaname = 'plm' and tablename = t and policyname = t || '_service_read';
    if v_qual is distinct from v_svc_ref then
      v_fail := v_fail + 1;
      raise warning 'FAIL policy %_service_read has predicate %, not the permissive %  -- '
        'the service read path was rewritten', t, coalesce(v_qual, '<null>'), v_svc_ref;
    end if;

    -- 7. RLS is still enabled, so the policy is actually the thing deciding.
    select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'plm' and c.relname = t and c.relrowsecurity;
    if v_n <> 1 then
      v_fail := v_fail + 1;
      raise warning 'FAIL row level security is not enabled on plm.% -- the grant above '
        'would then be unconditional', t;
    end if;
  end loop;

  if v_fail > 0 then
    raise exception 'FAILED: % assertion failure(s) across the 28 tables', v_fail;
  end if;

  raise notice 'OK: 28 tables carry authenticated SELECT and only SELECT, a <table>_plm_read '
    'policy whose predicate matches the Sega house predicate exactly, a <table>_service_read '
    'policy still carrying its original permissive expression, RLS enabled, and nothing '
    'for anon.';
end;
$$;
