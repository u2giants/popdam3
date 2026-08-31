-- Issue #1936 forward 7: aggregate retained DCP asset/style context once per
-- bounded page. Forward 6 made observation deduplication index-only, but real
-- production fanout still performed hundreds of thousands of asset PK probes.
-- derived-from: 20260831012326

do $migration$
declare
  v_definition text;
  v_context_old constant text := $old$  ), page_dcp_context_rows as materialized (
    select e.row_key,c.asset_count,c.style_guide_count,c.style_guide_names
    from enriched e
    join plm.dcp_property p
      on p.source_system=e.source_system and p.source_id=e.source_property_id
    cross join lateral (
      select count(*) as asset_count,
        count(distinct a.style_guide_id) as style_guide_count,
        coalesce(jsonb_agg(distinct g.folder_name order by g.folder_name)
          filter (where g.folder_name is not null),'[]'::jsonb) as style_guide_names
      from (
        select distinct o.dcp_asset_id
        from plm.dcp_asset_property_observation o
        where o.dcp_property_id=p.id
      ) retained
      left join plm.dcp_asset a on a.id=retained.dcp_asset_id
      left join plm.dcp_style_guide g on g.id=a.style_guide_id
    ) c
    where e.source_table='plm.dcp_property'
    union all
    select e.row_key,c.asset_count,c.style_guide_count,c.style_guide_names
    from enriched e
    join plm.lucasfilm_dcp_property p
      on p.source_system=e.source_system and p.source_id=e.source_property_id
    cross join lateral (
      select count(*) as asset_count,
        count(distinct a.style_guide_id) as style_guide_count,
        coalesce(jsonb_agg(distinct g.folder_name order by g.folder_name)
          filter (where g.folder_name is not null),'[]'::jsonb) as style_guide_names
      from (
        select distinct o.lucasfilm_dcp_asset_id
        from plm.lucasfilm_dcp_asset_property_observation o
        where o.lucasfilm_dcp_property_id=p.id
      ) retained
      left join plm.lucasfilm_dcp_asset a
        on a.id=retained.lucasfilm_dcp_asset_id
      left join plm.lucasfilm_dcp_style_guide g on g.id=a.style_guide_id
    ) c
    where e.source_table='plm.lucasfilm_dcp_property'
  ), page_dcp_context as materialized (
    select * from page_dcp_context_rows
$old$;
  v_context_new constant text := $new$  ), page_dcp_properties as materialized (
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
$new$;
begin
  select pg_get_functiondef(
    'api.db_data_admin_scraped_properties(text,text,integer)'::regprocedure
  ) into v_definition;

  if position(v_context_old in v_definition)=0
     or position('page_submission_source_candidates as materialized' in v_definition)=0
     or position('l.row_key collate "C" > v_cursor_key collate "C"' in v_definition)=0
     or position('app.require_licensing_manager_access()' in v_definition)=0 then
    raise exception using errcode='55000',
      message='#1936 forward-7 predecessor differs from applied forward-6';
  end if;

  v_definition:=replace(v_definition,v_context_old,v_context_new);

  if position('page_dcp_properties as materialized' in v_definition)=0
     or position('page_dcp_retained_assets as materialized' in v_definition)=0
     or position('dcp_asset_context as materialized' in v_definition)=0
     or position('page_submission_source_candidates as materialized' in v_definition)=0
     or position('l.row_key collate "C" > v_cursor_key collate "C"' in v_definition)=0 then
    raise exception using errcode='55000',
      message='#1936 forward-7 set-based retained context postconditions failed';
  end if;

  execute v_definition;
end
$migration$;
