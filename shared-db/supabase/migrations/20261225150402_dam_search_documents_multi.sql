-- u2giants/popdam3#1430 Phase 3 Step 7 (claim popcre/shared-db#7173).
-- public.search_dam_documents_multi: one call for a search with several product-phrase variants
-- ("floor covering" -> also "mat", "rug"). Each variant runs through search_dam_documents itself
-- (same candidates, inline anchor, ranking and visibility), with every visible match returned
-- (limit 20,000, offset 0). The union is deduplicated by (document_type, entity_id) keeping the
-- best keyword, picture, text and blended rank, ordered rank desc, document_type, entity_id, and
-- paged here, so total_count, total_group_files and has_more are EXACT over the union.
-- A variant whose exact total exceeds the rows it returned (more than 20,000 matches, or word-form
-- rows counted but not ranked) cannot be unioned exactly: the call fails (the app answers 503 and
-- Retry) instead of reporting a lower bound (owner ruling, shared-db#5053).
-- Facets: exact when one variant's matches contain the whole union (its own facets are then the
-- union's); otherwise the documented exact-flags-only shape (blank sidebar, never under-counts).
-- derived-from: 20261225150401
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = pg_catalog, public, extensions;

do $guard$
begin
  if to_regprocedure('public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real,extensions.halfvec,real,real,boolean,boolean)') is null then
    raise exception 'search_dam_documents with p_compute_anchor (20261225150401) is missing';
  end if;
end;
$guard$;

create function public.search_dam_documents_multi(
  p_variants jsonb,
  p_limit integer,
  p_offset integer,
  p_document_types text[] default null,
  p_min_rank real default 0,
  p_min_semantic_score real default null,
  p_min_text_score real default null,
  p_text_score_margin real default null,
  p_include_facets boolean default true
)
returns table(document_type text, entity_id uuid, asset_id uuid, style_group_id uuid, keyword_rank real,
  semantic_rank real, rank real, total_count bigint, has_more boolean, facets jsonb, text_rank real,
  total_group_files bigint)
language plpgsql
stable
security definer
set search_path = public, extensions
set statement_timeout = '30s'
as $function$
declare
  v jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_variant jsonb;
  v_n bigint;
  v_total bigint;
  v_facets jsonb[] := '{}';
  v_counts bigint[] := '{}';
  v_union bigint;
  v_union_facets jsonb;
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 20000));
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  i integer;
begin
  if not coalesce(public.require_dam_access(), false) then
    return;
  end if;
  if jsonb_typeof(p_variants) is distinct from 'array'
     or jsonb_array_length(p_variants) not between 1 and 8 then
    raise exception 'p_variants must be an array of 1 to 8 variants' using errcode = '22023';
  end if;

  for v in select x from jsonb_array_elements(p_variants) x loop
    if jsonb_typeof(v) is distinct from 'object' or nullif(btrim(v->>'query'), '') is null then
      raise exception 'each variant needs a query' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) into v_variant
    from public.search_dam_documents(
      v->>'query',
      case when jsonb_typeof(v->'filters') = 'object' then v->'filters' else '{}'::jsonb end,
      20000, 0, p_document_types,
      case when jsonb_typeof(v->'query_embedding') = 'array' then (v->>'query_embedding')::extensions.vector end,
      p_min_rank, p_min_semantic_score,
      case when jsonb_typeof(v->'query_text_embedding') = 'array' then (v->>'query_text_embedding')::extensions.halfvec end,
      p_min_text_score, p_text_score_margin,
      coalesce(p_include_facets, true),
      coalesce((v->>'compute_anchor')::boolean, false)) s;
    select count(*) filter (where r->>'entity_id' is not null), max((r->>'total_count')::bigint)
    into v_n, v_total from jsonb_array_elements(v_variant) r;
    if coalesce(v_total, 0) <> v_n then
      raise exception 'DAM multi-variant union cannot be exact (variant total % > % rows)', v_total, v_n
        using errcode = 'P0001';
    end if;
    v_counts := v_counts || v_n;
    v_facets := v_facets || coalesce((v_variant->0->'facets'), '{}'::jsonb);
    v_rows := v_rows || coalesce((select jsonb_agg(r) from jsonb_array_elements(v_variant) r
                                   where r->>'entity_id' is not null), '[]'::jsonb);
  end loop;

  select count(*) into v_union from (
    select distinct r->>'document_type', r->>'entity_id' from jsonb_array_elements(v_rows) r) u;
  if coalesce(p_include_facets, true) then
    for i in 1 .. cardinality(v_counts) loop
      if v_counts[i] = v_union then v_union_facets := v_facets[i]; exit; end if;
    end loop;
    v_union_facets := coalesce(v_union_facets, jsonb_build_object(
      'fileType','{}'::jsonb,'status','{}'::jsonb,'workflowStatus','{}'::jsonb,'stage','{}'::jsonb,
      'isLicensed','{}'::jsonb,'totalExact',true,'totalKind','exact'));
  else
    v_union_facets := '{}'::jsonb;
  end if;

  return query
  with r as (
    select x.* from jsonb_to_recordset(v_rows) x(document_type text, entity_id uuid, asset_id uuid,
      style_group_id uuid, keyword_rank real, semantic_rank real, rank real, text_rank real)
  ), u as materialized (
    select r.document_type, r.entity_id,
      (array_agg(r.asset_id) filter (where r.asset_id is not null))[1] asset_id,
      (array_agg(r.style_group_id) filter (where r.style_group_id is not null))[1] style_group_id,
      max(r.keyword_rank)::real keyword_rank, max(r.semantic_rank)::real semantic_rank,
      max(r.rank)::real rank, max(r.text_rank)::real text_rank
    from r group by r.document_type, r.entity_id
  ), s as materialized (
    select count(*)::bigint total_count,
      case when p_document_types is null or 'style_group' = any(p_document_types) then (
        select coalesce(sum(sg.asset_count), 0)::bigint from u
        join public.style_groups sg on sg.id = u.style_group_id
        where u.document_type = 'style_group') end total_group_files
    from u
  ), page as (
    select u.* from u order by u.rank desc, u.document_type, u.entity_id
    offset v_offset limit v_limit
  )
  select p.document_type, p.entity_id, p.asset_id, p.style_group_id, p.keyword_rank, p.semantic_rank,
    p.rank, s.total_count, s.total_count > v_offset + v_limit, v_union_facets, p.text_rank,
    s.total_group_files
  from s left join page p on true
  order by p.rank desc nulls last, p.document_type nulls last, p.entity_id nulls last;
end;
$function$;

alter function public.search_dam_documents_multi(jsonb,integer,integer,text[],real,real,real,real,boolean) owner to postgres;
revoke all on function public.search_dam_documents_multi(jsonb,integer,integer,text[],real,real,real,real,boolean) from public, anon;
grant execute on function public.search_dam_documents_multi(jsonb,integer,integer,text[],real,real,real,real,boolean) to authenticated, service_role;

do $guard$
declare
  f regprocedure := to_regprocedure('public.search_dam_documents_multi(jsonb,integer,integer,text[],real,real,real,real,boolean)');
begin
  if f is null
     or has_function_privilege('anon', f, 'execute')
     or not has_function_privilege('authenticated', f, 'execute')
     or not exists (select 1 from pg_proc p where p.oid = f and p.prosecdef and p.provolatile = 's'
       and pg_get_userbyid(p.proowner) = 'postgres') then
    raise exception 'popdam3#1430 Step 7: installed multi-variant search contract differs';
  end if;
end;
$guard$;

notify pgrst, 'reload schema';
commit;
