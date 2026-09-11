-- Rollback-safe, synthetic contracts for issue #2576: one stable DCP source id
-- is the business Creative identity, and every retained source-system/table
-- copy of it is provenance rather than a separate business fact.
--
-- Nothing here uses a licensed value. Every id, name and member is generated in
-- this file and rolled back.
--
-- Each assertion is paired with the KNOWN-BAD input that would have satisfied
-- the previous, copy-keyed contract, so a check that cannot fail is visible as
-- such: the Disney copy of the shared identity is deliberately left
-- approved/unmapped with no members, which is exactly what used to render it
-- unmapped in the reader.
begin;

do $$
declare
  v_scraped text := 'api.db_data_admin_scraped_properties(text,text,integer)';
  v_queue text := 'api.db_data_admin_property_match_queue(text,text,integer)';
  v_decide text := 'api.db_data_admin_decide_property_match(uuid,text,bigint[],text,uuid)';
  v_fn text;
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  v_search text;
  v_ns text;
  v_role_id uuid;
  v_profile uuid;
  v_auth uuid;
  v_opa_a bigint := -257600000001;
  v_opa_b bigint := -257600000002;
  v_opa_c bigint := -257600000003;
  v_page jsonb;
  v_row jsonb;
  v_copy_state text;
  v_denied boolean := false;
  v_pending_conflict uuid := gen_random_uuid();
  v_pending_follow uuid := gen_random_uuid();
  v_result jsonb;
  v_history_before integer;
  v_history_after integer;
  v_refused boolean := false;
  v_pending_tie uuid := gen_random_uuid();
  v_tie_at timestamptz := now();
  v_tie_expected uuid;
begin
  v_search := 'zz2576-' || v_suffix;
  v_ns := 'dcpvault:' || v_search;

  -- -------------------------------------------------------------------
  -- 1. All three RPCs keep authentication and least privilege.
  -- -------------------------------------------------------------------
  foreach v_fn in array array[v_scraped, v_queue, v_decide] loop
    if to_regprocedure(v_fn) is null then
      raise exception '#2576 missing function: %', v_fn;
    end if;
    if has_function_privilege('anon', v_fn::regprocedure, 'execute')
       or has_function_privilege('public', v_fn::regprocedure, 'execute')
       or has_function_privilege('service_role', v_fn::regprocedure, 'execute')
       or not has_function_privilege('authenticated', v_fn::regprocedure, 'execute') then
      raise exception '#2576 execution grants changed on %', v_fn;
    end if;
    if position('security definer' in lower(pg_get_functiondef(v_fn::regprocedure))) = 0 then
      raise exception '#2576 % is not security definer', v_fn;
    end if;
    if position('search_path' in lower(pg_get_functiondef(v_fn::regprocedure))) = 0 then
      raise exception '#2576 % does not pin its search_path', v_fn;
    end if;
    if position('app.require_licensing_manager_access' in
         lower(pg_get_functiondef(v_fn::regprocedure))) = 0
       and position('auth.uid' in lower(pg_get_functiondef(v_fn::regprocedure))) = 0 then
      raise exception '#2576 % lost its authorization gate', v_fn;
    end if;
  end loop;

  -- No function may guess an identity from the landing-table family, the
  -- non-authoritative Marvel tag, or a normalized name.
  if position('mixed_guide' in lower(pg_get_functiondef(v_queue::regprocedure))) <> 0
     or position('normalized_name' in lower(pg_get_functiondef(v_queue::regprocedure))) <> 0
     or position('mixed_guide' in lower(pg_get_functiondef(v_decide::regprocedure))) <> 0
     or position('normalized_name' in lower(pg_get_functiondef(v_decide::regprocedure))) <> 0 then
    raise exception '#2576 an identity is being guessed from a tag or a name';
  end if;

  -- The gate actually refuses an unauthenticated caller.
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform api.db_data_admin_property_match_queue(null, null, 10);
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception '#2576 the review queue answered an unauthorized caller';
  end if;

  -- -------------------------------------------------------------------
  -- 2. Authorize a licensing manager exactly the way the surface does.
  -- -------------------------------------------------------------------
  select p.id, p.auth_user_id into v_profile, v_auth
  from app.profile p
  where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id
  limit 1;
  if v_profile is null then
    raise exception '#2576 fixture requires one active authenticated profile';
  end if;
  select r.id into v_role_id from app.role r where r.slug = 'licensing'::app.app_role;
  delete from app.user_role where profile_id = v_profile and role_id = v_role_id;
  delete from app.app_access where profile_id = v_profile and app in ('plm', 'admin');
  insert into app.user_role (profile_id, role_id) values (v_profile, v_role_id);
  insert into app.app_access (profile_id, app) values (v_profile, 'plm');

  -- -------------------------------------------------------------------
  -- 3. Fixtures. Retained copies of stable DCP identities, plus one
  --    deliberately NON-namespaced id that must never be grouped.
  -- -------------------------------------------------------------------
  insert into plm.opa_property (licensed_property_id, property_name)
  values (v_opa_a, v_search || ' OPA A'), (v_opa_b, v_search || ' OPA B'),
         (v_opa_c, v_search || ' OPA C');

  insert into plm.dcp_property (source_system, source_id, display_name) values
    ('disney_dcpvault', v_ns || '/shared',   v_search || ' Shared Disney'),
    ('disney_dcpvault', v_ns || '/queued',   v_search || ' Queued Disney'),
    ('disney_dcpvault', v_ns || '/conflict', v_search || ' Conflict Disney'),
    ('disney_dcpvault', v_ns || '/tie',      v_search || ' Tie Disney'),
    ('disney_dcpvault', v_search || '-bare', v_search || ' Bare Disney');
  insert into plm.lucasfilm_dcp_property (source_system, source_id, display_name) values
    ('lucasfilm_dcpvault', v_ns || '/shared',   v_search || ' Shared Lucasfilm'),
    ('lucasfilm_dcpvault', v_ns || '/conflict', v_search || ' Conflict Lucasfilm'),
    ('lucasfilm_dcpvault', v_ns || '/tie',      v_search || ' Tie Lucasfilm');
  insert into plm.marvel_dcp_property (source_system, source_id, display_name) values
    ('marvel_dcpvault', v_ns || '/shared',   v_search || ' Shared Marvel'),
    ('marvel_dcpvault', v_ns || '/queued',   v_search || ' Queued Marvel'),
    ('marvel_dcpvault', v_ns || '/conflict', v_search || ' Conflict Marvel'),
    ('marvel_dcpvault', v_ns || '/tie',      v_search || ' Tie Marvel'),
    ('marvel_dcpvault', v_search || '-bare', v_search || ' Bare Marvel');

  -- SHARED: the Disney copy is terminally approved and explicitly UNMAPPED
  -- with no members. This is the known-bad input -- under the copy-keyed
  -- contract this row rendered unmapped.
  insert into plm.dcp_opa_property_resolution (
    source_system, source_table, source_property_id, decision_version,
    creative_decision_state, approval_status, evidence_reference,
    evidence_sha256, decision_reason, approved_at, approved_by
  ) values (
    'disney_dcpvault', 'plm.dcp_property', v_ns || '/shared', 1,
    'unmapped', 'approved', 'synthetic-2576-shared-disney', repeat('1', 64),
    'synthetic approved lack of mapping', now(), 'contract'
  );
  -- The Marvel copy of the SAME business identity carries the approved
  -- mapping, in the legacy DCP shape (null creative_decision_state, members).
  insert into plm.dcp_opa_property_resolution (
    source_system, source_table, source_property_id, decision_version,
    approval_status, evidence_reference, evidence_sha256, decision_reason,
    approved_at, approved_by
  ) values (
    'marvel_dcpvault', 'plm.marvel_dcp_property', v_ns || '/shared', 1,
    'approved', 'synthetic-2576-shared-marvel', repeat('2', 64),
    'synthetic approved mapping', now(), 'contract'
  );
  insert into plm.dcp_opa_property_resolution_member (
    resolution_id, licensed_property_id, member_ordinal,
    submission_source_system, submission_source_table, submission_source_id
  )
  select r.resolution_id, v_opa_a, 1, 'disney_opa', 'plm.opa_property', v_opa_a::text
  from plm.dcp_opa_property_resolution r
  where r.source_property_id = v_ns || '/shared'
    and r.source_table = 'plm.marvel_dcp_property';

  -- QUEUED: a terminal approved mapping on the Marvel copy, then a LATER
  -- pending proposal on the Disney copy. The proposal must stay queued and
  -- must not hide the terminal decision.
  insert into plm.dcp_opa_property_resolution (
    source_system, source_table, source_property_id, decision_version,
    creative_decision_state, approval_status, evidence_reference,
    evidence_sha256, decision_reason, approved_at, approved_by
  ) values (
    'marvel_dcpvault', 'plm.marvel_dcp_property', v_ns || '/queued', 1,
    'mapped', 'approved', 'synthetic-2576-queued-marvel', repeat('3', 64),
    'synthetic approved mapping', now(), 'contract'
  );
  insert into plm.dcp_opa_property_resolution_member (
    resolution_id, licensed_property_id, member_ordinal,
    submission_source_system, submission_source_table, submission_source_id
  )
  select r.resolution_id, v_opa_a, 1, 'disney_opa', 'plm.opa_property', v_opa_a::text
  from plm.dcp_opa_property_resolution r
  where r.source_property_id = v_ns || '/queued'
    and r.source_table = 'plm.marvel_dcp_property';

  insert into plm.dcp_opa_property_resolution (
    resolution_id, source_system, source_table, source_property_id,
    decision_version, approval_status, evidence_reference, evidence_sha256,
    decision_reason
  ) values (
    v_pending_follow, 'disney_dcpvault', 'plm.dcp_property', v_ns || '/queued',
    1, 'pending', 'synthetic-2576-queued-disney', repeat('4', 64),
    'synthetic later proposal'
  );

  -- CONFLICT: two retained copies terminally MAPPED to DIFFERENT member sets.
  insert into plm.dcp_opa_property_resolution (
    source_system, source_table, source_property_id, decision_version,
    creative_decision_state, approval_status, evidence_reference,
    evidence_sha256, decision_reason, approved_at, approved_by
  ) values (
    'disney_dcpvault', 'plm.dcp_property', v_ns || '/conflict', 1,
    'mapped', 'approved', 'synthetic-2576-conflict-disney', repeat('5', 64),
    'synthetic authority one', now(), 'contract'
  ), (
    'lucasfilm_dcpvault', 'plm.lucasfilm_dcp_property', v_ns || '/conflict', 1,
    'mapped', 'approved', 'synthetic-2576-conflict-lucasfilm', repeat('6', 64),
    'synthetic authority two', now(), 'contract'
  );
  insert into plm.dcp_opa_property_resolution_member (
    resolution_id, licensed_property_id, member_ordinal,
    submission_source_system, submission_source_table, submission_source_id
  )
  select r.resolution_id, v_opa_a, 1, 'disney_opa', 'plm.opa_property', v_opa_a::text
  from plm.dcp_opa_property_resolution r
  where r.source_property_id = v_ns || '/conflict'
    and r.source_table = 'plm.dcp_property';
  insert into plm.dcp_opa_property_resolution_member (
    resolution_id, licensed_property_id, member_ordinal,
    submission_source_system, submission_source_table, submission_source_id
  )
  select r.resolution_id, v_opa_b, 1, 'disney_opa', 'plm.opa_property', v_opa_b::text
  from plm.dcp_opa_property_resolution r
  where r.source_property_id = v_ns || '/conflict'
    and r.source_table = 'plm.lucasfilm_dcp_property';
  -- A pending proposal on the third copy, so the conflicting identity is
  -- still REVIEWABLE rather than silently dropped.
  insert into plm.dcp_opa_property_resolution (
    resolution_id, source_system, source_table, source_property_id,
    decision_version, approval_status, evidence_reference, evidence_sha256,
    decision_reason
  ) values (
    v_pending_conflict, 'marvel_dcpvault', 'plm.marvel_dcp_property',
    v_ns || '/conflict', 1, 'pending', 'synthetic-2576-conflict-marvel',
    repeat('7', 64), 'synthetic conflict review'
  );

  -- TIE: two retained copies terminally approved at the SAME decision_version
  -- and the SAME approved_at, mapped to the SAME member set, with a third copy
  -- left pending so the identity is observable through the review queue. The
  -- tie must be broken by resolution_id -- the primary key -- so the served
  -- mapping is stable rather than arbitrary.
  insert into plm.dcp_opa_property_resolution (
    source_system, source_table, source_property_id, decision_version,
    creative_decision_state, approval_status, evidence_reference,
    evidence_sha256, decision_reason, approved_at, approved_by
  ) values (
    'disney_dcpvault', 'plm.dcp_property', v_ns || '/tie', 1,
    'mapped', 'approved', 'synthetic-2576-tie-disney', repeat('a', 64),
    'synthetic tie one', v_tie_at, 'contract'
  ), (
    'marvel_dcpvault', 'plm.marvel_dcp_property', v_ns || '/tie', 1,
    'mapped', 'approved', 'synthetic-2576-tie-marvel', repeat('b', 64),
    'synthetic tie two', v_tie_at, 'contract'
  );
  insert into plm.dcp_opa_property_resolution_member (
    resolution_id, licensed_property_id, member_ordinal,
    submission_source_system, submission_source_table, submission_source_id
  )
  select r.resolution_id, v_opa_a, 1, 'disney_opa', 'plm.opa_property', v_opa_a::text
  from plm.dcp_opa_property_resolution r
  where r.source_property_id = v_ns || '/tie';
  insert into plm.dcp_opa_property_resolution (
    resolution_id, source_system, source_table, source_property_id,
    decision_version, approval_status, evidence_reference, evidence_sha256,
    decision_reason
  ) values (
    v_pending_tie, 'lucasfilm_dcpvault', 'plm.lucasfilm_dcp_property',
    v_ns || '/tie', 1, 'pending', 'synthetic-2576-tie-lucasfilm',
    repeat('c', 64), 'synthetic tie review'
  );

  -- BARE: a NON-namespaced source id present under two different systems.
  -- Small integer-style source ids collide between licensors, so these two
  -- copies are DIFFERENT businesses and must never be grouped.
  insert into plm.dcp_opa_property_resolution (
    source_system, source_table, source_property_id, decision_version,
    creative_decision_state, approval_status, evidence_reference,
    evidence_sha256, decision_reason, approved_at, approved_by
  ) values (
    'disney_dcpvault', 'plm.dcp_property', v_search || '-bare', 1,
    'unmapped', 'approved', 'synthetic-2576-bare-disney', repeat('8', 64),
    'synthetic approved lack of mapping', now(), 'contract'
  ), (
    'marvel_dcpvault', 'plm.marvel_dcp_property', v_search || '-bare', 1,
    'mapped', 'approved', 'synthetic-2576-bare-marvel', repeat('9', 64),
    'synthetic approved mapping', now(), 'contract'
  );
  insert into plm.dcp_opa_property_resolution_member (
    resolution_id, licensed_property_id, member_ordinal,
    submission_source_system, submission_source_table, submission_source_id
  )
  select r.resolution_id, v_opa_a, 1, 'disney_opa', 'plm.opa_property', v_opa_a::text
  from plm.dcp_opa_property_resolution r
  where r.source_property_id = v_search || '-bare'
    and r.source_table = 'plm.marvel_dcp_property';

  set constraints all immediate;
  perform set_config('request.jwt.claim.sub', v_auth::text, true);

  -- -------------------------------------------------------------------
  -- 4. Prove the KNOWN-BAD input is really there. If this ever stops being
  --    an approved copy with no mapping, the checks below prove nothing.
  -- -------------------------------------------------------------------
  select r.creative_decision_state into v_copy_state
  from plm.dcp_opa_property_resolution r
  where r.source_property_id = v_ns || '/shared'
    and r.source_table = 'plm.dcp_property';
  if v_copy_state is distinct from 'unmapped'
     or exists (
       select 1 from plm.dcp_opa_property_resolution r
       join plm.dcp_opa_property_resolution_member m
         on m.resolution_id = r.resolution_id
       where r.source_property_id = v_ns || '/shared'
         and r.source_table = 'plm.dcp_property'
     ) then
    raise exception '#2576 the known-bad copy-keyed fixture is not in place';
  end if;

  -- -------------------------------------------------------------------
  -- 5. api.db_data_admin_scraped_properties: an approved mapping held by one
  --    retained copy is NOT reported as unmapped merely because another
  --    retained copy of the same stable identity lacks one.
  -- -------------------------------------------------------------------
  select api.db_data_admin_scraped_properties(v_search, null, 500) into v_page;

  select x into v_row from jsonb_array_elements(v_page -> 'rows') x
  where x ->> 'source_property_id' = v_ns || '/shared'
    and x ->> 'source_table' = 'plm.dcp_property';
  if v_row is null then
    raise exception '#2576 the Disney copy of the shared identity is missing';
  end if;
  if v_row ->> 'mapping_state' <> 'mapped' then
    raise exception '#2576 an approved cross-copy mapping still reads as %: %',
      v_row ->> 'mapping_state', v_row;
  end if;

  select x into v_row from jsonb_array_elements(v_page -> 'rows') x
  where x ->> 'source_property_id' = v_ns || '/shared'
    and x ->> 'source_table' = 'plm.lucasfilm_dcp_property';
  if v_row is null or v_row ->> 'mapping_state' <> 'mapped' then
    raise exception '#2576 a retained copy with NO decision of its own did not inherit the identity state: %', v_row;
  end if;

  -- A later pending proposal stays a proposal: it never hides the newest
  -- terminal decision.
  select x into v_row from jsonb_array_elements(v_page -> 'rows') x
  where x ->> 'source_property_id' = v_ns || '/queued'
    and x ->> 'source_table' = 'plm.dcp_property';
  if v_row is null or v_row ->> 'mapping_state' <> 'mapped' then
    raise exception '#2576 a newer pending proposal hid the latest terminal decision: %', v_row;
  end if;

  -- Genuine terminal disagreement FAILS CLOSED and stays explicit.
  select x into v_row from jsonb_array_elements(v_page -> 'rows') x
  where x ->> 'source_property_id' = v_ns || '/conflict'
    and x ->> 'source_table' = 'plm.dcp_property';
  if v_row is null or v_row ->> 'mapping_state' <> 'conflict' then
    raise exception '#2576 two disagreeing terminal authorities did not fail closed: %', v_row;
  end if;

  -- A bare, non-namespaced source id is NEVER grouped across systems.
  select x into v_row from jsonb_array_elements(v_page -> 'rows') x
  where x ->> 'source_property_id' = v_search || '-bare'
    and x ->> 'source_table' = 'plm.dcp_property';
  if v_row is null or v_row ->> 'mapping_state' <> 'unmapped' then
    raise exception '#2576 a bare source id was grouped across licensors: %', v_row;
  end if;
  select x into v_row from jsonb_array_elements(v_page -> 'rows') x
  where x ->> 'source_property_id' = v_search || '-bare'
    and x ->> 'source_table' = 'plm.marvel_dcp_property';
  if v_row is null or v_row ->> 'mapping_state' <> 'mapped' then
    raise exception '#2576 the exact-copy contract broke for a bare source id: %', v_row;
  end if;

  -- Pagination envelope is intact.
  select api.db_data_admin_scraped_properties(v_search, null, 1) into v_page;
  if (v_page ->> 'page_size')::integer <> 1
     or jsonb_array_length(v_page -> 'rows') <> 1
     or v_page ->> 'next_cursor' is null then
    raise exception '#2576 scraped Properties keyset pagination changed: %', v_page;
  end if;

  -- -------------------------------------------------------------------
  -- 6. api.db_data_admin_property_match_queue: one coherent review state per
  --    business identity, with copy-level provenance retained.
  -- -------------------------------------------------------------------
  select api.db_data_admin_property_match_queue(v_search, null, 500) into v_page;

  select x into v_row from jsonb_array_elements(v_page -> 'rows') x
  where x ->> 'resolution_id' = v_pending_follow::text;
  if v_row is null then
    raise exception '#2576 a pending proposal left the review queue';
  end if;
  if v_row ->> 'identity_key' <> v_ns || '/queued'
     or v_row ->> 'identity_decision_state' <> 'mapped'
     or (v_row ->> 'identity_conflict')::boolean
     or (v_row ->> 'identity_copy_count')::integer <> 1 then
    raise exception '#2576 the queue did not present one coherent identity state: %', v_row;
  end if;
  if jsonb_array_length(v_row -> 'identity_copies') <> 1
     or v_row -> 'identity_copies' -> 0 ->> 'source_table' <> 'plm.marvel_dcp_property'
     or v_row -> 'identity_copies' -> 0 ->> 'copy_decision_state' <> 'mapped' then
    raise exception '#2576 the queue lost copy-level provenance: %', v_row;
  end if;
  -- The proposal itself is still the row being reviewed, unchanged.
  if v_row ->> 'approval_status' <> 'pending'
     or v_row ->> 'evidence_sha256' <> repeat('4', 64)
     or v_row ->> 'source_table' <> 'plm.dcp_property' then
    raise exception '#2576 the queue altered the proposal it is reviewing: %', v_row;
  end if;

  select x into v_row from jsonb_array_elements(v_page -> 'rows') x
  where x ->> 'resolution_id' = v_pending_conflict::text;
  if v_row is null then
    raise exception '#2576 a conflicting identity stopped being reviewable';
  end if;
  if v_row ->> 'identity_decision_state' <> 'conflict'
     or not (v_row ->> 'identity_conflict')::boolean
     or v_row ->> 'identity_resolution_id' is not null
     or (v_row ->> 'identity_copy_count')::integer <> 2
     or jsonb_array_length(v_row -> 'identity_copies') <> 2 then
    raise exception '#2576 terminal disagreement was resolved by guesswork instead of failing closed: %', v_row;
  end if;

  -- Queue pagination envelope is intact.
  select api.db_data_admin_property_match_queue(v_search, null, 1) into v_page;
  if (v_page ->> 'page_size')::integer <> 1
     or jsonb_array_length(v_page -> 'rows') <> 1
     or v_page ->> 'next_cursor' is null then
    raise exception '#2576 review queue keyset pagination changed: %', v_page;
  end if;

  -- -------------------------------------------------------------------
  -- 7. api.db_data_admin_decide_property_match: records under the same
  --    stable-identity/provenance contract, append-only.
  -- -------------------------------------------------------------------
  select count(*)::integer into v_history_before
  from plm.dcp_opa_property_resolution
  where source_property_id = v_ns || '/queued';

  select api.db_data_admin_decide_property_match(
    v_pending_follow, 'approve', array[v_opa_a],
    'synthetic stable-identity approval', gen_random_uuid()
  ) into v_result;

  if v_result ->> 'identity_key' <> v_ns || '/queued' then
    raise exception '#2576 the decision was not recorded against the stable identity: %', v_result;
  end if;
  if v_result ->> 'identity_decision_state' <> 'mapped' then
    raise exception '#2576 the decision payload lost the identity state: %', v_result;
  end if;
  if jsonb_array_length(v_result -> 'identity_copies') < 2 then
    raise exception '#2576 the decision payload lost copy-level provenance: %', v_result;
  end if;
  if (v_result ->> 'decision_version')::integer <> 2
     or v_result ->> 'supersedes_resolution_id' <> v_pending_follow::text then
    raise exception '#2576 the decision stopped superseding append-only: %', v_result;
  end if;

  select count(*)::integer into v_history_after
  from plm.dcp_opa_property_resolution
  where source_property_id = v_ns || '/queued';
  if v_history_after <> v_history_before + 1 then
    raise exception '#2576 decision history is no longer append-only (% then %)',
      v_history_before, v_history_after;
  end if;
  if not exists (
    select 1 from plm.dcp_opa_property_resolution
    where resolution_id = v_pending_follow and approval_status = 'pending'
  ) then
    raise exception '#2576 the superseded proposal was mutated instead of retained';
  end if;

  -- -------------------------------------------------------------------
  -- 8. The WRITE side refuses to un-serve a sibling mapping. The identity
  --    read fails closed on a terminal disagreement; a single-copy review
  --    screen must not be able to CREATE that disagreement by accident.
  -- -------------------------------------------------------------------
  -- KNOWN-BAD input: before this guard the call below succeeded, and every
  -- retained copy of the identity then rendered 'conflict' with no mapping
  -- served -- including a copy the reviewer never opened.
  v_refused := false;
  begin
    perform api.db_data_admin_decide_property_match(
      v_pending_conflict, 'approve', array[v_opa_c],
      'synthetic divergent member set', gen_random_uuid()
    );
  exception when restrict_violation then
    v_refused := true;
  end;
  if not v_refused then
    raise exception '#2576 an approval was allowed to un-serve a sibling mapping of the same identity';
  end if;
  if exists (
    select 1 from plm.dcp_opa_property_resolution
    where source_property_id = v_ns || '/conflict' and decision_version > 1
  ) then
    raise exception '#2576 the refused approval still recorded a decision version';
  end if;

  -- The guard must never strand an identity: approving the member set an
  -- existing terminal mapping already carries is how a disagreement is
  -- reconciled, and it stays allowed.
  select api.db_data_admin_decide_property_match(
    v_pending_conflict, 'approve', array[v_opa_a],
    'synthetic reconciling approval', gen_random_uuid()
  ) into v_result;
  if v_result ->> 'identity_key' <> v_ns || '/conflict'
     or (v_result ->> 'decision_version')::integer <> 2 then
    raise exception '#2576 the write guard stranded a reconcilable identity: %', v_result;
  end if;

  -- The guard is scoped to an approval that carries members, so a rejection
  -- and an approved lack of mapping are never blocked by it.
  if position('array_length(v_ids, 1) is not null' in
       pg_get_functiondef(v_decide::regprocedure)) = 0 then
    raise exception '#2576 the write guard is not scoped to approvals carrying members';
  end if;

  -- -------------------------------------------------------------------
  -- 9. Same-version, same-timestamp terminal copies resolve deterministically
  --    and are not mistaken for a disagreement.
  -- -------------------------------------------------------------------
  select api.db_data_admin_scraped_properties(v_search, null, 500) into v_page;
  select x into v_row from jsonb_array_elements(v_page -> 'rows') x
  where x ->> 'source_property_id' = v_ns || '/tie'
    and x ->> 'source_table' = 'plm.dcp_property';
  if v_row is null then
    raise exception '#2576 the tie fixture never reached the reader';
  end if;
  if v_row ->> 'mapping_state' <> 'mapped' then
    raise exception '#2576 identical mapped member sets were treated as a disagreement: %', v_row;
  end if;

  select r.resolution_id into v_tie_expected
  from plm.dcp_opa_property_resolution r
  where r.source_property_id = v_ns || '/tie'
    and r.approval_status = 'approved'
  order by r.decision_version desc, r.approved_at desc nulls last, r.resolution_id desc
  limit 1;

  select api.db_data_admin_property_match_queue(v_search, null, 500) into v_page;
  select x into v_row from jsonb_array_elements(v_page -> 'rows') x
  where x ->> 'resolution_id' = v_pending_tie::text;
  if v_row is null then
    raise exception '#2576 the tied identity stopped being reviewable';
  end if;
  if v_row ->> 'identity_decision_state' <> 'mapped'
     or (v_row ->> 'identity_conflict')::boolean then
    raise exception '#2576 a same-timestamp tie between identical mappings failed closed: %', v_row;
  end if;
  if (v_row ->> 'identity_resolution_id')::uuid is distinct from v_tie_expected then
    raise exception '#2576 the tie was not broken by resolution_id desc as documented (% wanted %)',
      v_row ->> 'identity_resolution_id', v_tie_expected;
  end if;

  select api.db_data_admin_property_match_queue(v_search, null, 500) into v_page;
  if (
    select x ->> 'identity_resolution_id' from jsonb_array_elements(v_page -> 'rows') x
    where x ->> 'resolution_id' = v_pending_tie::text
  ) is distinct from v_tie_expected::text then
    raise exception '#2576 a tied identity served a different mapping on a second call';
  end if;
end $$;

rollback;
