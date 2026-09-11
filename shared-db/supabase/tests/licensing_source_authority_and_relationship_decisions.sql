-- Issue #2335 contract: licensing source authority and relationship decisions.
--
-- This file asserts BEHAVIOUR, not "the migration applied". Every claim #2335 makes is
-- exercised against real rows and rolled back:
--   * plm.source_resolution now resolves six entity kinds, and licensor and franchise
--     decisions really land through the audited setter against real canonical targets;
--   * the four pre-existing kinds are UNCHANGED, and no kind can smuggle another kind's
--     target column;
--   * the frozen ten-argument setter still resolves for every historical call shape --
--     the twelve-argument overload does not shadow it and no call is ambiguous;
--   * that frozen setter refuses the two new kinds, which is why the overload exists;
--   * the new setter still enforces every rule the old one did: authenticated actor,
--     validated target, optimistic token, identical-repeat short circuit;
--   * anon gains nothing, and both new setters are pinned SECURITY DEFINER;
--   * six-kind helper behavior and authenticated reads preserve existing and dangling
--     targets, while anonymous calls and reads are denied at runtime;
--   * plm.licensing_source_scope makes authority explicit per licensor, per purpose and
--     per axis, and refuses every incoherent combination;
--   * plm.licensing_relationship_resolution records pair decisions, PRESERVES ambiguity
--     with a stated reason, and can never promote inferred evidence to a matched pair;
--   * and, in both new tables, two licensors using the SAME source ids coexist while a
--     genuine duplicate is refused -- the cross-licensor collision that makes a bare
--     source-id key a royalty error.

begin;

do $contracts$
declare
  v_licensor_a uuid;
  v_licensor_b uuid;
  v_property uuid;
  v_character uuid;
  v_style_guide uuid;
  v_franchise uuid;
  v_asset uuid;
  v_targets uuid[];
  v_args uuid[];
  v_kind text;
  v_index integer;
  v_missing uuid := gen_random_uuid();
  v_row plm.source_resolution%rowtype;
  v_row2 plm.source_resolution%rowtype;
  v_sqlstate text;
  v_count integer;
  v_bool boolean;
  t text;
begin
  -- ---------------------------------------------------------------------------------
  -- Shape: both new tables exist and are EMPTY. #2335 authorizes no rows, so a populated
  -- table here means data reached a public repository or an unauthorized load ran.
  -- ---------------------------------------------------------------------------------
  foreach t in array array['plm.licensing_source_scope',
                           'plm.licensing_relationship_resolution']
  loop
    if to_regclass(t) is null then
      raise exception 'CONTRACT: % does not exist', t;
    end if;
    execute format('select count(*) from %s', t) into v_count;
    if v_count <> 0 then
      raise exception 'CONTRACT: % must ship empty, found % row(s)', t, v_count;
    end if;
  end loop;

  -- Fail closed: no client role may write either table until a governed setter exists.
  foreach t in array array['plm.licensing_source_scope',
                           'plm.licensing_relationship_resolution']
  loop
    if has_table_privilege('authenticated', to_regclass(t), 'insert')
       or has_table_privilege('service_role', to_regclass(t), 'insert')
       or has_table_privilege('authenticated', to_regclass(t), 'update')
       or has_table_privilege('service_role', to_regclass(t), 'delete') then
      raise exception 'CONTRACT: % must have no write grant for any client role', t;
    end if;
    if not has_table_privilege('authenticated', to_regclass(t), 'select') then
      raise exception 'CONTRACT: authenticated must be able to read %', t;
    end if;
    if has_table_privilege('anon', to_regclass(t), 'select') then
      raise exception 'CONTRACT: anon must not be able to read %', t;
    end if;
  end loop;

  -- ---------------------------------------------------------------------------------
  -- Fixtures. core.licensor and core.property carry the exact-column transaction-bound
  -- licensing write guard (20260817124545); the fixtures use the real guard rather than
  -- working around it.
  -- ---------------------------------------------------------------------------------
  insert into plm.licensing_write_authorization
    (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
     actor, protected_columns, expires_at)
  values
    (pg_backend_pid(), txid_current(), 'core.licensor', 'scrape_consolidation',
     gen_random_uuid(), repeat('1', 64), 'issue-2335-contract',
     array['name','code','status'], clock_timestamp() + interval '1 minute'),
    (pg_backend_pid(), txid_current(), 'core.licensor', 'scrape_consolidation',
     gen_random_uuid(), repeat('2', 64), 'issue-2335-contract',
     array['name','code','status'], clock_timestamp() + interval '1 minute');
  insert into core.licensor (name, code, status)
    values ('ZZ Fixture Licensor 2335 A', 'ZZ2335A', 'active')
    returning id into v_licensor_a;
  insert into core.licensor (name, code, status)
    values ('ZZ Fixture Licensor 2335 B', 'ZZ2335B', 'active')
    returning id into v_licensor_b;

  insert into plm.licensing_write_authorization
    (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
     actor, protected_columns, expires_at)
  values
    (pg_backend_pid(), txid_current(), 'core.property', 'licensing_review_create',
     gen_random_uuid(), repeat('3', 64), 'issue-2335-contract',
     array['licensor_id','name','code','status'], clock_timestamp() + interval '1 minute');
  insert into core.property (licensor_id, name, code, status)
    values (v_licensor_a, 'ZZ Fixture Property 2335', 'ZZP2335', 'potential')
    returning id into v_property;
  insert into core.character (licensor_id, name)
    values (v_licensor_a, 'ZZ Fixture Character 2335') returning id into v_character;
  insert into core.style_guide (licensor_id, property_id, name)
    values (v_licensor_a, v_property, 'ZZ Fixture Style Guide 2335')
    returning id into v_style_guide;
  insert into core.franchise (licensor_id, name, source_system, source_id)
    values (v_licensor_a, 'ZZ Fixture Franchise 2335', 'paramount', 'zz2335')
    returning id into v_franchise;

  -- Exercise the seven-argument read helper with real targets and role changes.
  insert into dam.asset (title, source_system, source_id)
    values ('ZZ Fixture Asset 2493', 'paramount', 'zz2493-runtime') returning id into v_asset;
  v_targets := array[v_property,v_character,v_style_guide,v_asset,v_licensor_a,v_franchise];
  set local role authenticated;
  for v_index in 1..6 loop
    v_kind := (array['property','character','style_guide','asset','licensor','franchise'])[v_index];
    v_args := array[null::uuid,null,null,null,null,null];
    v_args[v_index] := v_targets[v_index];
    if plm.source_resolution_target_missing(v_kind,v_args[1],v_args[2],v_args[3],v_args[4],v_args[5],v_args[6]) is not false then
      raise exception 'CONTRACT: authenticated helper reports existing % target missing',v_kind;
    end if;
    v_args[v_index] := v_missing;
    if plm.source_resolution_target_missing(v_kind,v_args[1],v_args[2],v_args[3],v_args[4],v_args[5],v_args[6]) is not true then
      raise exception 'CONTRACT: helper reports missing % target present',v_kind;
    end if;
    v_args[v_index] := null;
    if plm.source_resolution_target_missing(v_kind,v_args[1],v_args[2],v_args[3],v_args[4],v_args[5],v_args[6]) is not true then
      raise exception 'CONTRACT: helper reports null % target present',v_kind;
    end if;
  end loop;
  if plm.source_resolution_target_missing('unknown',v_property,v_character,v_style_guide,v_asset,v_licensor_a,v_franchise) is not true
     or plm.source_resolution_target_missing(null,v_property,v_character,v_style_guide,v_asset,v_licensor_a,v_franchise) is not true then
    raise exception 'CONTRACT: unknown/null entity kind was treated as a valid target';
  end if;
  reset role;
  set local role anon;
  begin
    perform plm.source_resolution_target_missing('licensor',null,null,null,null,v_licensor_a,null);
    raise exception 'CONTRACT: anon executed the seven-argument helper';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from api.source_resolution limit 1;
    raise exception 'CONTRACT: anon read source resolutions';
  exception when insufficient_privilege then null; end;
  reset role;

  -- ---------------------------------------------------------------------------------
  -- 1. THE TWO OVERLOADS COEXIST AND NO CALL IS AMBIGUOUS.
  --    If the frozen ten-argument routine were replaced, or if the new one had default
  --    arguments, one of these two lookups would be null or every legacy call would fail
  --    with 42725.
  -- ---------------------------------------------------------------------------------
  if to_regprocedure('plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamptz)') is null then
    raise exception 'CONTRACT: the frozen ten-argument plm.set_source_resolution is gone; '
      'the production catalog contract pins that exact signature';
  end if;
  if to_regprocedure('plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamptz,uuid,uuid)') is null then
    raise exception 'CONTRACT: the twelve-argument plm.set_source_resolution overload is missing';
  end if;
  if to_regprocedure('api.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamptz,uuid,uuid)') is null then
    raise exception 'CONTRACT: the twelve-argument api.set_source_resolution overload is missing';
  end if;

  select count(*) into v_count
    from pg_catalog.pg_proc p
   where p.oid in (
     to_regprocedure('plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamptz,uuid,uuid)'),
     to_regprocedure('api.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamptz,uuid,uuid)'))
     and p.pronargdefaults = 0;
  if v_count <> 2 then
    raise exception 'CONTRACT: the twelve-argument setters must declare NO default arguments, '
      'or a ten-argument call becomes ambiguous (found % of 2 clean)', v_count;
  end if;

  -- A historical four-argument call still resolves, unambiguously, to the old routine.
  begin
    v_row := plm.set_source_resolution('paramount', 'property', 'zz-legacy-4', 'unresolved');
  exception when others then
    raise exception 'CONTRACT: a legacy four-argument call no longer resolves (% / %)',
      sqlstate, sqlerrm;
  end;
  -- And so does the full historical ten-argument call.
  begin
    v_row := plm.set_source_resolution('paramount', 'property', 'zz-legacy-10', 'matched',
      v_property, null, null, null, 'legacy shape still resolves', null);
  exception when others then
    raise exception 'CONTRACT: a legacy ten-argument call no longer resolves (% / %)',
      sqlstate, sqlerrm;
  end;
  if v_row.core_property_id is distinct from v_property then
    raise exception 'CONTRACT: the legacy ten-argument call did not record its property target';
  end if;

  -- The frozen routine cannot serve the new kinds. This is the whole reason the overload
  -- exists, so it is asserted rather than assumed.
  begin
    v_row := plm.set_source_resolution('paramount', 'licensor', 'zz-old-licensor', 'matched',
      null, null, null, null, 'old routine has no licensor branch', null);
    raise exception 'CONTRACT: the frozen ten-argument setter accepted entity_kind licensor';
  exception
    when sqlstate '23503' then null;
    when sqlstate '23514' then null;
  end;

  -- ---------------------------------------------------------------------------------
  -- 2. LICENSOR AND FRANCHISE DECISIONS REALLY LAND, THROUGH THE AUDITED SETTER.
  -- ---------------------------------------------------------------------------------
  v_row := plm.set_source_resolution('paramount', 'licensor', 'zz-lic-1', 'matched',
    null, null, null, null, 'contract: licensor decision', null, v_licensor_a, null);
  if v_row.core_licensor_id is distinct from v_licensor_a
     or v_row.resolution_status <> 'matched' then
    raise exception 'CONTRACT: a matched licensor decision did not record core_licensor_id';
  end if;
  if v_row.resolved_by is null or btrim(v_row.resolved_by) = '' then
    raise exception 'CONTRACT: the setter recorded no actor on a licensor decision';
  end if;

  v_row2 := plm.set_source_resolution('paramount', 'franchise', 'zz-fr-1', 'matched',
    null, null, null, null, 'contract: franchise decision', null, null, v_franchise);
  if v_row2.core_franchise_id is distinct from v_franchise then
    raise exception 'CONTRACT: a matched franchise decision did not record core_franchise_id';
  end if;

  -- The four pre-existing kinds still work through the new overload, unchanged.
  v_row2 := plm.set_source_resolution('paramount', 'character', 'zz-ch-1', 'matched',
    null, v_character, null, null, 'contract: character still works', null, null, null);
  if v_row2.core_character_id is distinct from v_character then
    raise exception 'CONTRACT: the twelve-argument overload broke the character kind';
  end if;
  v_row2 := plm.set_source_resolution('paramount', 'style_guide', 'zz-sg-1', 'matched',
    null, null, v_style_guide, null, 'contract: style guide still works', null, null, null);
  if v_row2.core_style_guide_id is distinct from v_style_guide then
    raise exception 'CONTRACT: the twelve-argument overload broke the style_guide kind';
  end if;

  -- ---------------------------------------------------------------------------------
  -- 3. REFUSAL PATHS ON THE WIDENED TABLE.
  -- ---------------------------------------------------------------------------------
  -- An off-vocabulary kind is still refused.
  begin
    insert into plm.source_resolution (source_system, entity_kind, source_id, resolution_status)
      values ('paramount', 'distributor', 'zz-bad-kind', 'unresolved');
    raise exception 'CONTRACT: an off-vocabulary entity_kind was accepted';
  exception when check_violation then null;
  end;

  -- A licensor decision may not carry a property target, and vice versa. Every UUID
  -- column has the same type, so without this check a swapped target would type check
  -- and attribute one licensor's decision to an unrelated property.
  begin
    insert into plm.source_resolution
      (source_system, entity_kind, source_id, resolution_status, core_property_id)
      values ('paramount', 'licensor', 'zz-smuggle-1', 'matched', v_property);
    raise exception 'CONTRACT: a licensor decision was allowed to carry a property target';
  exception when check_violation then null;
  end;
  begin
    insert into plm.source_resolution
      (source_system, entity_kind, source_id, resolution_status, core_franchise_id)
      values ('paramount', 'property', 'zz-smuggle-2', 'matched', v_franchise);
    raise exception 'CONTRACT: a property decision was allowed to carry a franchise target';
  exception when check_violation then null;
  end;

  -- Matched means exactly one target, and only matched may carry one.
  begin
    insert into plm.source_resolution (source_system, entity_kind, source_id, resolution_status)
      values ('paramount', 'licensor', 'zz-empty-match', 'matched');
    raise exception 'CONTRACT: a matched licensor row with no target was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into plm.source_resolution
      (source_system, entity_kind, source_id, resolution_status, core_franchise_id)
      values ('paramount', 'franchise', 'zz-unresolved-target', 'unresolved', v_franchise);
    raise exception 'CONTRACT: an unresolved franchise row was allowed to carry a target';
  exception when check_violation then null;
  end;

  -- A matched decision must point at a target that exists.
  begin
    v_row2 := plm.set_source_resolution('paramount', 'franchise', 'zz-ghost', 'matched',
      null, null, null, null, 'no such franchise', null, null,
      '00000000-0000-4000-8000-000000000000'::uuid);
    raise exception 'CONTRACT: the setter matched a franchise that does not exist';
  exception when sqlstate '23503' then null;
  end;

  -- Optimistic concurrency still applies to the new kinds: replacing a decision requires
  -- having read the one being replaced.
  begin
    v_row2 := plm.set_source_resolution('paramount', 'licensor', 'zz-lic-1', 'rejected',
      null, null, null, null, 'blind overwrite', null, null, null);
    raise exception 'CONTRACT: a licensor decision was overwritten without its token';
  exception when sqlstate '40001' then null;
  end;

  -- An identical repeat is not a change: it must not rewrite the audit stamp, so a
  -- retried request cannot silently consume the caller's token.
  v_row2 := plm.set_source_resolution('paramount', 'licensor', 'zz-lic-1', 'matched',
    null, null, null, null, 'contract: licensor decision', null, v_licensor_a, null);
  if v_row2.updated_at is distinct from v_row.updated_at then
    raise exception 'CONTRACT: an identical repeat rewrote the licensor decision audit stamp';
  end if;

  -- The api wrapper delegates, adds nothing, and is reachable by no anonymous caller.
  v_row2 := api.set_source_resolution('paramount', 'franchise', 'zz-fr-2', 'no_match',
    null, null, null, null, 'contract: api delegation', null, null, null);
  if v_row2.resolution_status <> 'no_match' then
    raise exception 'CONTRACT: api.set_source_resolution did not delegate';
  end if;
  foreach t in array array[
    'plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamptz,uuid,uuid)',
    'api.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamptz,uuid,uuid)']
  loop
    if has_function_privilege('anon', to_regprocedure(t), 'execute') then
      raise exception 'CONTRACT: anon can execute %', t;
    end if;
    select count(*) into v_count from pg_catalog.pg_proc p
     where p.oid = to_regprocedure(t)
       and p.prosecdef
       and p.proconfig @> array['search_path=pg_catalog'];
    if v_count <> 1 then
      raise exception 'CONTRACT: % must be SECURITY DEFINER with a pinned search_path', t;
    end if;
  end loop;

  -- ---------------------------------------------------------------------------------
  -- 4. THE READ PATH HAS PARITY WITH THE SIX-KIND WRITE PATH.
  --    Issue #2493 widens target_missing and the view, so existing licensor and franchise
  --    targets read as sound while a dangling durable target remains visible as missing.
  -- ---------------------------------------------------------------------------------
  select target_missing into v_bool from api.source_resolution
   where source_system = 'paramount' and entity_kind = 'licensor' and source_id = 'zz-lic-1';
  if v_bool is not false then
    raise exception 'CONTRACT: api.source_resolution reports an existing licensor target missing';
  end if;

  select target_missing into v_bool from api.source_resolution
   where source_system = 'paramount' and entity_kind = 'franchise' and source_id = 'zz-fr-1';
  if v_bool is not false then
    raise exception 'CONTRACT: api.source_resolution reports an existing franchise target missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'api' and table_name = 'source_resolution'
       and column_name in ('core_licensor_id', 'core_franchise_id')
     group by table_schema, table_name
    having count(*) = 2
  ) then
    raise exception 'CONTRACT: api.source_resolution does not expose both new target columns';
  end if;

  insert into plm.source_resolution
    (source_system, entity_kind, source_id, resolution_status, core_licensor_id,
     resolution_reason, resolved_at, resolved_by)
  values
    ('paramount', 'licensor', 'zz-dangling-licensor', 'matched',
     '00000000-0000-4000-8000-000000000001'::uuid,
     'contract: preserved dangling decision', clock_timestamp(), 'issue-2493-contract');
  set local role authenticated;
  select target_missing into v_bool from api.source_resolution
   where source_system = 'paramount' and entity_kind = 'licensor'
     and source_id = 'zz-dangling-licensor';
  if v_bool is not true then
    raise exception 'CONTRACT: api.source_resolution hid a dangling licensor target';
  end if;

  if not exists (select 1 from api.source_resolution where source_id='zz-lic-1' and entity_kind='licensor' and core_licensor_id=v_licensor_a and target_missing is false)
     or not exists (select 1 from api.source_resolution where source_id='zz-fr-1' and entity_kind='franchise' and core_franchise_id=v_franchise and target_missing is false) then
    raise exception 'CONTRACT: authenticated new-kind read parity failed';
  end if;
  reset role;

  -- ---------------------------------------------------------------------------------
  -- 5. plm.licensing_source_scope -- authority made explicit.
  -- ---------------------------------------------------------------------------------
  insert into plm.licensing_source_scope
    (licensor_id, source_system, source_purpose, scope_axis, permitted_kind,
     authorized_at, authorized_by, authorization_note)
  values (v_licensor_a, 'paramount', 'canonical_identity', 'entity', 'property',
          clock_timestamp(), 'issue-2335-contract', 'contract fixture');

  -- THE COLLISION CASE. Two licensors, the SAME source system and the same permitted
  -- kind. Both rows must exist: a bare (source_system, permitted_kind) key would let
  -- licensor A's grant answer licensor B's question, which is a royalty error.
  begin
    insert into plm.licensing_source_scope
      (licensor_id, source_system, source_purpose, scope_axis, permitted_kind)
    values (v_licensor_b, 'paramount', 'canonical_identity', 'entity', 'property');
  exception when others then
    raise exception 'CONTRACT: licensing_source_scope refused the same source scope under a '
      'different licensor (%). licensor_id must be part of the identity key.', sqlerrm;
  end;
  select count(*) into v_count from plm.licensing_source_scope
   where source_system = 'paramount' and permitted_kind = 'property';
  if v_count <> 2 then
    raise exception 'CONTRACT: expected 2 per-licensor scope rows, found %', v_count;
  end if;

  -- The same grant twice for the SAME licensor is a duplicate and must be refused.
  begin
    insert into plm.licensing_source_scope
      (licensor_id, source_system, source_purpose, scope_axis, permitted_kind)
    values (v_licensor_a, 'paramount', 'canonical_identity', 'entity', 'property');
    raise exception 'CONTRACT: licensing_source_scope accepted a duplicate scope row';
  exception when unique_violation then null;
  end;

  -- A relationship kind cannot be filed on the entity axis, and vice versa.
  begin
    insert into plm.licensing_source_scope
      (licensor_id, source_system, source_purpose, scope_axis, permitted_kind)
    values (v_licensor_a, 'paramount', 'canonical_identity', 'entity', 'property_character');
    raise exception 'CONTRACT: a relationship kind was accepted on the entity axis';
  exception when check_violation then null;
  end;
  begin
    insert into plm.licensing_source_scope
      (licensor_id, source_system, source_purpose, scope_axis, permitted_kind)
    values (v_licensor_a, 'paramount', 'relationship_evidence', 'relationship', 'franchise');
    raise exception 'CONTRACT: an entity kind was accepted on the relationship axis';
  exception when check_violation then null;
  end;

  -- Purpose and axis must agree. canonical_identity is a statement about an ENTITY;
  -- relationship_evidence is a statement about a PAIR. Conflating them is the mistake the
  -- coherence check exists to stop.
  begin
    insert into plm.licensing_source_scope
      (licensor_id, source_system, source_purpose, scope_axis, permitted_kind)
    values (v_licensor_a, 'paramount', 'relationship_evidence', 'entity', 'character');
    raise exception 'CONTRACT: relationship_evidence was accepted on the entity axis';
  exception when check_violation then null;
  end;
  begin
    insert into plm.licensing_source_scope
      (licensor_id, source_system, source_purpose, scope_axis, permitted_kind)
    values (v_licensor_a, 'paramount', 'canonical_identity', 'relationship', 'property_character');
    raise exception 'CONTRACT: canonical_identity was accepted on the relationship axis';
  exception when check_violation then null;
  end;

  -- reference_only is the one purpose meaningful on both axes.
  insert into plm.licensing_source_scope
    (licensor_id, source_system, source_purpose, scope_axis, permitted_kind)
  values (v_licensor_a, 'paramount', 'reference_only', 'relationship', 'asset_franchise');

  -- A half-recorded authorization is not an authorization.
  begin
    insert into plm.licensing_source_scope
      (licensor_id, source_system, source_purpose, scope_axis, permitted_kind, authorized_at)
    values (v_licensor_a, 'paramount', 'reference_only', 'entity', 'asset', clock_timestamp());
    raise exception 'CONTRACT: a scope row was authorized with a timestamp and no actor';
  exception when check_violation then null;
  end;

  -- A scope row may not outlive the licensor it grants for.
  begin
    insert into plm.licensing_source_scope
      (licensor_id, source_system, source_purpose, scope_axis, permitted_kind)
    values ('00000000-0000-4000-8000-000000000000'::uuid, 'paramount',
            'reference_only', 'entity', 'asset');
    raise exception 'CONTRACT: a scope row was accepted for a licensor that does not exist';
  exception when foreign_key_violation then null;
  end;

  -- ---------------------------------------------------------------------------------
  -- 6. plm.licensing_relationship_resolution -- pair decisions, ambiguity and provenance.
  -- ---------------------------------------------------------------------------------
  insert into plm.licensing_relationship_resolution
    (licensor_id, source_system, relationship_kind, source_left_id, source_right_id,
     resolution_status, core_property_id, core_character_id, evidence_kind,
     resolution_reason, resolved_at, resolved_by)
  values (v_licensor_a, 'paramount', 'property_character', '1', '2', 'matched',
          v_property, v_character, 'direct_source_assertion',
          'contract: the source states this pair directly',
          clock_timestamp(), 'issue-2335-contract');

  select is_direct_source_relationship into v_bool
    from plm.licensing_relationship_resolution
   where licensor_id = v_licensor_a and source_left_id = '1' and source_right_id = '2';
  if v_bool is not true then
    raise exception 'CONTRACT: is_direct_source_relationship was not generated from evidence_kind';
  end if;

  -- Evidence cannot lie about itself: the flag is generated and unwritable.
  v_sqlstate := null;
  begin
    insert into plm.licensing_relationship_resolution
      (licensor_id, source_system, relationship_kind, source_left_id, source_right_id,
       evidence_kind, is_direct_source_relationship)
    values (v_licensor_a, 'paramount', 'property_character', '90', '91', 'inferred', true);
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is null then
    raise exception 'CONTRACT: is_direct_source_relationship was writable -- evidence can '
      'lie about itself';
  end if;
  if v_sqlstate not in ('428C9', '42601') then
    raise exception 'CONTRACT: writing the generated column failed with % instead of a '
      'generated-column refusal', v_sqlstate;
  end if;

  -- THE COLLISION CASE. Disney and Sega both number from small integers: the SAME source
  -- system and the SAME pair of source ids under a DIFFERENT licensor is a different
  -- relationship and must be accepted.
  begin
    insert into plm.licensing_relationship_resolution
      (licensor_id, source_system, relationship_kind, source_left_id, source_right_id,
       evidence_kind)
    values (v_licensor_b, 'paramount', 'property_character', '1', '2', 'direct_source_assertion');
  exception when others then
    raise exception 'CONTRACT: licensing_relationship_resolution refused the same source id '
      'pair under a different licensor (%). licensor_id must be part of the identity key.',
      sqlerrm;
  end;
  select count(*) into v_count from plm.licensing_relationship_resolution
   where source_system = 'paramount' and source_left_id = '1' and source_right_id = '2';
  if v_count <> 2 then
    raise exception 'CONTRACT: expected 2 per-licensor relationship decisions, found %', v_count;
  end if;

  -- The same pair twice for the SAME licensor is a duplicate.
  begin
    insert into plm.licensing_relationship_resolution
      (licensor_id, source_system, relationship_kind, source_left_id, source_right_id,
       evidence_kind)
    values (v_licensor_a, 'paramount', 'property_character', '1', '2', 'inferred');
    raise exception 'CONTRACT: a duplicate relationship decision was accepted';
  exception when unique_violation then null;
  end;

  -- A guess may be RECORDED and may never be promoted to a canonical pair.
  insert into plm.licensing_relationship_resolution
    (licensor_id, source_system, relationship_kind, source_left_id, source_right_id,
     resolution_status, evidence_kind, source_evidence)
  values (v_licensor_a, 'paramount', 'property_character', '3', '4', 'unresolved',
          'co_occurrence', 'appeared on the same page');
  begin
    insert into plm.licensing_relationship_resolution
      (licensor_id, source_system, relationship_kind, source_left_id, source_right_id,
       resolution_status, core_property_id, core_character_id, evidence_kind)
    values (v_licensor_a, 'paramount', 'property_character', '5', '6', 'matched',
            v_property, v_character, 'inferred');
    raise exception 'CONTRACT: inferred evidence was promoted to a matched canonical pair';
  exception when check_violation then null;
  end;

  -- A matched row names exactly the two endpoints its kind is made of. Every endpoint
  -- column is uuid, so without this check a wrong-kind endpoint would type check.
  begin
    insert into plm.licensing_relationship_resolution
      (licensor_id, source_system, relationship_kind, source_left_id, source_right_id,
       resolution_status, core_property_id, core_franchise_id, evidence_kind)
    values (v_licensor_a, 'paramount', 'property_character', '7', '8', 'matched',
            v_property, v_franchise, 'direct_source_assertion');
    raise exception 'CONTRACT: a property_character match was allowed a franchise endpoint';
  exception when check_violation then null;
  end;
  begin
    insert into plm.licensing_relationship_resolution
      (licensor_id, source_system, relationship_kind, source_left_id, source_right_id,
       resolution_status, core_property_id, evidence_kind)
    values (v_licensor_a, 'paramount', 'property_character', '9', '10', 'matched',
            v_property, 'direct_source_assertion');
    raise exception 'CONTRACT: a matched pair was accepted with only one endpoint';
  exception when check_violation then null;
  end;

  -- An undecided row must not leave a half answer behind that a reader could mistake for
  -- a decision.
  begin
    insert into plm.licensing_relationship_resolution
      (licensor_id, source_system, relationship_kind, source_left_id, source_right_id,
       resolution_status, core_property_id, evidence_kind)
    values (v_licensor_a, 'paramount', 'property_character', '11', '12', 'unresolved',
            v_property, 'direct_source_assertion');
    raise exception 'CONTRACT: an unresolved decision was allowed to carry an endpoint';
  exception when check_violation then null;
  end;

  -- AMBIGUITY IS PRESERVED, AND SAYS WHAT IT IS. A bare "ambiguous" with no reason is
  -- indistinguishable from neglect, so it is refused; with a reason it is a first-class
  -- recorded outcome, not a missing row.
  begin
    insert into plm.licensing_relationship_resolution
      (licensor_id, source_system, relationship_kind, source_left_id, source_right_id,
       resolution_status, evidence_kind)
    values (v_licensor_a, 'paramount', 'property_character', '13', '14', 'ambiguous',
            'direct_source_assertion');
    raise exception 'CONTRACT: an ambiguous decision was accepted with no stated reason';
  exception when check_violation then null;
  end;
  insert into plm.licensing_relationship_resolution
    (licensor_id, source_system, relationship_kind, source_left_id, source_right_id,
     resolution_status, evidence_kind, resolution_reason)
  values (v_licensor_a, 'paramount', 'property_character', '13', '14', 'ambiguous',
          'direct_source_assertion',
          'two canonical characters share this name under this licensor');
  select count(*) into v_count from plm.licensing_relationship_resolution
   where resolution_status = 'ambiguous' and licensor_id = v_licensor_a;
  if v_count <> 1 then
    raise exception 'CONTRACT: a stated ambiguity was not preserved as a row';
  end if;

  -- Off-vocabulary relationship kinds and statuses are refused.
  begin
    insert into plm.licensing_relationship_resolution
      (licensor_id, source_system, relationship_kind, source_left_id, source_right_id,
       evidence_kind)
    values (v_licensor_a, 'paramount', 'property_distributor', '15', '16', 'inferred');
    raise exception 'CONTRACT: an off-vocabulary relationship_kind was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into plm.licensing_relationship_resolution
      (licensor_id, source_system, relationship_kind, source_left_id, source_right_id,
       resolution_status, evidence_kind)
    values (v_licensor_a, 'paramount', 'property_character', '17', '18', 'probably',
            'inferred');
    raise exception 'CONTRACT: an off-vocabulary resolution_status was accepted';
  exception when check_violation then null;
  end;

  -- Blank source keys are not keys.
  begin
    insert into plm.licensing_relationship_resolution
      (licensor_id, source_system, relationship_kind, source_left_id, source_right_id,
       evidence_kind)
    values (v_licensor_a, 'paramount', 'property_character', '   ', '19', 'inferred');
    raise exception 'CONTRACT: a blank source_left_id was accepted';
  exception when check_violation then null;
  end;

  raise notice 'issue #2335 licensing source authority and relationship decision contracts: all assertions passed';
end
$contracts$;

rollback;
