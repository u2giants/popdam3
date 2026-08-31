-- #1936 forward repair 2: remove per-row authority scans from the complete
-- Scraped Properties source set. The first repair paged mapping and contract
-- enrichment, but OPA and DCP authority were still recomputed once per source
-- Property before the global ordering step.

do $migration$
declare
  v_definition text;
  v_cte_needle constant text := $old$  with pmt_ranked as ($old$;
  v_cte_replacement constant text := $new$  with opa_scope_latest as materialized (
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
  ), dcp_current_resolution as materialized (
    select distinct on (r.source_system, r.source_table, r.source_property_id)
      r.resolution_id, r.source_system, r.source_table, r.source_property_id,
      r.contract_asserted_studio_code
    from plm.dcp_opa_property_resolution r
    where r.approval_status = 'approved'
      and not exists (
        select 1 from plm.dcp_opa_property_resolution newer
        where newer.supersedes_resolution_id = r.resolution_id
      )
    order by r.source_system, r.source_table, r.source_property_id,
      r.decision_version desc, r.approved_at desc, r.resolution_id desc
  ), dcp_member_count as materialized (
    select rm.resolution_id, count(*) as member_count
    from plm.dcp_opa_property_resolution_member rm
    group by rm.resolution_id
  ), dcp_scope_latest as materialized (
    select distinct on (
      rm.resolution_id, rm.licensed_property_id, sm.region_code, sm.branch_code,
      sm.line_of_business_id, sm.product_type_code, sm.template_id, sm.workflow_id
    )
      rm.resolution_id, sm.branch_code
    from plm.dcp_opa_property_resolution_member rm
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
  ), pmt_ranked as ($new$;
  v_opa_old constant text := $old$    left join lateral (
      select case
        when count(distinct latest.branch_code) > 1 then 'scope_conflict'
        when min(latest.branch_code) = 'lucasfilm' then 'direct_lucasfilm'
        when min(latest.branch_code) = 'disney' then 'direct_disney'
      end scope_status
      from (
        select distinct on (m.region_code, m.branch_code, m.line_of_business_id,
                            m.product_type_code, m.template_id, m.workflow_id)
          m.branch_code
        from plm.opa_property_scope_membership m
        where m.licensed_property_id = p.licensed_property_id
          and m.approval_status = 'approved'
        order by m.region_code, m.branch_code, m.line_of_business_id,
                 m.product_type_code, m.template_id, m.workflow_id,
                 m.source_captured_at desc, m.created_at desc, m.membership_id desc
      ) latest
    ) s on true
    left join lateral (
      select case
          when count(*) filter (where r.resolution_status = 'ambiguous_crossover') > 0
            or count(distinct r.studio_code) filter (where r.resolution_status = 'canonical') > 1
            then 'ambiguous_crossover'
          when count(*) filter (where r.resolution_status = 'canonical') = 1 then 'canonical'
          else 'unresolved' end resolution_status,
        case when count(*) filter (where r.resolution_status = 'ambiguous_crossover') = 0
          and count(*) filter (where r.resolution_status = 'canonical') = 1
          then min(r.studio_code) filter (where r.resolution_status = 'canonical') end studio_code
      from plm.opa_property_studio_resolution r
      where r.licensed_property_id = p.licensed_property_id
    ) o on true$old$;
  v_opa_new constant text := $new$    left join opa_scope_summary s0
      on s0.licensed_property_id = p.licensed_property_id
    left join lateral (
      select case
        when s0.scope_count > 1 then 'scope_conflict'
        when s0.studio_code = 'lucasfilm' then 'direct_lucasfilm'
        when s0.studio_code = 'disney' then 'direct_disney'
      end as scope_status
    ) s on true
    left join opa_studio_summary o
      on o.licensed_property_id = p.licensed_property_id$new$;
  v_dcp_old text;
  v_dcp_new text;
begin
  select pg_get_functiondef(
    'api.db_data_admin_scraped_properties(text,text,integer)'::regprocedure
  ) into v_definition;

  v_dcp_old := $old$    left join lateral (
      select case
        when o.opa_scope_count > 1 then 'opa_scope_conflict'
        when r.contract_asserted_studio_code is not null
          and o.opa_studio_code is not null
          and r.contract_asserted_studio_code <> o.opa_studio_code
          then 'contract_opa_conflict'
        when r.contract_asserted_studio_code is not null and o.member_count > 0
          then 'direct_' || r.contract_asserted_studio_code
        when o.opa_studio_code is not null then 'direct_' || o.opa_studio_code
      end as authority_status
      from (
        select current_r.*
        from plm.dcp_opa_property_resolution current_r
        where current_r.source_system = p.source_system
          and current_r.source_table = 'plm.dcp_property'
          and current_r.source_property_id = p.source_id
          and current_r.approval_status = 'approved'
          and not exists (select 1 from plm.dcp_opa_property_resolution newer_r
            where newer_r.supersedes_resolution_id = current_r.resolution_id)
        order by current_r.decision_version desc, current_r.approved_at desc,
          current_r.resolution_id desc
        limit 1
      ) r
      left join lateral (
        select count(distinct m.branch_code) as opa_scope_count,
          min(m.branch_code) as opa_studio_code,
          (select count(*) from plm.dcp_opa_property_resolution_member all_rm
            where all_rm.resolution_id = r.resolution_id) as member_count
        from (
        select distinct on (rm.licensed_property_id, sm.region_code, sm.branch_code,
          sm.line_of_business_id, sm.product_type_code, sm.template_id, sm.workflow_id)
          sm.branch_code
        from plm.dcp_opa_property_resolution_member rm
        join plm.opa_property_scope_membership sm
          on sm.licensed_property_id = rm.licensed_property_id
         and sm.approval_status = 'approved'
        where rm.resolution_id = r.resolution_id
        order by rm.licensed_property_id, sm.region_code, sm.branch_code,
          sm.line_of_business_id, sm.product_type_code, sm.template_id, sm.workflow_id,
          sm.source_captured_at desc, sm.created_at desc, sm.membership_id desc
        ) m
      ) o on true
    ) x on true$old$;
  v_dcp_new := $new$    left join dcp_current_resolution r
      on r.source_system = p.source_system
     and r.source_table = 'plm.dcp_property'
     and r.source_property_id = p.source_id
    left join dcp_member_count mc on mc.resolution_id = r.resolution_id
    left join dcp_scope_summary o on o.resolution_id = r.resolution_id
    left join lateral (
      select case
        when o.opa_scope_count > 1 then 'opa_scope_conflict'
        when r.contract_asserted_studio_code is not null
          and o.opa_studio_code is not null
          and r.contract_asserted_studio_code <> o.opa_studio_code
          then 'contract_opa_conflict'
        when r.contract_asserted_studio_code is not null and mc.member_count > 0
          then 'direct_' || r.contract_asserted_studio_code
        when o.opa_studio_code is not null then 'direct_' || o.opa_studio_code
      end as authority_status
    ) x on true$new$;

  if position(v_cte_needle in v_definition) = 0
     or position(v_opa_old in v_definition) = 0
     or position(v_dcp_old in v_definition) = 0
     or position(replace(replace(v_dcp_old,
          '''plm.dcp_property''', '''plm.lucasfilm_dcp_property'''),
          'from plm.dcp_property p', 'from plm.lucasfilm_dcp_property p') in v_definition) = 0
     or position('ordered as materialized' in v_definition) = 0
     or position('enriched as materialized' in v_definition) = 0 then
    raise exception using errcode = '55000',
      message = '#1936 forward-2 predecessor differs from reviewed first repair';
  end if;

  v_definition := replace(v_definition, v_cte_needle, v_cte_replacement);
  v_definition := replace(v_definition, v_opa_old, v_opa_new);
  v_definition := replace(v_definition, v_dcp_old, v_dcp_new);
  v_definition := replace(v_definition,
    replace(replace(v_dcp_old,
      '''plm.dcp_property''', '''plm.lucasfilm_dcp_property'''),
      'from plm.dcp_property p', 'from plm.lucasfilm_dcp_property p'),
    replace(replace(v_dcp_new,
      '''plm.dcp_property''', '''plm.lucasfilm_dcp_property'''),
      'from plm.dcp_property p', 'from plm.lucasfilm_dcp_property p'));

  execute v_definition;
end;
$migration$;

comment on function api.db_data_admin_scraped_properties(text,text,integer) is
  'Licensing-manager-only paginated cross-licensor scraped Property evidence. Source authority is resolved set-wise before ordering; page rows alone receive mapping and contract enrichment. Source, mapping, contract, unresolved-state, privacy, and authorization semantics are preserved.';
