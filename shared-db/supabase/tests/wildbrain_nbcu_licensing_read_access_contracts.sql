-- =====================================================================================
-- WildBrain and NBCU landing -- Licensing read access. Contract tests.
--
-- Covers migration 20260819151510_wildbrain_nbcu_licensing_read_access.sql
-- Issue u2giants/shared-db #1249 (OWNER RULING), claim #1252.
--
-- THE RULING BEING TESTED (Albert Hazan, in chat, 2026-08-19), verbatim:
--     "scrape data should be visible to Licensing department users."
--
-- EVERY VALUE IN THIS FILE IS INVENTED.
--   u2giants/shared-db is PUBLIC. Not one WildBrain or NBCU property, era, character,
--   guide, asset, file name or portal URL appears here. Every fixture token starts with
--   ZZTEST-/zztest- or ends in .invalid.
--
-- HOW IT IS RUN
--   .github/workflows/database-contract-tests.yml executes every supabase/tests/*.sql
--   against a THROWAWAY local Supabase stack, wrapped in a single
--   `begin; ... \ir <file>; rollback;` transaction, as the migration owner. Nothing here
--   survives the run. The owner connection is required because section B builds a
--   synthetic principal in auth.users behind `session_replication_role = replica` --
--   auth's handle_new_user invitation gate would otherwise refuse the insert -- exactly
--   as supabase/tests/dam_order_list_item_columns_contract.sql does.
--
-- WHAT IT ASSERTS, AND WHY IT IS SHAPED THIS WAY
--   A. CATALOGUE. All 28 tables (11 WildBrain + 17 NBCU) hold the grant, hold ONLY
--      SELECT for authenticated, carry a `<table>_plm_read` policy whose stored
--      predicate is byte-identical to the already-applied Sega house predicate, still
--      carry their original `<table>_service_read` policy, and still have RLS enabled.
--      The Sega predicate is READ FROM THE CATALOG, never written out here, so a typo
--      in this file cannot make the comparison pass.
--
--   B. BEHAVIOUR. The catalogue half can be read correctly and still describe a policy
--      that admits the wrong people, which is precisely the defect 20260807190000 had to
--      correct on plm.opa_property_character (`using (true)` under a comment claiming it
--      matched plm.erp_property). So section B stops describing and starts reading: it
--      builds one real capture per schema, becomes each principal in turn, and counts
--      the rows that principal can actually see.
--
--        CAN read:    licensing, administrator, a profile with `plm` app access
--        CANNOT read: vendor, viewer, an authenticated principal with no role at all
--        CANNOT read: anon, which is refused at the GRANT level, not by RLS
--
--   Every denial is asserted against a NON-VACUITY GATE first: the same row is proved
--   visible to the owner, and for each denied principal every arm of the predicate is
--   proved FALSE. A zero row count against an empty table, or against a principal that
--   was never actually assumed, proves nothing.
--
--   NO BARE `exception when others`. The one place an exception is expected -- anon
--   hitting the missing table privilege -- catches `insufficient_privilege` only and
--   asserts that the handler actually ran. `when others` would also swallow a typo in
--   the test itself and stay green after the thing under test was deleted.
--
-- WHICH ASSERTIONS FAIL WITHOUT THE MIGRATION, STATED HONESTLY
--   Section A fails on all 28 tables, and every CAN-read assertion in section B fails
--   (a principal reads 0 of 1 rows, because before this migration `authenticated` held
--   no grant and no policy on these tables at all). The CANNOT-read assertions and the
--   anon assertion would also PASS before the migration -- they are regression guards
--   against this change, or a later one, widening further than the ruling. They are not
--   claimed as proof that the migration did something.
--
-- SIDE EFFECTS
--   Creates synthetic captures and rows in plm.wildbrain_* and plm.nbcu_*, and one
--   synthetic auth.users/app.profile/app.app_access principal. Writes NOTHING to core.*,
--   dam.* or any canonical table.
-- =====================================================================================


-- =====================================================================================
-- A. CATALOGUE. The grant, the policy, the predicate, and what must NOT have changed.
-- =====================================================================================
do $$
declare
  t         text;
  v_fail    integer := 0;
  v_pass    integer := 0;
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
  raise notice '=== A. CATALOGUE ===';

  if array_length(v_tables, 1) <> 28 then
    raise exception 'A FAILED (fixture): the table list is %, expected the 28 objects '
      'named in claim #1252', array_length(v_tables, 1);
  end if;

  -- The reference predicate is the ALREADY-APPLIED Sega policy, read from the catalog.
  select qual into v_ref from pg_policies
   where schemaname = 'plm' and tablename = 'sega_capture'
     and policyname = 'sega_capture_plm_read';
  if v_ref is null then
    raise exception 'A FAILED (fixture): policy sega_capture_plm_read is missing, so '
      'there is no house predicate to compare against and section A would compare '
      'every new policy against NULL';
  end if;

  -- The second reference: the permissive service-read expression, read from an
  -- already-applied policy this PR does not touch.
  select qual into v_svc_ref from pg_policies
   where schemaname = 'plm' and tablename = 'sega_capture'
     and policyname = 'sega_capture_service_read';
  if v_svc_ref is null then
    raise exception 'A FAILED (fixture): policy sega_capture_service_read is missing, so '
      'there is no reference service-read expression and the _service_read comparisons '
      'below would compare against NULL';
  end if;

  foreach t in array v_tables loop
    -- The table has to exist, or every assertion below is vacuous.
    if to_regclass(format('plm.%I', t)) is null then
      v_fail := v_fail + 1;
      raise warning 'A FAIL: plm.% does not exist', t;
      continue;
    end if;

    -- 1. THE GRANT. A policy without it fails with 42501, not with an RLS denial.
    if not has_table_privilege('authenticated', format('plm.%I', t), 'SELECT') then
      v_fail := v_fail + 1;
      raise warning 'A FAIL: authenticated holds no SELECT on plm.% -- Licensing cannot '
        'read it and the owner ruling is not satisfied', t;
    else v_pass := v_pass + 1; end if;

    -- 2. READS ONLY. Anything that is not SELECT is counted, whatever it is called, so
    --    this does not go stale the way an explicit privilege list does (MAINTAIN
    --    arrived in PostgreSQL 17).
    select count(*) into v_n from information_schema.role_table_grants
     where table_schema = 'plm' and table_name = t
       and grantee = 'authenticated' and privilege_type <> 'SELECT';
    if v_n <> 0 then
      v_fail := v_fail + 1;
      raise warning 'A FAIL: authenticated holds % non-SELECT privilege(s) on plm.% -- '
        'the append-only landing became writable from the browser role', v_n, t;
    else v_pass := v_pass + 1; end if;

    -- 3. anon and PUBLIC still hold nothing at all.
    select count(*) into v_n from information_schema.role_table_grants
     where table_schema = 'plm' and table_name = t and grantee in ('anon', 'PUBLIC');
    if v_n <> 0 then
      v_fail := v_fail + 1;
      raise warning 'A FAIL: anon/PUBLIC hold % grant(s) on plm.%', v_n, t;
    else v_pass := v_pass + 1; end if;

    -- 4. THE POLICY. Present, permissive, SELECT, and scoped to authenticated alone.
    select count(*) into v_n from pg_policies
     where schemaname = 'plm' and tablename = t and policyname = t || '_plm_read'
       and cmd = 'SELECT' and permissive = 'PERMISSIVE'
       and roles = array['authenticated']::name[];
    if v_n <> 1 then
      v_fail := v_fail + 1;
      raise warning 'A FAIL: policy %_plm_read is missing, is not a permissive SELECT '
        'policy, or does not apply to authenticated alone', t;
    else v_pass := v_pass + 1; end if;

    -- 5. THE PREDICATE IS THE HOUSE PREDICATE, character for character.
    select qual into v_qual from pg_policies
     where schemaname = 'plm' and tablename = t and policyname = t || '_plm_read';
    if v_qual is distinct from v_ref then
      v_fail := v_fail + 1;
      raise warning 'A FAIL: policy %_plm_read has predicate %, which is not the house '
        'predicate %', t, coalesce(v_qual, '<null>'), v_ref;
    else v_pass := v_pass + 1; end if;

    -- 6. NOTHING WAS TAKEN AWAY: the pre-existing service_role read policy survives --
    --    name, command, role AND EXPRESSION. Name-only was not enough: a `_service_read`
    --    rewritten to `using (false)` keeps its name, its command and its role, and
    --    service_role carries BYPASSRLS, so section B could not catch it either. The
    --    stored expression is therefore compared against the untouched Sega original, the
    --    same technique used for _plm_read above.
    select count(*) into v_n from pg_policies
     where schemaname = 'plm' and tablename = t and policyname = t || '_service_read'
       and cmd = 'SELECT' and roles = array['service_role']::name[];
    if v_n <> 1 then
      v_fail := v_fail + 1;
      raise warning 'A FAIL: policy %_service_read on plm.% was dropped, renamed or '
        'rewritten -- #1249 must not touch it', t, t;
    else v_pass := v_pass + 1; end if;

    select qual into v_qual from pg_policies
     where schemaname = 'plm' and tablename = t and policyname = t || '_service_read';
    if v_qual is distinct from v_svc_ref then
      v_fail := v_fail + 1;
      raise warning 'A FAIL: policy %_service_read has predicate %, not the permissive % '
        '-- the loader read path was silently rewritten', t,
        coalesce(v_qual, '<null>'), v_svc_ref;
    else v_pass := v_pass + 1; end if;

    -- 7. NO SECOND READ PATH. `_plm_read` must be the ONLY authenticated SELECT policy
    --    on the table -- a second one would be OR-ed with it and could admit anybody,
    --    while every assertion above still passed.
    --
    --    This counts authenticated SELECT policies, not ALL policies. Pinning the total
    --    at two would fail the day somebody legitimately adds a WRITE policy to one of
    --    these tables, which narrows nothing and widens no read. A guard must fail when
    --    something CHANGES, not merely because something GREW.
    select count(*) into v_n from pg_policies
     where schemaname = 'plm' and tablename = t
       and cmd = 'SELECT' and roles = array['authenticated']::name[];
    if v_n <> 1 then
      v_fail := v_fail + 1;
      raise warning 'A FAIL: plm.% carries % authenticated SELECT policies; expected '
        'exactly 1 (%_plm_read). A second read path is OR-ed with the house predicate '
        'and can admit anyone', t, v_n, t;
    else v_pass := v_pass + 1; end if;

    -- 8. RLS is still ENABLED, or the grant above would be unconditional.
    select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'plm' and c.relname = t and c.relrowsecurity;
    if v_n <> 1 then
      v_fail := v_fail + 1;
      raise warning 'A FAIL: row level security is not enabled on plm.%', t;
    else v_pass := v_pass + 1; end if;

    -- 9. THE IMMUTABILITY MECHANISM IS UNTOUCHED. service_role must still hold no
    --    UPDATE, DELETE or TRUNCATE. #1249 is a read change and must not have disturbed
    --    the privilege separation that makes a landed snapshot row immutable.
    select count(*) into v_n from information_schema.role_table_grants
     where table_schema = 'plm' and table_name = t and grantee = 'service_role'
       and privilege_type in ('UPDATE','DELETE','TRUNCATE');
    if v_n <> 0 then
      v_fail := v_fail + 1;
      raise warning 'A FAIL: service_role holds % UPDATE/DELETE/TRUNCATE grant(s) on '
        'plm.% -- landed rows are no longer immutable', v_n, t;
    else v_pass := v_pass + 1; end if;
  end loop;

  -- 10. NO NEW READ SURFACE. #1249 makes the database permission correct; it does not
  --     put WildBrain or NBCU on a screen. `plm` is not PostgREST-exposed, and an api.*
  --     view would be a separate access decision (AGENTS.md section 8.1).
  select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'api'
     and (c.relname like '%wildbrain%' or c.relname like '%nbcu%');
  if v_n <> 0 then
    v_fail := v_fail + 1;
    raise warning 'A FAIL: % api.* object(s) matching wildbrain/nbcu exist; #1249 ships '
      'no read surface', v_n;
  else v_pass := v_pass + 1; end if;

  raise notice 'A: % passed / % failed', v_pass, v_fail;
  if v_fail > 0 then raise exception 'A FAILED (% failures)', v_fail; end if;
end;
$$;


-- =====================================================================================
-- B. BEHAVIOUR. Become each principal and count what it can actually see.
-- =====================================================================================

-- The synthetic principal for the `has_app_access('plm')` arm: one active profile with
-- `plm` app access and NO row in app.user_role, so it is not administrator, not sales
-- and not licensing. session_replication_role = replica is needed ONLY to get past
-- auth's handle_new_user invitation gate on auth.users; it is restored immediately.
set local session_replication_role = replica;
insert into auth.users (id, email)
values ('99999999-9999-4999-8999-999999991249', 'zztest-plm-staff@example.invalid');
set local session_replication_role = origin;

insert into app.profile (auth_user_id, email, display_name, status)
values ('99999999-9999-4999-8999-999999991249', 'zztest-plm-staff@example.invalid',
        'ZZTEST PLM App-Access Principal', 'active');

insert into app.app_access (profile_id, app)
select id, 'plm'::app.app_name from app.profile
where auth_user_id = '99999999-9999-4999-8999-999999991249';

do $$
declare
  v_wb_cap    uuid;
  v_nb_cap    uuid;
  v_fail      integer := 0;
  v_pass      integer := 0;
  v_n         integer;
  v_b         boolean;
  v_claims    text;
  v_role      text;
  v_denied    boolean;
  -- One representative table per structural class per schema: the capture ROOT (which
  -- service_role may not even insert into) and one snapshot table beneath it. Section A
  -- already proves the grant and policy state of all 28; repeating every table here
  -- would add rows to the suite, not evidence.
  v_targets   text[] := array[
    'wildbrain_capture', 'wildbrain_character',
    'nbcu_capture', 'nbcu_property'];
  t           text;
begin
  raise notice '=== B. BEHAVIOUR ===';

  -- ---------------------------------------------------------------- fixtures --------
  v_wb_cap := plm.begin_wildbrain_capture(
    p_capture_key            => 'zztest-wildbrain:1249',
    p_source_repository      => 'u2giants/zztest-fixture',
    p_source_commit_sha      => repeat('1', 40),
    p_source_manifest_sha256 => repeat('2', 64),
    p_portal_base_url        => 'https://zztest.example.invalid/',
    p_source_captured_at     => timestamptz '2026-01-03 00:00:00+00',
    p_expected_counts        => '{"characters":1}'::jsonb,
    p_raw_summary            => '{"fixture":true}'::jsonb,
    p_created_by             => 'zztest-1249',
    p_pagination_verified    => true
  );

  insert into plm.wildbrain_character
    (capture_id, character_source_id, character_label, normalized_character_label,
     in_source_dictionary, raw)
  values (v_wb_cap, '901249', 'ZZTEST Character 1249', 'zztest character 1249', true,
          '{}'::jsonb);

  v_nb_cap := plm.begin_nbcu_capture(
    'nbcu:ZZTEST-1249:' || repeat('3', 40),
    'u2giants/ZZTEST',
    repeat('3', 40),
    repeat('4', 64),
    'https://portal.example.invalid/',
    timestamptz '2026-01-03 00:00:00+00',
    '{"properties":1}'::jsonb,
    '{}'::jsonb,
    'zztest-1249'
  );

  insert into plm.nbcu_property (
    capture_id, property_key, property_source_id, property_label,
    source_kind, source_url, source_captured_at, raw
  ) values (
    v_nb_cap, 'source-id:ZZTEST-1249', 'ZZTEST-1249', 'ZZTEST Property 1249',
    'property', 'https://portal.example.invalid/zztest-1249',
    timestamptz '2026-01-03 00:00:00+00', '{}'::jsonb
  );

  -- NON-VACUITY GATE ONE. As the OWNER, every target holds exactly the one fixture row
  -- this section counts. Without this, a zero read by a denied principal could simply be
  -- an empty table and would prove nothing at all.
  foreach t in array v_targets loop
    execute format(
      'select count(*) from plm.%I where %s',
      t,
      case t
        when 'wildbrain_capture' then format('id = %L', v_wb_cap)
        when 'wildbrain_character' then format('capture_id = %L', v_wb_cap)
        when 'nbcu_capture' then format('id = %L', v_nb_cap)
        when 'nbcu_property' then format('capture_id = %L', v_nb_cap)
      end)
    into v_n;
    if v_n <> 1 then
      raise exception 'B FAILED (fixture): the owner reads % row(s) from plm.%, expected '
        '1. The fixture is broken and every count below would be measuring nothing',
        v_n, t;
    end if;
  end loop;

  -- ------------------------------------------------- the roles that MUST be admitted --
  -- These are the assertions that fail without migration 20260819151510: before it,
  -- `authenticated` held no grant and no policy on either schema, so each of these reads
  -- returned 0 rows -- or, with the policy but no grant, raised 42501.
  foreach v_role in array array['licensing', 'administrator', 'sales'] loop
    v_claims := json_build_object(
      'role', 'authenticated',
      'app_metadata', json_build_object('roles', json_build_array(v_role))
    )::text;

    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', v_claims, true);

    -- The principal really was assumed: the role arm it is named for is TRUE.
    if v_role = 'administrator' then
      select app.has_role('administrator'::app.app_role) into v_b;
    else
      select app.has_any_role(array[v_role]::app.app_role[]) into v_b;
    end if;
    if v_b is not true then
      v_fail := v_fail + 1;
      raise warning 'B FAIL [%]: the JWT did not take -- app.has_role is %, so the reads '
        'below are not testing this principal at all', v_role, v_b;
    else v_pass := v_pass + 1; end if;

    foreach t in array v_targets loop
      execute format(
        'select count(*) from plm.%I where %s',
        t,
        case t
          when 'wildbrain_capture' then format('id = %L', v_wb_cap)
          when 'wildbrain_character' then format('capture_id = %L', v_wb_cap)
          when 'nbcu_capture' then format('id = %L', v_nb_cap)
          when 'nbcu_property' then format('capture_id = %L', v_nb_cap)
        end)
      into v_n;
      if v_n <> 1 then
        v_fail := v_fail + 1;
        raise warning 'B FAIL [%]: read % of 1 row(s) from plm.% -- THE OWNER RULING IS '
          'NOT SATISFIED for this principal', v_role, v_n, t;
      else v_pass := v_pass + 1; end if;
    end loop;

    execute 'reset role';
    perform set_config('request.jwt.claims', null, true);
  end loop;

  -- --------------------------------------------- the `plm` app-access arm, for real ---
  -- This principal holds NO app role at all; it qualifies only through app.app_access,
  -- which has no JWT path, so it needs the real profile inserted above and a JWT `sub`
  -- that resolves to it.
  v_claims := json_build_object(
    'sub', '99999999-9999-4999-8999-999999991249',
    'role', 'authenticated',
    'app_metadata', json_build_object('roles', json_build_array())
  )::text;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', v_claims, true);

  select app.has_app_access('plm'::app.app_name) into v_b;
  if v_b is not true then
    v_fail := v_fail + 1;
    raise warning 'B FAIL [plm app access]: app.has_app_access(''plm'') is % -- the JWT '
      'sub did not resolve to the synthetic profile, so this section is measuring the '
      'wrong principal', v_b;
  else v_pass := v_pass + 1; end if;

  -- ...and it qualifies through THAT arm only, not by being an administrator.
  select app.has_any_role(array['administrator','sales','licensing']::app.app_role[])
    into v_b;
  if v_b is not false then
    v_fail := v_fail + 1;
    raise warning 'B FAIL [plm app access]: the principal also holds administrator/sales/'
      'licensing, so it does not test the has_app_access arm at all';
  else v_pass := v_pass + 1; end if;

  foreach t in array v_targets loop
    execute format(
      'select count(*) from plm.%I where %s',
      t,
      case t
        when 'wildbrain_capture' then format('id = %L', v_wb_cap)
        when 'wildbrain_character' then format('capture_id = %L', v_wb_cap)
        when 'nbcu_capture' then format('id = %L', v_nb_cap)
        when 'nbcu_property' then format('capture_id = %L', v_nb_cap)
      end)
    into v_n;
    if v_n <> 1 then
      v_fail := v_fail + 1;
      raise warning 'B FAIL [plm app access]: read % of 1 row(s) from plm.%', v_n, t;
    else v_pass := v_pass + 1; end if;
  end loop;

  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  -- ------------------------------------------------ the principals that MUST NOT read --
  -- vendor, viewer, and an authenticated principal holding no role whatsoever. These are
  -- regression guards: they also passed before migration 20260819151510, because nobody
  -- could read these tables then. They exist so that this change, or a later one, cannot
  -- widen past the ruling without turning CI red.
  foreach v_role in array array['vendor', 'viewer', 'none'] loop
    if v_role = 'none' then
      v_claims := json_build_object(
        'role', 'authenticated',
        'app_metadata', json_build_object('roles', json_build_array())
      )::text;
    else
      v_claims := json_build_object(
        'role', 'authenticated',
        'app_metadata', json_build_object('roles', json_build_array(v_role))
      )::text;
    end if;

    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', v_claims, true);

    -- NON-VACUITY GATE TWO. Every arm of the predicate must be FALSE for this principal,
    -- or a zero read below would be explained by something other than the policy.
    select app.has_app_access('plm'::app.app_name) into v_b;
    if v_b is not false then
      v_fail := v_fail + 1;
      raise warning 'B FAIL [%]: app.has_app_access(''plm'') is %', v_role, v_b;
    else v_pass := v_pass + 1; end if;

    select app.has_role('administrator'::app.app_role) into v_b;
    if v_b is not false then
      v_fail := v_fail + 1;
      raise warning 'B FAIL [%]: the principal IS an administrator', v_role;
    else v_pass := v_pass + 1; end if;

    select app.has_any_role(array['sales','licensing']::app.app_role[]) into v_b;
    if v_b is not false then
      v_fail := v_fail + 1;
      raise warning 'B FAIL [%]: the principal holds sales or licensing', v_role;
    else v_pass := v_pass + 1; end if;

    foreach t in array v_targets loop
      execute format(
        'select count(*) from plm.%I where %s',
        t,
        case t
          when 'wildbrain_capture' then format('id = %L', v_wb_cap)
          when 'wildbrain_character' then format('capture_id = %L', v_wb_cap)
          when 'nbcu_capture' then format('id = %L', v_nb_cap)
          when 'nbcu_property' then format('capture_id = %L', v_nb_cap)
        end)
      into v_n;
      if v_n <> 0 then
        v_fail := v_fail + 1;
        raise warning 'B FAIL [%]: LICENSED SOURCE MATERIAL IS READABLE BY THIS '
          'PRINCIPAL -- it saw % row(s) of plm.%. The read policy must admit only '
          'administrator / plm app access / sales / licensing', v_role, v_n, t;
      else v_pass := v_pass + 1; end if;
    end loop;

    execute 'reset role';
    perform set_config('request.jwt.claims', null, true);
  end loop;

  -- ------------------------------------------------------------------------ anon ------
  -- anon is refused at the GRANT level, which raises 42501 rather than returning zero
  -- rows, so the refusal itself is what gets asserted. `insufficient_privilege` only:
  -- `when others` would also swallow a typo in the statement and stay green forever.
  foreach t in array v_targets loop
    if has_table_privilege('anon', format('plm.%I', t), 'SELECT') then
      v_fail := v_fail + 1;
      raise warning 'B FAIL [anon]: anon holds SELECT on plm.%', t;
    else v_pass := v_pass + 1; end if;

    v_denied := false;
    execute 'set local role anon';
    begin
      execute format('select count(*) from plm.%I', t) into v_n;
    exception when insufficient_privilege then
      v_denied := true;
    end;
    execute 'reset role';

    if not v_denied then
      v_fail := v_fail + 1;
      raise warning 'B FAIL [anon]: anon read plm.% without being refused -- it saw % '
        'row(s)', t, v_n;
    else v_pass := v_pass + 1; end if;
  end loop;

  -- ------------------------------------------------------------------ service_role ----
  -- The `<table>_service_read` policies must still WORK, not merely still exist. Supabase
  -- service_role carries BYPASSRLS, so this proves the read path rather than the policy
  -- in isolation; section A proves the policy row itself is intact.
  execute 'set local role service_role';
  foreach t in array v_targets loop
    execute format(
      'select count(*) from plm.%I where %s',
      t,
      case t
        when 'wildbrain_capture' then format('id = %L', v_wb_cap)
        when 'wildbrain_character' then format('capture_id = %L', v_wb_cap)
        when 'nbcu_capture' then format('id = %L', v_nb_cap)
        when 'nbcu_property' then format('capture_id = %L', v_nb_cap)
      end)
    into v_n;
    if v_n <> 1 then
      v_fail := v_fail + 1;
      raise warning 'B FAIL [service_role]: the loader identity read % of 1 row(s) from '
        'plm.% -- #1249 broke the existing service read path', v_n, t;
    else v_pass := v_pass + 1; end if;
  end loop;
  execute 'reset role';

  if current_user <> session_user then
    raise exception 'B FAILED: the role was not reset (still %)', current_user;
  end if;

  raise notice 'B: % passed / % failed', v_pass, v_fail;
  if v_fail > 0 then raise exception 'B FAILED (% failures)', v_fail; end if;

  raise notice 'B passed: licensing, sales, administrator and a plm-app-access principal '
    'each read both landing schemas; vendor, viewer and a role-less principal read '
    'nothing; anon is refused at the grant; service_role still reads.';
end;
$$;


-- =====================================================================================
-- C. NOTHING ELSE MOVED. The other landing schemas are untouched by #1249.
--
--    WHY THIS SECTION IS SHAPED THE WAY IT IS. Its first version asked only whether the
--    neighbours' policies still EXISTED, which is a nominal guard and not a real one: a
--    Disney policy rewritten to `using (true)` still counts as one policy, and one
--    surviving `designer` mention still satisfies "some pmt_* policy mentions designer"
--    while the other twenty-two are narrowed. Every check below therefore compares a
--    STORED PREDICATE read from pg_policies, and quantifies over EVERY policy in the
--    family rather than over at least one -- the technique section A uses on the 28
--    tables this migration actually writes.
--
--    AND EVERY ARM GUARDS BOTH DIRECTIONS, because a neighbour policy fails two ways:
--    REWRITTEN (still present, admits somebody else) and DROPPED (gone, so RLS matches
--    no policy and the table returns zero rows to everyone, silently revoking the access
--    Albert ruled these people should have). A per-policy comparison catches the first
--    and is blind to the second -- it simply has one fewer row to check and passes. So
--    each arm asserts COVERAGE PER TABLE as well: count the tables that LACK a policy and
--    require zero. The Sega/Peanuts arm was missing that half until this was caught in
--    review, which is exactly the failure mode this header describes.
--
--    Disney is compared ARM BY ARM rather than by string equality, because its arms are
--    in a different ORDER from Sega's: 20260807190000 wrote administrator / plm access /
--    sales+licensing, and 20260819015333 wrote plm access / administrator /
--    sales+licensing. Same population, different text. Splitting both on OR and comparing
--    them as SETS asserts the thing that actually matters -- who is admitted -- and fails
--    immediately on `using (true)`, on a dropped arm, or on an added one.
--
--    THE RULE EVERY GUARD BELOW OBEYS: a neighbour guard must fail when a neighbour
--    CHANGES, and must NOT fail merely because a neighbour GREW. Nothing here pins a
--    literal count or a literal list of table names. The first version of the Paramount
--    check pinned 23, the number 20260810020000's loop creates; CI found 25, because
--    20260811030000 added plm.pmt_asset_metadata_value and 20260814213043 added
--    plm.pmt_metadata_element, each with its own read policy carrying the same four-role
--    predicate. Nothing was wrong with Paramount -- the expectation was wrong, and a
--    magic number the next author has to bump with no idea why is exactly the trap this
--    rule exists to avoid. Every count below is DERIVED from the catalog at run time.
-- =====================================================================================
do $$
declare
  v_fail      integer := 0;
  v_pass      integer := 0;
  v_n         integer;
  v_qual      text;
  v_ref       text;
  v_ref_arms  text[];
  v_opa_arms  text[];
  v_missing   text;
  r           record;
begin
  raise notice '=== C. NEIGHBOURS ===';

  select qual into v_ref from pg_policies
   where schemaname = 'plm' and tablename = 'sega_capture'
     and policyname = 'sega_capture_plm_read';
  if v_ref is null then
    raise exception 'C FAILED (fixture): sega_capture_plm_read is missing, so there is no '
      'house predicate to compare the neighbours against';
  end if;

  -- The house arms, as a SET: outer parentheses stripped, split on OR, all whitespace
  -- removed so two spellings of one arm compare equal, and sorted so order cannot matter.
  -- ONE outer pair of parentheses is stripped, not every parenthesis at either end:
  -- btrim(qual, '()') would eat the closing paren of the trailing ARRAY[...] call too and
  -- silently mangle the last arm.
  select array_agg(replace(btrim(arm), ' ', '') order by replace(btrim(arm), ' ', ''))
    into v_ref_arms
  from unnest(string_to_array(
    case when v_ref like '(%)' then substr(v_ref, 2, length(v_ref) - 2) else v_ref end,
    ' OR ')) as arm;

  if array_length(v_ref_arms, 1) <> 3 then
    raise exception 'C FAILED (fixture): the house predicate split into % arm(s), expected '
      '3 (plm app access, administrator, sales+licensing). The split is wrong and every '
      'comparison below would be meaningless', coalesce(array_length(v_ref_arms, 1), 0);
  end if;

  -- ------------------------------------------------------------------ Disney OPA ------
  -- Disney has been correct since 20260807190000, which dropped the original over-broad
  -- `using (true)` policy and recreated opa_property_character_read with the house
  -- predicate (issue #1251 was closed as already-done). #1249 must not add, drop or
  -- rewrite it, and its ARMS must still be exactly the house arms.
  -- NO PINNED POLICY COUNT. Requiring exactly one policy would fail the day somebody
  -- legitimately adds a WRITE policy to this table, which narrows nothing and is none of
  -- this test's business. What must never happen is a SECOND, WIDER read path appearing
  -- beside the correct one -- so every authenticated SELECT policy on the table is
  -- checked below, however many there are.
  select count(*) into v_n from pg_policies
   where schemaname = 'plm' and tablename = 'opa_property_character'
     and cmd = 'SELECT' and roles = array['authenticated']::name[];
  if v_n = 0 then
    v_fail := v_fail + 1;
    raise warning 'C FAIL: plm.opa_property_character has NO authenticated read policy at '
      'all -- the Disney extract became unreadable to the people entitled to it';
  else v_pass := v_pass + 1; end if;

  -- The policy 20260807190000 created must still be there under its own name...
  if not exists (
    select 1 from pg_policies
     where schemaname = 'plm' and tablename = 'opa_property_character'
       and policyname = 'opa_property_character_read'
       and cmd = 'SELECT' and roles = array['authenticated']::name[]) then
    v_fail := v_fail + 1;
    raise warning 'C FAIL: policy opa_property_character_read is missing, was renamed, or '
      'is no longer an authenticated SELECT policy';
  else v_pass := v_pass + 1; end if;

  -- ...and EVERY authenticated read path into the Disney extract, that one included, must
  -- admit exactly the house arms. Arms are compared as a SET because 20260807190000 wrote
  -- them in a different ORDER from 20260819015333 -- same population, different text.
  -- `using (true)` yields the single arm 'true', which matches no house arm and fails.
  for r in
    select policyname, qual from pg_policies
     where schemaname = 'plm' and tablename = 'opa_property_character'
       and cmd = 'SELECT' and roles = array['authenticated']::name[]
     order by policyname
  loop
    select array_agg(replace(btrim(arm), ' ', '') order by replace(btrim(arm), ' ', ''))
      into v_opa_arms
    from unnest(string_to_array(
      case when r.qual like '(%)' then substr(r.qual, 2, length(r.qual) - 2)
           else coalesce(r.qual, '<null>') end,
      ' OR ')) as arm;

    if v_opa_arms is distinct from v_ref_arms then
      v_fail := v_fail + 1;
      raise warning 'C FAIL: Disney read policy % admits [%] -- the house predicate admits '
        '[%]. The confidential Disney extract is no longer restricted to administrator / '
        'plm app access / sales+licensing',
        r.policyname, array_to_string(v_opa_arms, ' OR '),
        array_to_string(v_ref_arms, ' OR ');
    else v_pass := v_pass + 1; end if;
  end loop;

  -- ------------------------------------------------------------------- Paramount ------
  -- Paramount deliberately keeps its WIDER predicate, which also admits `designer`.
  -- Narrowing it would take access away from designers, which nobody asked for -- so
  -- EVERY pmt_* authenticated read policy must still mention designer, not merely one.
  --
  -- COVERAGE IS ASSERTED PER TABLE, NOT AS A HARDCODED COUNT. The first version of this
  -- check required exactly 23, the number 20260810020000's loop creates. CI found 25:
  -- two more pmt_* landing tables have arrived since, each with its own read policy. A
  -- literal count is a tripwire for unrelated Paramount work rather than a guard on this
  -- change, so what is asserted instead is the thing that actually matters -- that no
  -- pmt_* table with RLS enabled has LOST its authenticated read policy. That
  -- self-adjusts when Paramount legitimately grows and still fails the moment one is
  -- dropped.
  select count(*) into v_n
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'plm' and c.relname like 'pmt\_%'
     and c.relkind = 'r' and c.relrowsecurity
     and not exists (
       select 1 from pg_policies p
        where p.schemaname = 'plm' and p.tablename = c.relname
          and p.cmd = 'SELECT' and p.roles = array['authenticated']::name[]);
  if v_n <> 0 then
    v_fail := v_fail + 1;
    raise warning 'C FAIL: % plm.pmt_* table(s) with RLS enabled have NO authenticated '
      'read policy -- Paramount lost a read path it had before #1249', v_n;
  else v_pass := v_pass + 1; end if;

  -- NON-VACUITY, DERIVED. The coverage check above is trivially true if there are no
  -- pmt_* tables at all, so prove there are some -- by counting the TABLES, never by
  -- pinning how many there ought to be.
  select count(*) into v_n
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'plm' and c.relname like 'pmt\_%'
     and c.relkind = 'r' and c.relrowsecurity;
  if v_n = 0 then
    v_fail := v_fail + 1;
    raise warning 'C FAIL: there are no plm.pmt_* tables with RLS enabled at all, so the '
      'Paramount coverage check above proved nothing';
  else v_pass := v_pass + 1; end if;

  select string_agg(policyname, ', ' order by policyname) into v_missing
  from pg_policies
   where schemaname = 'plm' and tablename like 'pmt\_%'
     and cmd = 'SELECT' and roles = array['authenticated']::name[]
     and coalesce(qual, '') not like '%designer%';
  if v_missing is not null then
    v_fail := v_fail + 1;
    raise warning 'C FAIL: these pmt_* read policies no longer admit designer: % -- '
      'Paramount was narrowed, which #1249 must not do', v_missing;
  else v_pass := v_pass + 1; end if;

  -- --------------------------------------------------------------- Sega and Peanuts ---
  -- These two already satisfied the ruling before #1249, and they are guarded in BOTH
  -- directions, because a neighbour policy can fail two different ways:
  --
  --   REWRITTEN -- the policy is still there but admits somebody else. Caught by the
  --                per-policy qual/cmd/roles comparison in the loop below.
  --   DROPPED   -- the policy is simply gone. RLS stays enabled, so the table falls
  --                through to "no policy matches" and returns ZERO rows to everyone.
  --                That silently revokes Licensing's access to that table, which is the
  --                single most damaging thing that can happen to a neighbour here, and
  --                it is the exact opposite of what Albert ruled.
  --
  -- The loop below only inspects the policies that EXIST, so on its own a DROP leaves it
  -- green -- it would just have one fewer row to check and pass. Coverage is therefore
  -- asserted per TABLE first, the same shape used for Paramount above: count the tables
  -- that LACK a policy, and require that count to be zero. Derived from the catalog, so
  -- it self-adjusts when Sega or Peanuts legitimately grows and still fails the moment
  -- one is dropped.
  select count(*) into v_n
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'plm'
     and (c.relname like 'sega\_%' or c.relname like 'peanuts\_%')
     and c.relkind = 'r' and c.relrowsecurity
     and not exists (
       select 1 from pg_policies p
        where p.schemaname = 'plm' and p.tablename = c.relname
          and p.policyname = c.relname || '_plm_read'
          and p.cmd = 'SELECT' and p.roles = array['authenticated']::name[]);
  if v_n <> 0 then
    v_fail := v_fail + 1;
    raise warning 'C FAIL: % plm.sega_*/plm.peanuts_* table(s) with RLS enabled have NO '
      '<table>_plm_read policy -- Licensing silently lost read access to a landing table '
      'it could read before #1249', v_n;
  else v_pass := v_pass + 1; end if;

  -- NON-VACUITY, DERIVED. The coverage check above is trivially true if there are no such
  -- tables at all, so prove there are some -- by counting the TABLES, never by pinning
  -- how many there ought to be.
  select count(*) into v_n
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'plm'
     and (c.relname like 'sega\_%' or c.relname like 'peanuts\_%')
     and c.relkind = 'r' and c.relrowsecurity;
  if v_n = 0 then
    v_fail := v_fail + 1;
    raise warning 'C FAIL: there are no plm.sega_*/plm.peanuts_* tables with RLS enabled '
      'at all, so the Sega/Peanuts coverage check above proved nothing';
  else v_pass := v_pass + 1; end if;

  for r in
    select tablename, policyname, qual, cmd, roles from pg_policies
     where schemaname = 'plm'
       and (tablename like 'sega\_%' or tablename like 'peanuts\_%')
       and policyname like '%\_plm\_read'
     order by tablename, policyname
  loop
    if r.qual is distinct from v_ref
       or r.cmd <> 'SELECT'
       or r.roles is distinct from array['authenticated']::name[] then
      v_fail := v_fail + 1;
      raise warning 'C FAIL: policy % on plm.% is (% to %) using % -- it no longer matches '
        'the house predicate %. A neighbour #1249 must not touch was rewritten',
        r.policyname, r.tablename, r.cmd, array_to_string(r.roles, ','),
        coalesce(r.qual, '<null>'), v_ref;
    else v_pass := v_pass + 1; end if;
  end loop;

  raise notice 'C: % passed / % failed', v_pass, v_fail;
  if v_fail > 0 then raise exception 'C FAILED (% failures)', v_fail; end if;
  raise notice 'C passed: every Disney OPA authenticated read policy admits exactly the '
    'three house arms, every plm.pmt_* table with RLS still has a read policy and every '
    'one of those still admits designer, and every plm.sega_*/plm.peanuts_* table with '
    'RLS still HAS its _plm_read policy and every one of those still carries the house '
    'predicate byte for byte.';
end;
$$;
