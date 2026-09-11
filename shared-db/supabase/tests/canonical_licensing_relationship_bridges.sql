-- Issue #2334 contract: the canonical licensing relationship foundation.
--
-- This file asserts BEHAVIOUR, not "the migration applied". Every claim #2334 makes is
-- exercised against real rows and rolled back:
--   * the live core.property_character_associations endpoint contract is untouched;
--   * the five missing canonical bridges and all eight support-edge tables exist;
--   * inferred and co-occurrence evidence can NEVER become a direct canonical edge;
--   * is_direct_source_relationship cannot be written, so evidence cannot lie about itself;
--   * deleting CURRENT support fails closed -- directly, and by cascade from a deleted
--     endpoint, which is how the three pre-existing ON DELETE CASCADE bridges are covered;
--   * superseded support does NOT block deletion;
--   * every guard function pins its search_path to EXACTLY 'pg_catalog, pg_temp', is
--     SECURITY DEFINER, and is callable by no client role;
--   * the guards work for service_role, the role that actually loads DAM support edges and
--     that holds no SELECT on dam.asset or dam.asset_character;
--   * all five bridges and all eight support-edge wirings are pinned by ARGUMENT
--     VALUE, not by trigger name -- every endpoint column is uuid, so a swapped
--     pair would otherwise type check and guard the wrong relationship silently;
--   * repointing a canonical bridge row by UPDATE is held to the same evidence
--     standard as inserting it;
--   * a support row's licensor must be its endpoints' licensor, so one licensor's
--     pair can never be filed under another licensor's id -- enforced as the migration
--     owner AND as service_role;
--   * that licensor check is scoped to writes that actually set an endpoint or licensor_id,
--     so re-licensing an endpoint does not freeze the historical support row: withdrawal and
--     metadata corrections still work, while INSERTs and governed-column UPDATEs into
--     disagreement are still refused.
begin;

do $contracts$
declare
  v_licensor    uuid;
  v_property    uuid;
  v_property2   uuid;
  v_character   uuid;
  v_style_guide uuid;
  v_franchise   uuid;
  v_asset       uuid;
  v_edge        uuid;
  v_edge2       uuid;
  v_licensor2   uuid;
  v_property3   uuid;
  v_style_guide2 uuid;
  v_edge3       uuid;
  v_spec        jsonb;
  v_def         text;
  v_needle      text;
  v_oid         oid;
  v_table       text;
  v_raised      boolean;
  v_sqlstate    text;
  v_message     text;
  v_count       integer;
  t             text;
begin
  -- =========================================================================
  -- 1. Existence: the enum, the two guards, and all thirteen new tables.
  -- =========================================================================
  if not exists (select 1 from pg_type where typname = 'relationship_evidence_kind'
                 and typnamespace = 'core'::regnamespace) then
    raise exception 'core.relationship_evidence_kind is absent';
  end if;

  if array(select enumlabel::text from pg_enum
           where enumtypid = 'core.relationship_evidence_kind'::regtype
           order by enumsortorder)
     <> array['direct_source_assertion','inferred','co_occurrence'] then
    raise exception 'the three-way evidence vocabulary changed';
  end if;

  if to_regprocedure('core.refuse_delete_of_current_support_edge()') is null
     or to_regprocedure('core.require_direct_support_for_canonical_edge()') is null then
    raise exception 'a #2334 guard function is absent';
  end if;

  foreach t in array array[
    'core.property_style_guide', 'core.property_franchise',
    'dam.asset_property', 'dam.asset_style_guide', 'dam.asset_franchise',
    'core.property_character_source_edge', 'core.property_style_guide_source_edge',
    'core.property_franchise_source_edge', 'core.style_guide_character_source_edge',
    'dam.asset_property_source_edge', 'dam.asset_character_source_edge',
    'dam.asset_style_guide_source_edge', 'dam.asset_franchise_source_edge'
  ] loop
    if to_regclass(t) is null then
      raise exception '#2334 table % is absent', t;
    end if;
    -- Structure only: #2334 authorizes no relationship rows and no licensed evidence.
    execute format('select count(*) from %s', t) into v_count;
    if v_count <> 0 then
      raise exception '% was seeded with % row(s); #2334 authorizes none', t, v_count;
    end if;
  end loop;

  -- Every support edge carries both the supersession guard and the generated flag.
  foreach t in array array[
    'core.property_character_source_edge', 'core.property_style_guide_source_edge',
    'core.property_franchise_source_edge', 'core.style_guide_character_source_edge',
    'dam.asset_property_source_edge', 'dam.asset_character_source_edge',
    'dam.asset_style_guide_source_edge', 'dam.asset_franchise_source_edge'
  ] loop
    if not exists (
      select 1 from pg_trigger
      where tgrelid = t::regclass and not tgisinternal
        and tgname = 'refuse_delete_of_current_support'
    ) then
      raise exception '% has no fail-closed delete guard', t;
    end if;
    if not exists (
      select 1 from information_schema.columns
      where table_schema = split_part(t, '.', 1) and table_name = split_part(t, '.', 2)
        and column_name = 'is_direct_source_relationship' and is_generated = 'ALWAYS'
    ) then
      raise exception '%.is_direct_source_relationship is not a generated column', t;
    end if;
  end loop;

  -- Every NEW canonical bridge refuses an unsupported edge and restricts endpoint delete.
  foreach t in array array[
    'core.property_style_guide', 'core.property_franchise',
    'dam.asset_property', 'dam.asset_style_guide', 'dam.asset_franchise'
  ] loop
    if not exists (
      select 1 from pg_trigger
      where tgrelid = t::regclass and not tgisinternal and tgname = 'require_direct_support'
    ) then
      raise exception '% does not require direct support', t;
    end if;
    if exists (
      select 1 from pg_constraint
      where conrelid = t::regclass and contype = 'f' and confdeltype <> 'r'
    ) then
      raise exception '% has an endpoint foreign key that is not ON DELETE RESTRICT', t;
    end if;
  end loop;

  -- =========================================================================
  -- 1b. Round-3 review finding (hardening). Every #2334 guard function pins its
  --     search_path and grants EXECUTE to no client role. They run dynamic SQL, and an
  --     unrevoked probe is an existence oracle over licensing evidence that any signed-in
  --     caller could query directly. A trigger fires without the privilege, so revoking it
  --     costs nothing.
  --
  --     Round-4 review finding. The search_path assertion below used to accept any value
  --     beginning 'search_path=', so 'search_path = public' -- which is a settable,
  --     caller-influenced schema and defeats the whole point of pinning -- would have
  --     passed it. The EXACT expected value is asserted instead. Each function is also
  --     required to be SECURITY DEFINER: the guards read catalog-of-record tables the
  --     writing role has no SELECT on (service_role writes the dam support-edge tables but
  --     is granted no SELECT on dam.asset or dam.asset_character), so losing the definer
  --     would make every ordinary DAM loader write fail with a permission error.
  -- =========================================================================
  foreach t in array array[
    'core.refuse_delete_of_current_support_edge()',
    'core.require_direct_support_for_canonical_edge()',
    'core.assert_canonical_edge_still_supported()',
    'core.require_support_edge_licensor_matches_endpoints()'
  ] loop
    if to_regprocedure(t) is null then
      raise exception '#2334 guard function % is absent', t;
    end if;
    if not exists (
      select 1 from pg_proc
      where oid = to_regprocedure(t)
        and proconfig is not null
        and proconfig @> array['search_path=pg_catalog, pg_temp']
    ) then
      raise exception '% does not pin search_path to exactly ''pg_catalog, pg_temp'' '
        '(actual proconfig: %)', t,
        coalesce((select proconfig::text from pg_proc where oid = to_regprocedure(t)), '<null>');
    end if;
    if not (select prosecdef from pg_proc where oid = to_regprocedure(t)) then
      raise exception '% is not SECURITY DEFINER, so it reads the endpoint and bridge tables '
        'as the WRITING role -- service_role holds no SELECT on dam.asset or '
        'dam.asset_character, so the guard would fail closed with a permission error on the '
        'ordinary DAM loader path', t;
    end if;
    if has_function_privilege('public', to_regprocedure(t), 'execute')
       or has_function_privilege('anon', to_regprocedure(t), 'execute')
       or has_function_privilege('authenticated', to_regprocedure(t), 'execute') then
      raise exception '% is directly callable by a client role, which makes its dynamic-SQL '
        'existence probe an oracle over licensing evidence', t;
    end if;
  end loop;

  -- =========================================================================
  -- 1b2. Round-5 review finding (High). The invariant is enforced at COMMIT by the
  --      deferrable constraint trigger ONLY. An IMMEDIATE BEFORE UPDATE row guard makes the
  --      ordinary single-source supersession impossible: the partial unique index over
  --      (left, right, licensor_id, source_system, evidence_kind) WHERE is_current refuses
  --      the replacement while the old row is still current, and an immediate guard refuses
  --      the retirement while the replacement does not yet exist -- a deadlock no ordering
  --      inside one transaction can escape. Reintroducing such a guard must fail here.
  -- =========================================================================
  if to_regprocedure('core.refuse_unsupporting_update_of_support_edge()') is not null then
    raise exception 'the immediate BEFORE UPDATE support-withdrawal guard is back; it '
      'deadlocks same-source supersession against the partial unique claim key (round-5 '
      'review finding). The deferrable constraint trigger is the enforcement point.';
  end if;

  foreach v_table in array array[
    'core.property_character_source_edge',
    'core.property_style_guide_source_edge',
    'core.property_franchise_source_edge',
    'core.style_guide_character_source_edge',
    'dam.asset_property_source_edge',
    'dam.asset_character_source_edge',
    'dam.asset_style_guide_source_edge',
    'dam.asset_franchise_source_edge'
  ] loop
    if exists (
      select 1 from pg_trigger tg
      where tg.tgrelid = v_table::regclass
        and not tg.tgisinternal
        and tg.tgdeferrable = false
        and (tg.tgtype & 16) <> 0                          -- UPDATE
        and (tg.tgtype & 2) <> 0                           -- BEFORE
        and tg.tgfoid <> 'app.set_updated_at()'::regprocedure
        and tg.tgfoid <> 'core.require_support_edge_licensor_matches_endpoints()'::regprocedure
    ) then
      raise exception 'an unexpected IMMEDIATE BEFORE UPDATE trigger exists on %, which is '
        'how same-source supersession was deadlocked before the round-5 fix', v_table;
    end if;
  end loop;

  -- =========================================================================
  -- 1c. Round-3 review finding. Asserting a trigger by NAME alone proves nothing about
  --     WHICH pair it guards: every endpoint column here is uuid, so a wiring that swapped
  --     two arguments -- or named the wrong bridge or the wrong support table -- would type
  --     check, fire, and silently guard the wrong relationship. Each of the five bridges and
  --     all eight support-edge wirings is therefore pinned by its ARGUMENT VALUES, read back
  --     out of the catalog with pg_get_triggerdef.
  -- =========================================================================
  for v_spec in
    select * from jsonb_array_elements($wiring$[
      {"t":"core.property_style_guide",  "g":"require_direct_support",
       "f":"core.require_direct_support_for_canonical_edge",
       "a":"'core.property_style_guide_source_edge', 'property_id', 'style_guide_id'"},
      {"t":"core.property_franchise",    "g":"require_direct_support",
       "f":"core.require_direct_support_for_canonical_edge",
       "a":"'core.property_franchise_source_edge', 'property_id', 'franchise_id'"},
      {"t":"dam.asset_property",         "g":"require_direct_support",
       "f":"core.require_direct_support_for_canonical_edge",
       "a":"'dam.asset_property_source_edge', 'asset_id', 'property_id'"},
      {"t":"dam.asset_style_guide",      "g":"require_direct_support",
       "f":"core.require_direct_support_for_canonical_edge",
       "a":"'dam.asset_style_guide_source_edge', 'asset_id', 'style_guide_id'"},
      {"t":"dam.asset_franchise",        "g":"require_direct_support",
       "f":"core.require_direct_support_for_canonical_edge",
       "a":"'dam.asset_franchise_source_edge', 'asset_id', 'franchise_id'"},

      {"t":"core.property_character_source_edge",    "g":"assert_canonical_edge_still_supported",
       "f":"core.assert_canonical_edge_still_supported",
       "a":"'core.property_character_associations', 'property_id', 'character_id'"},
      {"t":"core.property_style_guide_source_edge",  "g":"assert_canonical_edge_still_supported",
       "f":"core.assert_canonical_edge_still_supported",
       "a":"'core.property_style_guide', 'property_id', 'style_guide_id'"},
      {"t":"core.property_franchise_source_edge",    "g":"assert_canonical_edge_still_supported",
       "f":"core.assert_canonical_edge_still_supported",
       "a":"'core.property_franchise', 'property_id', 'franchise_id'"},
      {"t":"core.style_guide_character_source_edge", "g":"assert_canonical_edge_still_supported",
       "f":"core.assert_canonical_edge_still_supported",
       "a":"'core.style_guide_character', 'style_guide_id', 'character_id'"},
      {"t":"dam.asset_property_source_edge",         "g":"assert_canonical_edge_still_supported",
       "f":"core.assert_canonical_edge_still_supported",
       "a":"'dam.asset_property', 'asset_id', 'property_id'"},
      {"t":"dam.asset_character_source_edge",        "g":"assert_canonical_edge_still_supported",
       "f":"core.assert_canonical_edge_still_supported",
       "a":"'dam.asset_character', 'asset_id', 'character_id'"},
      {"t":"dam.asset_style_guide_source_edge",      "g":"assert_canonical_edge_still_supported",
       "f":"core.assert_canonical_edge_still_supported",
       "a":"'dam.asset_style_guide', 'asset_id', 'style_guide_id'"},
      {"t":"dam.asset_franchise_source_edge",        "g":"assert_canonical_edge_still_supported",
       "f":"core.assert_canonical_edge_still_supported",
       "a":"'dam.asset_franchise', 'asset_id', 'franchise_id'"},

      {"t":"core.property_character_source_edge",    "g":"require_matching_licensor",
       "f":"core.require_support_edge_licensor_matches_endpoints",
       "a":"'core.property', 'property_id', 'core.character', 'character_id'"},
      {"t":"core.property_style_guide_source_edge",  "g":"require_matching_licensor",
       "f":"core.require_support_edge_licensor_matches_endpoints",
       "a":"'core.property', 'property_id', 'core.style_guide', 'style_guide_id'"},
      {"t":"core.property_franchise_source_edge",    "g":"require_matching_licensor",
       "f":"core.require_support_edge_licensor_matches_endpoints",
       "a":"'core.property', 'property_id', 'core.franchise', 'franchise_id'"},
      {"t":"core.style_guide_character_source_edge", "g":"require_matching_licensor",
       "f":"core.require_support_edge_licensor_matches_endpoints",
       "a":"'core.style_guide', 'style_guide_id', 'core.character', 'character_id'"},
      {"t":"dam.asset_property_source_edge",         "g":"require_matching_licensor",
       "f":"core.require_support_edge_licensor_matches_endpoints",
       "a":"'dam.asset', 'asset_id', 'core.property', 'property_id'"},
      {"t":"dam.asset_character_source_edge",        "g":"require_matching_licensor",
       "f":"core.require_support_edge_licensor_matches_endpoints",
       "a":"'dam.asset', 'asset_id', 'core.character', 'character_id'"},
      {"t":"dam.asset_style_guide_source_edge",      "g":"require_matching_licensor",
       "f":"core.require_support_edge_licensor_matches_endpoints",
       "a":"'dam.asset', 'asset_id', 'core.style_guide', 'style_guide_id'"},
      {"t":"dam.asset_franchise_source_edge",        "g":"require_matching_licensor",
       "f":"core.require_support_edge_licensor_matches_endpoints",
       "a":"'dam.asset', 'asset_id', 'core.franchise', 'franchise_id'"}
    ]$wiring$::jsonb)
  loop
    select oid into v_oid from pg_trigger
     where tgrelid = (v_spec->>'t')::regclass
       and not tgisinternal
       and tgname = v_spec->>'g';
    if v_oid is null then
      raise exception 'trigger % is absent from %', v_spec->>'g', v_spec->>'t';
    end if;

    -- The function identity is compared by OID, not by the rendered name, so a change of
    -- search_path in the session running this file can never turn a real mismatch green.
    if (select tgfoid from pg_trigger where oid = v_oid)
       <> to_regprocedure((v_spec->>'f') || '()') then
      raise exception 'trigger %.% calls the wrong function; expected %',
        v_spec->>'t', v_spec->>'g', v_spec->>'f';
    end if;

    -- And the ARGUMENT VALUES, which is the whole point: every endpoint column here is
    -- uuid, so a swapped or misnamed pair type checks and fires against the wrong pair.
    v_def := pg_get_triggerdef(v_oid);
    v_needle := '(' || (v_spec->>'a') || ')';
    if position(v_needle in v_def) = 0 then
      raise exception 'trigger %.% is wired with the wrong arguments. expected to contain: '
        '% -- actual: %',
        v_spec->>'t', v_spec->>'g', v_needle, v_def;
    end if;
  end loop;

  -- =========================================================================
  -- 2. The live Property/Character endpoint contract is byte-for-byte preserved.
  -- =========================================================================
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'core' and table_name = 'property_character_associations'
      and column_name not in ('property_id','character_id','created_at','updated_at')
  ) then
    raise exception '#2334 added a column to the live property_character_associations contract';
  end if;

  if 2 <> (select count(*) from pg_constraint
           where conrelid = 'core.property_character_associations'::regclass
             and contype = 'f' and confdeltype = 'r') then
    raise exception 'property_character_associations lost its ON DELETE RESTRICT endpoints';
  end if;

  if (select count(*) from core.property_character_associations) <> 0 then
    raise exception 'property_character_associations is no longer empty';
  end if;

  if has_table_privilege('authenticated', 'core.property_character_associations', 'insert')
     or has_table_privilege('service_role', 'core.property_character_associations', 'insert') then
    raise exception 'property_character_associations gained an ungoverned write privilege';
  end if;

  -- No role may write a canonical licensing edge, on the new bridges either.
  foreach t in array array[
    'core.property_style_guide', 'core.property_franchise',
    'dam.asset_property', 'dam.asset_style_guide', 'dam.asset_franchise'
  ] loop
    if has_table_privilege('authenticated', t, 'insert')
       or has_table_privilege('service_role', t, 'insert') then
      raise exception '% grants an ungoverned canonical write', t;
    end if;
  end loop;

  -- =========================================================================
  -- 3. Fixtures. Invented rows, rolled back with the transaction.
  -- =========================================================================
  -- core.licensor and core.property carry the exact-column transaction-bound
  -- licensing write guard (20260817124545). Fixtures use the real guard rather
  -- than working around it: one authorization row per insert, naming exactly
  -- the columns that insert changes. Property must be created as 'potential'.
  insert into plm.licensing_write_authorization
    (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
     actor, protected_columns, expires_at)
  values (pg_backend_pid(), txid_current(), 'core.licensor', 'scrape_consolidation',
          gen_random_uuid(), repeat('1', 64), 'issue-2334-contract',
          array['name','code','status'], clock_timestamp() + interval '1 minute');
  insert into core.licensor (name, code, status)
    values ('ZZ Fixture Licensor 2334', 'ZZ2334', 'active')
    returning id into v_licensor;

  insert into plm.licensing_write_authorization
    (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
     actor, protected_columns, expires_at)
  values
    (pg_backend_pid(), txid_current(), 'core.property', 'licensing_review_create',
     gen_random_uuid(), repeat('2', 64), 'issue-2334-contract',
     array['licensor_id','name','code','status'], clock_timestamp() + interval '1 minute'),
    (pg_backend_pid(), txid_current(), 'core.property', 'licensing_review_create',
     gen_random_uuid(), repeat('3', 64), 'issue-2334-contract',
     array['licensor_id','name','code','status'], clock_timestamp() + interval '1 minute');
  insert into core.property (licensor_id, name, code, status)
    values (v_licensor, 'ZZ Fixture Property 2334', 'ZZP2334', 'potential')
    returning id into v_property;
  insert into core.property (licensor_id, name, code, status)
    values (v_licensor, 'ZZ Fixture Property 2334 B', 'ZZP2334B', 'potential')
    returning id into v_property2;
  insert into core.character (licensor_id, name)
    values (v_licensor, 'ZZ Fixture Character 2334') returning id into v_character;
  insert into core.style_guide (licensor_id, property_id, name)
    values (v_licensor, v_property, 'ZZ Fixture Style Guide 2334') returning id into v_style_guide;
  insert into core.franchise (licensor_id, name, source_system, source_id)
    values (v_licensor, 'ZZ Fixture Franchise 2334', 'manual', 'zz-2334')
    returning id into v_franchise;
  insert into dam.asset (title, source_system, source_id)
    values ('ZZ Fixture Asset 2334', 'zz_fixture_2334', 'zz-asset-2334') returning id into v_asset;

  -- =========================================================================
  -- 4. THE CENTRAL CLAIM: inferred and co-occurrence evidence never become canon.
  -- =========================================================================

  -- 4a. No support at all -> refused.
  v_raised := false;
  begin
    insert into core.property_style_guide (property_id, style_guide_id)
      values (v_property, v_style_guide);
  exception when sqlstate 'P0001' then v_raised := true;
  end;
  if not v_raised then
    raise exception 'a canonical edge was accepted with NO supporting evidence';
  end if;

  -- 4b. INFERRED support -> still refused.
  insert into core.property_style_guide_source_edge
    (property_id, style_guide_id, licensor_id, source_system, evidence_kind, confidence)
    values (v_property, v_style_guide, v_licensor, 'zz_fixture_2334', 'inferred', 0.9900);
  v_raised := false;
  begin
    insert into core.property_style_guide (property_id, style_guide_id)
      values (v_property, v_style_guide);
  exception when sqlstate 'P0001' then v_raised := true;
  end;
  if not v_raised then
    raise exception 'INFERRED evidence was promoted into a direct canonical edge';
  end if;

  -- 4c. CO-OCCURRENCE support, at any volume -> still refused.
  insert into core.property_style_guide_source_edge
    (property_id, style_guide_id, licensor_id, source_system, evidence_kind,
     observation_count, confidence)
    values (v_property, v_style_guide, v_licensor, 'zz_fixture_2334', 'co_occurrence',
            100000, 1.0000);
  v_raised := false;
  begin
    insert into core.property_style_guide (property_id, style_guide_id)
      values (v_property, v_style_guide);
  exception when sqlstate 'P0001' then v_raised := true;
  end;
  if not v_raised then
    raise exception 'CO-OCCURRENCE evidence was promoted into a direct canonical edge';
  end if;

  -- 4d. A DIRECT source assertion -> accepted.
  insert into core.property_style_guide_source_edge
    (property_id, style_guide_id, licensor_id, source_system, source_id, evidence_kind)
    values (v_property, v_style_guide, v_licensor, 'zz_fixture_2334', 'sg-1',
            'direct_source_assertion')
    returning id into v_edge;
  insert into core.property_style_guide (property_id, style_guide_id)
    values (v_property, v_style_guide);

  -- 4e. Direct support for a DIFFERENT pair does not sustain this one.
  v_raised := false;
  begin
    insert into core.property_style_guide (property_id, style_guide_id)
      values (v_property2, v_style_guide);
  exception when sqlstate 'P0001' then v_raised := true;
  end;
  if not v_raised then
    raise exception 'a canonical edge borrowed another pair''s direct support';
  end if;

  -- 4f. Evidence cannot lie about itself: the flag is generated, never supplied.
  v_raised := false;
  begin
    execute format(
      'insert into core.property_franchise_source_edge (property_id, franchise_id, licensor_id,'
      ' source_system, evidence_kind, is_direct_source_relationship)'
      ' values (%L, %L, %L, ''zz_fixture_2334'', ''co_occurrence'', true)',
      v_property, v_franchise, v_licensor);
  exception when others then v_raised := true;
  end;
  if not v_raised then
    raise exception 'co-occurrence evidence was allowed to relabel itself as direct';
  end if;

  if (select is_direct_source_relationship
      from core.property_style_guide_source_edge where id = v_edge) is not true then
    raise exception 'a direct source assertion did not generate is_direct_source_relationship';
  end if;

  -- 4g. A direct assertion is not a probability.
  v_raised := false;
  begin
    insert into core.property_franchise_source_edge
      (property_id, franchise_id, licensor_id, source_system, evidence_kind, confidence)
      values (v_property, v_franchise, v_licensor, 'zz_fixture_2334',
              'direct_source_assertion', 0.5000);
  exception when check_violation then v_raised := true;
  end;
  if not v_raised then
    raise exception 'a direct source assertion was allowed to carry a confidence score';
  end if;

  -- 4h. is_current and superseded_at may never disagree.
  v_raised := false;
  begin
    insert into core.property_franchise_source_edge
      (property_id, franchise_id, licensor_id, source_system, evidence_kind, superseded_at)
      values (v_property, v_franchise, v_licensor, 'zz_fixture_2334', 'inferred', now());
  exception when check_violation then v_raised := true;
  end;
  if not v_raised then
    raise exception 'a support edge was both current and superseded';
  end if;

  -- =========================================================================
  -- 5. Fail-closed deletion.
  -- =========================================================================

  -- 5a. Current support cannot be deleted directly.
  v_raised := false;
  begin
    delete from core.property_style_guide_source_edge where id = v_edge;
  exception when sqlstate 'P0001' then v_raised := true;
  end;
  if not v_raised then
    raise exception 'CURRENT support was deleted, silently discarding licensing evidence';
  end if;

  -- 5b. An endpoint cannot be deleted while a canonical edge stands (RESTRICT).
  v_raised := false;
  begin
    delete from core.style_guide where id = v_style_guide;
  exception when foreign_key_violation then v_raised := true;
  end;
  if not v_raised then
    raise exception 'an endpoint was deleted out from under a canonical relationship';
  end if;

  -- 5c. THE CASCADE CASE. dam.asset_character already existed before #2334 and its
  --     endpoints are ON DELETE CASCADE; #2334 must not alter that live table. Deleting
  --     the asset must nevertheless fail closed, because the cascade reaches current
  --     support and the guard aborts the whole transaction.
  insert into dam.asset_character (asset_id, character_id) values (v_asset, v_character);
  insert into dam.asset_character_source_edge
    (asset_id, character_id, licensor_id, source_system, source_id, evidence_kind)
    values (v_asset, v_character, v_licensor, 'zz_fixture_2334', 'ac-1',
            'direct_source_assertion');
  v_raised := false;
  begin
    delete from dam.asset where id = v_asset;
  exception when sqlstate 'P0001' then v_raised := true;
  end;
  if not v_raised then
    raise exception 'deleting an endpoint CASCADED through a pre-existing bridge and erased '
      'current licensing support instead of failing closed';
  end if;

  -- And the evidence really is still there afterwards.
  if not exists (
    select 1 from dam.asset_character_source_edge
    where asset_id = v_asset and character_id = v_character and is_current
  ) then
    raise exception 'current support did not survive the refused endpoint delete';
  end if;

  -- 5d. Review finding H-1, re-pointed at COMMIT by the round-5 finding. Withdrawing
  --     support by UPDATE is the same orphaning as deleting it, so a transaction that
  --     retires the LAST current direct assertion and records NO replacement must fail --
  --     at commit, which is where the end state of the transaction is judged. Without this
  --     the delete guard in 5a is decorative: set is_current = false and the evidence is
  --     gone anyway, leaving core.property_style_guide standing on nothing. SET CONSTRAINTS
  --     ALL IMMEDIATE forces the deferred check to run here rather than at COMMIT.
  v_raised := false;
  begin
    update core.property_style_guide_source_edge
       set is_current = false, superseded_at = now(), superseded_reason = 'fixture withdrawal'
     where id = v_edge;
    set constraints all immediate;
  exception when sqlstate 'P0001' then v_raised := true;
  end;
  if not v_raised then
    raise exception 'a transaction retired the LAST current direct support with no '
      'replacement and was allowed to commit, leaving a canonical edge standing with no '
      'evidence under it';
  end if;

  -- And the withdrawal really did not take effect.
  if not (select is_current from core.property_style_guide_source_edge where id = v_edge) then
    raise exception 'a refused withdrawal still cleared is_current';
  end if;

  -- 5d2. Round-5 review finding (High). THE ORDINARY CASE: exactly ONE upstream system
  --      asserts the pair (Disney DCP alone publishes Disney style guides) and publishes a
  --      corrected claim. The loader must be able to retire the old row and insert the
  --      replacement under the SAME source_system inside ONE transaction. Neither order
  --      works statement-by-statement -- insert first collides with the partial unique claim
  --      key while the old row is still current, retire first has no replacement yet -- so
  --      this can only pass if the invariant is judged on the transaction's END STATE.
  --      SET CONSTRAINTS ALL IMMEDIATE runs the commit-time check without ending the test
  --      transaction; anything it raises escapes this block and fails the test.
  update core.property_style_guide_source_edge
     set is_current = false, superseded_at = now(), superseded_reason = 'fixture same-source'
   where id = v_edge;

  insert into core.property_style_guide_source_edge
    (property_id, style_guide_id, licensor_id, source_system, source_id, evidence_kind)
    values (v_property, v_style_guide, v_licensor, 'zz_fixture_2334', 'sg-1-corrected',
            'direct_source_assertion')
    returning id into v_edge;

  set constraints all immediate;
  set constraints all deferred;

  if not (select is_current from core.property_style_guide_source_edge where id = v_edge) then
    raise exception 'the same-source replacement assertion is not current';
  end if;
  if (select count(*) from core.property_style_guide_source_edge
      where property_id = v_property and style_guide_id = v_style_guide
        and source_system = 'zz_fixture_2334'
        and evidence_kind = 'direct_source_assertion'
        and is_current) <> 1 then
    raise exception 'same-source supersession did not leave exactly one current claim';
  end if;

  -- 5e. Supersession BY REPLACEMENT stays legal, which is the whole point of supersession:
  --     a second source's current direct assertion keeps the canonical edge supported, so
  --     the first may then be superseded and deleted.
  insert into core.property_style_guide_source_edge
    (property_id, style_guide_id, licensor_id, source_system, source_id, evidence_kind)
    values (v_property, v_style_guide, v_licensor, 'zz_fixture_2334_replacement', 'psg-2',
            'direct_source_assertion')
    returning id into v_edge2;

  -- 5f. Superseded support does NOT block: only CURRENT support does.
  update core.property_style_guide_source_edge
     set is_current = false, superseded_at = now(), superseded_reason = 'fixture supersession'
   where id = v_edge;
  delete from core.property_style_guide_source_edge where id = v_edge;
  if exists (select 1 from core.property_style_guide_source_edge where id = v_edge) then
    raise exception 'superseded support could not be deleted';
  end if;

  -- 5f2. Round-2 review finding (High). A BEFORE UPDATE ROW guard cannot see its own
  --      statement's already-applied updates to other rows, so ONE statement that withdraws
  --      EVERY current direct assertion for the pair would pass row by row and commit an
  --      orphaned canonical edge. The deferrable constraint trigger judges the end state at
  --      commit, where the whole transaction is visible, so the bulk shape is refused too.
  --      SET CONSTRAINTS ALL IMMEDIATE forces that commit-time check to run here.
  insert into core.property_style_guide_source_edge
    (property_id, style_guide_id, licensor_id, source_system, source_id, evidence_kind)
    values (v_property, v_style_guide, v_licensor, 'zz_fixture_2334_bulk', 'psg-3',
            'direct_source_assertion');

  v_raised := false;
  begin
    update core.property_style_guide_source_edge
       set is_current = false, superseded_at = now(), superseded_reason = 'fixture bulk'
     where property_id = v_property
       and style_guide_id = v_style_guide
       and is_current
       and evidence_kind = 'direct_source_assertion';
    set constraints all immediate;
  exception when sqlstate 'P0001' then v_raised := true;
  end;
  if not v_raised then
    raise exception 'one bulk statement withdrew every current direct assertion for a cited '
      'pair, leaving the canonical edge standing with no evidence under it';
  end if;

  -- The refused bulk withdrawal left the evidence in place.
  if not exists (
    select 1 from core.property_style_guide_source_edge
    where property_id = v_property and style_guide_id = v_style_guide
      and is_current and evidence_kind = 'direct_source_assertion'
  ) then
    raise exception 'a refused bulk withdrawal still removed the current direct support';
  end if;

  -- 5g. Review finding M-1. TRUNCATE never fires a row-level DELETE trigger, so a
  --     truncate-and-reload loader would erase every current claim straight past the guard
  --     proved in 5a. No role may hold it on a support-edge table.
  foreach v_table in array array[
    'core.property_character_source_edge',
    'core.property_franchise_source_edge',
    'core.property_style_guide_source_edge',
    'core.style_guide_character_source_edge',
    'dam.asset_character_source_edge',
    'dam.asset_franchise_source_edge',
    'dam.asset_property_source_edge',
    'dam.asset_style_guide_source_edge'
  ] loop
    if has_table_privilege('service_role', v_table, 'TRUNCATE') then
      raise exception 'service_role may TRUNCATE %, which bypasses the fail-closed delete guard',
        v_table;
    end if;
    if has_table_privilege('authenticated', v_table, 'TRUNCATE')
       or has_table_privilege('anon', v_table, 'TRUNCATE') then
      raise exception 'a client role may TRUNCATE %', v_table;
    end if;
  end loop;

  -- =========================================================================
  -- 6. Round-3 review findings, exercised against real rows.
  -- =========================================================================

  -- 6a. An UPDATE that REPOINTS a canonical bridge row is a write of a new pair, and it is
  --     held to the same evidence standard as an INSERT. Without this the guard is an
  --     insert-only formality: state a supported pair once, then repoint it anywhere.
  --     (v_property2 has no direct support for v_style_guide -- proved at 4e.)
  v_raised := false;
  begin
    update core.property_style_guide
       set property_id = v_property2
     where property_id = v_property and style_guide_id = v_style_guide;
  exception when sqlstate 'P0001' then v_raised := true;
  end;
  if not v_raised then
    raise exception 'a canonical bridge row was REPOINTED onto a pair with no direct source '
      'assertion behind it';
  end if;

  -- The refused repoint left the original edge exactly where it was.
  if not exists (
    select 1 from core.property_style_guide
    where property_id = v_property and style_guide_id = v_style_guide
  ) then
    raise exception 'a refused repoint still moved the canonical edge';
  end if;
  if exists (
    select 1 from core.property_style_guide
    where property_id = v_property2 and style_guide_id = v_style_guide
  ) then
    raise exception 'a refused repoint still created the unsupported pair';
  end if;

  -- And a repoint onto a pair that IS directly supported succeeds, so the guard is
  -- discriminating rather than simply refusing every update.
  insert into core.property_style_guide_source_edge
    (property_id, style_guide_id, licensor_id, source_system, source_id, evidence_kind)
    values (v_property2, v_style_guide, v_licensor, 'zz_fixture_2334_repoint', 'psg-4',
            'direct_source_assertion');
  update core.property_style_guide
     set property_id = v_property2
   where property_id = v_property and style_guide_id = v_style_guide;
  if not exists (
    select 1 from core.property_style_guide
    where property_id = v_property2 and style_guide_id = v_style_guide
  ) then
    raise exception 'a repoint onto a directly supported pair was refused';
  end if;

  -- 6b. Round-3 review finding. licensor_id is NOT NULL and in the identity key, which
  --     separates identical source ids across licensors -- but nothing tied it to the
  --     endpoints the row is about, so a loader could file one licensor's pair under
  --     another licensor's id and no constraint would object. That is a royalty
  --     misattribution, not a cosmetic one.
  insert into plm.licensing_write_authorization
    (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
     actor, protected_columns, expires_at)
  values (pg_backend_pid(), txid_current(), 'core.licensor', 'scrape_consolidation',
          gen_random_uuid(), repeat('4', 64), 'issue-2334-contract',
          array['name','code','status'], clock_timestamp() + interval '1 minute');
  insert into core.licensor (name, code, status)
    values ('ZZ Fixture Licensor 2334 B', 'ZZ2334B', 'active')
    returning id into v_licensor2;

  insert into plm.licensing_write_authorization
    (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
     actor, protected_columns, expires_at)
  values (pg_backend_pid(), txid_current(), 'core.property', 'licensing_review_create',
          gen_random_uuid(), repeat('5', 64), 'issue-2334-contract',
          array['licensor_id','name','code','status'], clock_timestamp() + interval '1 minute');
  insert into core.property (licensor_id, name, code, status)
    values (v_licensor2, 'ZZ Fixture Property 2334 C', 'ZZP2334C', 'potential')
    returning id into v_property3;

  insert into core.style_guide (licensor_id, property_id, name)
    values (v_licensor2, v_property3, 'ZZ Fixture Style Guide 2334 B')
    returning id into v_style_guide2;

  -- The LEFT endpoint belongs to licensor B, so filing the claim under licensor A is refused.
  v_raised := false;
  begin
    insert into core.property_style_guide_source_edge
      (property_id, style_guide_id, licensor_id, source_system, source_id, evidence_kind)
      values (v_property3, v_style_guide, v_licensor, 'zz_fixture_2334_cross', 'x-1',
              'direct_source_assertion');
  exception when sqlstate 'P0001' then v_raised := true;
  end;
  if not v_raised then
    raise exception 'one licensor''s property was filed as a relationship under ANOTHER '
      'licensor''s id, which misattributes royalties';
  end if;

  -- The RIGHT endpoint is checked too: property belongs to B, style guide to A, so neither
  -- licensor id can carry the pair.
  v_raised := false;
  begin
    insert into core.property_style_guide_source_edge
      (property_id, style_guide_id, licensor_id, source_system, source_id, evidence_kind)
      values (v_property3, v_style_guide, v_licensor2, 'zz_fixture_2334_cross', 'x-2',
              'direct_source_assertion');
  exception when sqlstate 'P0001' then v_raised := true;
  end;
  if not v_raised then
    raise exception 'only the left endpoint''s licensor is checked; a cross-licensor pair was '
      'accepted on the right endpoint';
  end if;

  -- An UPDATE cannot smuggle in what the INSERT refused.
  v_raised := false;
  begin
    update core.property_style_guide_source_edge
       set licensor_id = v_licensor2
     where property_id = v_property and style_guide_id = v_style_guide;
  exception when sqlstate 'P0001' then v_raised := true;
  end;
  if not v_raised then
    raise exception 'a support row was RELABELLED to another licensor by UPDATE, past the '
      'guard the INSERT path enforces';
  end if;

  -- The legitimate second-licensor case still works, and -- the reason licensor_id is in the
  -- identity key at all -- the SAME source id under a different licensor is a different
  -- claim, not a collision.
  insert into core.property_style_guide_source_edge
    (property_id, style_guide_id, licensor_id, source_system, source_id, evidence_kind)
    values (v_property, v_style_guide, v_licensor, 'zz_fixture_2334', 'sg-1',
            'direct_source_assertion');
  insert into core.property_style_guide_source_edge
    (property_id, style_guide_id, licensor_id, source_system, source_id, evidence_kind)
    values (v_property3, v_style_guide2, v_licensor2, 'zz_fixture_2334', 'sg-1',
            'direct_source_assertion');
  if (select count(*) from core.property_style_guide_source_edge
      where source_system = 'zz_fixture_2334' and source_id = 'sg-1' and is_current) <> 2 then
    raise exception 'the identity key stopped separating one source id across two licensors';
  end if;

  -- 6c. Round-4 review finding. Every case above writes as the migration owner, which can
  --     read every table in the database. The role that actually loads DAM support edges in
  --     production is service_role: it is granted ALL on the dam *_source_edge tables, but it
  --     holds no SELECT on dam.asset or on the pre-existing dam.asset_character bridge -- the
  --     schema-wide read grants cover core, not dam. The guards read both. An invoker-rights
  --     guard would therefore refuse the ordinary loader path with 'permission denied for
  --     table asset', which is a guard that fails on legitimate work rather than on a bad
  --     write. The guards are SECURITY DEFINER (asserted structurally at 1b); this exercises
  --     that decision against real rows, as the real role.
  --
  --     Note what a regression looks like here: v_sqlstate is reported, so a 42501 permission
  --     failure can never be mistaken for the P0001 refusal the guard is supposed to raise.

  -- A legitimate DAM support-edge write as service_role. dam.asset carries no licensor here
  -- (unattributed, which the guard allows) and core.character belongs to licensor A, so the
  -- guard must read both endpoint tables and then accept.
  begin
    execute 'set local role service_role';
    insert into dam.asset_character_source_edge
      (asset_id, character_id, licensor_id, source_system, source_id, evidence_kind)
      values (v_asset, v_character, v_licensor, 'zz_fixture_2334_svc', 'svc-1',
              'direct_source_assertion')
      returning id into v_edge2;
    execute 'set local role none';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
    execute 'set local role none';
    raise exception 'service_role could not make a LEGITIMATE dam support-edge write: % (%). '
      'The endpoint-licensor guard reads dam.asset, which service_role may not select; the '
      'guard must be SECURITY DEFINER or the ordinary DAM loader path is broken',
      v_message, v_sqlstate;
  end;

  if v_edge2 is null then
    raise exception 'the service_role dam support-edge write recorded no row';
  end if;

  -- And the guard still REFUSES a cross-licensor claim when it runs as service_role: the
  -- character belongs to licensor A, so filing the pair under licensor B must raise P0001 --
  -- not a permission error, and not nothing at all.
  v_raised := false;
  v_sqlstate := null;
  begin
    execute 'set local role service_role';
    insert into dam.asset_character_source_edge
      (asset_id, character_id, licensor_id, source_system, source_id, evidence_kind)
      values (v_asset, v_character, v_licensor2, 'zz_fixture_2334_svc', 'svc-2',
              'direct_source_assertion');
    execute 'set local role none';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
    execute 'set local role none';
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'as service_role, a cross-licensor dam support edge was ACCEPTED -- the '
      'endpoint-licensor guard did not run on the real loader path';
  end if;
  if v_sqlstate <> 'P0001' then
    raise exception 'as service_role, the cross-licensor write failed with % (%) instead of '
      'the guard''s own P0001 refusal -- the guard is failing on privilege, not on the claim',
      v_sqlstate, v_message;
  end if;

  -- The supersession guard reads the pre-existing dam.asset_character bridge, which
  -- service_role also may not select. Superseding this edge is legitimate (no canonical edge
  -- depends on it alone), so it must succeed rather than fail on privilege.
  begin
    execute 'set local role service_role';
    update dam.asset_character_source_edge
       set is_current = false, superseded_at = now(), superseded_reason = 'service_role fixture'
     where id = v_edge2;
    execute 'set local role none';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
    execute 'set local role none';
    raise exception 'service_role could not supersede its own dam support edge: % (%). The '
      'supersession guard reads dam.asset_character, which service_role may not select',
      v_message, v_sqlstate;
  end;

  if (select is_current from dam.asset_character_source_edge where id = v_edge2) then
    raise exception 'the service_role supersession did not take effect';
  end if;

  -- 6d. Round-6 review finding (High). Endpoint re-licensing is a routine, permitted event:
  --     an endpoint entity may move to another licensor long after a support row recorded
  --     what a source once asserted. The endpoint-licensor guard re-derives both endpoints'
  --     CURRENT licensors, so an UNSCOPED version of it freezes every historical support row
  --     the moment an endpoint moves -- the documented withdrawal path included. A frozen
  --     row can never record its own supersession, so a stale direct assertion stays current
  --     forever and keeps its canonical bridge alive; where the two endpoints end up under
  --     different licensors, no value of licensor_id satisfies the guard at all, and the only
  --     escape is rewriting licensor_id on a historical row -- falsifying the very
  --     attribution the guard exists to protect. The guard is therefore scoped to writes that
  --     actually SET an endpoint or licensor_id, exactly as
  --     core.guard_taxonomy_source_ref_identity() scopes its own rules.

  -- A support row recorded while both endpoints agree with the claim's licensor (B).
  insert into core.property_style_guide_source_edge
    (property_id, style_guide_id, licensor_id, source_system, source_id, evidence_kind)
    values (v_property3, v_style_guide2, v_licensor2, 'zz_fixture_2334_relicense', 'rl-1',
            'direct_source_assertion')
    returning id into v_edge3;

  -- The style-guide endpoint is re-licensed to licensor A. The historical support row is
  -- untouched and now disagrees with its right endpoint -- which is the true history, not
  -- an error to be edited away.
  update core.style_guide set licensor_id = v_licensor where id = v_style_guide2;

  -- (a) Withdrawal STILL WORKS after re-licensing. This is the whole point: a write that
  --     leaves both endpoint references and licensor_id alone is not a filing decision.
  begin
    update core.property_style_guide_source_edge
       set is_current = false, superseded_at = now(),
           superseded_reason = 'withdrawn after endpoint re-licensing'
     where id = v_edge3;
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
    raise exception 'a support row could not be WITHDRAWN after its endpoint was re-licensed: '
      '% (%). The endpoint-licensor guard is unscoped, so re-licensing permanently freezes '
      'every historical support row -- withdrawal, supersession and metadata corrections all',
      v_message, v_sqlstate;
  end;

  if (select is_current from core.property_style_guide_source_edge where id = v_edge3) then
    raise exception 'the post-re-licensing withdrawal did not take effect';
  end if;

  -- A metadata-only correction is likewise not a filing decision and must still be possible.
  begin
    update core.property_style_guide_source_edge
       set superseded_reason = 'withdrawn after endpoint re-licensing (corrected)'
     where id = v_edge3;
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
    raise exception 'a metadata-only correction on a support row was refused after endpoint '
      're-licensing: % (%)', v_message, v_sqlstate;
  end;

  -- (b) An UPDATE that actually CHANGES a governed column into disagreement is still
  --     refused. Scoping the guard must not turn it into an insert-only formality: after
  --     re-licensing, the style guide belongs to A and the property to B, so relabelling
  --     the claim to A still contradicts the left endpoint.
  v_raised := false;
  v_sqlstate := null;
  begin
    update core.property_style_guide_source_edge
       set licensor_id = v_licensor
     where id = v_edge3;
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'scoping the endpoint-licensor guard let an UPDATE RELABEL a support row '
      'into disagreement with its endpoints -- the guard now only runs on INSERT';
  end if;
  if v_sqlstate <> 'P0001' then
    raise exception 'the governed-column UPDATE failed with % (%) instead of the guard''s own '
      'P0001 refusal', v_sqlstate, v_message;
  end if;

  -- The refused relabel left the historical attribution exactly as recorded.
  if (select licensor_id from core.property_style_guide_source_edge where id = v_edge3)
     <> v_licensor2 then
    raise exception 'a refused relabel still rewrote licensor_id on a historical support row';
  end if;

  -- Repointing an ENDPOINT reference into disagreement is governed too, not just licensor_id.
  v_raised := false;
  begin
    update core.property_style_guide_source_edge
       set property_id = v_property
     where id = v_edge3;
  exception when sqlstate 'P0001' then v_raised := true;
  end;
  if not v_raised then
    raise exception 'a support row was REPOINTED onto an endpoint belonging to another '
      'licensor, past the scoped endpoint-licensor guard';
  end if;

  -- (c) INSERT-time disagreement is still refused after the re-licensing. Nothing about
  --     scoping the UPDATE path relaxes the filing decision an INSERT always is.
  v_raised := false;
  v_sqlstate := null;
  begin
    insert into core.property_style_guide_source_edge
      (property_id, style_guide_id, licensor_id, source_system, source_id, evidence_kind)
      values (v_property3, v_style_guide2, v_licensor2, 'zz_fixture_2334_relicense', 'rl-2',
              'direct_source_assertion');
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'after its endpoint was re-licensed, a NEW support row was accepted under '
      'the old licensor -- the endpoint-licensor guard no longer runs on INSERT';
  end if;
  if v_sqlstate <> 'P0001' then
    raise exception 'the post-re-licensing INSERT failed with % (%) instead of the guard''s own '
      'P0001 refusal', v_sqlstate, v_message;
  end if;

  raise notice 'issue #2334 canonical licensing relationship contracts: all assertions passed';
end
$contracts$;

rollback;
