-- Rollback-safe, synthetic contract for issue #1599.
begin;

do $$
declare
  v_sig text := 'api.db_data_admin_scraped_properties(text,text,integer)';
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  v_search text := 'Issue1599-';
  v_property_id bigint := -159900000001;
  v_conflict_property_id bigint := -159900000002;
  v_role_id uuid;
  v_profile uuid;
  v_auth uuid;
  v_page jsonb;
  v_row jsonb;
  v_first uuid;
  v_current uuid;
  v_conflict uuid;
begin
  v_search := v_search || v_suffix;

  if to_regclass('plm.opa_property_scope_membership') is null then
    raise exception 'missing OPA scope-membership table';
  end if;
  if not (select relrowsecurity from pg_class
          where oid = 'plm.opa_property_scope_membership'::regclass) then
    raise exception 'OPA scope-membership RLS is not enabled';
  end if;
  if not has_table_privilege('service_role', 'plm.opa_property_scope_membership', 'select')
     or not has_table_privilege('service_role', 'plm.opa_property_scope_membership', 'insert')
     or has_table_privilege('service_role', 'plm.opa_property_scope_membership', 'update')
     or has_table_privilege('service_role', 'plm.opa_property_scope_membership', 'delete') then
    raise exception 'OPA append-only loader grants changed';
  end if;
  if has_table_privilege('service_role', 'plm.dcp_property_licensor_resolution', 'update')
     or has_table_privilege('service_role', 'plm.dcp_property_licensor_resolution', 'delete') then
    raise exception 'DCP append-only loader posture changed';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'plm.dcp_property_licensor_resolution'::regclass
      and conname = 'dcp_property_licensor_resolution_supersedes_fk'
  ) then
    raise exception 'DCP exact-identity supersession constraint is missing';
  end if;

  select p.id, p.auth_user_id into v_profile, v_auth
  from app.profile p where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1;
  select r.id into v_role_id from app.role r where r.slug = 'licensing'::app.app_role;
  delete from app.user_role where profile_id = v_profile and role_id = v_role_id;
  delete from app.app_access where profile_id = v_profile and app in ('plm', 'admin');
  insert into app.user_role (profile_id, role_id) values (v_profile, v_role_id);
  insert into app.app_access (profile_id, app) values (v_profile, 'plm');
  perform set_config('request.jwt.claim.sub', v_auth::text, true);

  insert into plm.opa_property (licensed_property_id, property_name)
  values (v_property_id, v_search || ' OPA');
  insert into plm.opa_property_scope_membership (
    licensed_property_id, region_code, branch_code, line_of_business_id,
    product_type_code, template_id, workflow_id, capture_id,
    source_captured_at, approval_status, evidence_reference, evidence_sha256,
    approved_at, approved_by
  ) values (
    v_property_id, 'north-america', 'lucasfilm', 200, 'home-standard',
    462, 50, v_search || '-capture', now(), 'approved',
    'private-contract-fixture', repeat('a',64), now(), 'contract'
  );

  select api.db_data_admin_scraped_properties(v_search, null, 100) into v_page;
  select r into v_row from jsonb_array_elements(v_page -> 'rows') r
  where r ->> 'source_table' = 'plm.opa_property';
  if v_row ->> 'presentation_licensor_name' <> 'Lucasfilm / Star Wars - Submissions (OPA)'
     or v_row ->> 'source_purpose' <> 'Submissions (OPA)'
     or v_row ->> 'evidence_basis' <> 'direct_opa_route_membership' then
    raise exception 'direct OPA route evidence was not preferred';
  end if;

  insert into plm.dcp_property (source_system, source_id, display_name)
  values ('disney_dcpvault', v_search || '/dcp', v_search || ' DCP');
  insert into plm.dcp_property_licensor_resolution (
    source_system, source_property_id, presentation_licensor_key,
    presentation_licensor_name, resolution_status, authority_kind,
    authority_reference, evidence_reference, source_hash, resolved_at,
    decision_version, approval_status, approved_at, approved_by, decision_reason
  ) values (
    'disney_dcpvault', v_search || '/dcp', 'disney', 'Disney',
    'supported_core_ownership', 'canonical_core', 'synthetic', 'private-pointer',
    repeat('b',64), now(), 1, 'approved', now(), 'contract', 'first decision'
  ) returning resolution_id into v_first;
  insert into plm.dcp_property_licensor_resolution (
    source_system, source_property_id, presentation_licensor_key,
    presentation_licensor_name, resolution_status, authority_kind,
    authority_reference, evidence_reference, source_hash, resolved_at,
    decision_version, supersedes_resolution_id, approval_status,
    approved_at, approved_by, decision_reason
  ) values (
    'disney_dcpvault', v_search || '/dcp', 'star-wars', 'Star Wars',
    'supported_owner_source_label', 'owner_source_label', 'synthetic', 'private-pointer',
    repeat('c',64), now(), 2, v_first, 'approved', now(), 'contract',
    'owner-approved source title family'
  );
  insert into plm.dcp_opa_property_resolution (
    source_system, source_table, source_property_id, decision_version,
    approval_status, evidence_reference, evidence_sha256, decision_reason,
    contract_asserted_studio_code, contract_evidence_reference,
    contract_evidence_sha256, approved_at, approved_by
  ) values (
    'disney_dcpvault', 'plm.dcp_property', v_search || '/dcp', 1,
    'approved', 'private-exact-link', repeat('f',64), 'synthetic exact link',
    'lucasfilm', 'private-contract-assertion', repeat('1',64), now(), 'contract'
  ) returning resolution_id into v_current;
  insert into plm.dcp_opa_property_resolution_member (
    resolution_id, licensed_property_id, member_ordinal
  ) values (v_current, v_property_id, 1);

  select api.db_data_admin_scraped_properties(v_search, null, 100) into v_page;
  select r into v_row from jsonb_array_elements(v_page -> 'rows') r
  where r ->> 'source_table' = 'plm.dcp_property';
  if v_row ->> 'presentation_licensor_name' <> 'Lucasfilm / Star Wars - Creative (DCP Vault)'
     or v_row ->> 'source_status' <> 'direct_lucasfilm'
     or v_row ?| array['authority_reference','evidence_reference','source_hash','approved_by'] then
    raise exception 'latest approved DCP decision or private envelope contract changed';
  end if;

  if position('Marvel - Creative (ASGARD)' in pg_get_functiondef(v_sig::regprocedure)) = 0
     or position('plm.marvel_asgard_style_guide' in pg_get_functiondef(v_sig::regprocedure)) = 0
     or position('Marvel - Creative (DCP Vault)' in pg_get_functiondef(v_sig::regprocedure)) > 0
     or position('review_reason' in pg_get_functiondef(v_sig::regprocedure)) = 0
     or position('evidence_basis' in pg_get_functiondef(v_sig::regprocedure)) = 0
     or position('review_guidance' in pg_get_functiondef(v_sig::regprocedure)) = 0 then
    raise exception 'Scraped Properties presentation or review-detail contract changed';
  end if;

  insert into plm.dcp_property (source_system, source_id, display_name)
  values ('disney_dcpvault', v_search || '/conflict', v_search || ' conflict');
  insert into plm.opa_property (licensed_property_id, property_name)
  values (v_conflict_property_id, v_search || ' conflict OPA');
  insert into plm.opa_property_scope_membership (
    licensed_property_id, region_code, branch_code, line_of_business_id,
    product_type_code, template_id, workflow_id, capture_id,
    source_captured_at, approval_status, evidence_reference, evidence_sha256,
    approved_at, approved_by
  ) values (
    v_conflict_property_id, 'north-america', 'disney', 200, 'home-standard',
    462, 50, v_search || '-conflict-capture', now(), 'approved',
    'private-conflict-fixture', repeat('2',64), now(), 'contract'
  );
  insert into plm.dcp_property_licensor_resolution (
    source_system, source_property_id, presentation_licensor_key,
    presentation_licensor_name, resolution_status, authority_kind,
    authority_reference, evidence_reference, source_hash, resolved_at,
    decision_version, approval_status, approved_at, approved_by, decision_reason
  ) values (
    'disney_dcpvault', v_search || '/conflict', null, null,
    'authority_conflict', 'conflicting_direct_authority', 'synthetic',
    'private-pointer', repeat('e',64), now(), 1, 'approved', now(),
    'contract', 'synthetic authority conflict'
  );
  insert into plm.dcp_opa_property_resolution (
    source_system, source_table, source_property_id, decision_version,
    approval_status, evidence_reference, evidence_sha256, decision_reason,
    contract_asserted_studio_code, contract_evidence_reference,
    contract_evidence_sha256, approved_at, approved_by
  ) values (
    'disney_dcpvault', 'plm.dcp_property', v_search || '/conflict', 1,
    'approved', 'private-conflict-link', repeat('3',64), 'synthetic conflict',
    'lucasfilm', 'private-conflict-contract', repeat('4',64), now(), 'contract'
  ) returning resolution_id into v_conflict;
  insert into plm.dcp_opa_property_resolution_member (
    resolution_id, licensed_property_id, member_ordinal
  ) values (v_conflict, v_conflict_property_id, 1);

  select api.db_data_admin_scraped_properties(v_search || ' conflict', null, 100)
    into v_page;
  select r into v_row from jsonb_array_elements(v_page -> 'rows') r
  where r ->> 'source_property_id' = v_search || '/conflict';
  if v_row ->> 'presentation_licensor_name' <> 'DCP Creative - contract/OPA conflict'
     or v_row ->> 'source_status' <> 'contract_opa_conflict'
     or v_row ->> 'evidence_basis' <> 'authoritative signed-contract assertion compared independently with direct latest captured OPA scope through exact OPA Property IDs'
     or position('Licensing' in coalesce(v_row ->> 'review_reason', '')) = 0 then
    raise exception 'authority-conflict RPC guidance contract changed: %', v_row;
  end if;

  begin
    insert into plm.dcp_property_licensor_resolution (
      source_system, source_property_id, resolution_status, source_hash,
      decision_version, supersedes_resolution_id, approval_status, decision_reason
    ) values (
      'other_identity', v_search || '/other', 'unresolved', repeat('d',64),
      2, v_first, 'pending', 'cross-identity supersession must fail'
    );
    raise exception 'cross-identity DCP supersession was accepted';
  exception when foreign_key_violation then null;
  end;
end $$;

rollback;
