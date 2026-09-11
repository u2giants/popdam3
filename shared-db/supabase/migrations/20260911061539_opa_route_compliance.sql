-- #2703: explicit current rights are independent of retained identity and review approval.
-- derived-from: 20260911050646
create table plm.opa_property_compliance_capture (
  compliance_capture_id uuid default gen_random_uuid(),
  capture_key text not null,
  capture_id text not null,
  region_code text not null,
  branch_code text not null,
  line_of_business_id bigint not null,
  product_type_code text not null,
  template_id bigint not null,
  workflow_id bigint not null,
  account_scope_sha256 text not null,
  source_repository text not null,
  source_commit_sha text not null,
  source_manifest_sha256 text not null,
  compliant_file_sha256 text not null,
  show_all_file_sha256 text not null,
  paired_validation_sha256 text not null,
  evidence_reference text not null,
  authentication_evidence_sha256 text not null,
  authenticated_at timestamptz not null,
  capture_started_at timestamptz not null,
  source_captured_at timestamptz not null,
  expected_compliant_property_count bigint not null,
  expected_show_all_property_count bigint not null,
  expected_compliant_relationship_count bigint not null,
  expected_show_all_relationship_count bigint not null,
  observed_compliant_relationship_count bigint not null,
  observed_show_all_relationship_count bigint not null,
  duplicate_relationship_count bigint not null,
  property_subset_verified boolean not null,
  relationship_subset_verified boolean not null,
  expected_membership_sha256 text not null,
  status text not null default 'loading',
  approval_status text not null default 'pending',
  approved_at timestamptz,
  approved_by text,
  rejection_reason text,
  load_started_at timestamptz not null default clock_timestamp(),
  load_completed_at timestamptz,
  created_by text not null,
  constraint opa_compliance_capture_pkey primary key(compliance_capture_id),
  constraint opa_compliance_capture_key_key unique(capture_key),
  constraint opa_compliance_capture_shape_ck check (
    btrim(capture_key)<>'' and btrim(capture_id)<>'' and btrim(region_code)<>''
    and branch_code in ('disney','lucasfilm') and btrim(product_type_code)<>''
    and btrim(source_repository)<>'' and btrim(evidence_reference)<>'' and btrim(created_by)<>''
    and source_commit_sha ~ '^[0-9a-f]{40}$'
    and account_scope_sha256 ~ '^[0-9a-f]{64}$'
    and source_manifest_sha256 ~ '^[0-9a-f]{64}$'
    and compliant_file_sha256 ~ '^[0-9a-f]{64}$'
    and show_all_file_sha256 ~ '^[0-9a-f]{64}$'
    and paired_validation_sha256 ~ '^[0-9a-f]{64}$'
    and authentication_evidence_sha256 ~ '^[0-9a-f]{64}$'
    and expected_membership_sha256 ~ '^[0-9a-f]{64}$'
    and authenticated_at<=source_captured_at and capture_started_at<=source_captured_at),
  constraint opa_compliance_capture_counts_ck check (
    expected_compliant_property_count>=0
    and expected_show_all_property_count>=expected_compliant_property_count
    and expected_compliant_relationship_count>=expected_compliant_property_count
    and expected_show_all_relationship_count>=expected_show_all_property_count
    and expected_show_all_relationship_count>=expected_compliant_relationship_count
    and observed_compliant_relationship_count>=0 and observed_show_all_relationship_count>=0
    and duplicate_relationship_count>=0),
  constraint opa_compliance_capture_status_ck check (
    (status='loading' and load_completed_at is null and rejection_reason is null)
    or (status='complete' and load_completed_at is not null and rejection_reason is null)
    or (status='rejected' and load_completed_at is not null and rejection_reason is not null and btrim(rejection_reason)<>'')),
  constraint opa_compliance_capture_approval_ck check (
    (approval_status='approved' and approved_at is not null and approved_by is not null and btrim(approved_by)<>'')
    or (approval_status in ('pending','rejected') and approved_at is null and approved_by is null))
);

alter table plm.opa_property_scope_membership
  add column compliance_status text not null default 'unknown',
  add column compliance_capture_id uuid,
  add constraint opa_compliance_membership_status_ck
    check(compliance_status in ('compliant','non_compliant','unknown')),
  add constraint opa_compliance_membership_capture_fk foreign key(compliance_capture_id)
    references plm.opa_property_compliance_capture(compliance_capture_id) on delete restrict,
  add constraint opa_compliance_membership_shape_ck check (
    (compliance_capture_id is null and compliance_status='unknown')
    or (compliance_capture_id is not null and compliance_status in ('compliant','non_compliant')));

create index opa_compliance_membership_capture_idx
  on plm.opa_property_scope_membership(compliance_capture_id,licensed_property_id);
create index opa_compliance_capture_route_time_idx
  on plm.opa_property_compliance_capture(region_code,branch_code,line_of_business_id,
    product_type_code,template_id,workflow_id,account_scope_sha256,source_captured_at desc)
  where status='complete' and approval_status='approved';

create function plm.guard_opa_property_compliance_membership() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare c plm.opa_property_compliance_capture%rowtype;
begin
  if tg_op<>'INSERT' then
    raise exception 'OPA scope observations are append-only' using errcode='55000';
  end if;
  if new.compliance_capture_id is null then return new; end if;
  select * into strict c from plm.opa_property_compliance_capture
    where compliance_capture_id=new.compliance_capture_id for update;
  if c.status<>'loading' then
    raise exception 'OPA compliance capture is sealed' using errcode='55000';
  end if;
  if (new.region_code,new.branch_code,new.line_of_business_id,new.product_type_code,
      new.template_id,new.workflow_id,new.capture_id,new.source_captured_at)
    is distinct from (c.region_code,c.branch_code,c.line_of_business_id,c.product_type_code,
      c.template_id,c.workflow_id,c.capture_id,c.source_captured_at) then
    raise exception 'OPA compliance observation route or capture differs' using errcode='23514';
  end if;
  return new;
end $$;
create trigger opa_compliance_membership_guard before insert or update or delete
  on plm.opa_property_scope_membership for each row
  execute function plm.guard_opa_property_compliance_membership();
create trigger opa_compliance_membership_truncate_guard before truncate
  on plm.opa_property_scope_membership for each statement
  execute function plm.guard_opa_property_compliance_membership();

create function plm.guard_opa_property_compliance_capture() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$
declare total_count bigint; compliant_count bigint; approved_count bigint; actual_digest text;
begin
  if tg_op='DELETE' or tg_op='TRUNCATE' then
    raise exception 'OPA compliance captures are retained' using errcode='55000';
  end if;
  if tg_op='INSERT' then
    if new.status<>'loading' then raise exception 'New OPA capture must start loading' using errcode='23514'; end if;
    return new;
  end if;
  if old.status<>'loading' then raise exception 'OPA compliance capture is sealed' using errcode='55000'; end if;
  if (to_jsonb(new)-array['status','approval_status','approved_at','approved_by','rejection_reason','load_completed_at'])
    is distinct from (to_jsonb(old)-array['status','approval_status','approved_at','approved_by','rejection_reason','load_completed_at']) then
    raise exception 'OPA capture source evidence is immutable' using errcode='55000';
  end if;
  if new.status='complete' then
    if new.approval_status<>'approved' or not new.property_subset_verified
      or not new.relationship_subset_verified or new.duplicate_relationship_count<>0
      or new.observed_compliant_relationship_count<>new.expected_compliant_relationship_count
      or new.observed_show_all_relationship_count<>new.expected_show_all_relationship_count then
      raise exception 'OPA paired capture validation is incomplete' using errcode='23514';
    end if;
    -- Serialize conflicting observations of the same route/account, including empty captures.
    perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(new.region_code,new.branch_code,
      new.line_of_business_id,new.product_type_code,new.template_id,new.workflow_id,new.account_scope_sha256)::text,2703));
    select count(*),count(*) filter(where compliance_status='compliant'),
      count(*) filter(where approval_status='approved'),
      encode(extensions.digest(convert_to(coalesce(string_agg(licensed_property_id::text||':'||compliance_status,
        chr(10) order by licensed_property_id),''),'UTF8'),'sha256'),'hex')
    into total_count,compliant_count,approved_count,actual_digest
    from plm.opa_property_scope_membership where compliance_capture_id=new.compliance_capture_id;
    if total_count<>new.expected_show_all_property_count
      or compliant_count<>new.expected_compliant_property_count or approved_count<>total_count
      or actual_digest<>new.expected_membership_sha256 then
      raise exception 'OPA loaded membership count or digest differs' using errcode='23514';
    end if;
    if exists(select 1 from plm.opa_property_scope_membership incoming
      join plm.opa_property_scope_membership previous using(licensed_property_id)
      join plm.opa_property_compliance_capture c on c.compliance_capture_id=previous.compliance_capture_id
      where incoming.compliance_capture_id=new.compliance_capture_id and c.status='complete'
        and c.approval_status='approved' and previous.approval_status='approved'
        and c.compliance_capture_id<>new.compliance_capture_id
        and (c.region_code,c.branch_code,c.line_of_business_id,c.product_type_code,c.template_id,
          c.workflow_id,c.account_scope_sha256,c.source_captured_at)
          =(new.region_code,new.branch_code,new.line_of_business_id,new.product_type_code,new.template_id,
          new.workflow_id,new.account_scope_sha256,new.source_captured_at)
        and incoming.compliance_status<>previous.compliance_status) then
      raise exception 'Conflicting OPA compliance observations at identical source time' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
create trigger opa_compliance_capture_guard before insert or update or delete
  on plm.opa_property_compliance_capture for each row
  execute function plm.guard_opa_property_compliance_capture();
create trigger opa_compliance_capture_truncate_guard before truncate
  on plm.opa_property_compliance_capture for each statement
  execute function plm.guard_opa_property_compliance_capture();

create function plm.finalize_opa_property_compliance_capture(p_capture_id uuid,p_approved_by text)
returns uuid language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare c plm.opa_property_compliance_capture%rowtype;
begin
  if p_approved_by is null or btrim(p_approved_by)='' then
    raise exception 'OPA evidence approver is required' using errcode='22023'; end if;
  select * into strict c from plm.opa_property_compliance_capture
    where compliance_capture_id=p_capture_id for update;
  if c.status='complete' and c.approval_status='approved' then return p_capture_id; end if;
  if c.status<>'loading' then raise exception 'OPA capture cannot be finalized' using errcode='55000'; end if;
  update plm.opa_property_compliance_capture set status='complete',approval_status='approved',
    approved_by=p_approved_by,approved_at=clock_timestamp(),load_completed_at=clock_timestamp()
    where compliance_capture_id=p_capture_id;
  return p_capture_id;
end $$;

create view plm.opa_property_current_compliance with(security_invoker=true) as
with eligible as (
  select m.*,c.account_scope_sha256,
    row_number() over(partition by m.licensed_property_id,m.region_code,m.branch_code,
      m.line_of_business_id,m.product_type_code,m.template_id,m.workflow_id,c.account_scope_sha256
      order by m.source_captured_at desc,m.created_at desc,m.membership_id desc) as observation_rank
  from plm.opa_property_scope_membership m
  left join plm.opa_property_compliance_capture c on c.compliance_capture_id=m.compliance_capture_id
  where m.approval_status='approved' and (m.compliance_capture_id is null
    or (c.status='complete' and c.approval_status='approved'))
)
select e.licensed_property_id,e.region_code,e.branch_code,e.line_of_business_id,e.product_type_code,
  e.template_id,e.workflow_id,e.account_scope_sha256,e.compliance_status,e.source_captured_at,
  e.capture_id,e.compliance_capture_id,e.membership_id,
  e.compliance_status='compliant' as eligible_for_new_styles,
  e.compliance_status='compliant' as eligible_for_new_coldlion_entry,
  exists(select 1 from plm.opa_property_compliance_capture c
    where c.status='complete' and c.approval_status='approved' and c.source_captured_at>e.source_captured_at
      and (c.region_code,c.branch_code,c.line_of_business_id,c.product_type_code,c.template_id,c.workflow_id)
        =(e.region_code,e.branch_code,e.line_of_business_id,e.product_type_code,e.template_id,e.workflow_id)
      and c.account_scope_sha256=e.account_scope_sha256
      and not exists(select 1 from plm.opa_property_scope_membership m
        where m.compliance_capture_id=c.compliance_capture_id and m.licensed_property_id=e.licensed_property_id))
    as absent_from_newer_complete_capture
from eligible e where observation_rank=1;

alter table plm.opa_property_compliance_capture enable row level security;
revoke all on plm.opa_property_compliance_capture,plm.opa_property_current_compliance from public,anon,authenticated,service_role;
grant select,insert on plm.opa_property_compliance_capture to service_role;
grant select on plm.opa_property_current_compliance to service_role;
revoke all on function plm.guard_opa_property_compliance_capture(),plm.guard_opa_property_compliance_membership(),
  plm.finalize_opa_property_compliance_capture(uuid,text) from public,anon,authenticated,service_role;
grant execute on function plm.finalize_opa_property_compliance_capture(uuid,text) to service_role;

comment on view plm.opa_property_current_compliance is
  'Explicit latest approved complete Property/route/account observation; unknown is not current rights. Absence never deactivates. Consumers must select the exact route/account, never borrow eligibility from another route.';
comment on column plm.opa_property_scope_membership.compliance_status is
  'Source rights observation, independent of evidence approval. Legacy evidence is unknown; two-view captures require compliant or non_compliant.';

-- Retained source/studio presentation is historical identity, not a current-rights gate.
CREATE OR REPLACE FUNCTION api.db_data_admin_scraped_properties(p_search text DEFAULT NULL::text, p_cursor text DEFAULT NULL::text, p_page_size integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public'
AS $function$
declare
  v_page_size integer;
  v_cursor_key text;
  v_rows jsonb;
  v_fetched integer;
  v_last_key text;
  v_next_cursor text;
begin
  -- Authorization and licensed-source reads remain one server-side operation.
  perform app.require_licensing_manager_access();

  v_page_size := least(greatest(coalesce(p_page_size, 500), 1), 1000);

  if p_cursor is not null then
    begin
      v_cursor_key := convert_from(decode(p_cursor, 'base64'), 'UTF8');
    exception when others then
      raise exception 'db_data_admin: invalid cursor'
        using errcode = 'invalid_parameter_value';
    end;
    if v_cursor_key is null or v_cursor_key = '' then
      raise exception 'db_data_admin: invalid cursor'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  with opa_scope_latest as materialized (
    select distinct on (
      m.licensed_property_id, m.region_code, m.branch_code,
      m.line_of_business_id, m.product_type_code, m.template_id, m.workflow_id
    )
      m.licensed_property_id, m.branch_code
    from plm.opa_property_scope_membership m
    where m.approval_status = 'approved'
    order by m.licensed_property_id, m.region_code, m.branch_code,
      m.line_of_business_id, m.product_type_code, m.template_id, m.workflow_id,
      m.source_captured_at desc, m.created_at desc, m.membership_id desc
  ), opa_scope_summary as materialized (
    select licensed_property_id,
      count(distinct branch_code) as scope_count,
      min(branch_code) as studio_code
    from opa_scope_latest
    group by licensed_property_id
  ), opa_studio_summary as materialized (
    select r.licensed_property_id,
      case
        when count(*) filter (where r.resolution_status = 'ambiguous_crossover') > 0
          or count(distinct r.studio_code) filter (where r.resolution_status = 'canonical') > 1
          then 'ambiguous_crossover'
        when count(*) filter (where r.resolution_status = 'canonical') = 1 then 'canonical'
        else 'unresolved'
      end as resolution_status,
      case
        when count(*) filter (where r.resolution_status = 'ambiguous_crossover') = 0
          and count(*) filter (where r.resolution_status = 'canonical') = 1
          then min(r.studio_code) filter (where r.resolution_status = 'canonical')
      end as studio_code
    from plm.opa_property_studio_resolution r
    group by r.licensed_property_id
  ), dcp_terminal_copies as materialized (
    -- Stable DCP identity authority must precede section selection and paging.
    select distinct on (r.source_system, r.source_table, r.source_property_id)
      r.*,
      case when r.source_property_id like 'dcpvault:%'
        then r.source_property_id
        else r.source_table||'|'||r.source_system||'|'||r.source_property_id
      end as identity_key,
      case when r.creative_decision_state is not null then r.creative_decision_state
        when r.approval_status = 'approved' and mf.fingerprint <> '' then 'mapped'
        else 'unmapped' end as copy_state,
      mf.fingerprint as member_fingerprint
    from plm.dcp_opa_property_resolution r
    cross join lateral (
      select coalesce(string_agg(
        m.submission_source_system||'|'||m.submission_source_table||'|'||
          m.submission_source_id, chr(10)
        order by m.submission_source_system,m.submission_source_table,
          m.submission_source_id), '') as fingerprint
      from plm.dcp_opa_property_resolution_member m
      where m.resolution_id = r.resolution_id
    ) mf
    where r.approval_status in ('approved','rejected')
      and (r.source_property_id like 'dcpvault:%'
        or r.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property'))
    order by r.source_system,r.source_table,r.source_property_id,
      r.decision_version desc,r.approved_at desc nulls last,r.resolution_id desc
  ), dcp_identity_authority as materialized (
    select identity_key,
      count(distinct member_fingerprint) filter (where copy_state='mapped') > 1
        or count(distinct contract_asserted_studio_code)
          filter (where copy_state='mapped') > 1 as authority_conflict,
      min(contract_asserted_studio_code) filter (where copy_state='mapped')
        as contract_asserted_studio_code,
      (array_agg(resolution_id order by (copy_state='mapped') desc,
        decision_version desc,approved_at desc nulls last,resolution_id desc))[1]
        as resolution_id
    from dcp_terminal_copies
    group by identity_key
  ), dcp_current_resolution as materialized (
    select r.resolution_id,r.source_system,r.source_table,r.source_property_id,
      a.contract_asserted_studio_code,
      case when a.authority_conflict then 'conflict' else r.copy_state end
        as decision_state
    from dcp_identity_authority a
    join dcp_terminal_copies r on r.resolution_id = a.resolution_id
  ), dcp_member_count as materialized (
    select rm.resolution_id, count(*) as member_count
    from plm.dcp_opa_property_resolution_member rm
    join dcp_current_resolution r on r.resolution_id = rm.resolution_id
    group by rm.resolution_id
  ), dcp_scope_latest as materialized (
    select distinct on (
      rm.resolution_id, rm.licensed_property_id, sm.region_code, sm.branch_code,
      sm.line_of_business_id, sm.product_type_code, sm.template_id, sm.workflow_id
    )
      rm.resolution_id, sm.branch_code
    from plm.dcp_opa_property_resolution_member rm
    join dcp_current_resolution r on r.resolution_id = rm.resolution_id
    join plm.opa_property_scope_membership sm
      on sm.licensed_property_id = rm.licensed_property_id
     and sm.approval_status = 'approved'
    order by rm.resolution_id, rm.licensed_property_id, sm.region_code, sm.branch_code,
      sm.line_of_business_id, sm.product_type_code, sm.template_id, sm.workflow_id,
      sm.source_captured_at desc, sm.created_at desc, sm.membership_id desc
  ), dcp_scope_summary as materialized (
    select resolution_id,
      count(distinct branch_code) as opa_scope_count,
      min(branch_code) as opa_studio_code
    from dcp_scope_latest
    group by resolution_id
  ), pmt_ranked as (
    select p.*,
           row_number() over (
             partition by p.property_source_id
             order by c.completed_at desc nulls last,
                      p.imported_at desc,
                      p.capture_id::text desc
           ) as capture_rank
    from plm.pmt_property p
    join plm.pmt_capture c on c.capture_id = p.capture_id
    where c.status = 'complete'
      and c.capture_kind = 'full'
  ), nbcu_ranked as (
    select p.*,
           row_number() over (
             partition by p.property_key
             order by c.source_captured_at desc,
                      p.source_captured_at desc,
                      p.capture_id::text desc
           ) as capture_rank
    from plm.nbcu_property p
    join plm.nbcu_capture c on c.id = p.capture_id
    where c.status = 'complete'
  ), wildbrain_ranked as (
    select e.*,
      row_number() over (
        partition by e.era_source_id
        order by c.source_captured_at desc, e.capture_id::text desc
      ) as capture_rank
    from plm.wildbrain_era e
    join plm.wildbrain_capture c on c.id = e.capture_id
    where c.status = 'complete'
  ), sega_submission_ranked as (
    select p.*,
      row_number() over (
        partition by p.property_source_id
        order by c.source_captured_at desc, p.submission_capture_id::text desc
      ) as capture_rank
    from plm.sega_submission_property p
    join plm.sega_submission_capture c on c.id = p.submission_capture_id
    where c.status = 'complete'
  ), sega_ranked as (
    select p.*,
      row_number() over (
        partition by p.property_source_id
        order by c.source_captured_at desc, p.capture_id::text desc
      ) as capture_rank
    from plm.sega_property p
    join plm.sega_capture c on c.id = p.capture_id
    where c.status = 'complete'
  ), pmt_trackerplus_latest as (
    select c.id
    from plm.pmt_trackerplus_submission_capture c
    where c.status = 'complete'
    order by c.source_captured_at desc, c.load_completed_at desc, c.id desc
    limit 1
  ), coke_property_latest as (
    select c.id
    from plm.coke_capture c
    where c.status = 'complete'
    order by c.source_captured_at desc, c.load_completed_at desc, c.id desc
    limit 1
  ), wwe_submission_latest as (
    select c.id
    from plm.wwe_submission_capture c
    where c.status = 'complete'
    order by c.source_captured_at desc, c.load_completed_at desc, c.id desc
    limit 1
  ), source_rows as not materialized (
    select
      case
        when s.scope_status = 'direct_lucasfilm' then 'lucasfilm-star-wars-opa'
        when s.scope_status = 'direct_disney' and o.resolution_status = 'canonical'
          and o.studio_code in ('disney', 'marvel', 'pixar') then
          case o.studio_code when 'disney' then 'disney-opa'
            when 'marvel' then 'marvel-opa' when 'pixar' then 'pixar-opa' end
        when s.scope_status = 'direct_disney' then 'disney-opa'
        when s.scope_status = 'scope_conflict' or o.resolution_status = 'ambiguous_crossover'
          then 'opa-scope-conflict'
        when s.scope_status is null and o.resolution_status = 'canonical' then
          case o.studio_code when 'disney' then 'disney-opa'
            when 'marvel' then 'marvel-opa'
            when 'lucasfilm' then 'lucasfilm-star-wars-opa'
            when 'pixar' then 'pixar-opa' end
        else 'disney-opa-unresolved'
      end::text as presentation_licensor_key,
      case
        when s.scope_status = 'direct_lucasfilm' then 'Lucasfilm / Star Wars - Submissions (OPA)'
        when s.scope_status = 'direct_disney' and o.resolution_status = 'canonical'
          and o.studio_code = 'marvel' then 'Marvel - Submissions (OPA)'
        when s.scope_status = 'direct_disney' and o.resolution_status = 'canonical'
          and o.studio_code = 'pixar' then 'Pixar - Submissions (OPA)'
        when s.scope_status = 'direct_disney' then 'Disney - Submissions (OPA)'
        when s.scope_status = 'scope_conflict' or o.resolution_status = 'ambiguous_crossover'
          then 'OPA - Submissions (scope conflict)'
        when s.scope_status is null and o.resolution_status = 'canonical' then
          case o.studio_code when 'disney' then 'Disney - Submissions (OPA)'
            when 'marvel' then 'Marvel - Submissions (OPA)'
            when 'lucasfilm' then 'Lucasfilm / Star Wars - Submissions (OPA)'
            when 'pixar' then 'Pixar - Submissions (OPA)' end
        else 'OPA - Submissions (unresolved)'
      end::text as presentation_licensor_name,
      'disney_opa'::text as source_system,
      'plm.opa_property'::text as source_table,
      p.licensed_property_id::text as source_property_id,
      p.property_name::text as source_property_name,
      coalesce(s.scope_status, o.resolution_status, 'unresolved')::text as source_status,
      case when s.scope_status is not null then 'direct_opa_route_membership'
        else 'opa_studio_resolution' end::text as provenance_kind,
      p.last_seen_at::timestamptz as latest_seen_at,
      null::text as capture_marker
    from plm.opa_property p
    left join opa_scope_summary s0
      on s0.licensed_property_id = p.licensed_property_id
    left join lateral (
      select case
        when s0.scope_count > 1 then 'scope_conflict'
        when s0.studio_code = 'lucasfilm' then 'direct_lucasfilm'
        when s0.studio_code = 'disney' then 'direct_disney'
      end as scope_status
    ) s on true
    left join opa_studio_summary o
      on o.licensed_property_id = p.licensed_property_id

    union all
    select
      case when x.authority_status = 'direct_disney' then 'disney'
        when x.authority_status = 'direct_marvel' then 'marvel'
        when x.authority_status = 'direct_lucasfilm' then 'lucasfilm-star-wars'
        when x.authority_status = 'direct_pixar' then 'pixar'
        when x.authority_status = 'authority_conflict' then 'dcp-authority-conflict'
        when x.authority_status = 'contract_opa_conflict' then 'dcp-contract-opa-conflict'
        when x.authority_status = 'opa_scope_conflict' then 'dcp-opa-scope-conflict'
        else 'dcp-authority-unresolved' end,
      case when x.authority_status = 'direct_disney' then 'Disney - Creative (DCP Vault)'
        when x.authority_status = 'direct_marvel' then 'DCP Vault - Creative (authoritative Marvel scope)'
        when x.authority_status = 'direct_lucasfilm' then 'Lucasfilm / Star Wars - Creative (DCP Vault)'
        when x.authority_status = 'direct_pixar' then 'Pixar - Creative (DCP Vault)'
        when x.authority_status = 'authority_conflict' then 'DCP Creative - identity authority conflict'
        when x.authority_status = 'contract_opa_conflict' then 'DCP Creative - contract/OPA conflict'
        when x.authority_status = 'opa_scope_conflict' then 'DCP Creative - mapped OPA scope conflict'
        else 'DCP Creative - unresolved authority' end,
      p.source_system, 'plm.dcp_property', p.source_id, p.display_name,
      coalesce(x.authority_status, 'unresolved'),
      'explicit_dcp_to_opa_property_id_with_independent_contract_and_opa_authority', null::timestamptz,
      p.last_seen_metadata_run_id::text
    from plm.dcp_property p
    left join dcp_current_resolution r
      on r.source_property_id = p.source_id
     and (p.source_id like 'dcpvault:%'
       or (r.source_system = p.source_system and r.source_table = 'plm.dcp_property'))
    left join dcp_member_count mc on mc.resolution_id = r.resolution_id
    left join dcp_scope_summary o on o.resolution_id = r.resolution_id
    left join lateral (
      select case
        when r.decision_state = 'conflict' then 'authority_conflict'
        when r.decision_state is distinct from 'mapped' then null
        when o.opa_scope_count > 1 then 'opa_scope_conflict'
        when r.contract_asserted_studio_code is not null
          and o.opa_studio_code is not null
          and r.contract_asserted_studio_code <> o.opa_studio_code
          and not (
            r.contract_asserted_studio_code = 'marvel'
            and o.opa_studio_code = 'disney'
          )
          then 'contract_opa_conflict'
        when r.contract_asserted_studio_code is not null and mc.member_count > 0
          then 'direct_' || r.contract_asserted_studio_code
        when o.opa_studio_code is not null then 'direct_' || o.opa_studio_code
      end as authority_status
    ) x on true

    union all
    select
      'dcp-vault-non-authoritative-marvel-tag',
      'DCP Vault - Creative (non-authoritative Marvel tag)',
      p.source_system, 'plm.marvel_dcp_property', p.source_id, p.display_name,
      'non_authoritative',
      'dcp_property_licensor_resolution', null::timestamptz,
      p.last_seen_metadata_run_id::text
    from plm.marvel_dcp_property p

    union all
    select
      case when x.authority_status = 'direct_disney' then 'disney'
        when x.authority_status = 'direct_marvel' then 'marvel'
        when x.authority_status = 'direct_lucasfilm' then 'lucasfilm-star-wars'
        when x.authority_status = 'direct_pixar' then 'pixar'
        when x.authority_status = 'authority_conflict' then 'dcp-authority-conflict'
        when x.authority_status = 'contract_opa_conflict' then 'dcp-contract-opa-conflict'
        when x.authority_status = 'opa_scope_conflict' then 'dcp-opa-scope-conflict'
        else 'dcp-authority-unresolved' end,
      case when x.authority_status = 'direct_disney' then 'Disney - Creative (DCP Vault)'
        when x.authority_status = 'direct_marvel' then 'DCP Vault - Creative (authoritative Marvel scope)'
        when x.authority_status = 'direct_lucasfilm' then 'Lucasfilm / Star Wars - Creative (DCP Vault)'
        when x.authority_status = 'direct_pixar' then 'Pixar - Creative (DCP Vault)'
        when x.authority_status = 'authority_conflict' then 'DCP Creative - identity authority conflict'
        when x.authority_status = 'contract_opa_conflict' then 'DCP Creative - contract/OPA conflict'
        when x.authority_status = 'opa_scope_conflict' then 'DCP Creative - mapped OPA scope conflict'
        else 'DCP Creative - unresolved authority' end,
      p.source_system, 'plm.lucasfilm_dcp_property', p.source_id, p.display_name,
      coalesce(x.authority_status, 'unresolved'),
      'explicit_dcp_to_opa_property_id_with_independent_contract_and_opa_authority', null::timestamptz,
      p.last_seen_metadata_run_id::text
    from plm.lucasfilm_dcp_property p
    left join dcp_current_resolution r
      on r.source_property_id = p.source_id
     and (p.source_id like 'dcpvault:%'
       or (r.source_system = p.source_system and r.source_table = 'plm.lucasfilm_dcp_property'))
    left join dcp_member_count mc on mc.resolution_id = r.resolution_id
    left join dcp_scope_summary o on o.resolution_id = r.resolution_id
    left join lateral (
      select case
        when r.decision_state = 'conflict' then 'authority_conflict'
        when r.decision_state is distinct from 'mapped' then null
        when o.opa_scope_count > 1 then 'opa_scope_conflict'
        when r.contract_asserted_studio_code is not null
          and o.opa_studio_code is not null
          and r.contract_asserted_studio_code <> o.opa_studio_code
          and not (r.contract_asserted_studio_code = 'marvel' and o.opa_studio_code = 'disney')
          then 'contract_opa_conflict'
        when r.contract_asserted_studio_code is not null and mc.member_count > 0
          then 'direct_' || r.contract_asserted_studio_code
        when o.opa_studio_code is not null then 'direct_' || o.opa_studio_code
      end as authority_status
    ) x on true

    union all
    select
      'marvel-asgard-creative',
      'Marvel - Creative (ASGARD)',
      'marvel_asgard',
      'plm.marvel_asgard_style_guide',
      g.source_identity_key,
      g.exact_label,
      case when g.is_actively_observed then 'active' else 'retained' end,
      'direct_asgard_style_guide',
      null::timestamptz,
      g.last_seen_capture_key::text
    from plm.marvel_asgard_style_guide g

    union all
    select
      case when p.source_id not like 'dcpvault:%' then '20th-century'
        when x.authority_status = 'direct_disney' then 'disney'
        when x.authority_status = 'direct_marvel' then 'marvel'
        when x.authority_status = 'direct_lucasfilm' then 'lucasfilm-star-wars'
        when x.authority_status = 'direct_pixar' then 'pixar'
        when x.authority_status = 'authority_conflict' then 'dcp-authority-conflict'
        when x.authority_status = 'contract_opa_conflict' then 'dcp-contract-opa-conflict'
        when x.authority_status = 'opa_scope_conflict' then 'dcp-opa-scope-conflict'
        else 'dcp-authority-unresolved' end,
      case when p.source_id not like 'dcpvault:%' then '20th Century - Creative (DCP Vault)'
        when x.authority_status = 'direct_disney' then 'Disney - Creative (DCP Vault)'
        when x.authority_status = 'direct_marvel' then 'DCP Vault - Creative (authoritative Marvel scope)'
        when x.authority_status = 'direct_lucasfilm' then 'Lucasfilm / Star Wars - Creative (DCP Vault)'
        when x.authority_status = 'direct_pixar' then 'Pixar - Creative (DCP Vault)'
        when x.authority_status = 'authority_conflict' then 'DCP Creative - identity authority conflict'
        when x.authority_status = 'contract_opa_conflict' then 'DCP Creative - contract/OPA conflict'
        when x.authority_status = 'opa_scope_conflict' then 'DCP Creative - mapped OPA scope conflict'
        else 'DCP Creative - unresolved authority' end,
      p.source_system, 'plm.twentieth_century_dcp_property', p.source_id, p.display_name,
      case when p.source_id like 'dcpvault:%' then coalesce(x.authority_status, 'unresolved') end,
      case when p.source_id like 'dcpvault:%'
        then 'explicit_dcp_to_opa_property_id_with_independent_contract_and_opa_authority'
        else 'metadata_properties_array' end, null::timestamptz,
      p.last_seen_metadata_run_id::text
    from plm.twentieth_century_dcp_property p
    left join dcp_current_resolution r
      on r.source_property_id = p.source_id
     and (p.source_id like 'dcpvault:%'
       or (r.source_system = p.source_system and r.source_table = 'plm.twentieth_century_dcp_property'))
    left join dcp_member_count mc on mc.resolution_id = r.resolution_id
    left join dcp_scope_summary o on o.resolution_id = r.resolution_id
    left join lateral (
      select case
        when r.decision_state = 'conflict' then 'authority_conflict'
        when r.decision_state is distinct from 'mapped' then null
        when o.opa_scope_count > 1 then 'opa_scope_conflict'
        when r.contract_asserted_studio_code is not null
          and o.opa_studio_code is not null
          and r.contract_asserted_studio_code <> o.opa_studio_code
          and not (
            r.contract_asserted_studio_code = 'marvel'
            and o.opa_studio_code = 'disney'
          )
          then 'contract_opa_conflict'
        when r.contract_asserted_studio_code is not null and mc.member_count > 0
          then 'direct_' || r.contract_asserted_studio_code
        when o.opa_studio_code is not null then 'direct_' || o.opa_studio_code
      end as authority_status
    ) x on true

    union all
    select 'paramount', 'Paramount - Creative (Creative Library)', 'paramount_creative_library',
           'plm.pmt_property', p.property_source_id::text, p.property_name,
           case when p.is_licensed_selection then 'licensed_selection'
                else 'asset_metadata' end,
           case when p.is_licensed_selection then 'portal_property_selection'
                else 'asset_metadata_property' end,
           p.imported_at, p.capture_id::text
    from pmt_ranked p
    where p.capture_rank = 1

    union all
    select 'warner-bros', 'Warner Bros. - Creative (STARLABS)', 'warner_starlabs',
           'plm.wb_property',
           p.source_namespace || ':' || p.identity_method || ':' ||
             coalesce(p.source_id, p.fallback_key),
           p.label, null,
           'normalized_' || p.identity_method,
           p.last_seen_at, p.capture_id::text
    from plm.wb_property p

    union all
    select 'nbcuniversal', 'NBCUniversal - Creative (Creative Asset Factory)', 'nbcu_creative_asset_factory',
           'plm.nbcu_property', p.property_key, p.property_label, null,
           p.source_kind, p.source_captured_at, p.capture_id::text
    from nbcu_ranked p
    where p.capture_rank = 1

    union all
    select 'strawberry-shortcake-creative', 'Strawberry Shortcake - Creative',
           'wildbrain_tenovos', 'plm.wildbrain_era', e.era_source_id,
           e.era_label, case when e.is_root then 'root' else 'descendant' end,
           'declared_era_hierarchy', null::timestamptz, e.capture_id::text
    from wildbrain_ranked e
    where e.capture_rank = 1

    union all
    select 'sega-submissions', 'Sega - Submissions', 'sega_product_approval',
           'plm.sega_submission_property', p.property_source_id,
           p.property_label, 'complete', 'product_approval_property_picker',
           null::timestamptz, p.submission_capture_id::text
    from sega_submission_ranked p
    where p.capture_rank = 1

    union all
    select 'sega-creative', 'Sega - Creative',
           'sega_dsi', 'plm.sega_property', p.property_source_id,
           p.property_label, p.source_status, 'portal_ip_registry',
           null::timestamptz, p.capture_id::text
    from sega_ranked p
    where p.capture_rank = 1

    union all
    select 'paramount-submissions', 'Paramount - Submissions (TrackerPlus)',
           'paramount_trackerplus', 'plm.pmt_trackerplus_submission_property',
           p.property_local_key, p.exact_label, 'complete',
           'trackerplus_submission_property_picker',
           null::timestamptz, p.capture_id::text
    from plm.pmt_trackerplus_submission_property p
    join pmt_trackerplus_latest c on c.id = p.capture_id

    union all
    select 'coca-cola-creative', 'Coca-Cola - Creative (Asset Library Property choices)',
           'coke_brandcomply', 'plm.coke_asset_property_option', o.option_key,
           o.exact_label, o.classification_status, 'asset_library_property_choice',
           null::timestamptz, o.capture_id::text
    from (
      select distinct on (opt.option_key)
             opt.option_key, opt.exact_label, opt.classification_status, opt.capture_id
      from plm.coke_asset_property_option opt
      join coke_property_latest c on c.id = opt.capture_id
      order by opt.option_key, opt.ordinal, opt.exact_label
    ) o

    union all
    select 'wwe-submissions', 'WWE - Submissions', 'wwe_submissions',
           'plm.wwe_property', p.property_source_id, p.property_label,
           case when p.parent_property_source_id is null then 'root' else 'descendant' end,
           'submission_property_picker', null::timestamptz, p.capture_id::text
    from plm.wwe_property p
    join wwe_submission_latest c on c.id = p.capture_id
  ), keyed as (
    select
      jsonb_build_array(
        s.presentation_licensor_key,
        s.source_system,
        s.source_table,
        s.source_property_id
      )::text as row_key,
      s.*,
      case when s.source_table = 'plm.opa_property' then 'Submissions (OPA)'
        when s.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property','plm.twentieth_century_dcp_property') then 'Creative (DCP Vault)'
        when s.source_table = 'plm.marvel_dcp_property' then 'Retained DCP evidence - not Marvel Creative authority'
        when s.source_table = 'plm.marvel_asgard_style_guide' then 'Creative (ASGARD)'
        when s.source_table = 'plm.twentieth_century_dcp_property' then 'Creative (DCP Vault)'
        when s.source_table = 'plm.pmt_property' then 'Creative (Creative Library)'
        when s.source_table = 'plm.wb_property' then 'Creative (STARLABS)'
        when s.source_table = 'plm.nbcu_property' then 'Creative (Creative Asset Factory)'
        when s.source_table = 'plm.wildbrain_era' then 'Creative'
        when s.source_table = 'plm.sega_submission_property' then 'Submissions'
        when s.source_table = 'plm.sega_property' then 'Creative'
        when s.source_table = 'plm.pmt_trackerplus_submission_property'
          then 'Submissions (TrackerPlus)'
        when s.source_table = 'plm.coke_asset_property_option'
          then 'Creative (Asset Library Property choices)'
        when s.source_table = 'plm.wwe_property' then 'Submissions'
        else 'Creative' end::text as source_purpose,
      case
        when s.source_status = 'authority_conflict' then 'Retained copies of this stable DCP identity carry conflicting approved mappings or signed studio assertions; Licensing must review those exact decisions.'
        when s.source_status in ('contract_opa_conflict','opa_scope_conflict') and s.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property','plm.twentieth_century_dcp_property') then 'Authoritative signed-contract and direct captured OPA assertions disagree, or mapped OPA IDs have conflicting direct scopes; Licensing must review the concrete assertions and named style guides.'
        when s.source_status = 'scope_conflict' then 'Direct approved OPA route memberships place this Property in both Disney and Lucasfilm scope; Licensing must resolve whether both memberships are intentional.'
        when s.source_status = 'ambiguous_crossover' then 'Approved OPA studio evidence is ambiguous or names multiple studios; Licensing must resolve the direct source scope.'
        when s.source_status in ('unresolved') or s.source_status is null then case
          when s.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property','plm.twentieth_century_dcp_property')
            then 'DCP supplied a Creative metadata value but no approved exact OPA Property ID link carries an authoritative signed-contract assertion or direct captured OPA scope.'
          else 'No current approved direct authority evidence is available.' end
        when s.source_table = 'plm.marvel_dcp_property' then 'DCP Marvel tags are retained mixed-guide evidence and are not Marvel Creative authority.'
        else null::text
      end::text as review_reason,
      case
        when s.source_status = 'authority_conflict' then 'latest terminal decisions across retained copies of the exact stable DCP identity'
        when s.source_status in ('contract_opa_conflict','opa_scope_conflict') and s.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property','plm.twentieth_century_dcp_property') then 'authoritative signed-contract assertion compared independently with direct latest captured OPA scope through exact OPA Property IDs'
        when s.source_status = 'scope_conflict' then 'approved direct OPA route memberships'
        when s.source_status = 'ambiguous_crossover' then 'approved OPA studio-resolution records'
        when s.source_status = 'unresolved' or s.source_status is null then case
          when s.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property','plm.twentieth_century_dcp_property')
            then 'DCP Creative evidence has no authoritative signed-contract assertion or direct captured OPA scope through an approved exact OPA Property ID link'
          else 'no current approved direct authority record' end
        else null::text end::text as evidence_basis,
      case when s.source_status in ('authority_conflict','scope_conflict','ambiguous_crossover','unresolved') or s.source_status is null
        then case
          when s.source_status = 'authority_conflict' then 'Compare the direct authority records and approve one superseding exact-identity decision. Do not infer authority from a property name or landing table.'
          when s.source_status = 'scope_conflict' then 'Compare the approved Disney and Lucasfilm route records, then approve or reject the exact memberships. Do not use a name keyword as scope evidence.'
          else 'Review direct source identity and approve an evidence-backed decision; do not infer from names or landing tables.' end
        else null::text end::text as review_guidance
    from source_rows s
  ), labeled as (
    select
      k.*,
      case
        when k.source_table in (
          'plm.dcp_property',
          'plm.marvel_dcp_property',
          'plm.lucasfilm_dcp_property'
        )
          and nullif(btrim(k.source_property_name), '') is null
          and position('/' in k.source_property_id) > 0
          and btrim(regexp_replace(
                regexp_replace(k.source_property_id, '^.*/', ''),
                '[-_]+', ' ', 'g'
              )) ~ '[[:alnum:]]'
        then replace(
          replace(
            replace(
              replace(
                replace(
                  replace(
                    replace(
          replace(
            replace(
              replace(
                replace(
                  replace(
                    replace(
                      replace(
                        replace(
                          replace(
                            replace(
                              replace(
                                replace(
                                  initcap(btrim(regexp_replace(
                                    regexp_replace(k.source_property_id, '^.*/', ''),
                                    '[-_]+', ' ', 'g'
                                  ))),
                                  ' And ', ' and '
                                ),
                                ' Or ', ' or '
                              ),
                              ' Of ', ' of '
                            ),
                            ' The ', ' the '
                          ),
                          ' A ', ' a '
                        ),
                        ' An ', ' an '
                      ),
                      ' To ', ' to '
                    ),
                    ' For ', ' for '
                  ),
                  ' In ', ' in '
                ),
                ' On ', ' on '
              ),
              ' At ', ' at '
            ),
            ' By ', ' by '
          ),
                    '''S', '''s'
                  ),
                  '''T', '''t'
                ),
                '''Re', '''re'
              ),
              '''Ve', '''ve'
            ),
            '''Ll', '''ll'
          ),
          '''D', '''d'
        ),
        '''M', '''m'
        )
        else null
      end as derived_display_label
    from keyed k
  ), filtered as (
    select l.*
    from labeled l
    where (
      p_search is null
      or l.presentation_licensor_name ilike '%' || p_search || '%'
      or l.source_system ilike '%' || p_search || '%'
      or l.source_property_id ilike '%' || p_search || '%'
      or l.source_property_name ilike '%' || p_search || '%'
      or l.derived_display_label ilike '%' || p_search || '%'
    )
      and (p_cursor is null or l.row_key collate "C" > v_cursor_key collate "C")
  ), ordered as materialized (
    select f.*
    from filtered f
    order by f.row_key collate "C"
    limit v_page_size + 1
  ), page_creative_decision as materialized (
    -- One stable DCP source id is the business Creative identity. Every
    -- retained source-system/table copy of it is provenance, not a separate
    -- business fact. Non-DCP sources keep their exact copy key because bare
    -- integer source ids collide between licensors.
    select o.row_key, r.resolution_id, r.decision_state
    from ordered o
    cross join lateral (
      select case when o.source_property_id like 'dcpvault:%'
                  then o.source_property_id
                  else o.source_table||'|'||o.source_system||'|'||o.source_property_id
             end as identity_key
    ) k
    left join lateral (
      select
        -- Fails closed: a genuine terminal disagreement serves no mapping.
        case when g.mapped_fingerprints > 1 then null else g.pick_id end
          as resolution_id,
        (case
          when g.copy_count = 0 then null
          when g.mapped_fingerprints > 1 then 'conflict'
          when g.mapped_copies > 0 then 'mapped'
          else g.newest_state
        end)::text as decision_state
      from (
        select
          count(*) as copy_count,
          count(*) filter (where c.copy_state='mapped') as mapped_copies,
          count(distinct c.member_fingerprint)
            filter (where c.copy_state='mapped') as mapped_fingerprints,
          (array_agg(c.resolution_id order by (c.copy_state='mapped') desc,
             c.decision_version desc, c.approved_at desc nulls last,
             c.resolution_id desc))[1] as pick_id,
          (array_agg(c.copy_state order by c.decision_version desc,
             c.approved_at desc nulls last, c.resolution_id desc))[1]
             as newest_state
        from (
          -- Newest TERMINAL decision per retained copy. Pending rows are
          -- proposals: they stay queued and never hide a terminal decision.
          select distinct on (t.source_system, t.source_table)
            t.resolution_id, t.decision_version, t.approved_at,
            (case
              when t.creative_decision_state is not null
                then t.creative_decision_state
              when t.approval_status='approved' and mf.fingerprint <> ''
                then 'mapped'
              else 'unmapped'
            end)::text as copy_state,
            mf.fingerprint as member_fingerprint
          from plm.dcp_opa_property_resolution t
          cross join lateral (
            select coalesce(string_agg(
              m.submission_source_system||'|'||m.submission_source_table||'|'||
                m.submission_source_id, chr(10)
              order by m.submission_source_system, m.submission_source_table,
                m.submission_source_id), '') as fingerprint
            from plm.dcp_opa_property_resolution_member m
            where m.resolution_id = t.resolution_id
          ) mf
          where t.approval_status in ('approved','rejected')
            and case when k.identity_key like 'dcpvault:%'
                     then t.source_property_id = k.identity_key
                     else t.source_system = o.source_system
                      and t.source_table = o.source_table
                      and t.source_property_id = o.source_property_id
                end
          order by t.source_system, t.source_table, t.decision_version desc,
            t.approved_at desc nulls last, t.resolution_id desc
        ) c
      ) g
    ) r on true
  ), page_submission_identity as materialized (
    select distinct m.submission_source_system,m.submission_source_table,
      m.submission_source_id
    from page_creative_decision d
    join plm.dcp_opa_property_resolution_member m
      on m.resolution_id=d.resolution_id
  ), page_submission_source_candidates as materialized (
    select i.submission_source_system,i.submission_source_table,
      i.submission_source_id,p.source_property_name
    from page_submission_identity i
    join lateral (
      select p.property_name::text as source_property_name
      from plm.opa_property p
      where i.submission_source_id ~ '^-?[0-9]+$'
        and p.licensed_property_id=i.submission_source_id::bigint
      limit 1
    ) p on true
    where i.submission_source_system='disney_opa'
      and i.submission_source_table='plm.opa_property'

    union all
    select i.submission_source_system,i.submission_source_table,
      i.submission_source_id,p.source_property_name
    from page_submission_identity i
    join lateral (
      select p.display_name::text as source_property_name
      from plm.dcp_property p
      where p.source_system=i.submission_source_system
        and p.source_id=i.submission_source_id limit 1
    ) p on true
    where i.submission_source_table='plm.dcp_property'

    union all
    select i.submission_source_system,i.submission_source_table,
      i.submission_source_id,p.source_property_name
    from page_submission_identity i
    join lateral (
      select p.display_name::text as source_property_name
      from plm.marvel_dcp_property p
      where p.source_system=i.submission_source_system
        and p.source_id=i.submission_source_id limit 1
    ) p on true
    where i.submission_source_table='plm.marvel_dcp_property'

    union all
    select i.submission_source_system,i.submission_source_table,
      i.submission_source_id,p.source_property_name
    from page_submission_identity i
    join lateral (
      select p.display_name::text as source_property_name
      from plm.lucasfilm_dcp_property p
      where p.source_system=i.submission_source_system
        and p.source_id=i.submission_source_id limit 1
    ) p on true
    where i.submission_source_table='plm.lucasfilm_dcp_property'

    union all
    select i.submission_source_system,i.submission_source_table,
      i.submission_source_id,p.source_property_name
    from page_submission_identity i
    join lateral (
      select p.display_name::text as source_property_name
      from plm.twentieth_century_dcp_property p
      where p.source_system=i.submission_source_system
        and p.source_id=i.submission_source_id limit 1
    ) p on true
    where i.submission_source_table='plm.twentieth_century_dcp_property'

    union all
    select i.submission_source_system,i.submission_source_table,
      i.submission_source_id,p.source_property_name
    from page_submission_identity i
    join lateral (
      select p.property_name::text as source_property_name
      from plm.pmt_property p
      join plm.pmt_capture c on c.capture_id=p.capture_id
      where p.property_source_id::text=i.submission_source_id
        and c.status='complete' and c.capture_kind='full'
      order by c.completed_at desc nulls last,p.imported_at desc,
        p.capture_id::text desc limit 1
    ) p on true
    where i.submission_source_system='paramount_creative_library'
      and i.submission_source_table='plm.pmt_property'

    union all
    select i.submission_source_system,i.submission_source_table,
      i.submission_source_id,p.label::text as source_property_name
    from page_submission_identity i
    join plm.wb_property p
      on p.source_namespace || ':' || p.identity_method || ':' ||
        coalesce(p.source_id,p.fallback_key)=i.submission_source_id
    where i.submission_source_system='warner_starlabs'
      and i.submission_source_table='plm.wb_property'

    union all
    select i.submission_source_system,i.submission_source_table,
      i.submission_source_id,p.source_property_name
    from page_submission_identity i
    join lateral (
      select p.property_label::text as source_property_name
      from plm.nbcu_property p
      join plm.nbcu_capture c on c.id=p.capture_id
      where p.property_key=i.submission_source_id and c.status='complete'
      order by c.source_captured_at desc,p.source_captured_at desc,
        p.capture_id::text desc limit 1
    ) p on true
    where i.submission_source_system='nbcu_creative_asset_factory'
      and i.submission_source_table='plm.nbcu_property'

    union all
    select i.submission_source_system,i.submission_source_table,
      i.submission_source_id,p.source_property_name
    from page_submission_identity i
    join lateral (
      select e.era_label::text as source_property_name
      from plm.wildbrain_era e
      join plm.wildbrain_capture c on c.id=e.capture_id
      where e.era_source_id=i.submission_source_id and c.status='complete'
      order by c.source_captured_at desc,e.capture_id::text desc limit 1
    ) p on true
    where i.submission_source_system='wildbrain_tenovos'
      and i.submission_source_table='plm.wildbrain_era'

    union all
    select i.submission_source_system,i.submission_source_table,
      i.submission_source_id,p.source_property_name
    from page_submission_identity i
    join lateral (
      select p.property_label::text as source_property_name
      from plm.sega_submission_property p
      join plm.sega_submission_capture c on c.id=p.submission_capture_id
      where p.property_source_id=i.submission_source_id and c.status='complete'
      order by c.source_captured_at desc,p.submission_capture_id::text desc
      limit 1
    ) p on true
    where i.submission_source_system='sega_product_approval'
      and i.submission_source_table='plm.sega_submission_property'

    union all
    select i.submission_source_system,i.submission_source_table,
      i.submission_source_id,p.source_property_name
    from page_submission_identity i
    join lateral (
      select p.property_label::text as source_property_name
      from plm.sega_property p
      join plm.sega_capture c on c.id=p.capture_id
      where p.property_source_id=i.submission_source_id and c.status='complete'
      order by c.source_captured_at desc,p.capture_id::text desc limit 1
    ) p on true
    where i.submission_source_system='sega_dsi'
      and i.submission_source_table='plm.sega_property'
  ), page_submission_source as materialized (
    select i.submission_source_system,i.submission_source_table,
      i.submission_source_id,c.source_property_name
    from page_submission_identity i
    left join page_submission_source_candidates c
      on c.submission_source_system=i.submission_source_system
     and c.submission_source_table=i.submission_source_table
     and c.submission_source_id=i.submission_source_id
  ), enriched as materialized (
    select
      o.*,
      creative_decision.decision_state::text as creative_mapping_state,
      coalesce(submission_summary.members,'[]'::jsonb) as submission_members,
      submission_summary.contract_status::text as sanitized_contract_status
    from ordered o
    left join page_creative_decision creative_decision
      on creative_decision.row_key=o.row_key
    left join lateral (
      select
        coalesce(jsonb_agg(jsonb_build_object(
          'source_system',m.submission_source_system,
          'source_table',m.submission_source_table,
          'source_id',m.submission_source_id,
          'display_label',submission_source.source_property_name
        ) order by m.submission_source_system,m.submission_source_table,m.submission_source_id),'[]'::jsonb) members,
        case
          when bool_or(contract_decision.decision_state='conflict') then 'conflict'
          when bool_or(contract_decision.resolution_id is null) then 'unknown'
          when bool_or(contract_decision.decision_state='evidenced' and not capture.controlling_chain_complete) then 'incomplete_chain'
          when bool_or(contract_decision.decision_state='not_evidenced')
            or bool_or(contract_decision.decision_state='evidenced' and evidence.id is null) then 'not_evidenced'
          when bool_and(contract_decision.decision_state='evidenced'
            and capture.controlling_chain_complete and evidence.id is not null) then 'evidenced'
          else 'unknown' end contract_status
      from plm.dcp_opa_property_resolution_member m
      left join page_submission_source submission_source
        on submission_source.submission_source_system=m.submission_source_system
       and submission_source.submission_source_table=m.submission_source_table
       and submission_source.submission_source_id=m.submission_source_id
      left join lateral (
        select cr.* from plm.creative_submission_contract_resolution cr
        where cr.submission_source_system=m.submission_source_system
          and cr.submission_source_table=m.submission_source_table
          and cr.submission_source_id=m.submission_source_id
          and not exists (select 1 from plm.creative_submission_contract_resolution newer
            where newer.supersedes_resolution_id=cr.resolution_id)
        order by cr.decision_version desc,cr.approved_at desc,cr.resolution_id desc limit 1
      ) contract_decision on true
      left join plm.contract_property_capture capture on capture.id=contract_decision.contract_capture_id
      left join lateral (select e.id from plm.contract_property_evidence e
        where e.capture_id=contract_decision.contract_capture_id
          and e.property_id=contract_decision.contract_property_id limit 1) evidence on true
      where m.resolution_id=creative_decision.resolution_id
    ) submission_summary on true
  ), page_dcp_properties as materialized (
    select e.row_key,p.id as property_id
    from enriched e
    join plm.dcp_property p
      on p.source_system=e.source_system and p.source_id=e.source_property_id
    where e.source_table='plm.dcp_property'
  ), page_lucasfilm_dcp_properties as materialized (
    select e.row_key,p.id as property_id
    from enriched e
    join plm.lucasfilm_dcp_property p
      on p.source_system=e.source_system and p.source_id=e.source_property_id
    where e.source_table='plm.lucasfilm_dcp_property'
  ), page_dcp_retained_assets as materialized (
    select p.property_id,o.asset_id
    from page_dcp_properties p
    cross join lateral (
      select distinct o.dcp_asset_id as asset_id
      from plm.dcp_asset_property_observation o
      where o.dcp_property_id=p.property_id
    ) o
  ), page_lucasfilm_dcp_retained_assets as materialized (
    select p.property_id,o.asset_id
    from page_lucasfilm_dcp_properties p
    cross join lateral (
      select distinct o.lucasfilm_dcp_asset_id as asset_id
      from plm.lucasfilm_dcp_asset_property_observation o
      where o.lucasfilm_dcp_property_id=p.property_id
    ) o
  ), dcp_asset_context as materialized (
    select a.id,a.style_guide_id,g.folder_name
    from plm.dcp_asset a
    left join plm.dcp_style_guide g on g.id=a.style_guide_id
  ), lucasfilm_dcp_asset_context as materialized (
    select a.id,a.style_guide_id,g.folder_name
    from plm.lucasfilm_dcp_asset a
    left join plm.lucasfilm_dcp_style_guide g on g.id=a.style_guide_id
  ), dcp_asset_counts as materialized (
    select property_id,count(*) asset_count
    from page_dcp_retained_assets group by property_id
  ), lucasfilm_dcp_asset_counts as materialized (
    select property_id,count(*) asset_count
    from page_lucasfilm_dcp_retained_assets group by property_id
  ), dcp_property_styles as materialized (
    select distinct r.property_id,a.style_guide_id,a.folder_name
    from page_dcp_retained_assets r
    join dcp_asset_context a on a.id=r.asset_id
  ), lucasfilm_dcp_property_styles as materialized (
    select distinct r.property_id,a.style_guide_id,a.folder_name
    from page_lucasfilm_dcp_retained_assets r
    join lucasfilm_dcp_asset_context a on a.id=r.asset_id
  ), dcp_style_context as materialized (
    select property_id,count(style_guide_id) style_guide_count,
      coalesce(jsonb_agg(folder_name order by folder_name)
        filter (where folder_name is not null),'[]'::jsonb) style_guide_names
    from dcp_property_styles group by property_id
  ), lucasfilm_dcp_style_context as materialized (
    select property_id,count(style_guide_id) style_guide_count,
      coalesce(jsonb_agg(folder_name order by folder_name)
        filter (where folder_name is not null),'[]'::jsonb) style_guide_names
    from lucasfilm_dcp_property_styles group by property_id
  ), dcp_property_context as materialized (
    select c.property_id,c.asset_count,
      coalesce(s.style_guide_count,0) style_guide_count,
      coalesce(s.style_guide_names,'[]'::jsonb) style_guide_names
    from dcp_asset_counts c left join dcp_style_context s using (property_id)
  ), lucasfilm_dcp_property_context as materialized (
    select c.property_id,c.asset_count,
      coalesce(s.style_guide_count,0) style_guide_count,
      coalesce(s.style_guide_names,'[]'::jsonb) style_guide_names
    from lucasfilm_dcp_asset_counts c
    left join lucasfilm_dcp_style_context s using (property_id)
  ), page_dcp_context_rows as materialized (
    select p.row_key,c.asset_count,c.style_guide_count,c.style_guide_names
    from page_dcp_properties p
    left join dcp_property_context c on c.property_id=p.property_id
    union all
    select p.row_key,c.asset_count,c.style_guide_count,c.style_guide_names
    from page_lucasfilm_dcp_properties p
    left join lucasfilm_dcp_property_context c on c.property_id=p.property_id
  ), page_dcp_context as materialized (
    select * from page_dcp_context_rows
  ), page_rights_ids as materialized (
    select o.row_key,o.source_property_id::bigint as licensed_property_id
    from ordered o where o.source_table='plm.opa_property'
    union
    select d.row_key,m.licensed_property_id
    from page_creative_decision d
    join plm.dcp_opa_property_resolution_member m on m.resolution_id=d.resolution_id
    where d.decision_state='mapped' and m.submission_source_table='plm.opa_property'
  ), page_current_rights as materialized (
    select i.row_key,i.licensed_property_id,r.region_code,r.branch_code,r.line_of_business_id,
      r.product_type_code,r.template_id,r.workflow_id,r.account_scope_sha256,
      coalesce(r.compliance_status,'unknown') as compliance_status,r.source_captured_at,
      coalesce(r.eligible_for_new_styles,false) as eligible_for_new_styles,
      coalesce(r.eligible_for_new_coldlion_entry,false) as eligible_for_new_coldlion_entry,
      coalesce(r.absent_from_newer_complete_capture,false) as absent_from_newer_complete_capture
    from page_rights_ids i left join plm.opa_property_current_compliance r
      on r.licensed_property_id=i.licensed_property_id
  ), page_rights_summary as materialized (
    select row_key,
      case when bool_and(compliance_status='compliant') then 'compliant'
        when bool_and(compliance_status='non_compliant') then 'non_compliant'
        when bool_and(compliance_status='unknown') then 'unknown'
        else 'route_specific' end as current_rights_status,
      jsonb_agg(jsonb_build_object(
        'licensed_property_id',licensed_property_id,
        'region_code',region_code,'branch_code',branch_code,'line_of_business_id',line_of_business_id,
        'product_type_code',product_type_code,'template_id',template_id,'workflow_id',workflow_id,
        'account_scope_sha256',account_scope_sha256,'compliance_status',compliance_status,
        'source_captured_at',source_captured_at,'eligible_for_new_styles',eligible_for_new_styles,
        'eligible_for_new_coldlion_entry',eligible_for_new_coldlion_entry,
        'absent_from_newer_complete_capture',absent_from_newer_complete_capture)
        order by licensed_property_id,region_code,branch_code,line_of_business_id,product_type_code,
          template_id,workflow_id,account_scope_sha256) as current_rights
    from page_current_rights group by row_key
  ), numbered as (
    select e.*,
      rights.current_rights_status,rights.current_rights,
      c.asset_count as context_asset_count,
      c.style_guide_count as context_style_guide_count,
      c.style_guide_names as context_style_guide_names,
      row_number() over (order by e.row_key collate "C") as rn
    from enriched e
    left join page_dcp_context c on c.row_key=e.row_key
    left join page_rights_summary rights on rights.row_key=e.row_key
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'row_key', n.row_key,
        'presentation_licensor_key', n.presentation_licensor_key,
        'presentation_licensor_name', case
          when n.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property')
               and n.presentation_licensor_key = 'disney'
            then 'Disney - Creative (DCP Vault)'
          when n.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property')
               and n.presentation_licensor_key in ('star-wars','lucasfilm-star-wars')
            then 'Lucasfilm / Star Wars - Creative (DCP Vault)'
          else n.presentation_licensor_name
        end,
        'source_system', n.source_system,
        'source_table', n.source_table,
        'source_property_id', n.source_property_id,
        'source_property_name', n.source_property_name,
        'display_label', coalesce(
          nullif(btrim(n.source_property_name), ''),
          n.derived_display_label,
          '[Unlabeled source ID: ' || n.source_property_id || ']'
        ),
        -- source_status explains retained studio/provenance, never current selection rights.
        'source_status', n.source_status,
        'current_rights_status',case when n.source_table='plm.opa_property'
          or n.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property','plm.twentieth_century_dcp_property')
          then coalesce(n.current_rights_status,'unknown') else null end,
        'current_rights',coalesce(n.current_rights,'[]'::jsonb),
        'rights_require_exact_route',n.source_table in ('plm.opa_property','plm.dcp_property',
          'plm.lucasfilm_dcp_property','plm.twentieth_century_dcp_property'),
        'provenance_kind', n.provenance_kind,
        'latest_seen_at', n.latest_seen_at,
        'capture_marker', n.capture_marker,
        'source_purpose', n.source_purpose,
        'review_reason', n.review_reason,
        'evidence_basis', n.evidence_basis,
        'review_guidance', n.review_guidance,
        'mapping_state',case when n.source_purpose like 'Creative%'
          then coalesce(n.creative_mapping_state,'unmapped') else null end,
        'submissions',case when n.source_purpose like 'Creative%'
          then coalesce(n.submission_members,'[]'::jsonb) else '[]'::jsonb end,
        'contract_status',case when n.source_purpose not like 'Creative%' then null
          when coalesce(n.creative_mapping_state,'unmapped')='conflict' then 'conflict'
          when coalesce(n.creative_mapping_state,'unmapped')<>'mapped' then 'unknown'
          else coalesce(n.sanitized_contract_status,'unknown') end,
        'asset_count', case
          when n.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property')
            then coalesce(n.context_asset_count,0)
          else null end,
        'style_guide_count', case
          when n.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property')
            then coalesce(n.context_style_guide_count,0)
          else null end,
        'style_guide_names', case
          when n.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property')
            then coalesce(n.context_style_guide_names,'[]'::jsonb)
          else '[]'::jsonb end
      ) order by n.rn
    ) filter (where n.rn <= v_page_size), '[]'::jsonb),
    count(*)::integer,
    max(n.row_key) filter (where n.rn = v_page_size)
  into v_rows, v_fetched, v_last_key
  from numbered n;

  if v_fetched > v_page_size and v_last_key is not null then
    v_next_cursor := encode(convert_to(v_last_key, 'UTF8'), 'base64');
  end if;

  return jsonb_build_object(
    'rows', v_rows,
    'next_cursor', v_next_cursor,
    'page_size', v_page_size
  );
end;
$function$
;

