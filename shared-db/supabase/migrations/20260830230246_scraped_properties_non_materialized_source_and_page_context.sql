-- #1936 forward repair 3: keep the complete source union inlineable and batch
-- DCP page context. This preserves the exact public response while avoiding a
-- forced whole-union spool and three correlated graph walks per returned row.
-- derived-from: 20260830220646

do $migration$
declare
  v_definition text;
  v_source_old constant text := $old$  ), source_rows as ($old$;
  v_source_new constant text := $new$  ), source_rows as not materialized ($new$;
  v_numbered_old constant text := $old$  ), numbered as (
    select e.*, row_number() over (order by e.row_key collate "C") as rn
    from enriched e
  )$old$;
  v_numbered_new constant text := $new$  ), page_dcp_context_rows as materialized (
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
  ), numbered as (
    select e.*,
      c.asset_count as context_asset_count,
      c.style_guide_count as context_style_guide_count,
      c.style_guide_names as context_style_guide_names,
      row_number() over (order by e.row_key collate "C") as rn
    from enriched e
    left join page_dcp_context c on c.row_key=e.row_key
  )$new$;
  v_asset_old constant text := $old$        'asset_count', case
          when n.source_table = 'plm.dcp_property' then
            (select count(distinct o.dcp_asset_id) from plm.dcp_property p2
             join plm.dcp_asset_property_observation o on o.dcp_property_id = p2.id
             where p2.source_system = n.source_system and p2.source_id = n.source_property_id)
          when n.source_table = 'plm.lucasfilm_dcp_property' then
            (select count(distinct o.lucasfilm_dcp_asset_id) from plm.lucasfilm_dcp_property p2
             join plm.lucasfilm_dcp_asset_property_observation o on o.lucasfilm_dcp_property_id = p2.id
             where p2.source_system = n.source_system and p2.source_id = n.source_property_id)
          else null end,$old$;
  v_asset_new constant text := $new$        'asset_count', case
          when n.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property')
            then coalesce(n.context_asset_count,0)
          else null end,$new$;
  v_guide_count_old constant text := $old$        'style_guide_count', case
          when n.source_table = 'plm.dcp_property' then
            (select count(distinct a.style_guide_id) from plm.dcp_property p2
             join plm.dcp_asset_property_observation o on o.dcp_property_id = p2.id
             join plm.dcp_asset a on a.id = o.dcp_asset_id
             where p2.source_system = n.source_system and p2.source_id = n.source_property_id)
          when n.source_table = 'plm.lucasfilm_dcp_property' then
            (select count(distinct a.style_guide_id) from plm.lucasfilm_dcp_property p2
             join plm.lucasfilm_dcp_asset_property_observation o on o.lucasfilm_dcp_property_id = p2.id
             join plm.lucasfilm_dcp_asset a on a.id = o.lucasfilm_dcp_asset_id
             where p2.source_system = n.source_system and p2.source_id = n.source_property_id)
          else null end,$old$;
  v_guide_count_new constant text := $new$        'style_guide_count', case
          when n.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property')
            then coalesce(n.context_style_guide_count,0)
          else null end,$new$;
  v_guide_names_old constant text := $old$        'style_guide_names', case
          when n.source_table = 'plm.dcp_property' then
            (select coalesce(jsonb_agg(x.folder_name order by x.folder_name), '[]'::jsonb)
             from (select distinct g.folder_name from plm.dcp_property p2
               join plm.dcp_asset_property_observation o on o.dcp_property_id = p2.id
               join plm.dcp_asset a on a.id = o.dcp_asset_id
               join plm.dcp_style_guide g on g.id = a.style_guide_id
               where p2.source_system = n.source_system and p2.source_id = n.source_property_id) x)
          when n.source_table = 'plm.lucasfilm_dcp_property' then
            (select coalesce(jsonb_agg(x.folder_name order by x.folder_name), '[]'::jsonb)
             from (select distinct g.folder_name from plm.lucasfilm_dcp_property p2
               join plm.lucasfilm_dcp_asset_property_observation o on o.lucasfilm_dcp_property_id = p2.id
               join plm.lucasfilm_dcp_asset a on a.id = o.lucasfilm_dcp_asset_id
               join plm.lucasfilm_dcp_style_guide g on g.id = a.style_guide_id
               where p2.source_system = n.source_system and p2.source_id = n.source_property_id) x)
          else '[]'::jsonb end$old$;
  v_guide_names_new constant text := $new$        'style_guide_names', case
          when n.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property')
            then coalesce(n.context_style_guide_names,'[]'::jsonb)
          else '[]'::jsonb end$new$;
begin
  select pg_get_functiondef(
    'api.db_data_admin_scraped_properties(text,text,integer)'::regprocedure
  ) into v_definition;

  if position(v_source_old in v_definition)=0
     or position(v_numbered_old in v_definition)=0
     or position(v_asset_old in v_definition)=0
     or position(v_guide_count_old in v_definition)=0
     or position(v_guide_names_old in v_definition)=0
     or position('opa_scope_latest as materialized' in v_definition)=0
     or position('dcp_current_resolution as materialized' in v_definition)=0
     or position('ordered as materialized' in v_definition)=0
     or position('enriched as materialized' in v_definition)=0 then
    raise exception using errcode='55000',
      message='#1936 forward-3 predecessor differs from applied forward-2';
  end if;

  v_definition := replace(v_definition,v_source_old,v_source_new);
  v_definition := replace(v_definition,v_numbered_old,v_numbered_new);
  v_definition := replace(v_definition,v_asset_old,v_asset_new);
  v_definition := replace(v_definition,v_guide_count_old,v_guide_count_new);
  v_definition := replace(v_definition,v_guide_names_old,v_guide_names_new);
  execute v_definition;
end;
$migration$;

comment on function api.db_data_admin_scraped_properties(text,text,integer) is
  'Licensing-manager-only paginated cross-licensor scraped Property evidence. The complete source union remains inlineable; set-based authority and page-bounded mapping, contract, asset, and style-guide context preserve the public contract under the authenticated gateway budget.';
