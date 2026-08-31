begin;

do $$
declare
  v_definition text;
  v_rows real;
  v_expansions text[];
begin
  if to_regprocedure(
       'public.search_dam_documents(text,integer,text[],extensions.vector)'
     ) is not null then
    raise exception 'legacy unfiltered ranked-search overload must not exist';
  end if;

  select pg_get_functiondef(
    'public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real)'::regprocedure
  ) into v_definition;

  if position('filter_effective_assets' in v_definition) = 0
     or position('visible_assets as materialized' in v_definition) = 0 then
    raise exception 'ranked search must establish the effective visible asset set first';
  end if;
  if position('require_dam_access' in v_definition) = 0 then
    raise exception 'ranked search must refuse callers without DAM entitlement';
  end if;
  if position('keyword_candidates as materialized' in v_definition)
       > position('visible_assets as materialized' in v_definition) then
    raise exception 'indexed ranked candidates must precede expensive asset expansion';
  end if;
  if position('length(q.query_text) >= 3' in v_definition) = 0 then
    raise exception 'short queries must not activate unindexable substring scans';
  end if;
  if position('offset (select page_offset from params)' in lower(v_definition)) = 0
     or position('from ranked_documents' in lower(v_definition)) = 0 then
    raise exception 'ranked search must paginate only after authorization and ranking';
  end if;
  if position('* 0.35' in v_definition) = 0 then
    raise exception 'hybrid search semantic weighting changed';
  end if;
  if position('total_count' in v_definition) = 0
     or position('has_more' in v_definition) = 0
     or position('facets' in v_definition) = 0 then
    raise exception 'paged search must return exact total, has_more, and facets';
  end if;

  if has_function_privilege('anon',
       'public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real)', 'EXECUTE')
     or not has_function_privilege('authenticated',
       'public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real)', 'EXECUTE') then
    raise exception 'ranked search execute grants violate the authenticated boundary';
  end if;

  select prorows into v_rows
  from pg_proc
  where oid = 'public.expand_dam_search_queries(text)'::regprocedure;
  if v_rows <> 4 then
    raise exception 'DAM synonym expansion must retain its bounded planner estimate, got %', v_rows;
  end if;
  select array_agg(query_text order by query_text) into v_expansions
  from public.expand_dam_search_queries('canvas poster');
  if not v_expansions @> array[
    'canvas poster',
    'canvas wall art',
    'wall art poster',
    'wall art wall art'
  ]::text[] then
    raise exception 'planner estimate repair must not truncate chained synonym expansions';
  end if;

  select pg_get_functiondef('public.search_style_groups_full_text(text,integer)'::regprocedure)
    into v_definition;
  if position('max(d.rank)*0.8' in replace(v_definition, ' ', '')) = 0 then
    raise exception 'style-group member-asset ranking rollup changed';
  end if;
  if (length(v_definition) - length(replace(v_definition, 'search_dam_documents', '')))
       / length('search_dam_documents') <> 1 then
    raise exception 'style-group rollup must use one ranked-search pass';
  end if;

  select pg_get_functiondef('public.filter_effective_assets(jsonb)'::regprocedure)
    into v_definition;
  if position('require_dam_access' in v_definition) = 0
     or position('from public.assets' in v_definition) = 0 then
    raise exception 'effective filter must keep its inlinable body behind the DAM gate';
  end if;
  if has_function_privilege('authenticated',
       'public.filter_effective_assets_unchecked_1703(jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated',
       'public.get_filter_counts_unchecked_1703(jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated',
       'public.get_effective_filter_counts_unchecked_1703(jsonb)', 'EXECUTE') then
    raise exception 'unchecked implementation functions must not be callable by authenticated';
  end if;
end;
$$;

do $$
declare
  v_definition text;
begin
  if to_regclass('public.assets_style_group_id_active_idx') is null then
    raise exception 'ranked Style Group expansion requires its active asset key index';
  end if;
  select pg_get_functiondef(
    'public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real)'::regprocedure
  ) into v_definition;
  if position('candidate_asset_ids' in v_definition) = 0
     or position('visible_style_groups' in v_definition) = 0
     or position('join visible_assets a on a.id = c.asset_id' in v_definition) = 0
     or position('join visible_style_groups g on g.style_group_id = c.style_group_id' in v_definition) = 0 then
    raise exception 'ranked search must use keyed asset and Style Group visibility joins';
  end if;
  if position('c.asset_id = a.id or c.style_group_id = a.style_group_id' in v_definition) > 0
     or position('r.asset_id = a.id or r.style_group_id = a.style_group_id' in v_definition) > 0 then
    raise exception 'ranked search restored the production-timeout OR join';
  end if;
  if not exists (
    select 1 from pg_proc
    where oid = 'public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real)'::regprocedure
      and 'statement_timeout=8s' = any(coalesce(proconfig,'{}'))
  ) then
    raise exception 'ranked search lost its explicit edge timeout';
  end if;
  select pg_get_functiondef('public.get_filter_counts(jsonb)'::regprocedure)
    into v_definition;
  if position('get_effective_filter_counts_unchecked_1703' in v_definition) = 0
     or position('get_filter_counts_unchecked_1703' in v_definition) = 0
     or position('require_dam_access' in v_definition) = 0 then
    raise exception 'legacy counts must preserve the empty fast path and delegate filtered requests';
  end if;
end;
$$;

set local session_replication_role = replica;
insert into auth.users (id,email) values
  ('17030000-0000-4000-8000-000000000001','zz1703-dam@example.invalid'),
  ('17030000-0000-4000-8000-000000000002','zz1703-no-dam@example.invalid');
set local session_replication_role = origin;

insert into app.profile (auth_user_id,email,display_name,status) values
  ('17030000-0000-4000-8000-000000000001','zz1703-dam@example.invalid','ZZ1703 DAM','active'),
  ('17030000-0000-4000-8000-000000000002','zz1703-no-dam@example.invalid','ZZ1703 NO DAM','active');
insert into app.app_access (profile_id,app)
select id,'dam'::app.app_name from app.profile
where auth_user_id = '17030000-0000-4000-8000-000000000001';

do $$
declare v_n bigint;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    '{"sub":"17030000-0000-4000-8000-000000000001","role":"authenticated"}',true);
  if not app.has_app_access('dam'::app.app_name) then
    raise exception 'authorized control user did not receive DAM access';
  end if;
  perform 1 from public.filter_effective_assets('{}'::jsonb) limit 1;
  perform public.get_filter_counts('{}'::jsonb);
  perform public.get_effective_filter_counts('{}'::jsonb);
  select count(*) into v_n from public.search_dam_documents(
    'zz1703-no-match','{}'::jsonb,5,0,array['absent-document-type']::text[],null,0
  );
  perform 1 from public.search_assets_full_text('zz1703-no-match',5);
  perform 1 from public.search_style_groups_full_text('zz1703-no-match',5);

  perform set_config('request.jwt.claims',
    '{"sub":"17030000-0000-4000-8000-000000000002","role":"authenticated"}',true);
  if app.has_app_access('dam'::app.app_name) then
    raise exception 'non-DAM control user unexpectedly received DAM access';
  end if;
  begin
    perform 1 from public.filter_effective_assets('{}'::jsonb) limit 1;
    raise exception 'non-DAM user reached effective assets';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.search_dam_documents(
      'zz1703-no-match','{}'::jsonb,5,0,array['absent-document-type']::text[],null,0
    );
    raise exception 'non-DAM user reached ranked search';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.get_filter_counts('{}'::jsonb);
    raise exception 'non-DAM user reached filter counts';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.get_effective_filter_counts('{}'::jsonb);
    raise exception 'non-DAM user reached effective filter counts';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.search_assets_full_text('zz1703-no-match',1);
    raise exception 'non-DAM user reached asset search wrapper';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.search_style_groups_full_text('zz1703-no-match',1);
    raise exception 'non-DAM user reached Style Group search wrapper';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims',null,true);
end;
$$;

rollback;
