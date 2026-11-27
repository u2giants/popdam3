-- u2giants/popdam3#1430 Phase 1 Step 1 (claim popcre/shared-db#7163).
-- public.search_dam_documents:
--   * new trailing p_include_facets boolean default true. false skips visible_assets,
--     matched_assets and the facet aggregates and returns facets = '{}'; every other
--     output (ordered rows, ranks, total_count, has_more) is unchanged.
--   * new return column total_group_files bigint: exact sum of style_groups.asset_count
--     over every matching visible style-group document (same visibility as total_count,
--     independent of limit/offset); null when style groups were not requested. Replaces
--     the app's second, 200-capped search used only for this number.
--   * dam_search_named_scope(p_filters, need_asset_sets): asset sets are built only when
--     asset documents are requested.
-- The signature changes, so the function is dropped and recreated in this transaction (a
-- second overload would make PostgREST calls ambiguous). Existing callers keep working:
-- the new parameter has a default and the new column is last. SQL-language callers resolve
-- by name at run time. Owner, grants and settings restored and checked below.
-- derived-from: 20261225090101
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = pg_catalog, public, extensions;

do $guard$
begin
  if not exists (
    select 1 from pg_proc p
    where p.oid = to_regprocedure('public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real,extensions.halfvec,real,real)')
      and md5(p.prosrc) = '4a09830dafb773839a54834087a6e1d4'
  ) then
    raise exception 'DAM ranked search source differs from 20261225090101; reconcile rather than overwrite';
  end if;
  if to_regprocedure('public.dam_search_named_scope(jsonb,boolean)') is null then
    raise exception 'dam_search_named_scope(jsonb,boolean) is missing';
  end if;
end;
$guard$;

drop function public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real,extensions.halfvec,real,real);

CREATE FUNCTION public.search_dam_documents(p_query text, p_filters jsonb, p_limit integer, p_offset integer, p_document_types text[] DEFAULT NULL::text[], p_query_embedding extensions.vector DEFAULT NULL::extensions.vector, p_min_rank real DEFAULT 0, p_min_semantic_score real DEFAULT NULL::real, p_query_text_embedding extensions.halfvec DEFAULT NULL::extensions.halfvec, p_min_text_score real DEFAULT NULL::real, p_text_score_margin real DEFAULT NULL::real, p_include_facets boolean DEFAULT true)
 RETURNS TABLE(document_type text, entity_id uuid, asset_id uuid, style_group_id uuid, keyword_rank real, semantic_rank real, rank real, total_count bigint, has_more boolean, facets jsonb, text_rank real, total_group_files bigint)
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
      -- popdam3#1037 Step 6: text-meaning leg (Qwen3 vector of the typed words vs the stored
      -- description vectors). Absent = today's ranking and filtering exactly.
      (p_query_text_embedding is not null) has_text_embedding,
      -- popdam3#1037 product type: the typed words as English word forms ("framed" -> "frame").
      tsvector_to_array(to_tsvector('english',
        regexp_replace(coalesce(p_query,''), '[-_/]+', ' ', 'g'))) query_lexemes,
      dam.search_text_embedding_model() text_model,
      case when p_min_text_score is null then null
        else greatest(0,least(1,p_min_text_score))::real end min_text_score,
      -- relative text floor: keep text matches within this margin of the best in-scope text
      -- score (text-to-text scores spread wider than text-to-picture; plan O3 start 0.10).
      greatest(0,least(1,coalesce(p_text_score_margin,0.10)))::real text_score_margin,
      1000 summary_probe_limit,
      -- popdam3#892: when a search names a licensor, the caller passes its id(s) here and a
      -- document matched by its picture ALONE must belong to one of them. Keyword matches,
      -- and the picture score of a document that also matched by keyword, are untouched.
      (select array_agg(x.id::uuid)
       from jsonb_array_elements_text(
         case when jsonb_typeof(p_filters->'semanticLicensorIds')='array'
           then p_filters->'semanticLicensorIds' else '[]'::jsonb end) x(id)) semantic_licensor_ids,
      -- popdam3#1037 Step 2: named character (every leg) and property accepted set (picture-only
      -- matches), read once as sets of allowed style groups / assets (20261204003633: the
      -- per-candidate subqueries cost ~13 s on production for a character search).
      ns.character_groups, ns.character_assets, ns.property_groups, ns.property_assets,
      -- popdam3#1430: asset sets are only read by asset documents; a style-group-only
      -- search skips building them.
      coalesce(p_include_facets, true) include_facets,
      (p_document_types is null or 'style_group' = any(p_document_types)) want_group_files
    from public.dam_search_named_scope(p_filters,
      p_document_types is null or 'asset' = any(p_document_types)) ns
    where public.require_dam_access()
  ), queries as materialized (
    select q.query_text, websearch_to_tsquery('simple', regexp_replace(q.query_text, '[-_/]+', ' ', 'g')) tsq,
      -- popdam3#1037 Step 7: the same words in English word forms ("frames" ~ "framed" ~ "frame")
      -- and the recognised names in it, which must still be present in their exact form.
      websearch_to_tsquery('english', regexp_replace(q.query_text, '[-_/]+', ' ', 'g')) tsq_en,
      public.dam_search_exact_names(q.query_text, p_filters) names_tsq,
      '%' || replace(replace(replace(q.query_text, '\', '\\'), '%', '\%'), '_', '\_') || '%' like_pattern,
      (length(q.query_text) >= 3 and q.query_text ~ '[[:alnum:]]{3,}'
        and (length(q.query_text) >= 4 or q.query_text ~ '[0-9]')) allow_substring
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
  ), exact_text_matches as materialized (
    -- A nullable type predicate in the generic plan filters after the heap read.
    -- The normal style-group request can intersect the indexes before that read.
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,d.title,d.title_key,d.title_tsv
    from public.dam_search_keys d
    where p_document_types = array['style_group']::text[] and d.document_type = 'style_group'
      and d.search_tsv @@ any(array(select distinct q.tsq from queries q))
    union all
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,d.title,d.title_key,d.title_tsv
    from public.dam_search_keys d
    where p_document_types is distinct from array['style_group']::text[] and (p_document_types is null or d.document_type = any(p_document_types))
      and d.search_tsv @@ any(array(select distinct q.tsq from queries q))
  ), word_form_keys as materialized (
    -- popdam3#1037 Step 7 performance (20261218093000): the GIN index alone proves the word-form
    -- match, so no per-row re-test here (re-testing detoasted ~10.7k word lists: 8.8 s cold for
    -- "frame"). Only narrow key columns are read. The named-character scope (applied to every leg
    -- in candidate_pool anyway) is applied here too so the cap below never drops an in-scope row.
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,greatest(length(d.title_key),1) key_len
    from public.dam_search_keys d
    where p_document_types = array['style_group']::text[] and d.document_type = 'style_group'
      and d.search_tsv_en @@ any(array(select distinct q.tsq_en from queries q where q.tsq_en::text <> ''))
      and ((select character_groups from params) is null
        or d.style_group_id = any((select character_groups from params)::uuid[])
        or d.asset_id = any((select character_assets from params)::uuid[]))
      -- Both sides use the same NOT NULL primary key from dam_search_keys. Hash the
      -- exact keys once instead of comparing every stem match with the materialized CTE.
      and (d.document_type, d.entity_id) not in (
        select e.document_type, e.entity_id from exact_text_matches e)
    union all
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,greatest(length(d.title_key),1) key_len
    from public.dam_search_keys d
    where p_document_types is distinct from array['style_group']::text[] and (p_document_types is null or d.document_type = any(p_document_types))
      and d.search_tsv_en @@ any(array(select distinct q.tsq_en from queries q where q.tsq_en::text <> ''))
      and ((select character_groups from params) is null
        or d.style_group_id = any((select character_groups from params)::uuid[])
        or d.asset_id = any((select character_assets from params)::uuid[]))
      -- Both sides use the same NOT NULL primary key from dam_search_keys. Hash the
      -- exact keys once instead of comparing every stem match with the materialized CTE.
      and (d.document_type, d.entity_id) not in (
        select e.document_type, e.entity_id from exact_text_matches e)
  ), word_form_matches as materialized (
    -- The per-query test is needed only when a recognised name must also be present in its exact
    -- form; it then runs on the surviving rows only.
    select w.*, row_number() over (order by w.key_len, w.document_type, w.entity_id) wf_rn
    from word_form_keys w
    where not exists (select 1 from queries q where q.names_tsq is not null)
       or exists (select 1 from public.dam_search_keys d join queries q on q.tsq_en::text <> ''
         where d.document_type = w.document_type and d.entity_id = w.entity_id
           and d.search_tsv_en @@ q.tsq_en
           and (q.names_tsq is null or d.search_tsv @@ q.names_tsq))
  ), word_form_cap as materialized (
    -- Word-form-only rows score 0.05-0.09, below every exact match. Unfiltered (and min rank
    -- <= 0.05): rank only the best greatest(300, offset+limit+1) of them (shortest title first =
    -- highest word-form score), or none when exact matches already fill twice the requested
    -- page plus 50. The rest still count toward the exact total (word_form_overflow below).
    -- Any filter: no cap (filters are applied later, so every row may be needed).
    select case
      when (coalesce(p_filters,'{}'::jsonb)-'search'-'semanticLicensorIds'
        -'requiredCharacterIds'-'requiredLegacyCharacterIds'-'requiredCharacterNames'
        -'semanticPropertyIds'-'semanticPropertyCharacterIds') = '{}'::jsonb
       and (select min_rank from params) <= 0.05
      then case
        when (select count(*) from exact_text_matches)
             >= 2 * (select page_offset + page_limit from params) + 50 then 0
        else greatest(300, (select page_offset + page_limit + 1 from params)) end
      else null end::bigint cap
  ), full_text_matches as materialized (
    -- popdam3#1037 Step 7: exact words first (today's index and score); then documents that match
    -- only by English word form (search_tsv_en), scored below every exact match. A recognised
    -- character, licensor or property name in the query must still appear in its exact form.
    select e.*, false stem_only from exact_text_matches e
    union all
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,d.title,d.title_key,d.title_tsv,true
    from word_form_matches w
    join public.dam_search_keys d on d.document_type = w.document_type and d.entity_id = w.entity_id
    where w.wf_rn <= coalesce((select cap from word_form_cap), w.wf_rn)
  ), substring_matches as materialized (
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,d.title,d.path,d.customer,d.program,d.title_key,d.title_tsv
    from substring_regex r
    join public.dam_search_keys d on r.rx is not null and
      (d.title ~* r.rx or d.path ~* r.rx or d.customer ~* r.rx or d.program ~* r.rx)
    where p_document_types = array['style_group']::text[] and d.document_type = 'style_group'
    union all
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,d.title,d.path,d.customer,d.program,d.title_key,d.title_tsv
    from substring_regex r
    join public.dam_search_keys d on r.rx is not null and
      (d.title ~* r.rx or d.path ~* r.rx or d.customer ~* r.rx or d.program ~* r.rx)
    where p_document_types is distinct from array['style_group']::text[] and (p_document_types is null or d.document_type = any(p_document_types))
  ), keyword_features as materialized (
    select m.document_type,m.entity_id,m.asset_id,m.style_group_id,m.in_substring,
      m.title,m.path,m.customer,m.program,
      m.title_key,m.title_tsv,m.stem_only
    from (
      select f.document_type,f.entity_id,f.asset_id,f.style_group_id,f.title,f.title_key,f.title_tsv,
        s.path,s.customer,s.program,(s.entity_id is not null) in_substring,
        (f.stem_only and s.entity_id is null) stem_only
      from full_text_matches f
      left join substring_matches s
        on s.document_type = f.document_type and s.entity_id = f.entity_id
      union all
      select s.document_type,s.entity_id,s.asset_id,s.style_group_id,s.title,s.title_key,s.title_tsv,
        s.path,s.customer,s.program,true,false
      from substring_matches s
      where not exists (
        select 1 from full_text_matches f
        where f.document_type = s.document_type and f.entity_id = s.entity_id)
    ) m
  ), keyword_candidates as materialized (
    select k.document_type,k.entity_id,k.asset_id,k.style_group_id,
      (select max(
        -- popdam3#1037 Step 7: a word-form-only match scores 0.05-0.09, below every exact match
        -- (an exact match is at least 0.1 plus a positive length term).
        case when k.stem_only then
          0.05 + 0.04 * least(1.0, length(q.normalized_query)::numeric / greatest(length(k.title_key),1))
        else
        case
          when k.title_key = q.normalized_query then 1.0
          when k.in_substring and k.title ilike any(q.like_patterns) then 0.6
          when k.title_tsv @@ q.tsq then 0.45
          when k.in_substring and k.path ilike any(q.like_patterns) then 0.3
          when k.in_substring and (k.customer ilike any(q.like_patterns) or k.program ilike any(q.like_patterns)) then 0.2
          else 0.1
        end
        + 0.09 * least(1.0, length(q.normalized_query)::numeric / greatest(length(k.title_key),1))
        end
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
    -- This constant test must stay in WHERE: it becomes a one-time filter that
    -- skips the scan. Behind only the params join, a keyword-only call (null
    -- embedding) walks ~24k HNSW tuples for nothing: 19 s, up to the 30 s limit.
    where p_query_embedding is not null
      and (p_document_types is null
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
    join dam.search_group_vectors d
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
  ), text_ann_raw as materialized (
    -- popdam3#1037 Step 6 text leg, HNSW over every document (used whenever assets are searched).
    -- Same shape as semantic_ann: the constant test stays in WHERE so a null text vector skips the
    -- scan; distance order only; the floor is applied later so it never extends the walk.
    select v.document_type,v.entity_id,
      greatest(0,1-(v.embedding <=> p_query_text_embedding))::real text_rank
    from dam.search_text_vectors v
    where p_query_text_embedding is not null
      and (p_document_types is null
        or exists (select 1 from unnest(p_document_types) t where t is distinct from 'style_group'))
      and (p_document_types is null or v.document_type = any(p_document_types))
      and v.model = (select text_model from params)
    order by v.embedding <=> p_query_text_embedding
    limit 300
  ), text_exact_raw as materialized (
    -- Style-group-only searches walk the style-group partial HNSW; the literal document_type is
    -- what matches its predicate (a parameter here would miss the index, cf. semantic_exact).
    select v.document_type,v.entity_id,
      greatest(0,1-(v.embedding <=> p_query_text_embedding))::real text_rank
    from dam.search_text_vectors v
    where p_query_text_embedding is not null
      and p_document_types is not null and not ('asset' = any(p_document_types))
      and 'style_group' = any(p_document_types)
      and v.document_type = 'style_group'  -- literal: matches the partial index predicate
      and v.model = (select text_model from params)
    order by v.embedding <=> p_query_text_embedding
    limit 300
  ), text_candidates as materialized (
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,t.text_rank
    from (select * from text_ann_raw union all select * from text_exact_raw) t
    join public.dam_search_documents d
      on d.document_type = t.document_type and d.entity_id = t.entity_id
    cross join params p
    where p.min_text_score is null or t.text_rank >= p.min_text_score
  ), candidate_pool as materialized (
    -- Scope rules (licensor #892, property and named character #1037) are applied here, before
    -- the text floor, so the text anchor is the best IN-SCOPE text score (#6024 lesson). A
    -- candidate without an exact-word match (picture or text only) must satisfy the licensor and
    -- property scopes; the named-character rule applies to every leg.
    select c.document_type,c.entity_id,c.asset_id,c.style_group_id,max(c.keyword_rank)::real keyword_rank,
      max(c.semantic_rank)::real semantic_rank, max(c.text_rank)::real text_rank_raw
    from (select k.*,null::real semantic_rank,null::real text_rank from keyword_candidates k union all
      select s.document_type,s.entity_id,s.asset_id,s.style_group_id,null::real,s.semantic_rank,null::real from semantic_candidates s union all
      select t.document_type,t.entity_id,t.asset_id,t.style_group_id,null::real,null::real,t.text_rank from text_candidates t) c
    group by c.document_type,c.entity_id,c.asset_id,c.style_group_id
    having ((select semantic_licensor_ids from params) is null
        or max(c.keyword_rank) is not null
        -- a grouped document takes its style group's licensor, an ungrouped asset its own
        or exists (select 1 from public.style_groups g
          where g.id = c.style_group_id
            and g.licensor_id = any((select semantic_licensor_ids from params)::uuid[]))
        or (c.style_group_id is null and exists (select 1 from public.assets a
          where a.id = c.asset_id
            and a.licensor_id = any((select semantic_licensor_ids from params)::uuid[]))))
      -- popdam3#1037: property accepted set, picture-only matches only.
      and ((select property_groups from params) is null
        or max(c.keyword_rank) is not null
        or c.style_group_id = any((select property_groups from params)::uuid[])
        or (c.style_group_id is null and c.asset_id = any((select property_assets from params)::uuid[])))
      -- popdam3#1037: named character, every leg.
      and ((select character_groups from params) is null
        or c.style_group_id = any((select character_groups from params)::uuid[])
        or c.asset_id = any((select character_assets from params)::uuid[]))
  ), text_floor as materialized (
    select greatest(coalesce((select min_text_score from params),0),
      max(c.text_rank_raw) - (select text_score_margin from params))::real floor
    from candidate_pool c
  ), classified as materialized (
    select c.document_type,c.entity_id,c.asset_id,c.style_group_id,c.keyword_rank,c.semantic_rank,
      (case when c.text_rank_raw >= (select floor from text_floor) then c.text_rank_raw end)::real text_rank
    from candidate_pool c
  ), visibility_params_raw as materialized (
    -- semanticLicensorIds and the #1037 character/property scopes are not visibility filters
    -- (they are applied to candidates above): strip them so the unfiltered fast paths still apply.
    select coalesce(p_filters,'{}'::jsonb)-'search'-'semanticLicensorIds'
      -'requiredCharacterIds'-'requiredLegacyCharacterIds'-'requiredCharacterNames'
      -'semanticPropertyIds'-'semanticPropertyCharacterIds' f,
    public.assets_thumbnail_min_date() thumbnail_min_date
  ), visibility_params_typed as materialized (
    -- 20261218230700 (popdam3#1037): the filter values are read ONCE by
    -- public.dam_search_filter_pretest_values for a cheap typed pre-test in front of every call
    -- of the per-asset helper. Each pre-test is implied by that helper (same values, same
    -- comparisons), so it only skips rows the helper would reject; the helper still decides
    -- every row that passes. Measured: "frame" with a licensor filter sent ~22k member assets
    -- through the helper in each of three passes (13-35 s).
    select r.f, r.thumbnail_min_date, t.*
    -- (a function in FROM is implicitly lateral)
    from visibility_params_raw r, public.dam_search_filter_pretest_values(r.f) t
  ), visibility_params as materialized (
    -- One switch, and one opaque CASE at each call site: the planner keeps the row estimates (and
    -- so the plan shapes) it had for the function call alone; 13 separate tests made it expect one
    -- row and sort every member asset instead of stopping at the first 1,001 (measured 98 s).
    -- pf_on is true when any pre-test value is present.
    select x.*
    from visibility_params_typed x
  ), justified_visible as materialized (
    -- popdam3#1037 Step 6 picture demotion: when the text leg is on, a match by picture ALONE (no
    -- exact-word match, no text match above the floor) is kept only when the word and text legs
    -- together found fewer than 10 visible results. Counting stops at 10.
    select count(*) n from (
      select 1
      from classified c
      where (select has_text_embedding from params)
        and (c.keyword_rank is not null or c.text_rank is not null)
        and exists (
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
          where (case when v.pf_on then ((v.pf_licensor is null or case when a.style_group_id is null then a.licensor_id else sg.licensor_id end = v.pf_licensor)
          and (v.pf_property is null or case when a.style_group_id is null then a.property_id else sg.property_id end = v.pf_property)
          and (v.pf_customer_id is null or case when a.style_group_id is null then a.customer_id else sg.customer_id end = v.pf_customer_id)
          and (v.pf_file_type is null or a.file_type::text = any(v.pf_file_type))
          and (v.pf_content_type is null or a.content_type = any(v.pf_content_type))
          and (v.pf_status is null or a.status::text = any(v.pf_status))
          and (v.pf_workflow_status is null or a.workflow_status::text = any(v.pf_workflow_status))
          and (v.pf_stage is null or a.stage = any(v.pf_stage))
          and (v.pf_asset_type is null or a.asset_type::text = any(v.pf_asset_type))
          and (v.pf_art_source is null or a.art_source::text = any(v.pf_art_source))
          and (v.pf_is_licensed is null or a.is_licensed = v.pf_is_licensed)
          and (v.pf_customer is null or a.customer = v.pf_customer)
          and (v.pf_program is null or a.program = v.pf_program)) else true end)
          and public.dam_asset_matches_filters(
            a.id, a.is_deleted, a.modified_at, a.file_created_at, a.thumbnail_url,
            a.style_group_id, a.licensor_id, sg.licensor_id, a.property_id, sg.property_id,
            a.customer_id, sg.customer_id, a.file_type, a.content_type, a.product_material,
            a.status, a.workflow_status, a.stage, a.is_licensed, a.asset_type, a.art_source,
            a.thumbnail_error, a.product_category, a.relative_path, a.customer, a.program,
            v.f, v.thumbnail_min_date))
      limit 10
    ) j
  ), product_types as materialized (
    -- popdam3#1037 product type (owner, Nov 17): a product whose own text merely mentions a typed
    -- word ("a lap desk ... in a frame pattern") is shown but ranks below products OF that type.
    -- A product's type is its recorded merchandise group and category names, as English word
    -- forms. Text leg on only. A file inside a product takes its product's type; an ungrouped
    -- file has no recorded type and is never moved. This is a 0.15 ranking step, not a guarantee
    -- that every mention-only product sorts below every product of the type.
    select c.document_type,c.entity_id,
      tsvector_to_array(to_tsvector('english', regexp_replace(
        concat_ws(' ',g.mg01_name,g.mg02_name,g.mg03_name,g.product_category), '[-_/]+', ' ', 'g'))) type_lexemes
    from classified c
    join public.style_groups g on g.id = c.style_group_id
    where (select has_text_embedding from params)
      and cardinality((select query_lexemes from params)) > 0
  ), named_type as materialized (
    -- The words name a product type when at least one word or text match (a candidate returned
    -- without the picture rule) has a type containing one of them.
    select exists (select 1 from product_types t
      join classified c on c.document_type = t.document_type and c.entity_id = t.entity_id
      where (c.keyword_rank is not null or c.text_rank is not null)
        and t.type_lexemes && (select query_lexemes from params)) yes
  ), candidate_ranks as materialized (
    -- Text leg off: rank = keyword + 0.35 x picture (unchanged). On (plan O3 start):
    -- rank = keyword + 0.6 x text + 0.15 x picture, minus up to 0.15 for a product whose recorded
    -- type is known and is not the type the words name. The minimum rank is tested before the
    -- step and the step never takes a rank below it: it only reorders (never hides), and every
    -- returned rank still meets the minimum.
    select r.document_type,r.entity_id,r.asset_id,r.style_group_id,r.keyword_rank,r.semantic_rank,r.text_rank,
      (r.rank - least(r.type_step, r.rank - (select min_rank from params)))::real rank
    from (
      select c.document_type,c.entity_id,c.asset_id,c.style_group_id,c.keyword_rank,c.semantic_rank,c.text_rank,
        (coalesce(c.keyword_rank,0) + case when (select has_text_embedding from params)
          then coalesce(c.text_rank,0) * 0.6 + coalesce(c.semantic_rank,0) * 0.15
          else coalesce(c.semantic_rank,0) * 0.35 end)::real rank,
        case when (select yes from named_type) and cardinality(t.type_lexemes) > 0
          and not (t.type_lexemes && (select query_lexemes from params)) then 0.15 else 0 end type_step
      from classified c
      left join product_types t on t.document_type = c.document_type and t.entity_id = c.entity_id
      where not (select has_text_embedding from params)
         or c.keyword_rank is not null or c.text_rank is not null
         -- a text match below the floor is no match; a picture-only match needs the < 10 rule
         or (c.semantic_rank is not null and (select n from justified_visible) < 10)
    ) r
    where r.rank >= (select min_rank from params)
  ), ordered_candidates as materialized (
    select c.document_type,c.entity_id,c.asset_id,c.style_group_id,c.keyword_rank,c.semantic_rank,c.rank,c.text_rank,
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
  ), visible_assets as materialized (
    select c.document_type,c.entity_id,c.asset_id,c.style_group_id,c.keyword_rank,c.semantic_rank,c.rank,
      a.id, a.style_group_id asset_style_group_id, a.file_type, a.status,
      a.workflow_status, a.stage, a.is_licensed, c.rn
    from candidate_asset_ids c
    join public.assets a on a.id = c.id
    left join public.style_groups sg on sg.id=a.style_group_id
    cross join visibility_params v
    where (case when v.pf_on then ((v.pf_licensor is null or case when a.style_group_id is null then a.licensor_id else sg.licensor_id end = v.pf_licensor)
          and (v.pf_property is null or case when a.style_group_id is null then a.property_id else sg.property_id end = v.pf_property)
          and (v.pf_customer_id is null or case when a.style_group_id is null then a.customer_id else sg.customer_id end = v.pf_customer_id)
          and (v.pf_file_type is null or a.file_type::text = any(v.pf_file_type))
          and (v.pf_content_type is null or a.content_type = any(v.pf_content_type))
          and (v.pf_status is null or a.status::text = any(v.pf_status))
          and (v.pf_workflow_status is null or a.workflow_status::text = any(v.pf_workflow_status))
          and (v.pf_stage is null or a.stage = any(v.pf_stage))
          and (v.pf_asset_type is null or a.asset_type::text = any(v.pf_asset_type))
          and (v.pf_art_source is null or a.art_source::text = any(v.pf_art_source))
          and (v.pf_is_licensed is null or a.is_licensed = v.pf_is_licensed)
          and (v.pf_customer is null or a.customer = v.pf_customer)
          and (v.pf_program is null or a.program = v.pf_program)) else true end)
          and public.dam_asset_matches_filters(
          a.id, a.is_deleted, a.modified_at, a.file_created_at, a.thumbnail_url,
          a.style_group_id, a.licensor_id, sg.licensor_id, a.property_id, sg.property_id,
          a.customer_id, sg.customer_id, a.file_type, a.content_type, a.product_material,
          a.status, a.workflow_status, a.stage, a.is_licensed, a.asset_type, a.art_source,
          a.thumbnail_error, a.product_category, a.relative_path, a.customer, a.program,
          v.f, v.thumbnail_min_date)
    order by c.rn
    limit (select summary_probe_limit + 1 from params)
  ), default_candidate_flags as materialized (
    -- The primary key proves at most one matching document. Keep this lookup
    -- correlated so a broad candidate estimate cannot scan an entire type's flags.
    select c.rn, d.has_default_visible_member, d.default_visible_member_count,
      (d.has_default_visible_member is not null
        and d.default_visible_min_date = v.thumbnail_min_date
        and d.asset_id is not distinct from c.asset_id
        and d.style_group_id is not distinct from c.style_group_id) is_current
    from visibility_params v
    join ordered_candidates c on v.f = '{}'::jsonb
    left join lateral (
      select r.has_default_visible_member, r.default_visible_member_count,
        r.default_visible_min_date, r.asset_id, r.style_group_id
      from public.dam_search_documents r
      where r.document_type = c.document_type and r.entity_id = c.entity_id
      limit 1
    ) d on true
  ), default_flag_state as materialized (
    -- Keep the exact totals and facet truncation proof from #5747 and #5938.
    select count(*) filter (where d.has_default_visible_member) flagged_visible,
      coalesce(sum(d.default_visible_member_count), 0) visible_member_rows,
      coalesce(bool_and(d.default_visible_member_count is not null), true) all_counts_current,
      coalesce(bool_and(d.is_current), true) all_current
    from default_candidate_flags d
  ), probe_state as materialized (
    -- #5747 stage profile (production, 2026-11-06): for broad queries the
    -- visibility probe below (member fan-out + one assets fetch per visible
    -- row) cost ~1.0 s of the 2.4 s function body, and every consumer of that
    -- probe either discards its output when it truncates (facets blank
    -- fallback) or is answered elsewhere (exact totals from the flag fast
    -- path above, page rows and has_more from page_documents). When the
    -- request is unfiltered and every candidate flag is current,
    -- flagged_visible is exactly the number of candidate documents with >= 1
    -- probe-visible member asset (same predicate, same min date), so
    -- flagged_visible > summary_probe_limit already proves the probe would
    -- truncate. Return truncated = true and never build visible_assets. Any
    -- doubt (filters present, stale flags) runs the original probe unchanged.
    select case
      -- popdam3#1430: facets not requested -> never build visible_assets.
      when not (select include_facets from params) then true
      when (select f from visibility_params) = '{}'::jsonb
       and coalesce((select all_current from default_flag_state), true)
       and (coalesce((select flagged_visible from default_flag_state), 0)
              > (select summary_probe_limit from params)
         -- #5938 profile (production, 2026-11-08): broad queries with < 1,000
         -- candidate documents but > 1,000 member assets still built
         -- visible_assets (~1,000 assets heap fetches, 0.9-1.3 s, most of the
         -- slow tail) only to learn it truncates. The member-asset count
         -- proves the same thing without touching assets.
         or (coalesce((select all_counts_current from default_flag_state), true)
             and coalesce((select visible_member_rows from default_flag_state), 0)
                 > (select summary_probe_limit from params)))
      then true
      else (select count(*) > (select summary_probe_limit from params) from visible_assets)
    end truncated
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
      c.keyword_rank,c.semantic_rank,c.rank,c.text_rank,c.rn
    from (select * from ordered_candidates order by rn) c
    left join default_candidate_flags f on f.rn = c.rn
    -- Current flags use the same unfiltered visibility predicate as this probe.
    -- Filtered requests and stale or missing flags still inspect the members.
    where case when f.is_current then f.has_default_visible_member else coalesce((
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
      where (case when v.pf_on then ((v.pf_licensor is null or case when a.style_group_id is null then a.licensor_id else sg.licensor_id end = v.pf_licensor)
          and (v.pf_property is null or case when a.style_group_id is null then a.property_id else sg.property_id end = v.pf_property)
          and (v.pf_customer_id is null or case when a.style_group_id is null then a.customer_id else sg.customer_id end = v.pf_customer_id)
          and (v.pf_file_type is null or a.file_type::text = any(v.pf_file_type))
          and (v.pf_content_type is null or a.content_type = any(v.pf_content_type))
          and (v.pf_status is null or a.status::text = any(v.pf_status))
          and (v.pf_workflow_status is null or a.workflow_status::text = any(v.pf_workflow_status))
          and (v.pf_stage is null or a.stage = any(v.pf_stage))
          and (v.pf_asset_type is null or a.asset_type::text = any(v.pf_asset_type))
          and (v.pf_art_source is null or a.art_source::text = any(v.pf_art_source))
          and (v.pf_is_licensed is null or a.is_licensed = v.pf_is_licensed)
          and (v.pf_customer is null or a.customer = v.pf_customer)
          and (v.pf_program is null or a.program = v.pf_program)) else true end)
          and public.dam_asset_matches_filters(
          a.id, a.is_deleted, a.modified_at, a.file_created_at, a.thumbnail_url,
          a.style_group_id, a.licensor_id, sg.licensor_id, a.property_id, sg.property_id,
          a.customer_id, sg.customer_id, a.file_type, a.content_type, a.product_material,
          a.status, a.workflow_status, a.stage, a.is_licensed, a.asset_type, a.art_source,
          a.thumbnail_error, a.product_category, a.relative_path, a.customer, a.program,
          v.f, v.thumbnail_min_date)
      limit 1
    ), false) end
    order by c.rn
    limit (select page_offset + page_limit + 1 from params)
  ), page_state as materialized (
    select count(*) visible_through_page from page_documents
  ), word_form_overflow as materialized (
    -- 20261218093000: word-form-only rows left out by word_form_cap (unfiltered requests only)
    -- still count toward the exact total (owner ask #5053): a maintained flag when current,
    -- otherwise the same per-document visibility probe. Rows another leg already brought in are
    -- counted by exact_docs and skipped here.
    select count(*) n,
      -- popdam3#1430: whole-group file total of the same overflow rows.
      coalesce(sum(wsg.asset_count) filter (where w.document_type = 'style_group'), 0)::bigint group_files
    from word_form_matches w
    left join public.dam_search_documents d
      on d.document_type = w.document_type and d.entity_id = w.entity_id
    left join public.style_groups wsg
      on w.document_type = 'style_group' and wsg.id = w.style_group_id
    cross join visibility_params v
    where w.wf_rn > coalesce((select cap from word_form_cap), w.wf_rn)
      and not exists (select 1 from ordered_candidates c
        where c.document_type = w.document_type and c.entity_id = w.entity_id)
      and case
        when d.has_default_visible_member is not null
         and d.default_visible_min_date = v.thumbnail_min_date
         and d.asset_id is not distinct from w.asset_id
         and d.style_group_id is not distinct from w.style_group_id
        then d.has_default_visible_member
        else exists (
          select 1
          from (
            select w.asset_id id where w.document_type='asset' and w.asset_id is not null
            union all
            select m.id from public.assets m
            where w.document_type='style_group' and w.style_group_id is not null
              and m.style_group_id=w.style_group_id and not m.is_deleted
          ) x
          join public.assets a on a.id = x.id
          left join public.style_groups sg on sg.id=a.style_group_id
          where (case when v.pf_on then ((v.pf_licensor is null or case when a.style_group_id is null then a.licensor_id else sg.licensor_id end = v.pf_licensor)
          and (v.pf_property is null or case when a.style_group_id is null then a.property_id else sg.property_id end = v.pf_property)
          and (v.pf_customer_id is null or case when a.style_group_id is null then a.customer_id else sg.customer_id end = v.pf_customer_id)
          and (v.pf_file_type is null or a.file_type::text = any(v.pf_file_type))
          and (v.pf_content_type is null or a.content_type = any(v.pf_content_type))
          and (v.pf_status is null or a.status::text = any(v.pf_status))
          and (v.pf_workflow_status is null or a.workflow_status::text = any(v.pf_workflow_status))
          and (v.pf_stage is null or a.stage = any(v.pf_stage))
          and (v.pf_asset_type is null or a.asset_type::text = any(v.pf_asset_type))
          and (v.pf_art_source is null or a.art_source::text = any(v.pf_art_source))
          and (v.pf_is_licensed is null or a.is_licensed = v.pf_is_licensed)
          and (v.pf_customer is null or a.customer = v.pf_customer)
          and (v.pf_program is null or a.program = v.pf_program)) else true end)
          and public.dam_asset_matches_filters(
            a.id, a.is_deleted, a.modified_at, a.file_created_at, a.thumbnail_url,
            a.style_group_id, a.licensor_id, sg.licensor_id, a.property_id, sg.property_id,
            a.customer_id, sg.customer_id, a.file_type, a.content_type, a.product_material,
            a.status, a.workflow_status, a.stage, a.is_licensed, a.asset_type, a.art_source,
            a.thumbnail_error, a.product_category, a.relative_path, a.customer, a.program,
            v.f, v.thumbnail_min_date)
          limit 1)
      end
  ), probed_visible_docs as materialized (
    -- Every candidate document with at least one member asset passing the
    -- visibility predicate (short-circuit per document, LIMIT 1). Read only
    -- when the flag fast path below does not apply.
    select c.document_type, c.entity_id, c.style_group_id
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
            where (case when v.pf_on then ((v.pf_licensor is null or case when a.style_group_id is null then a.licensor_id else sg.licensor_id end = v.pf_licensor)
          and (v.pf_property is null or case when a.style_group_id is null then a.property_id else sg.property_id end = v.pf_property)
          and (v.pf_customer_id is null or case when a.style_group_id is null then a.customer_id else sg.customer_id end = v.pf_customer_id)
          and (v.pf_file_type is null or a.file_type::text = any(v.pf_file_type))
          and (v.pf_content_type is null or a.content_type = any(v.pf_content_type))
          and (v.pf_status is null or a.status::text = any(v.pf_status))
          and (v.pf_workflow_status is null or a.workflow_status::text = any(v.pf_workflow_status))
          and (v.pf_stage is null or a.stage = any(v.pf_stage))
          and (v.pf_asset_type is null or a.asset_type::text = any(v.pf_asset_type))
          and (v.pf_art_source is null or a.art_source::text = any(v.pf_art_source))
          and (v.pf_is_licensed is null or a.is_licensed = v.pf_is_licensed)
          and (v.pf_customer is null or a.customer = v.pf_customer)
          and (v.pf_program is null or a.program = v.pf_program)) else true end)
          and public.dam_asset_matches_filters(
              a.id, a.is_deleted, a.modified_at, a.file_created_at, a.thumbnail_url,
              a.style_group_id, a.licensor_id, sg.licensor_id, a.property_id, sg.property_id,
              a.customer_id, sg.customer_id, a.file_type, a.content_type, a.product_material,
              a.status, a.workflow_status, a.stage, a.is_licensed, a.asset_type, a.art_source,
              a.thumbnail_error, a.product_category, a.relative_path, a.customer, a.program,
              v.f, v.thumbnail_min_date)
            limit 1
          )
  ), exact_docs as materialized (
    -- Owner ask 2026-10-29 (issue #5053): totals must be exact, never lower
    -- bounds. Fast path (#5747): unfiltered request with every flag current
    -- -> count maintained flags. Otherwise count probed_visible_docs.
    -- popdam3#1430: total_group_files = exact sum of style_groups.asset_count
    -- over the same visible style-group documents (null when style groups
    -- were not requested), independent of page limit/offset.
    select
      case when x.fast then coalesce((select flagged_visible from default_flag_state), 0)
        else (select count(*) from probed_visible_docs) end total_count,
      case when not (select want_group_files from params) then null::bigint
        when x.fast then (
          select coalesce(sum(sg.asset_count), 0)::bigint
          from default_candidate_flags f
          join ordered_candidates c on c.rn = f.rn
          join public.style_groups sg on sg.id = c.style_group_id
          where f.has_default_visible_member and c.document_type = 'style_group')
        else (
          select coalesce(sum(sg.asset_count), 0)::bigint
          from probed_visible_docs p
          join public.style_groups sg on sg.id = p.style_group_id
          where p.document_type = 'style_group')
      end total_group_files
    from (select (select f from visibility_params) = '{}'::jsonb
       and coalesce((select all_current from default_flag_state), true) fast) x
  ), summary as materialized (
    select
      ((select total_count from exact_docs) + (select n from word_form_overflow)) total_count,
      ((select total_group_files from exact_docs) + (select group_files from word_form_overflow)) total_group_files,
      case when not (select include_facets from params) then '{}'::jsonb
      when (select truncated from probe_state)
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
    select r.document_type,r.entity_id,r.asset_id,r.style_group_id,r.keyword_rank,r.semantic_rank,r.rank,r.text_rank
    from page_documents r order by r.rn
    offset (select page_offset from params) limit (select page_limit from params)
  )
  select p.document_type,p.entity_id,p.asset_id,p.style_group_id,p.keyword_rank,p.semantic_rank,p.rank,
    s.total_count,
    (select visible_through_page from page_state) > (select page_offset+page_limit from params),
    s.facets, p.text_rank, s.total_group_files
  from summary s
  left join page p on true
  order by p.rank desc nulls last, p.document_type nulls last, p.entity_id nulls last;
$function$;

alter function public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real,extensions.halfvec,real,real,boolean) owner to postgres;
revoke all on function public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real,extensions.halfvec,real,real,boolean) from public, anon;
grant execute on function public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real,extensions.halfvec,real,real,boolean) to service_role;
grant execute on function public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real,extensions.halfvec,real,real,boolean) to authenticated;

do $guard$
declare
  f regprocedure := to_regprocedure('public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real,extensions.halfvec,real,real,boolean)');
begin
  if f is null
     or (select count(*) from pg_proc where proname = 'search_dam_documents' and pronamespace = 'public'::regnamespace) <> 1
     or not exists (select 1 from pg_proc p where p.oid = f
       and md5(p.prosrc) = 'a12bfb6494629b701b71cb6c39d377dd'
       and pg_get_userbyid(p.proowner) = 'postgres'
       and p.prosecdef and p.provolatile = 's' and p.proretset
       and p.proconfig = ARRAY['search_path=public, extensions','statement_timeout=30s']::text[])
     or has_function_privilege('anon', f, 'execute')
     or not has_function_privilege('authenticated', f, 'execute')
     or not has_function_privilege('service_role', f, 'execute') then
    raise exception 'popdam3#1430: installed search contract differs; reconcile before release';
  end if;
end;
$guard$;

notify pgrst, 'reload schema';

commit;
