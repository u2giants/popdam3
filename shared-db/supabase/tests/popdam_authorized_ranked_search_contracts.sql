begin;

-- #2138: the effective list function returns whole rows from an append relation
-- so PostgREST's outer LIMIT can stop it early. Comments are stripped and
-- whitespace folded first, so each pin is contiguous syntax in its real
-- position: a predicate that survives only inside a comment is not a predicate.
do $$
declare
  v_def text := pg_get_functiondef('public.filter_effective_assets(jsonb)'::regprocedure);
  v_body text := regexp_replace(regexp_replace(v_def, E'--[^\n]*', '', 'g'), '\s+', ' ', 'g');
  v_lower text := lower(v_body);
  v_pin text;
  v_arms int;
  v_gate int;
  v_language name;
  v_volatility "char";
  v_secdef boolean;
  v_config text[];
begin
  select l.lanname, p.provolatile, p.prosecdef, p.proconfig
    into v_language, v_volatility, v_secdef, v_config
  from pg_proc p
  join pg_language l on l.oid = p.prolang
  where p.oid = 'public.filter_effective_assets(jsonb)'::regprocedure;

  -- Only a STABLE SQL invoker function with no per-function SET is inlined; a
  -- PL/pgSQL RETURN QUERY of the same SELECT is not, and reproduces #1945.
  if v_language <> 'sql' or v_volatility <> 's' or v_secdef or v_config is not null then
    raise exception 'effective list function is not an inlinable stable invoker SQL function: language %, volatility %, security definer %, config %',
      v_language, v_volatility, v_secdef, v_config;
  end if;

  -- No CTE barrier, and no id self-join under any alias pair.
  if position('identity_asset_ids' in v_lower) > 0
     or position('as materialized' in v_lower) > 0
     or position('left join public.style_groups' in v_lower) > 0
     or position('filter_effective_assets_unchecked_1703' in v_lower) > 0
     or v_lower ~ '\m[a-z_][a-z0-9_]*\.id = [a-z_][a-z0-9_]*\.id\M' then
    raise exception 'effective list function reintroduced the materialised id set or its self-join';
  end if;

  -- Entitlement is invoked once, as the Var-free outer WHERE conjunct.
  v_gate := (length(v_lower) - length(replace(v_lower, 'public.require_dam_access()', '')))
              / length('public.require_dam_access()');
  if v_gate <> 1 then
    raise exception 'effective list function must invoke public.require_dam_access() exactly once, found %', v_gate;
  end if;
  if position(') a where public.require_dam_access()' in v_lower) = 0 then
    raise exception 'effective list function must gate on DAM entitlement in its outer WHERE clause';
  end if;

  -- Eight preserved fallback arms plus two exclusive narrow tag arms, each pinned by its leading guard.
  -- The bare equality tokens also occur as optional conjuncts on the licensor
  -- pair, so counting arms and pinning guards is what stops a deleted
  -- property- or customer-leading arm from passing while the DAM property and
  -- customer libraries silently return nothing.
  v_arms := (length(v_lower) - length(replace(v_lower, 'union all', ''))) / length('union all');
  if v_arms <> 9 then
    raise exception 'effective predicates must keep ten UNION arms, found % UNION ALLs', v_arms;
  end if;
  foreach v_pin in array array[
    'from public.assets a where nullif(p_filters ->> ''licensorid'', '''') is null and nullif(p_filters ->> ''propertyid'', '''') is null and nullif(p_filters ->> ''customerid'', '''') is null and nullif(p_filters ->> ''tagfilter'', '''') is null union all',
    'select distinct e.asset_id from public.asset_effective_tags e where nullif(p_filters ->> ''tagfilter'', '''') is not null and e.tag = p_filters ->> ''tagfilter''',
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

  -- The three identity keys the DAM client sends, case-sensitively.
  foreach v_pin in array array['''licensorId''', '''propertyId''', '''customerId'''] loop
    if position(v_pin in v_body) = 0 then
      raise exception 'effective list function no longer reads the DAM identity key %', v_pin;
    end if;
  end loop;
end;
$$;

do $$
declare
  v_definition text;
  v_rows real;
  v_expansions text[];
begin
  if to_regprocedure(
       'public.search_dam_documents(text,integer,text[],extensions.vector)'
     ) is not null then
    raise exception 'legacy unfiltered ranked-search overload survived ordered replay';
  end if;

  select pg_get_functiondef(
    'public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real)'::regprocedure
  ) into v_definition;

  if position('candidate_asset_ids as materialized' in v_definition) = 0
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
     or position('select distinct a.document_type, a.entity_id, a.asset_id' in v_definition) = 0 then
    raise exception 'ranked search must use keyed asset and Style Group visibility joins';
  end if;
  if position('d.search_tsv @@ any(array(select q.tsq from queries q))' in v_definition) = 0
     or position('full_text_matches as materialized' in v_definition) = 0
     or position('select max(ts_rank_cd(d.search_tsv, q.tsq))' in v_definition) = 0 then
    raise exception 'ranked search must retain the measured indexable scan and maximum synonym rank';
  end if;
  if position('c.keyword_rank, c.semantic_rank, c.rank, c.asset_id id' in v_definition) = 0
     or position('c.keyword_rank, c.semantic_rank, c.rank, a.id' in v_definition) = 0
     or position('select distinct a.document_type, a.entity_id, a.asset_id' in v_definition) = 0
     or position('from candidate_ranks c' in substring(v_definition from position('ranked_documents as materialized' in v_definition))) > 0 then
    raise exception 'candidate rank keys must flow through visibility without a quadratic CTE join';
  end if;
  if position('c.asset_id = a.id or c.style_group_id = a.style_group_id' in v_definition) > 0
     or position('r.asset_id = a.id or r.style_group_id = a.style_group_id' in v_definition) > 0 then
    raise exception 'ranked search restored the production-timeout OR join';
  end if;
  if position('a.id, a.style_group_id asset_style_group_id, a.file_type, a.status,' in v_definition) = 0
     or position('a.workflow_status, a.stage, a.is_licensed' in v_definition) = 0
     or position('select a.*' in v_definition) > 0
     or position('select distinct a.*' in v_definition) > 0 then
    raise exception 'visible assets must retain the explicit seven-column projection';
  end if;
  if position('select f.*' in v_definition) > 0
     or position('select distinct a.*' in v_definition) > 0
     or position('cross join lateral' in substring(v_definition from position('visible_assets as materialized' in v_definition))) > 0
     or position('from candidate_asset_ids c' in v_definition) = 0
     or position('join public.assets a on a.id = c.id' in v_definition) = 0
     or position('filter_effective_assets' in substring(v_definition from position('visible_assets as materialized' in v_definition))) > 0
     or position('cross join lateral' in v_definition) > 0 then
    raise exception 'ranked search restored wide visibility or redundant wide deduplication';
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
  if (length(v_definition) - length(replace(v_definition,
       'get_effective_filter_counts_unchecked_1703', '')))
       / length('get_effective_filter_counts_unchecked_1703') <> 1
     or position('get_filter_counts_unchecked_1703' in v_definition) > 0
     or position('require_dam_access' in v_definition) = 0 then
    raise exception 'legacy counts must delegate exactly once to effective counts behind the DAM gate';
  end if;
  select pg_get_functiondef('public.get_effective_filter_counts_unchecked_1703(jsonb)'::regprocedure)
    into v_definition;
  if position('select a.file_type, a.status, a.workflow_status, a.stage, a.is_licensed' in v_definition) = 0
     or position('from public.assets a' in v_definition) = 0
     or position('select a.*' in v_definition) > 0
     or position('filter_effective_assets' in v_definition) > 0
     or position('bounds as materialized' in v_definition) = 0 then
    raise exception 'effective counts must use one narrow five-column direct asset scan';
  end if;
  select pg_get_functiondef('public.get_effective_filter_counts(jsonb)'::regprocedure)
    into v_definition;
  if position('get_effective_filter_counts_unchecked_1703' in v_definition) = 0
     or position('filter_effective_assets' in v_definition) > 0
     or (length(v_definition) - length(replace(v_definition, 'require_dam_access', '')))
       / length('require_dam_access') <> 1 then
    raise exception 'effective counts must use the parity filter behind one DAM gate';
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

-- An inlinable SQL SRF may defer its materialized authorization CTE when the
-- underlying scan is empty. Keep one rollback-only eligible row so the runtime
-- refusal probe necessarily evaluates the gate instead of proving only that an
-- empty query returns no rows.
insert into public.assets (
  id, filename, relative_path, file_type, quick_hash, modified_at, is_deleted
) values (
  '17030000-0000-4000-8000-000000000003',
  'zz1703-auth-gate.ai', 'zz1703-auth-gate.ai', 'ai',
  'zz1703-auth-gate', now(), false
);
insert into public.assets(id,filename,relative_path,file_type,quick_hash,modified_at,thumbnail_url,is_deleted)
values('17030000-0000-4000-8000-000000000004','zz1703-tag-visible.ai',
  'zz1703-tag-visible.ai','ai','zz1703-tag-visible',now(),'https://example.invalid/tag.png',false);
insert into public.asset_effective_tags(asset_id,tag,scope) values
  ('17030000-0000-4000-8000-000000000003','zz1703-auth-tag','asset'),
  ('17030000-0000-4000-8000-000000000004','zz1703-auth-tag','asset');

do $$
declare v_n bigint;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    '{"sub":"17030000-0000-4000-8000-000000000001","role":"authenticated"}',true);
  if not app.has_app_access('dam'::app.app_name) then
    raise exception 'authorized control user did not receive DAM access';
  end if;
  perform set_config('plan_cache_mode','force_generic_plan',true);
  select count(*) into v_n from public.filter_effective_assets('{"tagFilter":"zz1703-auth-tag"}'::jsonb);
  if v_n<>2 then raise exception 'authenticated prepared tag path lost thumbnail partition parity'; end if;
  if (public.get_filter_counts('{"tagFilter":"zz1703-auth-tag"}'::jsonb)->>'total')::bigint<>2 then
    raise exception 'authenticated tag facet/list parity changed';
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
    perform 1 from public.filter_effective_assets('{"tagFilter":"zz1703-auth-tag"}'::jsonb) limit 1;
    raise exception 'non-DAM user reached narrow tag assets';
  exception when insufficient_privilege then null;
  end;
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
