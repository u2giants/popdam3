-- Version: 20261030224046
-- Exact DAM search totals (issue #5053; owner ask 2026-10-29: "I don't want
-- estimates, i want precise numbers only").
-- derived-from: 20261030042314
--   The 1,001-row summary probe made total_count a LOWER BOUND whenever a
--   query matched more than ~1,000 visible assets (facets.totalExact=false,
--   totalKind='lower_bound'; measured live: "spiderman" style groups reported
--   98 while the true exact count is 1,325; "disney" reported 113 vs 4,090).
--   This migration makes totals exact and only exact:
--   1. search_dam_documents gains an exact_docs CTE: it counts EVERY
--      candidate document with at least one member asset passing the same
--      visibility predicate, short-circuiting per document (EXISTS ...
--      LIMIT 1), so the exact count does not enumerate every member asset.
--      total_count comes from exact_docs; facets.totalExact is always true
--      and totalKind always 'exact'. has_more, page rows, ranking, grants
--      and the output contract are unchanged.
--   2. Facet per-key counts remain exact while the visible asset set fits
--      the 1,001-row probe. Past the cap the per-key counts would be lower
--      bounds — which the owner ruled out — so summary then emits only the
--      exactness flags (empty facet objects; the PopDAM filter sidebar shows
--      blanks instead of under-counts). Totals stay exact in every case.
--   3. dam_asset_matches_filters changes signature from composite row
--      arguments to scalar column arguments (same predicate body, same
--      planner opacity via its per-function SET search_path, so #4508's
--      ~14 ms planning cost is preserved). Measured reason (production,
--      read-only, 2026-10-29): composite arguments detoast whole rows and
--      cost ~150 us per call; scalars are ~free (17,223 calls: 3.56 s ->
--      0.62 s). exact_docs calls the helper once per candidate document, so
--      the scalar form keeps broad asset legs inside the 8 s authenticated
--      budget (spiderman asset leg ~4-6 s calm-window; disney-class legs
--      stay timeout-class exactly like the live function today —
--      pg_stat_statements on the live function: mean 4.4-13.9 s, max 29.1 s
--      — and the app then falls back to its exact keyword count path).
--   Verification performed before this migration (pg_temp copies only, no
--   durable objects touched): exact totals spiderman sg 1,325 / asset
--   17,223; disney sg 4,090 / asset 52,386; star wars asset 8,958; mickey
--   sg 1,012; row-identical to the live function on bounded queries;
--   facet-identical where untruncated.

do $guard$
declare v_src text; v_helper_oid regprocedure;
begin
  v_helper_oid := to_regprocedure('public.dam_asset_matches_filters(public.assets, public.style_groups, jsonb, timestamptz)');
  select p.prosrc into v_src from pg_proc p
   where p.oid = to_regprocedure('public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real)');
  if v_src is null
     or v_helper_oid is null
     or position('dam_asset_matches_filters' in v_src) = 0
     or position('semantic_exact as materialized' in v_src) = 0
     or position('hnsw.iterative_scan' in v_src) = 0
     or position('semantic_ann as materialized' in v_src) = 0
     or position('threshold applied after the legs' in v_src) = 0 then
    raise exception '#5053: live search_dam_documents is not the 20261030042314 (#4508) body; refusing to replace';
  end if;
end
$guard$;

set statement_timeout = '15min';

-- Create the scalar-argument overload FIRST. The still-live search body calls
-- the composite overload, so dropping it before the body is replaced is
-- dependency-blocked ("other objects depend on it"); both overloads coexist
-- until the new search body below replaces the calls, and only then is the
-- composite overload dropped.
CREATE FUNCTION public.dam_asset_matches_filters(
  p_id uuid,
  p_is_deleted boolean,
  p_modified_at timestamptz,
  p_file_created_at timestamptz,
  p_thumbnail_url text,
  p_style_group_id uuid,
  p_licensor_id uuid,
  p_sg_licensor_id uuid,
  p_property_id uuid,
  p_sg_property_id uuid,
  p_customer_id uuid,
  p_sg_customer_id uuid,
  p_file_type public.file_type,
  p_content_type text,
  p_product_material text[],
  p_status public.asset_status,
  p_workflow_status public.workflow_status,
  p_stage text,
  p_is_licensed boolean,
  p_asset_type public.asset_type,
  p_art_source public.art_source,
  p_thumbnail_error text,
  p_product_category text,
  p_relative_path text,
  p_customer text,
  p_program text,
  p_filters jsonb,
  p_min_date timestamptz
)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 PARALLEL SAFE
 SET search_path TO 'public', 'extensions'
AS $fn$
  select not p_is_deleted
      and (p_modified_at >= p_min_date or p_file_created_at >= p_min_date or p_thumbnail_url is not null)
      and (nullif(p_filters->>'licensorId','') is null or case when p_style_group_id is null then p_licensor_id else p_sg_licensor_id end=(p_filters->>'licensorId')::uuid)
      and (nullif(p_filters->>'propertyId','') is null or case when p_style_group_id is null then p_property_id else p_sg_property_id end=(p_filters->>'propertyId')::uuid)
      and (nullif(p_filters->>'customerId','') is null or case when p_style_group_id is null then p_customer_id else p_sg_customer_id end=(p_filters->>'customerId')::uuid)
      and (nullif(p_filters->>'tagFilter','') is null or exists(select 1 from public.asset_effective_tags e where e.asset_id=p_id and e.tag=p_filters->>'tagFilter'))
      and (jsonb_array_length(coalesce(p_filters->'fileType','[]'))=0 or p_file_type::text in(select jsonb_array_elements_text(p_filters->'fileType')))
      and (jsonb_array_length(coalesce(p_filters->'contentType','[]'))=0 or p_content_type in(select jsonb_array_elements_text(p_filters->'contentType')))
      and (jsonb_array_length(coalesce(p_filters->'productMaterial','[]'))=0 or p_product_material && array(select jsonb_array_elements_text(p_filters->'productMaterial')))
      and (jsonb_array_length(coalesce(p_filters->'status','[]'))=0 or p_status::text in(select jsonb_array_elements_text(p_filters->'status')))
      and (jsonb_array_length(coalesce(p_filters->'workflowStatus','[]'))=0 or p_workflow_status::text in(select jsonb_array_elements_text(p_filters->'workflowStatus')))
      and (jsonb_array_length(coalesce(p_filters->'stage','[]'))=0 or p_stage in(select jsonb_array_elements_text(p_filters->'stage')))
      and ((p_filters->>'isLicensed') is null or p_is_licensed=(p_filters->>'isLicensed')::boolean)
      and (jsonb_array_length(coalesce(p_filters->'assetType','[]'))=0 or p_asset_type::text in(select jsonb_array_elements_text(p_filters->'assetType')))
      and (jsonb_array_length(coalesce(p_filters->'artSource','[]'))=0 or p_art_source::text in(select jsonb_array_elements_text(p_filters->'artSource')))
      and (jsonb_array_length(coalesce(p_filters->'fileStatus','[]'))=0 or exists(select 1 from jsonb_array_elements_text(p_filters->'fileStatus') fs where
        (fs='has_preview' and p_thumbnail_url is not null) or
        (fs='no_preview_renderable' and p_thumbnail_url is null and p_thumbnail_error is null) or
        (fs='no_pdf_compat' and p_thumbnail_url is null and p_thumbnail_error='no_pdf_compat') or
        (fs='no_preview_unsupported' and p_thumbnail_url is null and p_thumbnail_error='no_preview_or_render_failed')))
      and (jsonb_array_length(coalesce(p_filters->'productCategory','[]'))=0 or p_product_category in(select jsonb_array_elements_text(p_filters->'productCategory')) or
        ('Wall' in(select jsonb_array_elements_text(p_filters->'productCategory')) and (p_relative_path ilike '%WALL ART%' or p_relative_path ilike '%3FZ%')))
      and (nullif(p_filters->>'customer','') is null or p_customer=p_filters->>'customer')
      and (nullif(p_filters->>'program','') is null or p_program=p_filters->>'program')
$fn$;

revoke all on function public.dam_asset_matches_filters(uuid, boolean, timestamptz, timestamptz, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, public.file_type, text, text[], public.asset_status, public.workflow_status, text, boolean, public.asset_type, public.art_source, text, text, text, text, text, jsonb, timestamptz) from public;

CREATE OR REPLACE FUNCTION public.search_dam_documents(p_query text, p_filters jsonb, p_limit integer, p_offset integer, p_document_types text[] DEFAULT NULL::text[], p_query_embedding extensions.vector DEFAULT NULL::extensions.vector, p_min_rank real DEFAULT 0, p_min_semantic_score real DEFAULT NULL::real)
 RETURNS TABLE(document_type text, entity_id uuid, asset_id uuid, style_group_id uuid, keyword_rank real, semantic_rank real, rank real, total_count bigint, has_more boolean, facets jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET statement_timeout TO '30s'
AS $function$
  select set_config('hnsw.ef_search', '100', true);
  select set_config('hnsw.iterative_scan', 'relaxed_order', true);
  select set_config('hnsw.max_scan_tuples', '20000', true);
  with params as materialized (
    select nullif(trim(p_query),'') query_text,
      greatest(1,least(coalesce(p_limit,100),20000)) page_limit,
      greatest(coalesce(p_offset,0),0) page_offset,
      greatest(coalesce(p_min_rank,0),0)::real min_rank,
      case when p_min_semantic_score is null then null
        else greatest(0,least(1,p_min_semantic_score))::real end min_semantic_score,
      case when p_query_embedding is null then false else true end has_embedding,
      1000 summary_probe_limit
    where public.require_dam_access()
  ), queries as materialized (
    select q.query_text, websearch_to_tsquery('simple', regexp_replace(q.query_text, '[-_/]+', ' ', 'g')) tsq,
      '%' || replace(replace(replace(q.query_text, '\', '\\'), '%', '\%'), '_', '\_') || '%' like_pattern,
      (length(q.query_text) >= 3 and q.query_text ~ '[[:alnum:]]{3,}') allow_substring
    from params p cross join public.expand_dam_search_queries(p.query_text) q
    where p.query_text is not null
      and websearch_to_tsquery('simple', regexp_replace(q.query_text, '[-_/]+', ' ', 'g'))::text <> ''
  ), distinct_queries as materialized (
    select distinct q.query_text, q.tsq, q.allow_substring, q.like_pattern,
      btrim(lower(regexp_replace(btrim(q.query_text), '[-_/[:space:]]+', ' ', 'g'))) normalized_query,
      regexp_replace(q.query_text, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') regex_literal
    from queries q
  ), substring_regex as materialized (
    select '(' || string_agg(distinct q.regex_literal, '|') || ')' rx
    from distinct_queries q where q.allow_substring
  ), rank_queries as materialized (
    select q.normalized_query, q.tsq,
      coalesce(array_agg(distinct q.like_pattern) filter (where q.allow_substring), '{}'::text[]) like_patterns
    from distinct_queries q
    group by q.normalized_query, q.tsq
  ), full_text_matches as materialized (
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,d.title,d.title_key,d.title_tsv
    from public.dam_search_keys d
    where (p_document_types is null or d.document_type = any(p_document_types))
      and d.search_tsv @@ any(array(select q.tsq from queries q))
  ), substring_matches as materialized (
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,d.title,d.path,d.customer,d.program,d.title_key,d.title_tsv
    from substring_regex r
    join public.dam_search_keys d on r.rx is not null and
      (d.title ~* r.rx or d.path ~* r.rx or d.customer ~* r.rx or d.program ~* r.rx)
    where (p_document_types is null or d.document_type = any(p_document_types))
  ), keyword_features as materialized (
    select m.document_type,m.entity_id,m.asset_id,m.style_group_id,m.in_substring,
      m.title,m.path,m.customer,m.program,
      m.title_key,m.title_tsv
    from (
      select f.document_type,f.entity_id,f.asset_id,f.style_group_id,f.title,f.title_key,f.title_tsv,
        s.path,s.customer,s.program,(s.entity_id is not null) in_substring
      from full_text_matches f
      left join substring_matches s
        on s.document_type = f.document_type and s.entity_id = f.entity_id
      union all
      select s.document_type,s.entity_id,s.asset_id,s.style_group_id,s.title,s.title_key,s.title_tsv,
        s.path,s.customer,s.program,true
      from substring_matches s
      where not exists (
        select 1 from full_text_matches f
        where f.document_type = s.document_type and f.entity_id = s.entity_id)
    ) m
  ), keyword_candidates as materialized (
    select k.document_type,k.entity_id,k.asset_id,k.style_group_id,
      (select max(
        case
          when k.title_key = q.normalized_query then 1.0
          when k.in_substring and k.title ilike any(q.like_patterns) then 0.6
          when k.title_tsv @@ q.tsq then 0.45
          when k.in_substring and k.path ilike any(q.like_patterns) then 0.3
          when k.in_substring and (k.customer ilike any(q.like_patterns) or k.program ilike any(q.like_patterns)) then 0.2
          else 0.1
        end
        + 0.09 * least(1.0, length(q.normalized_query)::numeric / greatest(length(k.title_key),1))
      ) from rank_queries q)::real keyword_rank
    from keyword_features k
  ), semantic_ann as materialized (
    -- HNSW leg: used whenever assets are searched. hnsw.iterative_scan=relaxed_order
    -- (set_config at the top of the body) keeps scanning past ef_search until the post-filtered
    -- LIMIT is met, instead of stopping at the ~100-row candidate list (#4664).
    -- HNSW returns distance order; do NOT add a secondary sort key here.
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,
      greatest(0,1-(d.embedding <=> p_query_embedding))::real semantic_rank
    from params p
    join public.dam_search_documents d
      on p.has_embedding
      and d.embedding is not null
      and d.embedding_model = 'google/siglip2-base-patch16-naflex'
    -- also used for any requested type that has no exact leg (anything but style_group; #4664 M2).
    where (p_document_types is null
        or exists (select 1 from unnest(p_document_types) t where t is distinct from 'style_group'))
      and (p_document_types is null or d.document_type = any(p_document_types))
    order by d.embedding <=> p_query_embedding
    limit 2000
  ), semantic_exact as materialized (
    -- Exact leg: when assets are NOT searched (style groups only, ~6k vectors; the
    -- only other document type),
    -- a filtered HNSW walk must cross ~25x more asset tuples than it keeps (15 s for
    -- 964 rows on production). An exact distance sort over the pkey range is ~0.1 s.
    -- "+ 0" keeps the planner off the HNSW index on purpose.
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,
      greatest(0,1-(d.embedding <=> p_query_embedding))::real semantic_rank
    from params p
    join public.dam_search_documents d
      on p.has_embedding
      and d.embedding is not null
      and d.embedding_model = 'google/siglip2-base-patch16-naflex'
    where p_document_types is not null and not ('asset' = any(p_document_types))
      and 'style_group' = any(p_document_types)
      and d.document_type = 'style_group'  -- literal: a parameter here makes the planner seq-scan (3.5 s)
    order by (d.embedding <=> p_query_embedding) + 0
    limit 2000
  ), semantic_candidates as materialized (
    -- threshold applied after the legs so it never extends the HNSW walk (#4664 M1).
    select s.document_type,s.entity_id,s.asset_id,s.style_group_id,s.semantic_rank from (
      select * from semantic_ann
      union all
      select * from semantic_exact
    ) s
    cross join params p
    where p.min_semantic_score is null
       or s.semantic_rank >= p.min_semantic_score
  ), candidate_ranks as materialized (
    select c.document_type,c.entity_id,c.asset_id,c.style_group_id,max(c.keyword_rank)::real keyword_rank,
      max(c.semantic_rank)::real semantic_rank,
      (coalesce(max(c.keyword_rank),0) + coalesce(max(c.semantic_rank),0) * 0.35)::real rank
    from (select k.*,null::real semantic_rank from keyword_candidates k union all
      select s.document_type,s.entity_id,s.asset_id,s.style_group_id,null::real,s.semantic_rank from semantic_candidates s) c
    group by c.document_type,c.entity_id,c.asset_id,c.style_group_id
    having coalesce(max(c.keyword_rank),0) + coalesce(max(c.semantic_rank),0) * 0.35 >= (select min_rank from params)
  ), ordered_candidates as materialized (
    select c.document_type,c.entity_id,c.asset_id,c.style_group_id,c.keyword_rank,c.semantic_rank,c.rank,
      row_number() over (order by c.rank desc, c.document_type, c.entity_id) rn
    from candidate_ranks c
  ), candidate_asset_ids as not materialized (
    select c.document_type, c.entity_id, c.asset_id, c.style_group_id,
      c.keyword_rank, c.semantic_rank, c.rank, x.id, c.rn
    from (select * from ordered_candidates order by rn) c
    join lateral (
      select c.asset_id id where c.document_type='asset' and c.asset_id is not null
      union all
      select m.id from public.assets m
      where c.document_type='style_group' and c.style_group_id is not null
        and m.style_group_id=c.style_group_id and not m.is_deleted
    ) x on true
  ), visibility_params as materialized (
    select coalesce(p_filters,'{}'::jsonb)-'search' f,
    public.assets_thumbnail_min_date() thumbnail_min_date
  ), visible_assets as materialized (
    select c.document_type,c.entity_id,c.asset_id,c.style_group_id,c.keyword_rank,c.semantic_rank,c.rank,
      a.id, a.style_group_id asset_style_group_id, a.file_type, a.status,
      a.workflow_status, a.stage, a.is_licensed, c.rn
    from candidate_asset_ids c
    join public.assets a on a.id = c.id
    left join public.style_groups sg on sg.id=a.style_group_id
    cross join visibility_params v
    where public.dam_asset_matches_filters(
          a.id, a.is_deleted, a.modified_at, a.file_created_at, a.thumbnail_url,
          a.style_group_id, a.licensor_id, sg.licensor_id, a.property_id, sg.property_id,
          a.customer_id, sg.customer_id, a.file_type, a.content_type, a.product_material,
          a.status, a.workflow_status, a.stage, a.is_licensed, a.asset_type, a.art_source,
          a.thumbnail_error, a.product_category, a.relative_path, a.customer, a.program,
          v.f, v.thumbnail_min_date)
    order by c.rn
    limit (select summary_probe_limit + 1 from params)
  ), probe_state as materialized (
    select count(*) > (select summary_probe_limit from params) truncated
    from visible_assets
  ), summary_assets as materialized (
    select a.document_type,a.entity_id,a.asset_id,a.style_group_id,a.keyword_rank,a.semantic_rank,a.rank,
      a.id,a.asset_style_group_id,a.file_type,a.status,a.workflow_status,a.stage,a.is_licensed,a.rn
    from visible_assets a
    where not (select truncated from probe_state)
       or a.rn < (select max(x.rn) from visible_assets x)
  ), matched_assets as materialized (
    select distinct a.id,a.asset_style_group_id style_group_id,a.file_type,a.status,a.workflow_status,a.stage,a.is_licensed from summary_assets a
  ), page_documents as materialized (
    select c.document_type,c.entity_id,c.asset_id,c.style_group_id,
      c.keyword_rank,c.semantic_rank,c.rank,c.rn
    from (select * from ordered_candidates order by rn) c
    where coalesce((
      select true
      from (
        select c.asset_id id where c.document_type='asset' and c.asset_id is not null
        union all
        select m.id from public.assets m
        where c.document_type='style_group' and c.style_group_id is not null
          and m.style_group_id=c.style_group_id and not m.is_deleted
      ) x
      join public.assets a on a.id = x.id
      left join public.style_groups sg on sg.id=a.style_group_id
      cross join visibility_params v
      where public.dam_asset_matches_filters(
          a.id, a.is_deleted, a.modified_at, a.file_created_at, a.thumbnail_url,
          a.style_group_id, a.licensor_id, sg.licensor_id, a.property_id, sg.property_id,
          a.customer_id, sg.customer_id, a.file_type, a.content_type, a.product_material,
          a.status, a.workflow_status, a.stage, a.is_licensed, a.asset_type, a.art_source,
          a.thumbnail_error, a.product_category, a.relative_path, a.customer, a.program,
          v.f, v.thumbnail_min_date)
      limit 1
    ), false)
    order by c.rn
    limit (select page_offset + page_limit + 1 from params)
  ), page_state as materialized (
    select count(*) visible_through_page from page_documents
  ), exact_docs as materialized (
    -- Owner ask 2026-10-29 (issue #5053): totals must be exact, never lower
    -- bounds. Count EVERY candidate document that has at least one member
    -- asset passing the same visibility predicate, short-circuiting per
    -- document (LIMIT 1) instead of enumerating every member asset: the
    -- per-document probe touches ~1 asset for asset documents and stops at
    -- the first visible member for style groups, so the exact count stays
    -- cheap even for queries with tens of thousands of candidates
    -- (measured: "spiderman" 17,223 asset docs; "disney" 52,386).
    select count(*) total_count from (
      select c.document_type, c.entity_id
      from ordered_candidates c
      where exists (
        select 1
        from (
          select c.asset_id id where c.document_type='asset' and c.asset_id is not null
          union all
          select m.id from public.assets m
          where c.document_type='style_group' and c.style_group_id is not null
            and m.style_group_id=c.style_group_id and not m.is_deleted
        ) x
        join public.assets a on a.id = x.id
        left join public.style_groups sg on sg.id=a.style_group_id
        cross join visibility_params v
        where public.dam_asset_matches_filters(
          a.id, a.is_deleted, a.modified_at, a.file_created_at, a.thumbnail_url,
          a.style_group_id, a.licensor_id, sg.licensor_id, a.property_id, sg.property_id,
          a.customer_id, sg.customer_id, a.file_type, a.content_type, a.product_material,
          a.status, a.workflow_status, a.stage, a.is_licensed, a.asset_type, a.art_source,
          a.thumbnail_error, a.product_category, a.relative_path, a.customer, a.program,
          v.f, v.thumbnail_min_date)
        limit 1
      )
    ) d
  ), summary as materialized (
    select
      (select total_count from exact_docs) total_count,
      case when (select truncated from probe_state)
        -- Facet aggregates count assets, and the probe sees only the first
        -- 1,001; past the cap the per-key counts would be lower bounds, which
        -- the owner ruled out. Emit only the exactness flags; the filter
        -- sidebar shows blanks instead of under-counts (documented fallback
        -- shape, still exact totals).
        then jsonb_build_object(
          'fileType','{}'::jsonb,'status','{}'::jsonb,'workflowStatus','{}'::jsonb,'stage','{}'::jsonb,'isLicensed','{}'::jsonb,
          'totalExact',true,'totalKind','exact')
        else jsonb_build_object(
      'fileType',coalesce((select jsonb_object_agg(k,c) from (select file_type::text k,count(*) c from matched_assets group by 1)x),'{}'::jsonb),
      'status',coalesce((select jsonb_object_agg(k,c) from (select status::text k,count(*) c from matched_assets group by 1)x),'{}'::jsonb),
      'workflowStatus',coalesce((select jsonb_object_agg(k,c) from (select workflow_status::text k,count(*) c from matched_assets where workflow_status is not null group by 1)x),'{}'::jsonb),
      'stage',coalesce((select jsonb_object_agg(k,c) from (select stage k,count(*) c from matched_assets where stage is not null group by 1)x),'{}'::jsonb),
      'isLicensed',jsonb_build_object('true',(select count(*) from matched_assets where is_licensed is true),'false',(select count(*) from matched_assets where is_licensed is not true)),
      'totalExact',true,
      'totalKind','exact'
    ) end facets
    -- from (select 1): summary is ALWAYS exactly one row, including the
    -- no-match query (total 0). Every select-list item is a scalar
    -- subquery, so a constant anchor row yields the same values as any
    -- matched_assets row would.
    from (select 1) as summary_anchor
  ), page as materialized (
    select r.document_type,r.entity_id,r.asset_id,r.style_group_id,r.keyword_rank,r.semantic_rank,r.rank
    from page_documents r order by r.rn
    offset (select page_offset from params) limit (select page_limit from params)
  )
  select p.document_type,p.entity_id,p.asset_id,p.style_group_id,p.keyword_rank,p.semantic_rank,p.rank,
    s.total_count,
    (select visible_through_page from page_state) > (select page_offset+page_limit from params),
    s.facets
  from summary s
  left join page p on true
  order by p.rank desc nulls last, p.document_type nulls last, p.entity_id nulls last;
$function$;

revoke all on function public.search_dam_documents(text, jsonb, integer, integer, text[], extensions.vector, real, real) from public;
grant execute on function public.search_dam_documents(text, jsonb, integer, integer, text[], extensions.vector, real, real) to authenticated, service_role;

-- NOW the composite overload has no callers left; drop it. Both overloads
-- coexisted above only inside this single atomic migration.
drop function if exists public.dam_asset_matches_filters(public.assets, public.style_groups, jsonb, timestamptz);

comment on function public.search_dam_documents(text, jsonb, integer, integer, text[], extensions.vector, real, real) is
  '#5053: totals are always exact (exact_docs counts every matching document); past the 1,001-row probe per-key facet counts are blanked, never lower bounds; the summary row is always returned, including no-match (total_count 0).';
