-- Issue #1936 forward 6: keep retained DCP asset/style context inside the
-- authenticated gateway budget even when observation history is much larger
-- than the current Property result set.
-- derived-from: 20260831002935

create index idx_dcp_asset_property_obs_property_asset
  on plm.dcp_asset_property_observation (dcp_property_id, dcp_asset_id);

create index idx_lucasfilm_dcp_asset_property_obs_property_asset
  on plm.lucasfilm_dcp_asset_property_observation
    (lucasfilm_dcp_property_id, lucasfilm_dcp_asset_id);

do $migration$
declare
  v_definition text;
  v_context_old constant text := $old$  ), page_dcp_context_rows as materialized (
    select e.row_key,
      o.dcp_asset_id::text as asset_id,
      a.style_guide_id::text as style_guide_id,
      g.folder_name::text as folder_name
    from enriched e
    join plm.dcp_property p
      on p.source_system=e.source_system and p.source_id=e.source_property_id
    left join plm.dcp_asset_property_observation o on o.dcp_property_id=p.id
    left join plm.dcp_asset a on a.id=o.dcp_asset_id
    left join plm.dcp_style_guide g on g.id=a.style_guide_id
    where e.source_table='plm.dcp_property'
    union all
    select e.row_key,
      o.lucasfilm_dcp_asset_id::text as asset_id,
      a.style_guide_id::text as style_guide_id,
      g.folder_name::text as folder_name
    from enriched e
    join plm.lucasfilm_dcp_property p
      on p.source_system=e.source_system and p.source_id=e.source_property_id
    left join plm.lucasfilm_dcp_asset_property_observation o
      on o.lucasfilm_dcp_property_id=p.id
    left join plm.lucasfilm_dcp_asset a on a.id=o.lucasfilm_dcp_asset_id
    left join plm.lucasfilm_dcp_style_guide g on g.id=a.style_guide_id
    where e.source_table='plm.lucasfilm_dcp_property'
  ), page_dcp_context as materialized (
    select row_key,
      count(distinct asset_id) as asset_count,
      count(distinct style_guide_id) as style_guide_count,
      coalesce(
        jsonb_agg(distinct folder_name order by folder_name)
          filter (where folder_name is not null),
        '[]'::jsonb
      ) as style_guide_names
    from page_dcp_context_rows
    group by row_key
$old$;
  v_context_new constant text := $new$  ), page_dcp_context_rows as materialized (
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
      message='#1936 forward-6 predecessor differs from applied forward-5';
  end if;

  v_definition:=replace(v_definition,v_context_old,v_context_new);

  if position('page_dcp_context_rows as materialized' in v_definition)=0
     or position('select distinct o.dcp_asset_id' in v_definition)=0
     or position('select distinct o.lucasfilm_dcp_asset_id' in v_definition)=0
     or position('page_submission_source_candidates as materialized' in v_definition)=0
     or position('l.row_key collate "C" > v_cursor_key collate "C"' in v_definition)=0 then
    raise exception using errcode='55000',
      message='#1936 forward-6 bounded DCP context postconditions failed';
  end if;

  execute v_definition;
end
$migration$;
