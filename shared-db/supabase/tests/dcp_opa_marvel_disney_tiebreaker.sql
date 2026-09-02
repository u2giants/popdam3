-- Rollback-safe, synthetic positive and negative contract for issue #1999.
begin;

do $test$
declare
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  v_search text;
  v_opa_property_id bigint := -199900000001;
  v_role_id uuid;
  v_profile uuid;
  v_auth uuid;
  v_marvel_resolution uuid;
  v_lucasfilm_resolution uuid;
  v_page jsonb;
  v_row jsonb;
  v_definition text;
begin
  v_search := 'Issue1999-' || v_suffix;

  select pg_get_functiondef(
    'api.db_data_admin_scraped_properties(text,text,integer)'::regprocedure
  ) into v_definition;
  if position($needle$r.contract_asserted_studio_code = 'marvel'$needle$ in v_definition) = 0
     or position($needle$o.opa_studio_code = 'disney'$needle$ in v_definition) = 0 then
    raise exception 'Marvel-contract/Disney-OPA exception is missing from the live function';
  end if;

  select p.id, p.auth_user_id into v_profile, v_auth
  from app.profile p
  where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id
  limit 1;
  select r.id into v_role_id
  from app.role r
  where r.slug = 'licensing'::app.app_role;
  delete from app.user_role where profile_id = v_profile and role_id = v_role_id;
  delete from app.app_access where profile_id = v_profile and app in ('plm', 'admin');
  insert into app.user_role (profile_id, role_id) values (v_profile, v_role_id);
  insert into app.app_access (profile_id, app) values (v_profile, 'plm');
  perform set_config('request.jwt.claim.sub', v_auth::text, true);

  insert into plm.opa_property (licensed_property_id, property_name)
  values (v_opa_property_id, v_search || ' OPA');
  insert into plm.opa_property_scope_membership (
    licensed_property_id, region_code, branch_code, line_of_business_id,
    product_type_code, template_id, workflow_id, capture_id,
    source_captured_at, approval_status, evidence_reference, evidence_sha256,
    approved_at, approved_by
  ) values (
    v_opa_property_id, 'north-america', 'disney', 200, 'home-standard',
    462, 50, v_search || '-capture', now(), 'approved',
    'synthetic-disney-scope', repeat('a', 64), now(), 'contract'
  );

  insert into plm.dcp_property (source_system, source_id, display_name) values
    ('disney_dcpvault', v_search || '/marvel', v_search || ' Marvel contract'),
    ('disney_dcpvault', v_search || '/lucasfilm', v_search || ' Lucasfilm contract');

  insert into plm.dcp_opa_property_resolution (
    source_system, source_table, source_property_id, decision_version,
    approval_status, evidence_reference, evidence_sha256, decision_reason,
    contract_asserted_studio_code, contract_evidence_reference,
    contract_evidence_sha256, approved_at, approved_by
  ) values (
    'disney_dcpvault', 'plm.dcp_property', v_search || '/marvel', 1,
    'approved', 'synthetic-marvel-link', repeat('b', 64), 'synthetic exact link',
    'marvel', 'synthetic-marvel-contract', repeat('c', 64), now(), 'contract'
  ) returning resolution_id into v_marvel_resolution;

  insert into plm.dcp_opa_property_resolution (
    source_system, source_table, source_property_id, decision_version,
    approval_status, evidence_reference, evidence_sha256, decision_reason,
    contract_asserted_studio_code, contract_evidence_reference,
    contract_evidence_sha256, approved_at, approved_by
  ) values (
    'disney_dcpvault', 'plm.dcp_property', v_search || '/lucasfilm', 1,
    'approved', 'synthetic-lucasfilm-link', repeat('d', 64), 'synthetic exact link',
    'lucasfilm', 'synthetic-lucasfilm-contract', repeat('e', 64), now(), 'contract'
  ) returning resolution_id into v_lucasfilm_resolution;

  insert into plm.dcp_opa_property_resolution_member (
    resolution_id, licensed_property_id, member_ordinal
  ) values
    (v_marvel_resolution, v_opa_property_id, 1),
    (v_lucasfilm_resolution, v_opa_property_id, 1);

  select api.db_data_admin_scraped_properties(v_search, null, 100) into v_page;

  select r into v_row
  from jsonb_array_elements(v_page -> 'rows') r
  where r ->> 'source_property_id' = v_search || '/marvel';
  if v_row ->> 'source_status' <> 'direct_marvel'
     or v_row ->> 'presentation_licensor_name' <> 'DCP Vault - Creative (authoritative Marvel scope)' then
    raise exception 'Marvel contract did not win over Disney OPA scope: %', v_row;
  end if;

  select r into v_row
  from jsonb_array_elements(v_page -> 'rows') r
  where r ->> 'source_property_id' = v_search || '/lucasfilm';
  if v_row ->> 'source_status' <> 'contract_opa_conflict'
     or v_row ->> 'presentation_licensor_name' <> 'DCP Creative - contract/OPA conflict' then
    raise exception 'Lucasfilm contract/Disney OPA disagreement stopped failing closed: %', v_row;
  end if;
end;
$test$;

rollback;
