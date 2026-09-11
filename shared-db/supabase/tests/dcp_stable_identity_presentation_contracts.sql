-- Synthetic, rollback-only regression for #2706. No licensed source values.
begin;
do $$
declare
  k text := 'dcpvault:zz2706-' || replace(gen_random_uuid()::text,'-','');
  a bigint := -270600000001;
  b bigint := -270600000002;
  profile_id uuid;
  auth_id uuid;
  licensing_role uuid;
  mapped_id uuid;
  conflict_id uuid;
  page jsonb;
  row_value jsonb;
  cursor_value text;
  copies integer := 0;
  seen integer := 0;
begin
  select p.id,p.auth_user_id into profile_id,auth_id from app.profile p
  where p.status='active' and p.auth_user_id is not null order by p.created_at,p.id limit 1;
  if auth_id is null then raise exception '#2706 requires seeded authenticated profile'; end if;
  select id into licensing_role from app.role where slug='licensing'::app.app_role;
  insert into app.user_role(profile_id,role_id) values(profile_id,licensing_role) on conflict do nothing;
  insert into app.app_access(profile_id,app) values(profile_id,'plm') on conflict do nothing;
  perform set_config('request.jwt.claim.sub',auth_id::text,true);

  insert into plm.opa_property(licensed_property_id,property_name)
  values(a,k||' target A'),(b,k||' target B');
  insert into plm.opa_property_scope_membership(
    licensed_property_id,region_code,branch_code,line_of_business_id,product_type_code,
    template_id,workflow_id,capture_id,source_captured_at,approval_status,
    evidence_reference,evidence_sha256,approved_at,approved_by)
  values(a,'north-america','disney',200,'home-standard',462,50,k,now(),'approved',
    'synthetic-2706',repeat('a',64),now(),'contract'),
    (b,'north-america','disney',200,'home-standard',462,50,k,now(),'approved',
    'synthetic-2706',repeat('b',64),now(),'contract');

  insert into plm.dcp_property(source_system,source_id,display_name)
  values('disney_dcpvault',k,k||' retained A'),('disney_dcpvault',k||'-unknown',k||' unknown');
  insert into plm.lucasfilm_dcp_property(source_system,source_id,display_name)
  values('lucasfilm_dcpvault',k,k||' retained B');
  insert into plm.twentieth_century_dcp_property(source_system,source_id,display_name)
  values('twentieth_century_dcpvault',k,k||' retained C');
  insert into plm.marvel_dcp_property(source_system,source_id,display_name)
  values('marvel_dcpvault',k,k||' retained raw tag');

  insert into plm.dcp_opa_property_resolution(source_system,source_table,source_property_id,
    decision_version,approval_status,creative_decision_state,evidence_reference,evidence_sha256,
    decision_reason,approved_at,approved_by)
  values('disney_dcpvault','plm.dcp_property',k,1,'approved','unmapped','synthetic-2706',
    repeat('c',64),'synthetic copy-local unmapped',now(),'contract');
  insert into plm.dcp_opa_property_resolution(source_system,source_table,source_property_id,
    decision_version,approval_status,evidence_reference,evidence_sha256,
    decision_reason,approved_at,approved_by)
  values('marvel_dcpvault','plm.marvel_dcp_property',k,1,'approved','synthetic-2706',
    repeat('d',64),'synthetic stable mapping',now(),'contract') returning resolution_id into mapped_id;
  insert into plm.dcp_opa_property_resolution_member(resolution_id,licensed_property_id,
    member_ordinal,submission_source_system,submission_source_table,submission_source_id)
  values(mapped_id,a,1,'disney_opa','plm.opa_property',a::text);
  -- A later same-copy proposal must not hide its approved terminal authority.
  insert into plm.dcp_opa_property_resolution(source_system,source_table,source_property_id,
    decision_version,supersedes_resolution_id,approval_status,evidence_reference,evidence_sha256,decision_reason)
  values('marvel_dcpvault','plm.marvel_dcp_property',k,2,mapped_id,'pending',
    'synthetic-2706-proposal',repeat('e',64),'synthetic pending proposal');

  page := api.db_data_admin_scraped_properties(k,null,100);
  for row_value in select value from jsonb_array_elements(page->'rows') loop
    if row_value->>'source_property_id'=k and row_value->>'source_table'<>'plm.marvel_dcp_property' then
      copies := copies+1;
      if row_value->>'presentation_licensor_key' is distinct from 'disney'
        or row_value->>'source_status' is distinct from 'direct_disney'
        or row_value->>'mapping_state' is distinct from 'mapped'
        or row_value->>'review_reason' is not null
        or row_value->>'review_guidance' is not null
        or row_value->>'evidence_basis' is not null
        or row_value->>'presentation_licensor_name' is distinct from 'Disney - Creative (DCP Vault)' then
        raise exception '#2706 retained-copy presentation contradicts stable authority';
      end if;
    elsif row_value->>'source_table'='plm.marvel_dcp_property' then
      if row_value->>'source_status' is distinct from 'non_authoritative'
        or row_value->>'presentation_licensor_key' is distinct from 'dcp-vault-non-authoritative-marvel-tag' then
        raise exception '#2706 raw Marvel tag became Creative authority';
      end if;
    elsif row_value->>'source_property_id'=k||'-unknown' then
      if row_value->>'source_status' is distinct from 'unresolved'
        or row_value->>'mapping_state' is distinct from 'unmapped'
        or row_value->>'review_guidance' is null then
        raise exception '#2706 genuine unresolved identity was suppressed';
      end if;
    end if;
  end loop;
  if copies<>3 then raise exception '#2706 expected all three Creative provenance copies'; end if;

  loop
    page := api.db_data_admin_scraped_properties(k,cursor_value,1);
    seen := seen+jsonb_array_length(page->'rows');
    cursor_value := page->>'next_cursor';
    exit when cursor_value is null;
    if seen>20 then raise exception '#2706 pagination repeated a cursor'; end if;
  end loop;
  if seen<>7 then raise exception '#2706 pagination lost source rows'; end if;

  -- A non-namespaced 20th Century identity retains its independent source group.
  insert into plm.twentieth_century_dcp_property(source_system,source_id,display_name)
  values('twentieth_century_dcpvault','bare-'||k,k||' independent twentieth');
  page := api.db_data_admin_scraped_properties(k||' independent twentieth',null,100);
  if jsonb_array_length(page->'rows')<>1 then raise exception '#2706 independent twentieth fixture missing'; end if;
  row_value := page->'rows'->0;
  if row_value->>'presentation_licensor_key' is distinct from '20th-century'
    or row_value->>'presentation_licensor_name' is distinct from '20th Century - Creative (DCP Vault)'
    or row_value->>'source_status' is not null then
    raise exception '#2706 changed independent twentieth source presentation';
  end if;

  insert into plm.dcp_opa_property_resolution(source_system,source_table,source_property_id,
    decision_version,approval_status,creative_decision_state,evidence_reference,evidence_sha256,
    decision_reason,approved_at,approved_by)
  values('lucasfilm_dcpvault','plm.lucasfilm_dcp_property',k,1,'approved','mapped','synthetic-2706-conflict',
    repeat('f',64),'synthetic differing terminal membership',now(),'contract') returning resolution_id into conflict_id;
  insert into plm.dcp_opa_property_resolution_member(resolution_id,licensed_property_id,
    member_ordinal,submission_source_system,submission_source_table,submission_source_id)
  values(conflict_id,b,1,'disney_opa','plm.opa_property',b::text);
  page := api.db_data_admin_scraped_properties(k,null,100);
  copies := 0;
  for row_value in select value from jsonb_array_elements(page->'rows') loop
    if row_value->>'source_property_id'=k and row_value->>'source_table'<>'plm.marvel_dcp_property' then
      copies := copies+1;
      if row_value->>'source_status' is distinct from 'authority_conflict'
        or row_value->>'mapping_state' is distinct from 'conflict'
        or row_value->>'review_reason' is null or row_value->>'review_guidance' is null then
        raise exception '#2706 terminal conflict lost its explicit review treatment';
      end if;
    end if;
  end loop;
  if copies<>3 then raise exception '#2706 conflict hid retained Creative copies'; end if;

  -- Disney OPA cannot distinguish Marvel studio placement. The signed studio
  -- assertion must win identically in Disney and Lucasfilm retained copies.
  insert into plm.dcp_property(source_system,source_id,display_name)
  values('disney_dcpvault',k||'-studio',k||' studio A');
  insert into plm.lucasfilm_dcp_property(source_system,source_id,display_name)
  values('lucasfilm_dcpvault',k||'-studio',k||' studio B');
  insert into plm.dcp_opa_property_resolution(source_system,source_table,source_property_id,
    decision_version,approval_status,evidence_reference,evidence_sha256,decision_reason,
    contract_asserted_studio_code,contract_evidence_reference,contract_evidence_sha256,approved_at,approved_by)
  values('disney_dcpvault','plm.dcp_property',k||'-studio',1,'approved','synthetic-2706-studio',
    repeat('a',64),'synthetic signed studio assertion','marvel','synthetic-contract',repeat('b',64),now(),'contract')
  returning resolution_id into mapped_id;
  insert into plm.dcp_opa_property_resolution_member(resolution_id,licensed_property_id,
    member_ordinal,submission_source_system,submission_source_table,submission_source_id)
  values(mapped_id,a,1,'disney_opa','plm.opa_property',a::text);
  -- A newer member-equivalent mapped copy without a contract must not erase
  -- the existing signed studio assertion belonging to this stable identity.
  insert into plm.dcp_opa_property_resolution(source_system,source_table,source_property_id,
    decision_version,approval_status,evidence_reference,evidence_sha256,decision_reason,approved_at,approved_by)
  values('lucasfilm_dcpvault','plm.lucasfilm_dcp_property',k||'-studio',1,'approved',
    'synthetic-2706-studio-copy',repeat('c',64),'synthetic member-equivalent copy',now()+interval '1 second','contract')
  returning resolution_id into conflict_id;
  insert into plm.dcp_opa_property_resolution_member(resolution_id,licensed_property_id,
    member_ordinal,submission_source_system,submission_source_table,submission_source_id)
  values(conflict_id,a,1,'disney_opa','plm.opa_property',a::text);
  page := api.db_data_admin_scraped_properties(k||'-studio',null,100);
  if jsonb_array_length(page->'rows')<>2 then raise exception '#2706 signed studio fixture missing'; end if;
  for row_value in select value from jsonb_array_elements(page->'rows') loop
    if row_value->>'source_status' is distinct from 'direct_marvel'
      or row_value->>'presentation_licensor_key' is distinct from 'marvel'
      or row_value->>'review_reason' is not null then
      raise exception '#2706 signed studio placement differs between retained copies';
    end if;
  end loop;

  -- Conflicting signed studio assertions fail closed even when member sets agree.
  insert into plm.dcp_opa_property_resolution(source_system,source_table,source_property_id,
    decision_version,supersedes_resolution_id,approval_status,evidence_reference,evidence_sha256,decision_reason,
    contract_asserted_studio_code,contract_evidence_reference,contract_evidence_sha256,approved_at,approved_by)
  values('lucasfilm_dcpvault','plm.lucasfilm_dcp_property',k||'-studio',2,conflict_id,'approved',
    'synthetic-2706-studio-conflict',repeat('d',64),'synthetic conflicting signed studio',
    'lucasfilm','synthetic-contract-conflict',repeat('e',64),now(),'contract')
  returning resolution_id into conflict_id;
  insert into plm.dcp_opa_property_resolution_member(resolution_id,licensed_property_id,
    member_ordinal,submission_source_system,submission_source_table,submission_source_id)
  values(conflict_id,a,1,'disney_opa','plm.opa_property',a::text);
  page := api.db_data_admin_scraped_properties(k||'-studio',null,100);
  if jsonb_array_length(page->'rows')<>2 then raise exception '#2706 studio conflict hid source rows'; end if;
  for row_value in select value from jsonb_array_elements(page->'rows') loop
    if row_value->>'source_status' is distinct from 'authority_conflict'
      or row_value->>'presentation_licensor_key' is distinct from 'dcp-authority-conflict'
      or row_value->>'mapping_state' is distinct from 'mapped'
      or row_value->>'review_reason' is null or row_value->>'review_guidance' is null then
      raise exception '#2706 conflicting studio assertions did not fail closed independently of agreed mapping';
    end if;
  end loop;
end $$;
rollback;
