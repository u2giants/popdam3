-- #3104: Warner Submissions section and mapped values in
-- api.db_data_admin_scraped_source_inventory.
--
-- derived-from: 20260914172031
--
-- plm.wb_property rows with source_namespace 'warner_product_catalogue'
-- (STARLABS Product catalogue) are now source_purpose Submissions under the
-- label 'Warner Bros. - Submissions (STARLABS Product catalogue)';
-- 'warner_art_assets' rows stay Creative. licensor_key, source_id and row_key are
-- unchanged, so ledger identities and paging cursors stay stable.
--
-- Property rows now also return the mapped value for the Mapping column:
-- Creative rows carry `submissions` (members of the winning mapped decision,
-- only when mapping_state is 'mapped'; otherwise an empty array) and Submissions
-- rows carry `mapped_creative` (the Creative rows whose winning mapped decision
-- names this row). Each entry holds source_system, source_table, source_id and
-- display_label only; no evidence locator or contract data is exposed.
-- The character and style-guide arms, grants and the rest of the function are
-- carried forward unchanged from 20260914172031.

create or replace function api.db_data_admin_scraped_source_inventory(
  p_entity_kind text,
  p_search text default null,
  p_cursor text default null,
  p_page_size integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'app', 'public'
as $function$
declare
  v_entity_kind text;
  v_page_size integer;
  v_cursor_key text;
  v_rows jsonb;
  v_fetched integer := 0;
  v_last_key text;
  v_next_cursor text;
begin
  perform app.require_licensing_manager_access();

  v_entity_kind := lower(btrim(coalesce(p_entity_kind, '')));
  if v_entity_kind not in ('property', 'character', 'style_guide') then
    raise exception 'db_data_admin: invalid entity kind'
      using errcode = 'invalid_parameter_value';
  end if;

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

  if v_entity_kind = 'property' then
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
        end::text as licensor_key,
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
        end::text as licensor_name,
        'Submissions'::text as source_purpose,
        'disney_opa'::text as source_system,
        'plm.opa_property'::text as source_table,
        p.licensed_property_id::text as source_id,
        p.property_name::text as source_label,
        coalesce(s.scope_status, o.resolution_status, 'unresolved')::text as source_status,
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
        'Creative',
        p.source_system, 'plm.dcp_property', p.source_id, p.display_name,
        coalesce(x.authority_status, 'unresolved'),
        null::timestamptz,
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
        'Creative',
        p.source_system, 'plm.marvel_dcp_property', p.source_id, p.display_name,
        'non_authoritative',
        null::timestamptz,
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
        'Creative',
        p.source_system, 'plm.lucasfilm_dcp_property', p.source_id, p.display_name,
        coalesce(x.authority_status, 'unresolved'),
        null::timestamptz,
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
        'Creative',
        'marvel_asgard',
        'plm.marvel_asgard_style_guide',
        g.source_identity_key,
        g.exact_label,
        case when g.is_actively_observed then 'active' else 'retained' end,
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
        'Creative',
        p.source_system, 'plm.twentieth_century_dcp_property', p.source_id, p.display_name,
        case when p.source_id like 'dcpvault:%' then coalesce(x.authority_status, 'unresolved') end,
        null::timestamptz,
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
      select 'paramount', 'Paramount - Creative (Creative Library)', 'Creative',
             'paramount_creative_library',
             'plm.pmt_property', p.property_source_id::text, p.property_name,
             case when p.is_licensed_selection then 'licensed_selection'
                  else 'asset_metadata' end,
             p.imported_at, p.capture_id::text
      from pmt_ranked p
      where p.capture_rank = 1

      union all
      select 'warner-bros',
             case when p.source_namespace = 'warner_product_catalogue'
               then 'Warner Bros. - Submissions (STARLABS Product catalogue)'
               else 'Warner Bros. - Creative (STARLABS)' end,
             case when p.source_namespace = 'warner_product_catalogue'
               then 'Submissions' else 'Creative' end,
             'warner_starlabs',
             'plm.wb_property',
             p.source_namespace || ':' || p.identity_method || ':' ||
               coalesce(p.source_id, p.fallback_key),
             p.label, null,
             p.last_seen_at, p.capture_id::text
      from plm.wb_property p

      union all
      select 'nbcuniversal',
             case when p.source_kind in ('property', 'franchise_asset')
               then 'NBCUniversal - Submissions (Product Submissions picker)'
               else 'NBCUniversal - Creative (Creative Asset Factory)' end,
             case when p.source_kind in ('property', 'franchise_asset')
               then 'Submissions' else 'Creative' end,
             'nbcu_creative_asset_factory',
             'plm.nbcu_property', p.property_key, p.property_label, null,
             p.source_captured_at, p.capture_id::text
      from nbcu_ranked p
      where p.capture_rank = 1

      union all
      select 'strawberry-shortcake-creative', 'Strawberry Shortcake - Creative', 'Creative',
             'wildbrain_tenovos', 'plm.wildbrain_era', e.era_source_id,
             e.era_label, case when e.is_root then 'root' else 'descendant' end,
             null::timestamptz, e.capture_id::text
      from wildbrain_ranked e
      where e.capture_rank = 1

      union all
      select 'sega-submissions', 'Sega - Submissions', 'Submissions',
             'sega_product_approval',
             'plm.sega_submission_property', p.property_source_id,
             p.property_label, 'complete',
             null::timestamptz, p.submission_capture_id::text
      from sega_submission_ranked p
      where p.capture_rank = 1

      union all
      select 'sega-creative', 'Sega - Creative', 'Creative',
             'sega_dsi', 'plm.sega_property', p.property_source_id,
             p.property_label, p.source_status,
             null::timestamptz, p.capture_id::text
      from sega_ranked p
      where p.capture_rank = 1

      union all
      select 'paramount-submissions', 'Paramount - Submissions (TrackerPlus)', 'Submissions',
             'paramount_trackerplus', 'plm.pmt_trackerplus_submission_property',
             p.property_local_key, p.exact_label, 'complete',
             null::timestamptz, p.capture_id::text
      from plm.pmt_trackerplus_submission_property p
      join pmt_trackerplus_latest c on c.id = p.capture_id

      union all
      select 'coca-cola-creative', 'Coca-Cola - Creative (Asset Library Property choices)',
             'Creative',
             'coke_brandcomply', 'plm.coke_asset_property_option', o.option_key,
             o.exact_label, o.classification_status,
             null::timestamptz, o.capture_id::text
      from (
        select distinct on (opt.option_key)
               opt.option_key, opt.exact_label, opt.classification_status, opt.capture_id
        from plm.coke_asset_property_option opt
        join coke_property_latest c on c.id = opt.capture_id
        order by opt.option_key, opt.ordinal, opt.exact_label
      ) o

      union all
      select 'wwe-submissions', 'WWE - Submissions', 'Submissions',
             'wwe_submissions',
             'plm.wwe_property', p.property_source_id, p.property_label,
             case when p.parent_property_source_id is null then 'root' else 'descendant' end,
             null::timestamptz, p.capture_id::text
      from plm.wwe_property p
      join wwe_submission_latest c on c.id = p.capture_id
    ), keyed as (
      select
        jsonb_build_array(
          'property', s.licensor_key, s.source_system, s.source_table, s.source_id
        )::text as row_key,
        s.*,
        case
          when s.licensor_key in ('disney', 'disney-opa') then 'disney'
          when s.licensor_key in ('marvel', 'marvel-opa', 'marvel-asgard-creative') then 'marvel'
          when s.licensor_key in ('pixar', 'pixar-opa') then 'pixar'
          when s.licensor_key in ('lucasfilm-star-wars', 'lucasfilm-star-wars-opa') then 'lucasfilm-star-wars'
          when s.licensor_key = '20th-century' then '20th-century'
          when s.licensor_key = 'warner-bros' then 'warner-bros'
          when s.licensor_key = 'nbcuniversal' then 'nbcuniversal'
          when s.licensor_key in ('paramount', 'paramount-submissions') then 'paramount'
          when s.licensor_key = 'strawberry-shortcake-creative' then 'strawberry-shortcake'
          when s.licensor_key in ('sega-creative', 'sega-submissions') then 'sega'
          when s.licensor_key = 'coca-cola-creative' then 'coca-cola'
          when s.licensor_key = 'peanuts-creative' then 'peanuts'
          when s.licensor_key = 'sesame-creative' then 'sesame-workshop'
          when s.licensor_key in ('wwe-creative', 'wwe-submissions') then 'wwe'
          else 'unresolved'
        end::text as licensor_group_key,
        case
          when s.licensor_key in ('disney', 'disney-opa') then 'Disney'
          when s.licensor_key in ('marvel', 'marvel-opa', 'marvel-asgard-creative') then 'Marvel'
          when s.licensor_key in ('pixar', 'pixar-opa') then 'Pixar'
          when s.licensor_key in ('lucasfilm-star-wars', 'lucasfilm-star-wars-opa') then 'Lucasfilm / Star Wars'
          when s.licensor_key = '20th-century' then '20th Century'
          when s.licensor_key = 'warner-bros' then 'Warner Bros.'
          when s.licensor_key = 'nbcuniversal' then 'NBCUniversal'
          when s.licensor_key in ('paramount', 'paramount-submissions') then 'Paramount'
          when s.licensor_key = 'strawberry-shortcake-creative' then 'Strawberry Shortcake'
          when s.licensor_key in ('sega-creative', 'sega-submissions') then 'Sega'
          when s.licensor_key = 'coca-cola-creative' then 'Coca-Cola'
          when s.licensor_key = 'peanuts-creative' then 'Peanuts'
          when s.licensor_key = 'sesame-creative' then 'Sesame Workshop'
          when s.licensor_key in ('wwe-creative', 'wwe-submissions') then 'WWE'
          else 'Licensor not yet determined'
        end::text as licensor_group_name,
        coalesce(
          nullif(btrim(s.source_label), ''),
          nullif(btrim(regexp_replace(
            regexp_replace(s.source_id, '^.*/', ''), '[-_]+', ' ', 'g'
          )), '')
        ) as display_label
      from source_rows s
    ), filtered as (
      select k.*
      from keyed k
      where (
        p_search is null
        or k.licensor_name ilike '%' || p_search || '%'
        or k.source_system ilike '%' || p_search || '%'
        or k.source_id ilike '%' || p_search || '%'
        or k.display_label ilike '%' || p_search || '%'
      )
        and (p_cursor is null or k.row_key collate "C" > v_cursor_key collate "C")
    ), ordered as materialized (
      select f.*
      from filtered f
      order by f.row_key collate "C"
      limit v_page_size + 1
    ), page_creative_decision as materialized (
      -- One stable DCP source id is the business Creative identity. Every retained
      -- source-system/table copy of it is provenance, not a separate business fact.
      -- Non-DCP sources keep their exact copy key because bare integer source ids
      -- collide between licensors.
      select o.row_key, r.decision_state
      from ordered o
      cross join lateral (
        select case when o.source_id like 'dcpvault:%'
                    then o.source_id
                    else o.source_table||'|'||o.source_system||'|'||o.source_id
               end as identity_key
      ) k
      left join lateral (
        select
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
            (array_agg(c.copy_state order by c.decision_version desc,
               c.approved_at desc nulls last, c.resolution_id desc))[1]
               as newest_state
          from (
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
                        and t.source_property_id = o.source_id
                  end
            order by t.source_system, t.source_table, t.decision_version desc,
              t.approved_at desc nulls last, t.resolution_id desc
          ) c
        ) g
      ) r on true
    ), current_copy as materialized (
      -- The newest approved/rejected decision for every retained source copy.
      -- Same copy and identity rules as page_creative_decision above.
      select distinct on (t.source_system, t.source_table, t.source_property_id)
        t.resolution_id,
        case when t.source_property_id like 'dcpvault:%'
             then t.source_property_id
             else t.source_table||'|'||t.source_system||'|'||t.source_property_id
        end as identity_key,
        (case
          when t.creative_decision_state is not null then t.creative_decision_state
          when t.approval_status='approved' and mf.fingerprint <> '' then 'mapped'
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
      order by t.source_system, t.source_table, t.source_property_id,
        t.decision_version desc, t.approved_at desc nulls last, t.resolution_id desc
    ), mapped_member as materialized (
      -- Members of the winning mapped decision of every Creative identity whose
      -- decision state is exactly 'mapped' (never conflict).
      select distinct c.identity_key,
        m.submission_source_system, m.submission_source_table, m.submission_source_id
      from current_copy c
      join plm.dcp_opa_property_resolution_member m on m.resolution_id = c.resolution_id
      where c.copy_state = 'mapped'
        and c.identity_key in (
          select cc.identity_key
          from current_copy cc
          group by cc.identity_key
          having count(*) filter (where cc.copy_state='mapped') > 0
             and count(distinct cc.member_fingerprint)
               filter (where cc.copy_state='mapped') = 1
        )
    ), page_identity as materialized (
      select o.row_key, o.source_purpose, o.source_table, o.source_id,
        case when o.source_id like 'dcpvault:%'
             then o.source_id
             else o.source_table||'|'||o.source_system||'|'||o.source_id
        end as identity_key
      from ordered o
    ), page_submissions as materialized (
      -- Creative rows: the Submissions members of the winning mapped decision.
      select x.row_key,
        jsonb_agg(jsonb_build_object(
          'source_system', x.submission_source_system,
          'source_table', x.submission_source_table,
          'source_id', x.submission_source_id,
          'display_label', x.display_label
        ) order by x.display_label, x.submission_source_system,
          x.submission_source_table, x.submission_source_id) as submissions
      from (
        select p.row_key, mm.submission_source_system, mm.submission_source_table,
          mm.submission_source_id,
          coalesce((array_agg(k.display_label
            order by (k.source_system = mm.submission_source_system) desc nulls last,
              k.row_key collate "C"))[1], mm.submission_source_id) as display_label
        from page_identity p
        join page_creative_decision d
          on d.row_key = p.row_key and d.decision_state = 'mapped'
        join mapped_member mm on mm.identity_key = p.identity_key
        left join keyed k
          on k.source_table = mm.submission_source_table
         and k.source_id = mm.submission_source_id
        where p.source_purpose = 'Creative'
        group by p.row_key, mm.submission_source_system, mm.submission_source_table,
          mm.submission_source_id
      ) x
      group by x.row_key
    ), page_mapped_creative as materialized (
      -- Submissions rows: one entry per Creative identity mapped to this row.
      select x.row_key,
        jsonb_agg(jsonb_build_object(
          'source_system', x.source_system,
          'source_table', x.source_table,
          'source_id', x.source_id,
          'display_label', x.display_label
        ) order by x.display_label, x.source_system, x.source_table, x.source_id)
          as mapped_creative
      from (
        select distinct on (p.row_key, mm.identity_key)
          p.row_key, k.source_system, k.source_table, k.source_id, k.display_label
        from page_identity p
        join mapped_member mm
          on mm.submission_source_table = p.source_table
         and mm.submission_source_id = p.source_id
        join keyed k
          on k.source_purpose = 'Creative'
         and case when k.source_id like 'dcpvault:%'
                  then k.source_id
                  else k.source_table||'|'||k.source_system||'|'||k.source_id
             end = mm.identity_key
        where p.source_purpose = 'Submissions'
        order by p.row_key, mm.identity_key, k.row_key collate "C"
      ) x
      group by x.row_key
    ), numbered as (
      select o.*,
        d.decision_state,
        ps.submissions,
        pc.mapped_creative,
        row_number() over (order by o.row_key collate "C") as rn
      from ordered o
      left join page_creative_decision d on d.row_key = o.row_key
      left join page_submissions ps on ps.row_key = o.row_key
      left join page_mapped_creative pc on pc.row_key = o.row_key
    )
    select
      coalesce(jsonb_agg(
        jsonb_build_object(
          'row_key', n.row_key,
          'entity_kind', 'property',
          'licensor_key', n.licensor_key,
          'licensor_name', n.licensor_name,
          'licensor_group_key', n.licensor_group_key,
          'licensor_group_name', n.licensor_group_name,
          'source_purpose', n.source_purpose,
          'display_label', n.display_label,
          'source_system', n.source_system,
          'source_table', n.source_table,
          'source_id', n.source_id,
          'source_status', n.source_status,
          'latest_seen_at', n.latest_seen_at,
          'capture_marker', n.capture_marker,
          'mapping_state', case when n.source_purpose = 'Creative'
            then coalesce(n.decision_state, 'unmapped') else null end,
          'submissions', case when n.source_purpose = 'Creative'
            then coalesce(n.submissions, '[]'::jsonb) else null end,
          'mapped_creative', case when n.source_purpose = 'Submissions'
            then coalesce(n.mapped_creative, '[]'::jsonb) else null end
        ) order by n.rn
      ) filter (where n.rn <= v_page_size), '[]'::jsonb),
      count(*)::integer,
      max(n.row_key) filter (where n.rn = v_page_size)
    into v_rows, v_fetched, v_last_key
    from numbered n;

  elsif v_entity_kind = 'character' then
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
    ), opa_character_scope as materialized (
      -- A character has no scope of its own. 609 OPA characters belong to more than
      -- one property, so studio is inherited through EVERY parent property and a
      -- character whose parents sit in more than one studio branch is a scope
      -- conflict, never silently attributed to Disney.
      select pc.character_id,
        count(distinct s.branch_code) as scope_count,
        min(s.branch_code) as studio_code
      from plm.opa_property_character pc
      join opa_scope_latest s on s.licensed_property_id = pc.licensed_property_id
      group by pc.character_id
    ), opa_character_studio as materialized (
      select pc.character_id,
        case
          when count(*) filter (where o.resolution_status = 'ambiguous_crossover') > 0
            or count(distinct o.studio_code) filter (where o.resolution_status = 'canonical') > 1
            then 'ambiguous_crossover'
          when count(*) filter (where o.resolution_status = 'canonical') > 0 then 'canonical'
          else 'unresolved'
        end as resolution_status,
        case
          when count(*) filter (where o.resolution_status = 'ambiguous_crossover') = 0
            and count(distinct o.studio_code) filter (where o.resolution_status = 'canonical') = 1
            then min(o.studio_code) filter (where o.resolution_status = 'canonical')
        end as studio_code
      from plm.opa_property_character pc
      join opa_studio_summary o on o.licensed_property_id = pc.licensed_property_id
      group by pc.character_id
    ), nbcu_character_ranked as (
      select ch.*,
        row_number() over (
          partition by ch.character_key
          order by c.source_captured_at desc, ch.source_captured_at desc,
            ch.capture_id::text desc
        ) as capture_rank
      from plm.nbcu_character ch
      join plm.nbcu_capture c on c.id = ch.capture_id
      where c.status = 'complete'
    ), pmt_character_ranked as (
      select ch.*,
        row_number() over (
          partition by ch.character_source_id
          order by c.completed_at desc nulls last, ch.imported_at desc,
            ch.capture_id::text desc
        ) as capture_rank
      from plm.pmt_character ch
      join plm.pmt_capture c on c.capture_id = ch.capture_id
      where c.status = 'complete'
        and c.capture_kind = 'full'
    ), wildbrain_character_ranked as (
      select ch.*,
        row_number() over (
          partition by ch.character_source_id
          order by c.source_captured_at desc, ch.capture_id::text desc
        ) as capture_rank
      from plm.wildbrain_character ch
      join plm.wildbrain_capture c on c.id = ch.capture_id
      where c.status = 'complete'
    ), peanuts_latest as (
      select c.id
      from plm.peanuts_capture c
      where c.status = 'complete'
      order by c.source_captured_at desc, c.load_completed_at desc, c.id desc
      limit 1
    ), sesame_latest as (
      select c.id
      from plm.sesame_capture c
      where c.status = 'complete'
      order by c.source_captured_at desc, c.load_completed_at desc, c.id desc
      limit 1
    ), source_rows as not materialized (
      select
        case
          when sc.scope_count > 1 or st.resolution_status = 'ambiguous_crossover'
            then 'opa-scope-conflict'
          when sc.studio_code = 'lucasfilm' then 'lucasfilm-star-wars-opa'
          when sc.studio_code = 'disney' and st.resolution_status = 'canonical'
            and st.studio_code in ('disney','marvel','pixar') then
            case st.studio_code when 'disney' then 'disney-opa'
              when 'marvel' then 'marvel-opa' when 'pixar' then 'pixar-opa' end
          when sc.studio_code = 'disney' then 'disney-opa'
          when sc.studio_code is null and st.resolution_status = 'canonical' then
            case st.studio_code when 'disney' then 'disney-opa'
              when 'marvel' then 'marvel-opa'
              when 'lucasfilm' then 'lucasfilm-star-wars-opa'
              when 'pixar' then 'pixar-opa' end
          else 'disney-opa-unresolved'
        end::text as licensor_key,
        case
          when sc.scope_count > 1 or st.resolution_status = 'ambiguous_crossover'
            then 'OPA - Submissions (scope conflict)'
          when sc.studio_code = 'lucasfilm' then 'Lucasfilm / Star Wars - Submissions (OPA)'
          when sc.studio_code = 'disney' and st.resolution_status = 'canonical'
            and st.studio_code = 'marvel' then 'Marvel - Submissions (OPA)'
          when sc.studio_code = 'disney' and st.resolution_status = 'canonical'
            and st.studio_code = 'pixar' then 'Pixar - Submissions (OPA)'
          when sc.studio_code = 'disney' then 'Disney - Submissions (OPA)'
          when sc.studio_code is null and st.resolution_status = 'canonical' then
            case st.studio_code when 'disney' then 'Disney - Submissions (OPA)'
              when 'marvel' then 'Marvel - Submissions (OPA)'
              when 'lucasfilm' then 'Lucasfilm / Star Wars - Submissions (OPA)'
              when 'pixar' then 'Pixar - Submissions (OPA)' end
          else 'OPA - Submissions (unresolved)'
        end::text as licensor_name,
        'Submissions'::text as source_purpose,
        'disney_opa'::text as source_system,
        'plm.opa_character'::text as source_table,
        ch.character_id::text as source_id,
        ch.character_name::text as source_label,
        coalesce(ch.resolution_status, 'unresolved')::text as source_status,
        ch.last_seen_at::timestamptz as latest_seen_at,
        null::text as capture_marker
      from plm.opa_character ch
      left join opa_character_scope sc on sc.character_id = ch.character_id
      left join opa_character_studio st on st.character_id = ch.character_id

      union all
      select 'disney', 'Disney - Creative (DCP Vault)', 'Creative',
             ch.source_system, 'plm.dcp_character', ch.source_id, ch.display_name,
             null, null::timestamptz, ch.last_seen_metadata_run_id::text
      from plm.dcp_character ch

      union all
      select 'lucasfilm-star-wars', 'Lucasfilm / Star Wars - Creative (DCP Vault)', 'Creative',
             ch.source_system, 'plm.lucasfilm_dcp_character', ch.source_id, ch.display_name,
             null, null::timestamptz, ch.last_seen_metadata_run_id::text
      from plm.lucasfilm_dcp_character ch

      union all
      select '20th-century', '20th Century - Creative (DCP Vault)', 'Creative',
             ch.source_system, 'plm.twentieth_century_dcp_character', ch.source_id,
             ch.display_name, null, null::timestamptz,
             ch.last_seen_metadata_run_id::text
      from plm.twentieth_century_dcp_character ch

      union all
      select 'dcp-vault-non-authoritative-marvel-tag',
             'DCP Vault - Creative (non-authoritative Marvel tag)', 'Creative',
             ch.source_system, 'plm.marvel_dcp_character', ch.source_id, ch.display_name,
             'non_authoritative', null::timestamptz,
             ch.last_seen_metadata_run_id::text
      from plm.marvel_dcp_character ch

      union all
      select 'marvel-asgard-creative', 'Marvel - Creative (ASGARD)', 'Creative',
             'marvel_asgard', 'plm.marvel_asgard_character', ch.source_identity_key,
             ch.exact_label,
             case when ch.is_actively_observed then 'active' else 'retained' end,
             null::timestamptz, ch.last_seen_capture_key::text
      from plm.marvel_asgard_character ch

      union all
      select 'warner-bros', 'Warner Bros. - Creative (STARLABS)', 'Creative',
             'warner_starlabs', 'plm.wb_character_normalized',
             ch.source_namespace || ':' || coalesce(ch.source_id, ch.fallback_key), ch.label, ch.status,
             ch.last_seen_at, ch.capture_id::text
      from plm.wb_character_normalized ch

      union all
      select 'nbcuniversal', 'NBCUniversal - Creative (Creative Asset Factory)', 'Creative',
             'nbcu_creative_asset_factory', 'plm.nbcu_character', ch.character_key,
             ch.character_label, coalesce(ch.resolution_status, 'unresolved'),
             ch.source_captured_at, ch.capture_id::text
      from nbcu_character_ranked ch
      where ch.capture_rank = 1

      union all
      select 'paramount', 'Paramount - Creative (Creative Library)', 'Creative',
             'paramount_creative_library', 'plm.pmt_character',
             ch.character_source_id::text, ch.character_name,
             coalesce(ch.resolution_status, 'unresolved'),
             ch.imported_at, ch.capture_id::text
      from pmt_character_ranked ch
      where ch.capture_rank = 1

      union all
      select 'strawberry-shortcake-creative', 'Strawberry Shortcake - Creative', 'Creative',
             'wildbrain_tenovos', 'plm.wildbrain_character', ch.character_source_id,
             ch.character_label,
             case when ch.in_source_dictionary then 'in_source_dictionary'
                  else 'asset_value_only' end,
             null::timestamptz, ch.capture_id::text
      from wildbrain_character_ranked ch
      where ch.capture_rank = 1

      union all
      select 'peanuts-creative', 'Peanuts - Creative (Tenovos)', 'Creative',
             'peanuts_tenovos', 'plm.peanuts_character', ch.value_key, ch.value_label,
             null, null::timestamptz, ch.capture_id::text
      from plm.peanuts_character ch
      join peanuts_latest c on c.id = ch.capture_id

      union all
      select 'sesame-creative', 'Sesame Workshop - Creative (NetX)', 'Creative',
             'sesame_netx', 'plm.sesame_character',
             ch.field_generation || ':' || ch.value_key, ch.value_label,
             ch.field_generation, null::timestamptz, ch.capture_id::text
      from plm.sesame_character ch
      join sesame_latest c on c.id = ch.capture_id
    ), keyed as (
      select
        jsonb_build_array(
          'character', s.licensor_key, s.source_system, s.source_table, s.source_id
        )::text as row_key,
        s.*,
        case
          when s.licensor_key in ('disney', 'disney-opa') then 'disney'
          when s.licensor_key in ('marvel', 'marvel-opa', 'marvel-asgard-creative') then 'marvel'
          when s.licensor_key in ('pixar', 'pixar-opa') then 'pixar'
          when s.licensor_key in ('lucasfilm-star-wars', 'lucasfilm-star-wars-opa') then 'lucasfilm-star-wars'
          when s.licensor_key = '20th-century' then '20th-century'
          when s.licensor_key = 'warner-bros' then 'warner-bros'
          when s.licensor_key = 'nbcuniversal' then 'nbcuniversal'
          when s.licensor_key in ('paramount', 'paramount-submissions') then 'paramount'
          when s.licensor_key = 'strawberry-shortcake-creative' then 'strawberry-shortcake'
          when s.licensor_key in ('sega-creative', 'sega-submissions') then 'sega'
          when s.licensor_key = 'coca-cola-creative' then 'coca-cola'
          when s.licensor_key = 'peanuts-creative' then 'peanuts'
          when s.licensor_key = 'sesame-creative' then 'sesame-workshop'
          when s.licensor_key in ('wwe-creative', 'wwe-submissions') then 'wwe'
          else 'unresolved'
        end::text as licensor_group_key,
        case
          when s.licensor_key in ('disney', 'disney-opa') then 'Disney'
          when s.licensor_key in ('marvel', 'marvel-opa', 'marvel-asgard-creative') then 'Marvel'
          when s.licensor_key in ('pixar', 'pixar-opa') then 'Pixar'
          when s.licensor_key in ('lucasfilm-star-wars', 'lucasfilm-star-wars-opa') then 'Lucasfilm / Star Wars'
          when s.licensor_key = '20th-century' then '20th Century'
          when s.licensor_key = 'warner-bros' then 'Warner Bros.'
          when s.licensor_key = 'nbcuniversal' then 'NBCUniversal'
          when s.licensor_key in ('paramount', 'paramount-submissions') then 'Paramount'
          when s.licensor_key = 'strawberry-shortcake-creative' then 'Strawberry Shortcake'
          when s.licensor_key in ('sega-creative', 'sega-submissions') then 'Sega'
          when s.licensor_key = 'coca-cola-creative' then 'Coca-Cola'
          when s.licensor_key = 'peanuts-creative' then 'Peanuts'
          when s.licensor_key = 'sesame-creative' then 'Sesame Workshop'
          when s.licensor_key in ('wwe-creative', 'wwe-submissions') then 'WWE'
          else 'Licensor not yet determined'
        end::text as licensor_group_name,
        coalesce(
          nullif(btrim(s.source_label), ''),
          nullif(btrim(regexp_replace(
            regexp_replace(s.source_id, '^.*/', ''), '[-_]+', ' ', 'g'
          )), '')
        ) as display_label
      from source_rows s
    ), filtered as (
      select k.*
      from keyed k
      where (
        p_search is null
        or k.licensor_name ilike '%' || p_search || '%'
        or k.source_system ilike '%' || p_search || '%'
        or k.source_id ilike '%' || p_search || '%'
        or k.display_label ilike '%' || p_search || '%'
      )
        and (p_cursor is null or k.row_key collate "C" > v_cursor_key collate "C")
    ), ordered as materialized (
      select f.*
      from filtered f
      order by f.row_key collate "C"
      limit v_page_size + 1
    ), numbered as (
      select o.*, row_number() over (order by o.row_key collate "C") as rn
      from ordered o
    )
    select
      coalesce(jsonb_agg(
        jsonb_build_object(
          'row_key', n.row_key,
          'entity_kind', 'character',
          'licensor_key', n.licensor_key,
          'licensor_name', n.licensor_name,
          'licensor_group_key', n.licensor_group_key,
          'licensor_group_name', n.licensor_group_name,
          'source_purpose', n.source_purpose,
          'display_label', n.display_label,
          'source_system', n.source_system,
          'source_table', n.source_table,
          'source_id', n.source_id,
          'source_status', n.source_status,
          'latest_seen_at', n.latest_seen_at,
          'capture_marker', n.capture_marker,
          'mapping_state', null
        ) order by n.rn
      ) filter (where n.rn <= v_page_size), '[]'::jsonb),
      count(*)::integer,
      max(n.row_key) filter (where n.rn = v_page_size)
    into v_rows, v_fetched, v_last_key
    from numbered n;

  else
    with nbcu_style_guide_ranked as (
      select g.*,
        row_number() over (
          partition by g.style_guide_key
          order by c.source_captured_at desc, g.source_captured_at desc,
            g.capture_id::text desc
        ) as capture_rank
      from plm.nbcu_style_guide g
      join plm.nbcu_capture c on c.id = g.capture_id
      where c.status = 'complete'
    ), peanuts_latest as (
      select c.id
      from plm.peanuts_capture c
      where c.status = 'complete'
      order by c.source_captured_at desc, c.load_completed_at desc, c.id desc
      limit 1
    ), sesame_latest as (
      select c.id
      from plm.sesame_capture c
      where c.status = 'complete'
      order by c.source_captured_at desc, c.load_completed_at desc, c.id desc
      limit 1
    ), wwe_creative_latest as (
      select c.id
      from plm.wwe_creative_capture c
      where c.status = 'complete'
      order by c.source_captured_at desc, c.load_completed_at desc, c.id desc
      limit 1
    ), source_rows as not materialized (
      select
        'disney'::text as licensor_key,
        'Disney - Creative (DCP Vault)'::text as licensor_name,
        'Creative'::text as source_purpose,
        g.source_system::text as source_system,
        'plm.dcp_style_guide'::text as source_table,
        g.source_path::text as source_id,
        g.folder_name::text as source_label,
        coalesce(g.resolution_status, 'unresolved')::text as source_status,
        null::timestamptz as latest_seen_at,
        g.last_seen_crawl_id::text as capture_marker
      from plm.dcp_style_guide g

      union all
      select 'lucasfilm-star-wars', 'Lucasfilm / Star Wars - Creative (DCP Vault)', 'Creative',
             g.source_system, 'plm.lucasfilm_dcp_style_guide', g.source_path,
             g.folder_name, coalesce(g.resolution_status, 'unresolved'),
             null::timestamptz, g.last_seen_crawl_id::text
      from plm.lucasfilm_dcp_style_guide g

      union all
      select '20th-century', '20th Century - Creative (DCP Vault)', 'Creative',
             g.source_system, 'plm.twentieth_century_dcp_style_guide', g.source_path,
             g.folder_name, coalesce(g.resolution_status, 'unresolved'),
             null::timestamptz, g.last_seen_crawl_id::text
      from plm.twentieth_century_dcp_style_guide g

      union all
      select 'dcp-vault-non-authoritative-marvel-tag',
             'DCP Vault - Creative (non-authoritative Marvel tag)', 'Creative',
             g.source_system, 'plm.marvel_dcp_style_guide', g.source_path,
             g.folder_name, 'non_authoritative',
             null::timestamptz, g.last_seen_crawl_id::text
      from plm.marvel_dcp_style_guide g

      union all
      select 'marvel-asgard-creative', 'Marvel - Creative (ASGARD)', 'Creative',
             'marvel_asgard', 'plm.marvel_asgard_style_guide', g.source_identity_key,
             g.exact_label,
             case when g.is_actively_observed then 'active' else 'retained' end,
             null::timestamptz, g.last_seen_capture_key::text
      from plm.marvel_asgard_style_guide g

      union all
      select 'warner-bros', 'Warner Bros. - Creative (STARLABS)', 'Creative',
             'warner_starlabs', 'plm.wb_style_guide_normalized',
             g.source_namespace || ':' || coalesce(g.source_id, g.fallback_key),
             g.label, g.status, g.last_seen_at, g.capture_id::text
      from plm.wb_style_guide_normalized g

      union all
      select 'nbcuniversal', 'NBCUniversal - Creative (Creative Asset Factory)', 'Creative',
             'nbcu_creative_asset_factory', 'plm.nbcu_style_guide', g.style_guide_key,
             g.style_guide_label, coalesce(g.resolution_status, 'unresolved'),
             g.source_captured_at, g.capture_id::text
      from nbcu_style_guide_ranked g
      where g.capture_rank = 1

      union all
      select 'peanuts-creative', 'Peanuts - Creative (Tenovos)', 'Creative',
             'peanuts_tenovos', 'plm.peanuts_style_guide', g.value_key, g.value_label,
             null, null::timestamptz, g.capture_id::text
      from plm.peanuts_style_guide g
      join peanuts_latest c on c.id = g.capture_id

      union all
      select 'sesame-creative', 'Sesame Workshop - Creative (NetX)', 'Creative',
             'sesame_netx', 'plm.sesame_style_guide',
             g.field_generation || ':' || g.value_key, g.value_label,
             g.field_generation, null::timestamptz, g.capture_id::text
      from plm.sesame_style_guide g
      join sesame_latest c on c.id = g.capture_id

      union all
      select 'wwe-creative', 'WWE - Creative', 'Creative',
             'wwe_creative', 'plm.wwe_style_guide', g.guideline_source_id,
             g.guideline_label, null, null::timestamptz, g.capture_id::text
      from plm.wwe_style_guide g
      join wwe_creative_latest c on c.id = g.capture_id
    ), keyed as (
      select
        jsonb_build_array(
          'style_guide', s.licensor_key, s.source_system, s.source_table, s.source_id
        )::text as row_key,
        s.*,
        case
          when s.licensor_key in ('disney', 'disney-opa') then 'disney'
          when s.licensor_key in ('marvel', 'marvel-opa', 'marvel-asgard-creative') then 'marvel'
          when s.licensor_key in ('pixar', 'pixar-opa') then 'pixar'
          when s.licensor_key in ('lucasfilm-star-wars', 'lucasfilm-star-wars-opa') then 'lucasfilm-star-wars'
          when s.licensor_key = '20th-century' then '20th-century'
          when s.licensor_key = 'warner-bros' then 'warner-bros'
          when s.licensor_key = 'nbcuniversal' then 'nbcuniversal'
          when s.licensor_key in ('paramount', 'paramount-submissions') then 'paramount'
          when s.licensor_key = 'strawberry-shortcake-creative' then 'strawberry-shortcake'
          when s.licensor_key in ('sega-creative', 'sega-submissions') then 'sega'
          when s.licensor_key = 'coca-cola-creative' then 'coca-cola'
          when s.licensor_key = 'peanuts-creative' then 'peanuts'
          when s.licensor_key = 'sesame-creative' then 'sesame-workshop'
          when s.licensor_key in ('wwe-creative', 'wwe-submissions') then 'wwe'
          else 'unresolved'
        end::text as licensor_group_key,
        case
          when s.licensor_key in ('disney', 'disney-opa') then 'Disney'
          when s.licensor_key in ('marvel', 'marvel-opa', 'marvel-asgard-creative') then 'Marvel'
          when s.licensor_key in ('pixar', 'pixar-opa') then 'Pixar'
          when s.licensor_key in ('lucasfilm-star-wars', 'lucasfilm-star-wars-opa') then 'Lucasfilm / Star Wars'
          when s.licensor_key = '20th-century' then '20th Century'
          when s.licensor_key = 'warner-bros' then 'Warner Bros.'
          when s.licensor_key = 'nbcuniversal' then 'NBCUniversal'
          when s.licensor_key in ('paramount', 'paramount-submissions') then 'Paramount'
          when s.licensor_key = 'strawberry-shortcake-creative' then 'Strawberry Shortcake'
          when s.licensor_key in ('sega-creative', 'sega-submissions') then 'Sega'
          when s.licensor_key = 'coca-cola-creative' then 'Coca-Cola'
          when s.licensor_key = 'peanuts-creative' then 'Peanuts'
          when s.licensor_key = 'sesame-creative' then 'Sesame Workshop'
          when s.licensor_key in ('wwe-creative', 'wwe-submissions') then 'WWE'
          else 'Licensor not yet determined'
        end::text as licensor_group_name,
        coalesce(
          nullif(btrim(s.source_label), ''),
          nullif(btrim(regexp_replace(
            regexp_replace(s.source_id, '^.*/', ''), '[-_]+', ' ', 'g'
          )), '')
        ) as display_label
      from source_rows s
    ), filtered as (
      select k.*
      from keyed k
      where (
        p_search is null
        or k.licensor_name ilike '%' || p_search || '%'
        or k.source_system ilike '%' || p_search || '%'
        or k.source_id ilike '%' || p_search || '%'
        or k.display_label ilike '%' || p_search || '%'
      )
        and (p_cursor is null or k.row_key collate "C" > v_cursor_key collate "C")
    ), ordered as materialized (
      select f.*
      from filtered f
      order by f.row_key collate "C"
      limit v_page_size + 1
    ), numbered as (
      select o.*, row_number() over (order by o.row_key collate "C") as rn
      from ordered o
    )
    select
      coalesce(jsonb_agg(
        jsonb_build_object(
          'row_key', n.row_key,
          'entity_kind', 'style_guide',
          'licensor_key', n.licensor_key,
          'licensor_name', n.licensor_name,
          'licensor_group_key', n.licensor_group_key,
          'licensor_group_name', n.licensor_group_name,
          'source_purpose', n.source_purpose,
          'display_label', n.display_label,
          'source_system', n.source_system,
          'source_table', n.source_table,
          'source_id', n.source_id,
          'source_status', n.source_status,
          'latest_seen_at', n.latest_seen_at,
          'capture_marker', n.capture_marker,
          'mapping_state', null
        ) order by n.rn
      ) filter (where n.rn <= v_page_size), '[]'::jsonb),
      count(*)::integer,
      max(n.row_key) filter (where n.rn = v_page_size)
    into v_rows, v_fetched, v_last_key
    from numbered n;
  end if;

  if v_fetched > v_page_size and v_last_key is not null then
    v_next_cursor := encode(convert_to(v_last_key, 'UTF8'), 'base64');
  end if;

  return jsonb_build_object(
    'rows', coalesce(v_rows, '[]'::jsonb),
    'next_cursor', v_next_cursor,
    'page_size', v_page_size,
    'entity_kind', v_entity_kind
  );
end;
$function$;

comment on function api.db_data_admin_scraped_source_inventory(text,text,text,integer) is
  'Licensing-manager-gated read-only inventory of the raw scraped source vocabularies for Properties, Characters and Style Guides. One entity kind per call (property, character, style_guide), with search text, a deterministic base64 keyset cursor and a page size clamped to 1..1000. Every row carries source-declared identity only: licensor key and name decided by the actual scrape route and source authority, one canonical licensor_group_key and licensor_group_name (a single unresolved group, "Licensor not yet determined", holds rows whose licensor is in conflict or unresolved), a source purpose normalized to exactly Creative or Submissions (NBCU Product Submissions picker rows and Warner STARLABS Product catalogue rows are Submissions), the display label, source system/table/id/status, a capture marker, and for Creative Property rows the existing mapped/unmapped indicator plus a submissions array naming the Submissions members of the winning mapped decision, and for Submissions Property rows a mapped_creative array naming the Creative rows mapped to it. Disney, Marvel, Pixar and Lucasfilm / Star Wars stay separate licensors; retained copies across scrape routes are never deduplicated and identity is never inferred from names. Matching controls, review reasons, evidence basis, review guidance, contract status and authority-derived presentation buckets are deliberately absent, as are the Sega and WWE inferred character and style-guide candidate tables, which their own comments and constraints declare are not source-declared facts. api.db_data_admin_scraped_properties is unchanged and remains the Property Matching contract.';

revoke all on function api.db_data_admin_scraped_source_inventory(text,text,text,integer) from public, anon, service_role;
grant execute on function api.db_data_admin_scraped_source_inventory(text,text,text,integer) to authenticated;
