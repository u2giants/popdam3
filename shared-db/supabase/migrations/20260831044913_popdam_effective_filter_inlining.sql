-- #1945: restore bounded authenticated effective-filter execution.
--
-- PostgreSQL cannot inline a SQL-language function that has a per-function SET
-- clause.  The original effective-filter migration attached
-- `SET search_path = public`, so PostgREST's outer LIMIT could not reach the
-- assets scan and every call materialized the full result first.  The body
-- already schema-qualifies every relation and helper function it references;
-- removing only that configuration restores inlining without changing filter,
-- identity, tag, thumbnail, RLS, or privilege semantics.
-- derived-from: 20260830110517

create or replace function public.filter_effective_assets(p_filters jsonb default '{}'::jsonb)
returns setof public.assets
language sql
stable
security invoker
as $$
  select a.*
  from public.assets a
  left join public.style_groups sg on sg.id = a.style_group_id
  where a.is_deleted = false
    and (
      a.modified_at >= public.assets_thumbnail_min_date()
      or a.file_created_at >= public.assets_thumbnail_min_date()
      or a.thumbnail_url is not null
    )
    and (
      not (p_filters ? 'search')
      or nullif(p_filters ->> 'search', '') is null
      or a.filename ilike '%' || (p_filters ->> 'search') || '%'
    )
    and (
      not (p_filters ? 'licensorId')
      or nullif(p_filters ->> 'licensorId', '') is null
      or case when a.style_group_id is null then a.licensor_id else sg.licensor_id end
           = (p_filters ->> 'licensorId')::uuid
    )
    and (
      not (p_filters ? 'propertyId')
      or nullif(p_filters ->> 'propertyId', '') is null
      or case when a.style_group_id is null then a.property_id else sg.property_id end
           = (p_filters ->> 'propertyId')::uuid
    )
    and (
      not (p_filters ? 'tagFilter')
      or nullif(p_filters ->> 'tagFilter', '') is null
      or exists (
        select 1
        from public.asset_effective_tags e
        where e.asset_id = a.id
          and e.tag = p_filters ->> 'tagFilter'
      )
    )
    and (
      not (p_filters ? 'fileType')
      or jsonb_array_length(p_filters -> 'fileType') = 0
      or a.file_type::text in (select jsonb_array_elements_text(p_filters -> 'fileType'))
    )
    and (
      not (p_filters ? 'status')
      or jsonb_array_length(p_filters -> 'status') = 0
      or a.status::text in (select jsonb_array_elements_text(p_filters -> 'status'))
    )
    and (
      not (p_filters ? 'workflowStatus')
      or jsonb_array_length(p_filters -> 'workflowStatus') = 0
      or a.workflow_status::text in (select jsonb_array_elements_text(p_filters -> 'workflowStatus'))
    )
    and (
      not (p_filters ? 'stage')
      or jsonb_array_length(p_filters -> 'stage') = 0
      or a.stage in (select jsonb_array_elements_text(p_filters -> 'stage'))
    )
    and (
      not (p_filters ? 'isLicensed')
      or (p_filters ->> 'isLicensed') is null
      or a.is_licensed = (p_filters ->> 'isLicensed')::boolean
    )
    and (
      not (p_filters ? 'assetType')
      or jsonb_array_length(p_filters -> 'assetType') = 0
      or a.asset_type::text in (select jsonb_array_elements_text(p_filters -> 'assetType'))
    )
    and (
      not (p_filters ? 'artSource')
      or jsonb_array_length(p_filters -> 'artSource') = 0
      or a.art_source::text in (select jsonb_array_elements_text(p_filters -> 'artSource'))
    )
    and (nullif(p_filters ->> 'customer', '') is null or a.customer = p_filters ->> 'customer')
    and (nullif(p_filters ->> 'program', '') is null or a.program = p_filters ->> 'program');
$$;

comment on function public.filter_effective_assets(jsonb) is
  'Effective PopDAM asset list with group-winning identity and active effective tags; fully schema-qualified and intentionally free of per-function SET options so caller LIMIT and predicates can be inlined.';

do $$
declare
  v_config text[];
  v_language text;
  v_volatility "char";
  v_security_definer boolean;
  v_source text;
begin
  select p.proconfig, l.lanname, p.provolatile, p.prosecdef, p.prosrc
    into v_config, v_language, v_volatility, v_security_definer, v_source
  from pg_proc p
  join pg_language l on l.oid = p.prolang
  where p.oid = 'public.filter_effective_assets(jsonb)'::regprocedure;

  if v_config is not null then
    raise exception 'filter_effective_assets still has a per-function SET option and cannot inline: %', v_config;
  end if;
  if v_language <> 'sql' or v_volatility <> 's' or v_security_definer then
    raise exception 'filter_effective_assets execution contract changed: language %, volatility %, security definer %',
      v_language, v_volatility, v_security_definer;
  end if;
  if v_source !~ 'from[[:space:]]+public\.assets'
     or v_source !~ 'join[[:space:]]+public\.style_groups'
     or v_source !~ 'from[[:space:]]+public\.asset_effective_tags'
     or v_source !~ 'public\.assets_thumbnail_min_date\(\)' then
    raise exception 'filter_effective_assets is not fully schema-qualified after removing its search_path option';
  end if;
end;
$$;
