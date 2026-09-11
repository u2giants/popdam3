-- Synthetic rollback-only evidence. No licensed names, identifiers or portal files.
begin;

create function pg_temp.opa_compliance_fixture(
  p_property bigint,p_state text,p_time timestamptz,p_branch text default 'disney',
  p_account text default repeat('a',64),p_finalize boolean default true,p_empty boolean default false)
returns uuid language plpgsql as $$
declare c uuid:=gen_random_uuid(); k text:=c::text; d text;
begin
  d:=encode(extensions.digest(convert_to(case when p_empty then '' else p_property::text||':'||p_state end,'UTF8'),'sha256'),'hex');
  insert into plm.opa_property_compliance_capture(
    compliance_capture_id,capture_key,capture_id,region_code,branch_code,line_of_business_id,
    product_type_code,template_id,workflow_id,account_scope_sha256,source_repository,
    source_commit_sha,source_manifest_sha256,compliant_file_sha256,show_all_file_sha256,
    paired_validation_sha256,evidence_reference,authentication_evidence_sha256,authenticated_at,
    capture_started_at,source_captured_at,expected_compliant_property_count,expected_show_all_property_count,
    expected_compliant_relationship_count,expected_show_all_relationship_count,
    observed_compliant_relationship_count,observed_show_all_relationship_count,duplicate_relationship_count,
    property_subset_verified,relationship_subset_verified,expected_membership_sha256,created_by)
  values(c,k,k,'synthetic-region',p_branch,2703,'synthetic-product',2703,2703,p_account,'synthetic-repository',
    repeat('b',40),repeat('c',64),repeat('d',64),repeat('e',64),repeat('f',64),'synthetic-evidence',repeat('0',64),
    p_time,p_time,p_time,case when not p_empty and p_state='compliant' then 1 else 0 end,
    case when p_empty then 0 else 1 end,case when not p_empty and p_state='compliant' then 1 else 0 end,
    case when p_empty then 0 else 1 end,case when not p_empty and p_state='compliant' then 1 else 0 end,
    case when p_empty then 0 else 1 end,0,true,true,d,'synthetic-reviewer');
  if not p_empty then
    insert into plm.opa_property_scope_membership(licensed_property_id,region_code,branch_code,
      line_of_business_id,product_type_code,template_id,workflow_id,capture_id,source_captured_at,
      approval_status,evidence_reference,evidence_sha256,approved_at,approved_by,compliance_status,compliance_capture_id)
    values(p_property,'synthetic-region',p_branch,2703,'synthetic-product',2703,2703,k,p_time,
      'approved','synthetic-evidence',repeat('1',64),clock_timestamp(),'synthetic-reviewer',p_state,c);
  end if;
  if p_finalize then perform plm.finalize_opa_property_compliance_capture(c,'synthetic-reviewer'); end if;
  return c;
end $$;

do $$
declare
  p bigint:=-270300000001; legacy bigint:=-270300000002;
  k text:='dcpvault:synthetic-2703-'||gen_random_uuid()::text;
  c uuid; incomplete uuid; r uuid; member uuid; t timestamptz:='2001-01-01T00:00:00Z';
  profile uuid; auth_id uuid; role_id uuid; payload jsonb; v jsonb;
begin
  insert into plm.opa_property(licensed_property_id,property_name) values(p,k),(legacy,k||'-legacy');
  insert into plm.opa_property_scope_membership(licensed_property_id,region_code,branch_code,
    line_of_business_id,product_type_code,template_id,workflow_id,capture_id,source_captured_at,
    approval_status,evidence_reference,evidence_sha256,approved_at,approved_by)
  values(legacy,'synthetic-region','disney',2703,'synthetic-product',2703,2703,k,t,
    'approved','synthetic-legacy',repeat('2',64),now(),'synthetic-reviewer');
  if not exists(select 1 from plm.opa_property_current_compliance where licensed_property_id=legacy
      and compliance_status='unknown' and not eligible_for_new_styles and not eligible_for_new_coldlion_entry) then
    raise exception '#2703 legacy evidence invented rights'; end if;

  c:=pg_temp.opa_compliance_fixture(p,'compliant',t);
  if not exists(select 1 from plm.opa_property_current_compliance where licensed_property_id=p
      and compliance_status='compliant' and eligible_for_new_styles and eligible_for_new_coldlion_entry) then
    raise exception '#2703 compliant observation not current'; end if;
  if plm.finalize_opa_property_compliance_capture(c,'synthetic-reviewer')<>c then
    raise exception '#2703 exact completed finalize not idempotent'; end if;
  begin
    truncate plm.opa_property_compliance_capture cascade;
    raise exception '#2703 truncated retained compliance evidence';
  exception when object_not_in_prerequisite_state then null; end;
  begin
    update plm.opa_property_compliance_capture set evidence_reference='changed' where compliance_capture_id=c;
    raise exception '#2703 changed sealed source evidence';
  exception when object_not_in_prerequisite_state then null; end;
  select membership_id into member from plm.opa_property_scope_membership where compliance_capture_id=c;
  begin
    update plm.opa_property_scope_membership set approval_status='pending',approved_at=null,approved_by=null where membership_id=member;
    raise exception '#2703 rewrote immutable evidence approval';
  exception when object_not_in_prerequisite_state then null; end;
  begin
    delete from plm.opa_property_scope_membership where membership_id=member;
    raise exception '#2703 deleted historical observation';
  exception when object_not_in_prerequisite_state then null; end;
  begin
    insert into plm.opa_property_scope_membership select gen_random_uuid(),legacy,region_code,branch_code,
      line_of_business_id,product_type_code,template_id,workflow_id,capture_id,source_captured_at,
      approval_status,evidence_reference,evidence_sha256,approved_at,approved_by,created_at,compliance_status,compliance_capture_id
      from plm.opa_property_scope_membership where membership_id=member;
    raise exception '#2703 appended after finalization';
  exception when object_not_in_prerequisite_state then null; end;

  c:=pg_temp.opa_compliance_fixture(p,'non_compliant',t+interval '1 day');
  if not exists(select 1 from plm.opa_property_current_compliance where licensed_property_id=p
      and compliance_status='non_compliant' and not eligible_for_new_styles and not eligible_for_new_coldlion_entry) then
    raise exception '#2703 older compliance resurrected current rights'; end if;
  incomplete:=pg_temp.opa_compliance_fixture(p,'compliant',t+interval '2 days','disney',repeat('a',64),false);
  if exists(select 1 from plm.opa_property_current_compliance where licensed_property_id=p and eligible_for_new_styles) then
    raise exception '#2703 incomplete capture became authority'; end if;
  -- A later approved empty Show All is absence, never an explicit revocation/reactivation.
  perform pg_temp.opa_compliance_fixture(p,'compliant',t+interval '3 days','disney',repeat('a',64),true,true);
  if not exists(select 1 from plm.opa_property_current_compliance where licensed_property_id=p
      and compliance_status='non_compliant' and absent_from_newer_complete_capture) then
    raise exception '#2703 absence erased explicit state'; end if;
  perform pg_temp.opa_compliance_fixture(p,'compliant',t+interval '4 days');
  if not exists(select 1 from plm.opa_property_current_compliance where licensed_property_id=p and eligible_for_new_styles) then
    raise exception '#2703 explicit reactivation failed'; end if;
  -- Approving an older observation late cannot win over the newer source time.
  perform plm.finalize_opa_property_compliance_capture(incomplete,'synthetic-late-reviewer');
  if not exists(select 1 from plm.opa_property_current_compliance where licensed_property_id=p
      and source_captured_at=t+interval '4 days') then raise exception '#2703 approval time overrode observation time'; end if;
  begin
    perform pg_temp.opa_compliance_fixture(p,'non_compliant',t+interval '4 days');
    raise exception '#2703 conflicting simultaneous observations accepted';
  exception when check_violation then null; end;
  perform pg_temp.opa_compliance_fixture(p,'non_compliant',t+interval '5 days','lucasfilm');
  perform pg_temp.opa_compliance_fixture(p,'non_compliant',t+interval '5 days','disney',repeat('b',64));
  if (select count(*) from plm.opa_property_current_compliance where licensed_property_id=p)<>3
    or (select count(*) from plm.opa_property_current_compliance where licensed_property_id=p and eligible_for_new_styles)<>1 then
    raise exception '#2703 borrowed rights across route/account'; end if;

  c:=pg_temp.opa_compliance_fixture(p,'non_compliant',t+interval '6 days','disney',repeat('a',64),false);
  select membership_id into member from plm.opa_property_scope_membership where compliance_capture_id=c;
  begin
    insert into plm.opa_property_scope_membership select gen_random_uuid(),legacy,region_code,'lucasfilm',
      line_of_business_id,product_type_code,template_id,workflow_id,capture_id,source_captured_at,
      approval_status,evidence_reference,evidence_sha256,approved_at,approved_by,created_at,compliance_status,compliance_capture_id
      from plm.opa_property_scope_membership where membership_id=member;
    raise exception '#2703 accepted mismatched capture route';
  exception when check_violation then null; end;
  insert into plm.opa_property_scope_membership select gen_random_uuid(),legacy,region_code,branch_code,
    line_of_business_id,product_type_code,template_id,workflow_id,capture_id,source_captured_at,
    approval_status,evidence_reference,evidence_sha256,approved_at,approved_by,created_at,compliance_status,compliance_capture_id
    from plm.opa_property_scope_membership where membership_id=member;
  begin
    perform plm.finalize_opa_property_compliance_capture(c,'synthetic-reviewer');
    raise exception '#2703 accepted inconsistent actual count/digest';
  exception when check_violation then null; end;
  update plm.opa_property_compliance_capture set status='rejected',rejection_reason='synthetic mismatch',
    load_completed_at=clock_timestamp() where compliance_capture_id=c;
  if not exists(select 1 from plm.opa_property_current_compliance where licensed_property_id=p
      and branch_code='disney' and account_scope_sha256=repeat('a',64) and eligible_for_new_styles) then
    raise exception '#2703 rejected capture became current'; end if;

  -- The public RPC retains source rows and mapping, and exposes route-specific rights.
  select id,auth_user_id into profile,auth_id from app.profile where status='active' and auth_user_id is not null limit 1;
  if auth_id is null then raise exception '#2703 requires seeded authenticated profile'; end if;
  select id into role_id from app.role where slug='licensing'::app.app_role;
  insert into app.user_role(profile_id,role_id) values(profile,role_id) on conflict do nothing;
  insert into app.app_access(profile_id,app) values(profile,'plm') on conflict do nothing;
  perform set_config('request.jwt.claim.sub',auth_id::text,true);
  insert into plm.dcp_property(source_system,source_id,display_name) values('disney_dcpvault',k,k);
  insert into plm.dcp_opa_property_resolution(source_system,source_table,source_property_id,decision_version,
    approval_status,evidence_reference,evidence_sha256,decision_reason,approved_at,approved_by)
  values('disney_dcpvault','plm.dcp_property',k,1,'approved','synthetic',repeat('3',64),'synthetic mapping',now(),'synthetic-reviewer')
  returning resolution_id into r;
  insert into plm.dcp_opa_property_resolution_member(resolution_id,licensed_property_id,member_ordinal,
    submission_source_system,submission_source_table,submission_source_id)
  values(r,p,1,'disney_opa','plm.opa_property',p::text);
  payload:=api.db_data_admin_scraped_properties(k,null,100);
  if jsonb_array_length(payload->'rows')<>3 then raise exception '#2703 source presence lost'; end if;
  for v in select value from jsonb_array_elements(payload->'rows') loop
    if v->>'source_property_id' in (p::text,k) then
      if v->>'current_rights_status'<>'route_specific' or jsonb_array_length(v->'current_rights')<>3 then
        raise exception '#2703 OPA/DCP rights differ or lost exact-route context'; end if;
    end if;
    if v->>'source_property_id'=k and v->>'mapping_state'<>'mapped' then
      raise exception '#2703 current rights erased historical mapping'; end if;
  end loop;
  if has_function_privilege('authenticated','plm.finalize_opa_property_compliance_capture(uuid,text)','EXECUTE')
    or has_table_privilege('authenticated','plm.opa_property_compliance_capture','SELECT')
    or has_table_privilege('service_role','plm.opa_property_compliance_capture','UPDATE') then
    raise exception '#2703 broadened direct access'; end if;
end $$;
rollback;
