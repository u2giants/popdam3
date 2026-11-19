-- popdam3#1037: a named style-group picture anchor reads only group scope.
-- derived-from: 20261204003633
-- Do not materialize unused individual-file scopes on that branch.
-- Body guards pin the deployed #6643 scope and anchor. Ranked-search calls
-- keep the original one-argument full scope; grants and all ranking stay intact.
begin;
set local lock_timeout = '500ms';
set local statement_timeout = '2500ms';
set local transaction_timeout = '4s';
set local search_path = pg_catalog, public, extensions;

do $precondition$
begin
  if not exists (
    select 1 from pg_proc p
    where p.oid = to_regprocedure('public.dam_search_named_scope(jsonb)')
      and md5(p.prosrc) = 'be1c29c118a1be8766b67198aecdbeef'
  ) or not exists (
    select 1 from pg_proc p
    where p.oid = to_regprocedure('public.dam_search_semantic_anchor_named(extensions.vector,text[],jsonb)')
      and md5(p.prosrc) = 'a2761ff6cbb39d36c869cc46ef682de0'
  ) or to_regprocedure('public.dam_search_named_scope(jsonb,boolean)') is not null then
    raise exception 'popdam3#1037 named anchor source differs from the intended contract';
  end if;
end;
$precondition$;

create function public.dam_search_named_scope(
  p_filters jsonb,
  p_need_asset_sets boolean,
  out character_groups uuid[],
  out character_assets uuid[],
  out property_groups uuid[],
  out property_assets uuid[]
)
language plpgsql
stable
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_characters uuid[] := public.dam_search_uuid_list(p_filters->'requiredCharacterIds');
  v_legacy uuid[] := public.dam_search_uuid_list(p_filters->'requiredLegacyCharacterIds');
  v_names tsquery[] := public.dam_search_name_queries(p_filters->'requiredCharacterNames');
  v_properties uuid[] := public.dam_search_uuid_list(p_filters->'semanticPropertyIds');
  v_property_characters uuid[] := public.dam_search_uuid_list(p_filters->'semanticPropertyCharacterIds');
begin
  -- NULL = no scope. An empty array = a scope that allows nothing.
  if v_characters is not null or v_legacy is not null or v_names is not null then
    -- style groups: a non-deleted member file is tagged, or the group's own text names it
    select coalesce(array_agg(distinct x.id), '{}') into character_groups from (
      select a.style_group_id id
      from public.asset_licensor_characters t
      join public.assets a on a.id = t.asset_id
      where t.character_id = any(v_characters) and not a.is_deleted and a.style_group_id is not null
      union all
      select a.style_group_id
      from public.asset_characters t
      join public.assets a on a.id = t.asset_id
      where t.character_id = any(v_legacy) and not a.is_deleted and a.style_group_id is not null
      union all
      select k.entity_id
      from unnest(v_names) q
      join public.dam_search_keys k on k.search_tsv @@ q
      where k.document_type = 'style_group'
    ) x where x.id is not null;
    -- ungrouped asset documents: the file itself is tagged. (Name matching runs on style-group
    -- text only: on 171k asset texts a common name reads ~10k rows, 13 s cold on production.)
    if p_need_asset_sets is distinct from false then
      select coalesce(array_agg(distinct x.id), '{}') into character_assets from (
        select a.id
        from public.asset_licensor_characters t
        join public.assets a on a.id = t.asset_id
        where t.character_id = any(v_characters) and not a.is_deleted and a.style_group_id is null
        union all
        select a.id
        from public.asset_characters t
        join public.assets a on a.id = t.asset_id
        where t.character_id = any(v_legacy) and not a.is_deleted and a.style_group_id is null
      ) x where x.id is not null;
    end if;
  end if;
  if v_properties is not null or v_property_characters is not null then
    select coalesce(array_agg(distinct x.id), '{}') into property_groups from (
      select g.id from public.style_groups g where g.property_id = any(v_properties)
      union all
      select a.style_group_id
      from public.asset_licensor_characters t
      join public.assets a on a.id = t.asset_id
      where t.character_id = any(v_property_characters) and not a.is_deleted and a.style_group_id is not null
    ) x where x.id is not null;
    if p_need_asset_sets is distinct from false then
      select coalesce(array_agg(distinct x.id), '{}') into property_assets from (
        select a.id from public.assets a
        where a.property_id = any(v_properties) and a.style_group_id is null and not a.is_deleted
        union all
        select a.id
        from public.asset_licensor_characters t
        join public.assets a on a.id = t.asset_id
        where t.character_id = any(v_property_characters) and not a.is_deleted and a.style_group_id is null
      ) x where x.id is not null;
    end if;
  end if;
end;
$function$;

revoke all on function public.dam_search_named_scope(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.dam_search_named_scope(jsonb, boolean) to service_role;

create or replace function public.dam_search_named_scope(
  p_filters jsonb,
  out character_groups uuid[],
  out character_assets uuid[],
  out property_groups uuid[],
  out property_assets uuid[]
)
language plpgsql
stable
set search_path = pg_catalog, public, extensions
as $function$
begin
  select s.character_groups, s.character_assets, s.property_groups, s.property_assets
  into character_groups, character_assets, property_groups, property_assets
  from public.dam_search_named_scope(p_filters, true) s;
end;
$function$;

create or replace function public.dam_search_semantic_anchor_named(
  p_query_embedding extensions.vector,
  p_document_types text[] default null,
  p_filters jsonb default null
)
returns real
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions
set statement_timeout = '5s'
as $function$
declare
  v_licensors uuid[] := public.dam_search_uuid_list(p_filters->'semanticLicensorIds');
  v_style_group_only boolean := p_document_types is not null and not ('asset' = any(p_document_types))
     and 'style_group' = any(p_document_types);
  s record;
  v_score real;
begin
  if not coalesce(public.require_dam_access(), false) then
    return null;
  end if;
  -- The style-group branch reads only the group scopes. Preserve both scopes
  -- for the mixed/asset branch, including when the original predicate is NULL.
  s := public.dam_search_named_scope(p_filters, not coalesce(v_style_group_only, false));
  if p_query_embedding is null
     or (v_licensors is null and s.character_groups is null and s.property_groups is null) then
    return public.dam_search_semantic_anchor(p_query_embedding, p_document_types);
  end if;
  if s.character_groups is null and s.property_groups is null then
    -- licensor scope only: the #6024 anchor.
    return public.dam_search_semantic_anchor_scoped(p_query_embedding, p_document_types, v_licensors);
  end if;

  -- Exact distance over the allowed documents only (a few hundred to a few thousand rows):
  -- a filtered HNSW or exact walk over every vector cost 4-42 s on production.
  if v_style_group_only then
    select greatest(0, 1 - min(d.embedding operator(extensions.<=>) p_query_embedding))::real
    into v_score
    from dam.search_group_vectors d
    join public.style_groups g on g.id = d.style_group_id
    where d.entity_id = any(coalesce(s.character_groups, s.property_groups))
      and (s.property_groups is null or d.style_group_id = any(s.property_groups))
      and d.embedding is not null
      and d.embedding_model = 'google/siglip2-base-patch16-naflex'
      and d.document_type = 'style_group'
      and (v_licensors is null or g.licensor_id = any(v_licensors))
    having count(*) > 0;
  elsif p_document_types is null
     or exists (select 1 from unnest(p_document_types) t where t is distinct from 'style_group') then
    select greatest(0, 1 - min(d.embedding operator(extensions.<=>) p_query_embedding))::real
    into v_score
    from (
      select d.* from public.dam_search_documents d
      where d.style_group_id = any(coalesce(s.character_groups, s.property_groups))
      union all
      select d.* from public.dam_search_documents d
      where d.document_type = 'asset' and d.asset_id = any(coalesce(s.character_assets, s.property_assets))
    ) d
    left join public.style_groups g on g.id = d.style_group_id
    left join public.assets a on a.id = d.asset_id and d.style_group_id is null
    where d.embedding is not null
      and d.embedding_model = 'google/siglip2-base-patch16-naflex'
      and (p_document_types is null or d.document_type = any(p_document_types))
      and (s.character_groups is null or d.style_group_id = any(s.character_groups) or d.asset_id = any(s.character_assets))
      and (s.property_groups is null or d.style_group_id = any(s.property_groups)
           or (d.style_group_id is null and d.asset_id = any(s.property_assets)))
      and (v_licensors is null or coalesce(g.licensor_id, a.licensor_id) = any(v_licensors))
    having count(*) > 0;
  end if;

  if v_score is null then
    return public.dam_search_semantic_anchor(p_query_embedding, p_document_types);
  end if;
  return v_score;
end;
$function$;

do $postcondition$
begin
  if (
    select count(*) from pg_proc p
    where p.oid in (to_regprocedure('public.dam_search_named_scope(jsonb)'),
                    to_regprocedure('public.dam_search_named_scope(jsonb,boolean)'))
      and pg_get_userbyid(p.proowner) = 'postgres'
      and not p.prosecdef and p.provolatile = 's'
      and p.proconfig = array['search_path=pg_catalog, public, extensions']::text[]
      and not has_function_privilege('anon', p.oid, 'execute')
      and not has_function_privilege('authenticated', p.oid, 'execute')
      and has_function_privilege('service_role', p.oid, 'execute')
  ) <> 2 or not exists (
    select 1 from pg_proc p
    where p.oid = to_regprocedure('public.dam_search_semantic_anchor_named(extensions.vector,text[],jsonb)')
      and md5(p.prosrc) = 'c84c3687340a36cb16193ef9e3f138cb'
      and pg_get_userbyid(p.proowner) = 'postgres'
      and p.prosecdef and p.provolatile = 's'
      and p.proconfig = array['search_path=pg_catalog, public, extensions','statement_timeout=5s']::text[]
      and not has_function_privilege('anon', p.oid, 'execute')
      and has_function_privilege('authenticated', p.oid, 'execute')
      and has_function_privilege('service_role', p.oid, 'execute')
  ) then
    raise exception 'popdam3#1037 named anchor authorization or settings differ';
  end if;
end;
$postcondition$;

commit;
