-- #2138: restore LIMIT-bounded row fetching in the effective asset filter.
-- The identity arms returned ids only, so every row needed a self-join back to
-- public.assets. Under the generic plan PostgREST gets for a bound p_filters the
-- planner cannot tell which arm supplies ids, drops the primary-key path and
-- rescans the whole identity set once per output row, so cost grows with the
-- page size until the authenticated 8s statement_timeout fires. Selecting whole
-- rows in each arm makes the union a plain append relation the LIMIT can stop
-- early, and entitlement moves back to the Var-free outer conjunct #1703 used,
-- which is evaluated once as a one-time filter and keeps the function inlinable.
-- derived-from: 20260901142825

create or replace function public.filter_effective_assets(p_filters jsonb default '{}'::jsonb)
returns setof public.assets
language sql stable security invoker
as $$
  select a.*
  from (
    -- No identity filter: preserve the simple active-assets path.
    select a.*
    from public.assets a
    where nullif(p_filters ->> 'licensorId', '') is null
      and nullif(p_filters ->> 'propertyId', '') is null
      and nullif(p_filters ->> 'customerId', '') is null
    union all
    -- Licensor is the leading key when supplied; property/customer still narrow.
    select a.*
    from public.assets a
    where nullif(p_filters ->> 'licensorId', '') is not null
      and a.style_group_id is null
      and a.licensor_id = (p_filters ->> 'licensorId')::uuid
      and (nullif(p_filters ->> 'propertyId', '') is null or a.property_id = (p_filters ->> 'propertyId')::uuid)
      and (nullif(p_filters ->> 'customerId', '') is null or a.customer_id = (p_filters ->> 'customerId')::uuid)
    union all
    select a.*
    from public.style_groups sg
    join public.assets a on a.style_group_id = sg.id
    where nullif(p_filters ->> 'licensorId', '') is not null
      and sg.licensor_id = (p_filters ->> 'licensorId')::uuid
      and (nullif(p_filters ->> 'propertyId', '') is null or sg.property_id = (p_filters ->> 'propertyId')::uuid)
      and (nullif(p_filters ->> 'customerId', '') is null or sg.customer_id = (p_filters ->> 'customerId')::uuid)
    union all
    -- Property leads only when licensor is absent.
    select a.*
    from public.assets a
    where nullif(p_filters ->> 'licensorId', '') is null
      and nullif(p_filters ->> 'propertyId', '') is not null
      and a.style_group_id is null
      and a.property_id = (p_filters ->> 'propertyId')::uuid
      and (nullif(p_filters ->> 'customerId', '') is null or a.customer_id = (p_filters ->> 'customerId')::uuid)
    union all
    select a.*
    from public.style_groups sg
    join public.assets a on a.style_group_id = sg.id
    where nullif(p_filters ->> 'licensorId', '') is null
      and nullif(p_filters ->> 'propertyId', '') is not null
      and sg.property_id = (p_filters ->> 'propertyId')::uuid
      and (nullif(p_filters ->> 'customerId', '') is null or sg.customer_id = (p_filters ->> 'customerId')::uuid)
    union all
    -- Customer leads only when neither taxonomy key is supplied.
    select a.*
    from public.assets a
    where nullif(p_filters ->> 'licensorId', '') is null
      and nullif(p_filters ->> 'propertyId', '') is null
      and nullif(p_filters ->> 'customerId', '') is not null
      and a.style_group_id is null
      and a.customer_id = (p_filters ->> 'customerId')::uuid
    union all
    select a.*
    from public.style_groups sg
    join public.assets a on a.style_group_id = sg.id
    where nullif(p_filters ->> 'licensorId', '') is null
      and nullif(p_filters ->> 'propertyId', '') is null
      and nullif(p_filters ->> 'customerId', '') is not null
      and sg.customer_id = (p_filters ->> 'customerId')::uuid
  ) a
  where public.require_dam_access()
    and a.is_deleted = false
    and (a.modified_at >= public.assets_thumbnail_min_date()
      or a.file_created_at >= public.assets_thumbnail_min_date() or a.thumbnail_url is not null)
    and (nullif(p_filters ->> 'search','') is null or a.filename ilike '%' || (p_filters ->> 'search') || '%')
    and (nullif(p_filters ->> 'tagFilter','') is null or exists (
      select 1 from public.asset_effective_tags e where e.asset_id = a.id and e.tag = p_filters ->> 'tagFilter'))
    and (jsonb_array_length(coalesce(p_filters -> 'fileType','[]')) = 0 or a.file_type::text in (select jsonb_array_elements_text(p_filters -> 'fileType')))
    and (jsonb_array_length(coalesce(p_filters -> 'contentType','[]')) = 0 or a.content_type in (select jsonb_array_elements_text(p_filters -> 'contentType')))
    and (jsonb_array_length(coalesce(p_filters -> 'productMaterial','[]')) = 0 or a.product_material && array(select jsonb_array_elements_text(p_filters -> 'productMaterial')))
    and (jsonb_array_length(coalesce(p_filters -> 'status','[]')) = 0 or a.status::text in (select jsonb_array_elements_text(p_filters -> 'status')))
    and (jsonb_array_length(coalesce(p_filters -> 'workflowStatus','[]')) = 0 or a.workflow_status::text in (select jsonb_array_elements_text(p_filters -> 'workflowStatus')))
    and (jsonb_array_length(coalesce(p_filters -> 'stage','[]')) = 0 or a.stage in (select jsonb_array_elements_text(p_filters -> 'stage')))
    and ((p_filters ->> 'isLicensed') is null or a.is_licensed = (p_filters ->> 'isLicensed')::boolean)
    and (jsonb_array_length(coalesce(p_filters -> 'assetType','[]')) = 0 or a.asset_type::text in (select jsonb_array_elements_text(p_filters -> 'assetType')))
    and (jsonb_array_length(coalesce(p_filters -> 'artSource','[]')) = 0 or a.art_source::text in (select jsonb_array_elements_text(p_filters -> 'artSource')))
    and (jsonb_array_length(coalesce(p_filters -> 'fileStatus','[]')) = 0 or exists (
      select 1 from jsonb_array_elements_text(p_filters -> 'fileStatus') fs where
        (fs = 'has_preview' and a.thumbnail_url is not null) or
        (fs = 'no_preview_renderable' and a.thumbnail_url is null and a.thumbnail_error is null) or
        (fs = 'no_pdf_compat' and a.thumbnail_url is null and a.thumbnail_error = 'no_pdf_compat') or
        (fs = 'no_preview_unsupported' and a.thumbnail_url is null and a.thumbnail_error = 'no_preview_or_render_failed')))
    and (jsonb_array_length(coalesce(p_filters -> 'productCategory','[]')) = 0 or
      a.product_category in (select jsonb_array_elements_text(p_filters -> 'productCategory')) or
      ('Wall' in (select jsonb_array_elements_text(p_filters -> 'productCategory')) and
        (a.relative_path ilike '%WALL ART%' or a.relative_path ilike '%3FZ%')))
    and (nullif(p_filters ->> 'customer','') is null or a.customer = p_filters ->> 'customer')
    and (nullif(p_filters ->> 'program','') is null or a.program = p_filters ->> 'program');
$$;

revoke all on function public.filter_effective_assets(jsonb) from public, anon;
grant execute on function public.filter_effective_assets(jsonb) to authenticated, service_role;

do $$
declare
  v_def text := pg_get_functiondef('public.filter_effective_assets(jsonb)'::regprocedure);
  -- Line comments are stripped and whitespace folded before anything is
  -- inspected. A predicate that survives only inside a comment is not a
  -- predicate, and folding lets every pin below be a contiguous piece of
  -- syntax in its real position rather than a substring found anywhere.
  v_body text := regexp_replace(regexp_replace(v_def, E'--[^\n]*', '', 'g'), '\s+', ' ', 'g');
  v_lower text := lower(v_body);
  v_pin text;
  v_arms int;
  v_gate int;
  v_secdef boolean;
  v_config text[];
  v_language name;
  v_volatility "char";
begin
  select p.prosecdef, p.proconfig, l.lanname, p.provolatile
    into v_secdef, v_config, v_language, v_volatility
  from pg_proc p
  join pg_language l on l.oid = p.prolang
  where p.oid = 'public.filter_effective_assets(jsonb)'::regprocedure;

  -- The CTE barrier and the id self-join are the regression; both must be gone.
  -- The self-join is matched by shape, not by the alias pair it happened to
  -- use: `join public.assets a on a.id = ids.id` is the same generic-plan
  -- nested loop under a different name.
  if position('identity_asset_ids' in v_lower) > 0
     or position('as materialized' in v_lower) > 0
     or v_lower ~ '\m[a-z_][a-z0-9_]*\.id = [a-z_][a-z0-9_]*\.id\M' then
    raise exception 'effective filter still materialises identity ids before the join';
  end if;

  -- Entitlement stays enforced as the Var-free outer conjunct, exactly once.
  -- Presence of the text proves nothing: public.require_dam_access() raises
  -- insufficient_privilege only when it is invoked, and an authenticated caller
  -- without DAM access holds EXECUTE on this function. Pin the call in the
  -- outer WHERE, immediately followed by the visibility guard.
  v_gate := (length(v_lower) - length(replace(v_lower, 'public.require_dam_access()', '')))
              / length('public.require_dam_access()');
  if v_gate <> 1 then
    raise exception 'effective filter must invoke public.require_dam_access() exactly once, found %', v_gate;
  end if;
  if position(') a where public.require_dam_access() and a.is_deleted = false and (' in v_lower) = 0 then
    raise exception 'effective filter lost its entitlement or visibility predicate as an outer WHERE conjunct';
  end if;

  -- The seven mutually exclusive identity arms must survive intact. Counting the
  -- six UNION ALLs and pinning each arm's leading guard is what makes this a
  -- check: the bare equality tokens also occur as optional conjuncts on the
  -- licensor pair, so deleting the property- or customer-leading arms would
  -- otherwise leave every substring present while the DAM property and customer
  -- libraries silently returned nothing.
  v_arms := (length(v_lower) - length(replace(v_lower, 'union all', ''))) / length('union all');
  if v_arms <> 6 then
    raise exception 'effective filter must keep seven identity arms joined by six UNION ALLs, found % UNION ALLs', v_arms;
  end if;
  if position('left join public.style_groups' in v_lower) > 0 then
    raise exception 'effective identity predicates restored the unindexable LEFT JOIN shape';
  end if;
  foreach v_pin in array array[
    'from public.assets a where nullif(p_filters ->> ''licensorid'', '''') is null and nullif(p_filters ->> ''propertyid'', '''') is null and nullif(p_filters ->> ''customerid'', '''') is null union all',
    'where nullif(p_filters ->> ''licensorid'', '''') is not null and a.style_group_id is null and a.licensor_id = (p_filters ->> ''licensorid'')::uuid',
    'from public.style_groups sg join public.assets a on a.style_group_id = sg.id where nullif(p_filters ->> ''licensorid'', '''') is not null and sg.licensor_id = (p_filters ->> ''licensorid'')::uuid',
    'and nullif(p_filters ->> ''propertyid'', '''') is not null and a.style_group_id is null and a.property_id = (p_filters ->> ''propertyid'')::uuid',
    'and nullif(p_filters ->> ''propertyid'', '''') is not null and sg.property_id = (p_filters ->> ''propertyid'')::uuid',
    'and nullif(p_filters ->> ''customerid'', '''') is not null and a.style_group_id is null and a.customer_id = (p_filters ->> ''customerid'')::uuid',
    'and nullif(p_filters ->> ''customerid'', '''') is not null and sg.customer_id = (p_filters ->> ''customerid'')::uuid'
  ] loop
    if position(v_pin in v_lower) = 0 then
      raise exception 'effective identity predicates lost an index-leading UNION arm: %', v_pin;
    end if;
  end loop;

  -- Every filter key the DAM sends must still be honoured, including the three
  -- identity keys: renaming one to a key the client never sends would silently
  -- ignore that facet. These are compared case-sensitively and quoted.
  foreach v_pin in array array[
    '''licensorId''', '''propertyId''', '''customerId''',
    '''search''', '''tagFilter''', '''fileType''', '''contentType''',
    '''productMaterial''', '''workflowStatus''', '''isLicensed''',
    '''assetType''', '''artSource''', '''fileStatus''', '''productCategory''',
    '''program''', '''customer''', '''stage''', '''status'''
  ] loop
    if position(v_pin in v_body) = 0 then
      raise exception 'effective filter lost one of its filter keys: %', v_pin;
    end if;
  end loop;

  -- #1945: only a STABLE SQL function with no SECURITY DEFINER flag and no
  -- per-function SET can be inlined, and inlining is what lets PostgREST's
  -- outer LIMIT reach the append scan. A PL/pgSQL set-returning rewrite of the
  -- same SELECT is never inlined and reproduces the #1945 timeout exactly.
  if v_language <> 'sql' or v_volatility <> 's' or v_secdef or v_config is not null then
    raise exception 'effective filter is no longer inlinable: language %, volatility %, security definer %, config %',
      v_language, v_volatility, v_secdef, v_config;
  end if;

  if has_function_privilege('anon','public.filter_effective_assets(jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.filter_effective_assets(jsonb)','EXECUTE')
     or not has_function_privilege('service_role','public.filter_effective_assets(jsonb)','EXECUTE') then
    raise exception 'effective filter privileges changed';
  end if;
end;
$$;
