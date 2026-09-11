-- Rollback-safe, synthetic contract for issue #2008:
-- api.db_data_admin_property_match_queue.
--
-- Every assertion below is written so that it FAILS if the gate, the
-- least-privilege grants, the latest-version-only rule, the evidence/candidate
-- shape, or the keyset pagination is wrong. No licensed row is used: every
-- fixture value is generated in this file and rolled back.
begin;

do $$
declare
  v_sig text := 'api.db_data_admin_property_match_queue(text,text,integer)';
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  v_search text;
  v_opa_a bigint := -200800000001;
  v_opa_b bigint := -200800000002;
  v_role_id uuid;
  v_profile uuid;
  v_auth uuid;
  v_pending_a uuid;
  v_pending_b uuid;
  v_pending_c uuid;
  v_decided uuid;
  v_pending_after_decision uuid := gen_random_uuid();
  v_final_approved uuid := gen_random_uuid();
  v_page jsonb;
  v_page2 jsonb;
  v_row jsonb;
  v_cursor text;
  v_denied boolean := false;
begin
  v_search := 'Issue2008Q-' || v_suffix;

  -- ---------------------------------------------------------------------
  -- 1. Least-privilege grants. Fails if EXECUTE reaches a role the gate
  --    does not require, or if the browser role loses it.
  -- ---------------------------------------------------------------------
  if to_regprocedure(v_sig) is null then
    raise exception 'api.db_data_admin_property_match_queue does not exist';
  end if;
  if has_function_privilege('anon', v_sig::regprocedure, 'EXECUTE') then
    raise exception 'property match queue is reachable by anon';
  end if;
  if has_function_privilege('public', v_sig::regprocedure, 'EXECUTE') then
    raise exception 'property match queue is reachable by public';
  end if;
  if has_function_privilege('service_role', v_sig::regprocedure, 'EXECUTE') then
    raise exception 'property match queue is reachable by service_role';
  end if;
  if not has_function_privilege('authenticated', v_sig::regprocedure, 'EXECUTE') then
    raise exception 'property match queue lost its authenticated grant';
  end if;

  -- Security posture of the object itself.
  if position('security definer' in lower(pg_get_functiondef(v_sig::regprocedure))) = 0 then
    raise exception 'property match queue is not security definer';
  end if;
  if position('pg_catalog' in lower(pg_get_functiondef(v_sig::regprocedure))) = 0 then
    raise exception 'property match queue does not pin its search_path';
  end if;
  if position('app.require_licensing_manager_access' in
       lower(pg_get_functiondef(v_sig::regprocedure))) = 0 then
    raise exception 'property match queue is not licensing-manager gated';
  end if;

  -- ---------------------------------------------------------------------
  -- 2. The gate actually refuses. No JWT subject is set yet.
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform api.db_data_admin_property_match_queue(null, null, 10);
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'property match queue answered an unauthorized caller';
  end if;

  -- ---------------------------------------------------------------------
  -- 3. Authorize a licensing manager exactly the way the surface does.
  -- ---------------------------------------------------------------------
  select p.id, p.auth_user_id into v_profile, v_auth
  from app.profile p
  where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id
  limit 1;
  if v_profile is null then
    raise exception 'no active profile fixture is available';
  end if;
  select r.id into v_role_id from app.role r where r.slug = 'licensing'::app.app_role;
  delete from app.user_role where profile_id = v_profile and role_id = v_role_id;
  delete from app.app_access where profile_id = v_profile and app in ('plm', 'admin');
  insert into app.user_role (profile_id, role_id) values (v_profile, v_role_id);
  insert into app.app_access (profile_id, app) values (v_profile, 'plm');
  perform set_config('request.jwt.claim.sub', v_auth::text, true);

  -- ---------------------------------------------------------------------
  -- 4. Fixtures: two pending identities and one already-decided identity.
  -- ---------------------------------------------------------------------
  insert into plm.opa_property (licensed_property_id, property_name)
  values (v_opa_a, v_search || ' OPA A'), (v_opa_b, v_search || ' OPA B');

  insert into plm.dcp_property (source_system, source_id, display_name) values
    ('disney_dcpvault', v_search || '/a', v_search || ' Alpha'),
    ('disney_dcpvault', v_search || '/b', v_search || ' Bravo'),
    ('disney_dcpvault', v_search || '/c', v_search || ' Charlie');

  insert into plm.dcp_opa_property_resolution (
    source_system, source_table, source_property_id, decision_version,
    approval_status, evidence_reference, evidence_sha256, decision_reason,
    contract_asserted_studio_code, contract_evidence_reference,
    contract_evidence_sha256
  ) values (
    'disney_dcpvault', 'plm.dcp_property', v_search || '/a', 1,
    'pending', 'synthetic-evidence-a', repeat('a', 64), 'synthetic pending alpha',
    'marvel', 'synthetic-contract-a', repeat('b', 64)
  ) returning resolution_id into v_pending_a;

  insert into plm.dcp_opa_property_resolution_member (
    resolution_id, licensed_property_id, member_ordinal, submission_source_system, submission_source_table, submission_source_id
  ) values (v_pending_a, v_opa_a, 1, 'disney_opa', 'plm.opa_property', v_opa_a::text), (v_pending_a, v_opa_b, 2, 'disney_opa', 'plm.opa_property', v_opa_b::text);

  insert into plm.dcp_opa_property_resolution (
    source_system, source_table, source_property_id, decision_version,
    approval_status, evidence_reference, evidence_sha256, decision_reason
  ) values (
    'disney_dcpvault', 'plm.dcp_property', v_search || '/b', 1,
    'pending', 'synthetic-evidence-b', repeat('c', 64), 'synthetic pending bravo'
  ) returning resolution_id into v_pending_b;

  insert into plm.dcp_opa_property_resolution (
    source_system, source_table, source_property_id, decision_version,
    approval_status, evidence_reference, evidence_sha256, decision_reason
  ) values (
    'disney_dcpvault', 'plm.dcp_property', v_search || '/c', 1,
    'pending', 'synthetic-evidence-c', repeat('d', 64), 'synthetic pending charlie'
  ) returning resolution_id into v_pending_c;

  -- ---------------------------------------------------------------------
  -- 5. Shape: evidence, candidates and label come back for a pending row.
  -- ---------------------------------------------------------------------
  v_page := api.db_data_admin_property_match_queue(v_search, null, 100);
  if jsonb_typeof(v_page -> 'rows') <> 'array' then
    raise exception 'property match queue envelope lost its rows array';
  end if;
  if (v_page ->> 'page_size')::integer <> 100 then
    raise exception 'property match queue ignored its page size';
  end if;

  select r into v_row from jsonb_array_elements(v_page -> 'rows') r
  where r ->> 'source_property_id' = v_search || '/a';
  if v_row is null then
    raise exception 'a pending identity is missing from the review queue';
  end if;
  if v_row ->> 'resolution_id' <> v_pending_a::text
     or v_row ->> 'approval_status' <> 'pending'
     or v_row ->> 'evidence_reference' <> 'synthetic-evidence-a'
     or v_row ->> 'evidence_sha256' <> repeat('a', 64)
     or v_row ->> 'decision_reason' <> 'synthetic pending alpha'
     or v_row ->> 'contract_asserted_studio_code' <> 'marvel'
     or v_row ->> 'contract_evidence_sha256' <> repeat('b', 64)
     or v_row ->> 'display_label' <> v_search || ' Alpha'
     or (v_row ->> 'candidate_count')::integer <> 2 then
    raise exception 'property match queue evidence contract changed: %', v_row;
  end if;
  if (v_row -> 'candidates' -> 0 ->> 'licensed_property_id')::bigint <> v_opa_a
     or (v_row -> 'candidates' -> 0 ->> 'member_ordinal')::integer <> 1
     or (v_row -> 'candidates' -> 1 ->> 'licensed_property_id')::bigint <> v_opa_b then
    raise exception 'property match queue candidate contract changed: %', v_row;
  end if;

  -- ---------------------------------------------------------------------
  -- 6. LATEST version only. Appending an approved superseding version must
  --    remove the identity from the queue -- not leave the stale pending
  --    version visible forever.
  -- ---------------------------------------------------------------------
  insert into plm.dcp_opa_property_resolution (
    source_system, source_table, source_property_id, decision_version,
    approval_status, supersedes_resolution_id, evidence_reference,
    evidence_sha256, decision_reason, approved_at, approved_by
  ) values (
    'disney_dcpvault', 'plm.dcp_property', v_search || '/c', 2,
    'approved', v_pending_c, 'synthetic-evidence-c', repeat('d', 64),
    'synthetic decided charlie', now(), 'contract'
  ) returning resolution_id into v_decided;

  v_page := api.db_data_admin_property_match_queue(v_search, null, 100);
  if exists (
    select 1 from jsonb_array_elements(v_page -> 'rows') r
    where r ->> 'source_property_id' = v_search || '/c'
  ) then
    raise exception 'a decided identity is still presented as pending review';
  end if;
  if (select count(*) from jsonb_array_elements(v_page -> 'rows')) <> 2 then
    raise exception 'property match queue returned an unexpected pending set: %',
      v_page -> 'rows';
  end if;

  -- A newer pending proposal remains visible to reviewers even though the
  -- prior approval remains the newest terminal decision for read surfaces.
  insert into plm.dcp_opa_property_resolution (
    resolution_id,source_system,source_table,source_property_id,decision_version,
    approval_status,supersedes_resolution_id,evidence_reference,evidence_sha256,decision_reason
  ) values (
    v_pending_after_decision,'disney_dcpvault','plm.dcp_property',v_search||'/c',3,
    'pending',v_decided,'synthetic-evidence-c3',repeat('e',64),'synthetic follow-up proposal'
  );
  insert into plm.dcp_opa_property_resolution_member (
    resolution_id,licensed_property_id,member_ordinal,submission_source_system,
    submission_source_table,submission_source_id
  ) values (
    v_pending_after_decision,v_opa_b,1,'disney_opa','plm.opa_property',v_opa_b::text
  );
  v_page := api.db_data_admin_property_match_queue(v_search, null, 100);
  select r into v_row from jsonb_array_elements(v_page -> 'rows') r
  where r ->> 'source_property_id'=v_search||'/c';
  if v_row is null
     or v_row ->> 'resolution_id' <> v_pending_after_decision::text
     or v_row ->> 'approval_status' <> 'pending'
     or (select count(*) from jsonb_array_elements(v_page -> 'rows')) <> 3 then
    raise exception 'latest pending proposal was not preserved in the review queue: %',v_page -> 'rows';
  end if;

  -- A still-later approval closes that proposal without mutating history.
  insert into plm.dcp_opa_property_resolution (
    resolution_id,source_system,source_table,source_property_id,decision_version,
    creative_decision_state,approval_status,supersedes_resolution_id,
    evidence_reference,evidence_sha256,decision_reason,approved_at,approved_by
  ) values (
    v_final_approved,'disney_dcpvault','plm.dcp_property',v_search||'/c',4,
    'mapped','approved',v_pending_after_decision,'synthetic-evidence-c4',repeat('f',64),
    'synthetic final approval',now(),'contract'
  );
  insert into plm.dcp_opa_property_resolution_member (
    resolution_id,licensed_property_id,member_ordinal,submission_source_system,
    submission_source_table,submission_source_id
  ) values (
    v_final_approved,v_opa_a,1,'disney_opa','plm.opa_property',v_opa_a::text
  );
  v_page := api.db_data_admin_property_match_queue(v_search, null, 100);
  if exists (
    select 1 from jsonb_array_elements(v_page -> 'rows') r
    where r ->> 'source_property_id'=v_search||'/c'
  ) or (select count(*) from jsonb_array_elements(v_page -> 'rows')) <> 2 then
    raise exception 'later approval did not close the follow-up proposal queue row';
  end if;

  -- ---------------------------------------------------------------------
  -- 7. Keyset pagination pages without overlap and without loss.
  -- ---------------------------------------------------------------------
  v_page := api.db_data_admin_property_match_queue(v_search, null, 1);
  if (select count(*) from jsonb_array_elements(v_page -> 'rows')) <> 1 then
    raise exception 'property match queue ignored a page size of 1';
  end if;
  v_cursor := v_page ->> 'next_cursor';
  if v_cursor is null then
    raise exception 'property match queue did not offer a next cursor';
  end if;
  v_page2 := api.db_data_admin_property_match_queue(v_search, v_cursor, 1);
  if (select count(*) from jsonb_array_elements(v_page2 -> 'rows')) <> 1 then
    raise exception 'property match queue lost the second page';
  end if;
  if (v_page -> 'rows' -> 0 ->> 'row_key') = (v_page2 -> 'rows' -> 0 ->> 'row_key') then
    raise exception 'property match queue repeated a row across pages';
  end if;
  if (v_page2 ->> 'next_cursor') is not null then
    raise exception 'property match queue offered a cursor past the last page';
  end if;

  -- A corrupt cursor must fail loudly rather than silently return page one.
  v_denied := false;
  begin
    perform api.db_data_admin_property_match_queue(v_search, '###not-base64###', 1);
  exception when invalid_parameter_value then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'property match queue accepted an invalid cursor';
  end if;
end $$;

rollback;
