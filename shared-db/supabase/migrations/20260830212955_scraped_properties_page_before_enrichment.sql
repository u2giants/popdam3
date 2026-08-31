-- Issue #1936: page the complete source vocabulary before running the
-- per-row Creative-to-Submissions and contract-status enrichment. The
-- response, authorization, privacy, source, mapping, and cursor contracts are
-- unchanged; only the execution boundary moves behind the bounded page.
-- derived-from: 20260830202243

do $migration$
declare
  v_definition text;
  v_keyed_enrichment constant text := $sql$      s.*,
      creative_decision.decision_state::text as creative_mapping_state,
      coalesce(submission_summary.members,'[]'::jsonb) as submission_members,
      submission_summary.contract_status::text as sanitized_contract_status,$sql$;
  v_keyed_plain constant text := $sql$      s.*,$sql$;
  v_joined_source constant text := $sql$    from source_rows s
    left join lateral (
      select r.* from plm.creative_submission_property_resolution r
      where r.creative_source_system=s.source_system
        and r.creative_source_table=s.source_table
        and r.creative_source_id=s.source_property_id
        and not exists (select 1 from plm.creative_submission_property_resolution newer
          where newer.supersedes_resolution_id=r.resolution_id)
      order by r.decision_version desc,r.approved_at desc,r.resolution_id desc limit 1
    ) creative_decision on true
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
      from plm.creative_submission_property_resolution_member m
      left join source_rows submission_source
        on submission_source.source_system=m.submission_source_system
       and submission_source.source_table=m.submission_source_table
       and submission_source.source_property_id=m.submission_source_id
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
    ) submission_summary on true$sql$;
  v_plain_source constant text := '    from source_rows s';
  v_page_boundary constant text := $sql$  ), ordered as (
    select f.*
    from filtered f
    order by f.row_key collate "C"
    limit v_page_size + 1
  ), numbered as (
    select o.*, row_number() over (order by o.row_key collate "C") as rn
    from ordered o
  )$sql$;
  v_paged_enrichment constant text := $sql$  ), ordered as materialized (
    select f.*
    from filtered f
    order by f.row_key collate "C"
    limit v_page_size + 1
  ), enriched as materialized (
    select
      o.*,
      creative_decision.decision_state::text as creative_mapping_state,
      coalesce(submission_summary.members,'[]'::jsonb) as submission_members,
      submission_summary.contract_status::text as sanitized_contract_status
    from ordered o
    left join lateral (
      select r.* from plm.creative_submission_property_resolution r
      where r.creative_source_system=o.source_system
        and r.creative_source_table=o.source_table
        and r.creative_source_id=o.source_property_id
        and not exists (select 1 from plm.creative_submission_property_resolution newer
          where newer.supersedes_resolution_id=r.resolution_id)
      order by r.decision_version desc,r.approved_at desc,r.resolution_id desc limit 1
    ) creative_decision on true
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
      from plm.creative_submission_property_resolution_member m
      left join source_rows submission_source
        on submission_source.source_system=m.submission_source_system
       and submission_source.source_table=m.submission_source_table
       and submission_source.source_property_id=m.submission_source_id
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
  ), numbered as (
    select e.*, row_number() over (order by e.row_key collate "C") as rn
    from enriched e
  )$sql$;
begin
  select pg_get_functiondef(
    'api.db_data_admin_scraped_properties(text,text,integer)'::regprocedure
  ) into v_definition;

  if length(v_definition)-length(replace(v_definition,v_keyed_enrichment,''))<>length(v_keyed_enrichment)
     or length(v_definition)-length(replace(v_definition,v_joined_source,''))<>length(v_joined_source)
     or length(v_definition)-length(replace(v_definition,v_page_boundary,''))<>length(v_page_boundary)
     or position('creative_submission_contract_resolution' in v_definition)=0
     or position('Strawberry Shortcake - Creative' in v_definition)=0
     or position('Sega - Submissions' in v_definition)=0
     or position('mapping_state' in v_definition)=0
     or position('contract_status' in v_definition)=0 then
    raise exception using errcode='55000',
      message='#1936 Scraped Properties predecessor differs from reviewed #1872 definition';
  end if;

  v_definition:=replace(v_definition,v_keyed_enrichment,v_keyed_plain);
  v_definition:=replace(v_definition,v_joined_source,v_plain_source);
  v_definition:=replace(v_definition,v_page_boundary,v_paged_enrichment);

  if position('ordered as materialized' in v_definition)=0
     or position('from ordered o' in v_definition)=0
     or position('from enriched e' in v_definition)=0
     or position('creative_decision.decision_state::text as creative_mapping_state' in v_definition)=0
     or position('submission_summary.contract_status::text as sanitized_contract_status' in v_definition)=0
     or position('from source_rows s'||chr(10)||'    left join lateral' in v_definition)<>0 then
    raise exception using errcode='55000',
      message='#1936 page-before-enrichment replacement postconditions failed';
  end if;

  execute v_definition;
end $migration$;

comment on function api.db_data_admin_scraped_properties(text,text,integer) is
  'Licensing-manager-gated source Property vocabulary with exact Creative-to-Submissions decisions and sanitized contract status. Stable cursor pagination is materialized before per-row mapping and contract enrichment so populated first and subsequent pages stay bounded. All source identities, privacy restrictions, and authorization checks remain unchanged.';

revoke all on function api.db_data_admin_scraped_properties(text,text,integer)
  from public,anon,service_role;
grant execute on function api.db_data_admin_scraped_properties(text,text,integer)
  to authenticated;
