-- Rollback-safe, synthetic contract for issue #2008:
-- api.db_data_admin_decide_property_match.
--
-- Written to FAIL if the licensing-manager gate, the least-privilege grants,
-- append-only versioning, JWT-only reviewer identity, or idempotency is wrong.
-- No licensed row is used: every fixture value is generated here and rolled back.
begin;

do $$
declare
  v_sig text := 'api.db_data_admin_decide_property_match(uuid,text,bigint[],text,uuid)';
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  v_search text;
  v_opa_a bigint := -200800001001;
  v_opa_b bigint := -200800001002;
  v_role_id uuid;
  v_profile uuid;
  v_auth uuid;
  v_pending_a uuid;
  v_pending_b uuid;
  v_request_a uuid := gen_random_uuid();
  v_request_a2 uuid := gen_random_uuid();
  v_request_b uuid := gen_random_uuid();
  v_result jsonb;
  v_repeat jsonb;
  v_denied boolean := false;
  v_versions bigint;
begin
  v_search := 'Issue2008D-' || v_suffix;

  -- ---------------------------------------------------------------------
  -- 1. Least-privilege grants and security posture.
  -- ---------------------------------------------------------------------
  if to_regprocedure(v_sig) is null then
    raise exception 'api.db_data_admin_decide_property_match does not exist';
  end if;
  if has_function_privilege('anon', v_sig::regprocedure, 'EXECUTE') then
    raise exception 'property match decision is reachable by anon';
  end if;
  if has_function_privilege('public', v_sig::regprocedure, 'EXECUTE') then
    raise exception 'property match decision is reachable by public';
  end if;
  if has_function_privilege('service_role', v_sig::regprocedure, 'EXECUTE') then
    raise exception 'property match decision is reachable by service_role';
  end if;
  if not has_function_privilege('authenticated', v_sig::regprocedure, 'EXECUTE') then
    raise exception 'property match decision lost its authenticated grant';
  end if;
  if position('security definer' in lower(pg_get_functiondef(v_sig::regprocedure))) = 0 then
    raise exception 'property match decision is not security definer';
  end if;
  if position('pg_catalog' in lower(pg_get_functiondef(v_sig::regprocedure))) = 0 then
    raise exception 'property match decision does not pin its search_path';
  end if;
  if position('app.require_licensing_manager_access' in
       lower(pg_get_functiondef(v_sig::regprocedure))) = 0 then
    raise exception 'property match decision is not licensing-manager gated';
  end if;
  -- The reviewer may never come from a parameter or from the connection role.
  if position('session_user' in lower(pg_get_functiondef(v_sig::regprocedure))) <> 0 then
    raise exception 'property match decision accepts a non-JWT reviewer identity';
  end if;

  -- ---------------------------------------------------------------------
  -- 2. The gate refuses before anything is written.
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform api.db_data_admin_decide_property_match(
      gen_random_uuid(), 'approve', '{}'::bigint[], 'unauthorized attempt',
      gen_random_uuid());
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'property match decision answered an unauthorized caller';
  end if;

  -- ---------------------------------------------------------------------
  -- 3. Authorize a licensing manager.
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
  -- 4. Fixtures: two pending identities.
  -- ---------------------------------------------------------------------
  insert into plm.opa_property (licensed_property_id, property_name)
  values (v_opa_a, v_search || ' OPA A'), (v_opa_b, v_search || ' OPA B');

  insert into plm.dcp_property (source_system, source_id, display_name) values
    ('disney_dcpvault', v_search || '/a', v_search || ' Alpha'),
    ('disney_dcpvault', v_search || '/b', v_search || ' Bravo');

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

  insert into plm.dcp_opa_property_resolution (
    source_system, source_table, source_property_id, decision_version,
    approval_status, evidence_reference, evidence_sha256, decision_reason
  ) values (
    'disney_dcpvault', 'plm.dcp_property', v_search || '/b', 1,
    'pending', 'synthetic-evidence-b', repeat('c', 64), 'synthetic pending bravo'
  ) returning resolution_id into v_pending_b;

  -- ---------------------------------------------------------------------
  -- 5. Approve. A SUPERSEDING version is appended; the pending row is
  --    untouched; the reviewer comes from the JWT; members are written.
  -- ---------------------------------------------------------------------
  v_result := api.db_data_admin_decide_property_match(
    v_pending_a, 'approve', array[v_opa_b, v_opa_a]::bigint[],
    'synthetic approval', v_request_a);

  if v_result ->> 'approval_status' <> 'approved'
     or (v_result ->> 'decision_version')::bigint <> 2
     or v_result ->> 'supersedes_resolution_id' <> v_pending_a::text
     or v_result ->> 'resolution_id' <> v_request_a::text
     or (v_result ->> 'idempotent_repeat')::boolean then
    raise exception 'approval did not append a superseding version: %', v_result;
  end if;
  if v_result ->> 'approved_by' <> v_auth::text then
    raise exception 'the approving reviewer was not taken from the JWT: %',
      v_result ->> 'approved_by';
  end if;
  if v_result ->> 'evidence_sha256' <> repeat('a', 64)
     or v_result ->> 'contract_asserted_studio_code' <> 'marvel' then
    raise exception 'the decision dropped the reviewed evidence: %', v_result;
  end if;
  -- Members are ordinal-numbered by licensed_property_id, written in the call.
  if (v_result -> 'members' -> 0 ->> 'licensed_property_id')::bigint <> v_opa_b
     or (v_result -> 'members' -> 0 ->> 'member_ordinal')::integer <> 1
     or (v_result -> 'members' -> 1 ->> 'licensed_property_id')::bigint <> v_opa_a then
    raise exception 'the approved member set was not written atomically: %', v_result;
  end if;
  if (select count(*) from plm.dcp_opa_property_resolution_member m
      where m.resolution_id = v_request_a) <> 2 then
    raise exception 'the approved member rows are missing from the ledger';
  end if;

  -- Append-only: version 1 is still exactly as it was recorded.
  if (select approval_status from plm.dcp_opa_property_resolution
      where resolution_id = v_pending_a) <> 'pending' then
    raise exception 'the pending version was rewritten instead of superseded';
  end if;

  -- ---------------------------------------------------------------------
  -- 6. Idempotency: the identical retry returns the recorded decision and
  --    appends NOTHING.
  -- ---------------------------------------------------------------------
  v_repeat := api.db_data_admin_decide_property_match(
    v_pending_a, 'approve', array[v_opa_a, v_opa_b]::bigint[],
    'synthetic approval', v_request_a);
  if not (v_repeat ->> 'idempotent_repeat')::boolean
     or v_repeat ->> 'resolution_id' <> v_request_a::text then
    raise exception 'a retried decision was not recognised as a repeat: %', v_repeat;
  end if;

  select count(*) into v_versions
  from plm.dcp_opa_property_resolution
  where source_system = 'disney_dcpvault'
    and source_table = 'plm.dcp_property'
    and source_property_id = v_search || '/a';
  if v_versions <> 2 then
    raise exception 'a retried decision appended a duplicate version (% versions)',
      v_versions;
  end if;

  -- A DIFFERENT decision reusing a spent request id must fail.
  v_denied := false;
  begin
    perform api.db_data_admin_decide_property_match(
      v_pending_a, 'reject', '{}'::bigint[], 'synthetic approval', v_request_a);
  exception when unique_violation then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'a spent client request id was reused for a different decision';
  end if;

  -- ---------------------------------------------------------------------
  -- 7. A decided identity cannot be decided twice.
  -- ---------------------------------------------------------------------
  v_denied := false;
  begin
    perform api.db_data_admin_decide_property_match(
      v_pending_a, 'approve', array[v_opa_a]::bigint[], 'second decision',
      v_request_a2);
  exception when restrict_violation then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'an already-superseded resolution accepted a second decision';
  end if;

  -- ---------------------------------------------------------------------
  -- 8. Rejection: no members, no reviewer column (the table's
  --    approved-shape check permits approved_by only on an approved row).
  -- ---------------------------------------------------------------------
  v_denied := false;
  begin
    perform api.db_data_admin_decide_property_match(
      v_pending_b, 'reject', array[v_opa_a]::bigint[], 'reject with members',
      gen_random_uuid());
  exception when invalid_parameter_value then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'a rejection was allowed to select OPA members';
  end if;

  v_result := api.db_data_admin_decide_property_match(
    v_pending_b, 'reject', null::bigint[], 'synthetic rejection', v_request_b);
  if v_result ->> 'approval_status' <> 'rejected'
     or (v_result ->> 'decision_version')::bigint <> 2
     or v_result ->> 'supersedes_resolution_id' <> v_pending_b::text
     or v_result ->> 'approved_by' is not null
     or v_result -> 'members' <> '[]'::jsonb then
    raise exception 'rejection contract changed: %', v_result;
  end if;

  -- ---------------------------------------------------------------------
  -- 9. Bad input is refused rather than half-applied.
  -- ---------------------------------------------------------------------
  v_denied := false;
  begin
    perform api.db_data_admin_decide_property_match(
      v_pending_b, 'maybe', '{}'::bigint[], 'not a decision', gen_random_uuid());
  exception when invalid_parameter_value then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'an unknown decision verb was accepted';
  end if;

  v_denied := false;
  begin
    perform api.db_data_admin_decide_property_match(
      v_pending_b, 'approve', '{}'::bigint[], '   ', gen_random_uuid());
  exception when invalid_parameter_value then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'a blank decision reason was accepted';
  end if;

  -- ---------------------------------------------------------------------
  -- 10. The ledger itself is still append-only underneath the RPC.
  -- ---------------------------------------------------------------------
  v_denied := false;
  begin
    update plm.dcp_opa_property_resolution
      set decision_reason = 'rewritten'
    where resolution_id = v_pending_a;
  exception when restrict_violation then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'the decision ledger is no longer append-only';
  end if;
end $$;

rollback;
