-- Issue #1936 forward 5: resolve only the submission labels requested by the
-- bounded page. Forward 4 removed per-row union evaluation but still invoked
-- the complete source union a second time whenever a page carried mappings.
-- derived-from: 20260830235651

do $migration$
declare
  v_definition text;
  v_lookup_old constant text := $old$  ), page_submission_source as materialized (
    select i.submission_source_system,i.submission_source_table,
      i.submission_source_id,s.source_property_name
    from page_submission_identity i
    left join source_rows s
      on s.source_system=i.submission_source_system
     and s.source_table=i.submission_source_table
     and s.source_property_id=i.submission_source_id
  ), enriched as materialized ($old$;
  v_lookup_new constant text := $new$  ), page_submission_source_candidates as materialized (
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
  ), enriched as materialized ($new$;
begin
  select pg_get_functiondef(
    'api.db_data_admin_scraped_properties(text,text,integer)'::regprocedure
  ) into v_definition;

  if position(v_lookup_old in v_definition)=0
     or position('page_creative_decision as materialized' in v_definition)=0
     or position('page_submission_identity as materialized' in v_definition)=0
     or position('source_rows as not materialized' in v_definition)=0
     or position('l.row_key collate "C" > v_cursor_key collate "C"' in v_definition)=0
     or position('app.require_licensing_manager_access()' in v_definition)=0 then
    raise exception using errcode='55000',
      message='#1936 forward-5 predecessor differs from applied forward-4';
  end if;

  v_definition:=replace(v_definition,v_lookup_old,v_lookup_new);

  if position('page_submission_source_candidates as materialized' in v_definition)=0
     or position(v_lookup_old in v_definition)<>0
     or position('left join source_rows s' in v_definition)<>0
     or position('l.row_key collate "C" > v_cursor_key collate "C"' in v_definition)=0 then
    raise exception using errcode='55000',
      message='#1936 forward-5 targeted submission lookup postconditions failed';
  end if;

  execute v_definition;
end
$migration$;
