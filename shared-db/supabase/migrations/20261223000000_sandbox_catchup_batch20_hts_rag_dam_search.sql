-- Sandbox catch-up batch 20 (#6472): DesignFlow sandbox (xupnyeifmpsacrqahwwm) ONLY. Never apply to shared preview or production.
-- Replaces batch 19 (20261220000000, blocked on the sandbox route): its apply (run 44441411258) failed because it
-- skipped links of the search_dam_documents chain. Replays production's 20261204000400, 000501, 003329, 003429,
-- 003530, 003532, 003632, 003633, 20261218043336, 084103, 084203, 084706, 084707, 090000, 093000 and 230700 in
-- production order, unchanged except that grants and policies naming production service logins (designflow_hts_*,
-- dam_image_embed_worker; excluded from the sandbox by #6356) are omitted, revokes drop only those names, and the
-- 003429 verify skips the worker check when the worker is absent.
-- derived-from: none

-- ===== replay of 20261204000400_hts_rag_product_embeddings.sql =====
-- popcre/designflow-backend#278 (plan_hts-4-upgrades.md Phase 3 steps 1-2): a separate,
-- versioned store of product-phrase embeddings for nearest-product retrieval.
--
-- hts_rag_ruling_products.phrase_embedding is already filled by a writer and model nobody
-- can identify, so #278 neither overwrites nor uses it. Each row here records its model,
-- so queries embed with the same model. Workers select/insert/delete only (no UPDATE):
-- a re-embed is a new embed_version, or delete+insert (plan §8a item 12).

create table hts_rag.hts_rag_product_embeddings (
  product_id uuid not null,
  embed_version text not null,
  source_environment text not null,
  ruling_number text not null,
  model text not null,
  text_hash text not null,
  embedding extensions.halfvec(768) not null,
  created_at timestamptz not null default now(),
  constraint hts_rag_product_embeddings_pkey primary key (product_id, embed_version, source_environment),
  constraint hts_rag_product_embeddings_product_fkey foreign key (product_id)
    references hts_rag.hts_rag_ruling_products(id) on delete cascade,
  constraint hts_rag_product_embeddings_source_environment_chk check (source_environment in ('production', 'alsand'))
);
comment on table hts_rag.hts_rag_product_embeddings is
  'Product-phrase embeddings per embed_version (model recorded per row); insert/delete only (no worker UPDATE). designflow-backend#278 plan_hts-4-upgrades.md Phase 3.';
create index hts_rag_product_embeddings_hnsw_idx
  on hts_rag.hts_rag_product_embeddings using hnsw (embedding extensions.halfvec_cosine_ops);
create index hts_rag_product_embeddings_ruling_idx
  on hts_rag.hts_rag_product_embeddings (ruling_number);
alter table hts_rag.hts_rag_product_embeddings enable row level security;
revoke all on hts_rag.hts_rag_product_embeddings
  from public, anon, authenticated, service_role;
-- sandbox: omitted, names production service login(s) absent here: designflow_hts_prod_worker, designflow_hts_alsand_worker
-- sandbox: omitted, names production service login(s) absent here: designflow_hts_prod_runtime, designflow_hts_alsand_runtime
-- sandbox: omitted, names production service login(s) absent here: designflow_hts_prod_worker
-- sandbox: omitted, names production service login(s) absent here: designflow_hts_prod_worker
-- sandbox: omitted, names production service login(s) absent here: designflow_hts_prod_worker
-- sandbox: omitted, names production service login(s) absent here: designflow_hts_alsand_worker
-- sandbox: omitted, names production service login(s) absent here: designflow_hts_alsand_worker
-- sandbox: omitted, names production service login(s) absent here: designflow_hts_alsand_worker
-- sandbox: omitted, names production service login(s) absent here: designflow_hts_prod_runtime
-- sandbox: omitted, names production service login(s) absent here: designflow_hts_alsand_runtime

-- Nearest products by cosine distance for one embed_version. The HTS logins have no USAGE
-- on schema extensions, so the vector type and operator live behind this definer function;
-- the query vector arrives as text ('[x,y,...]', 768 numbers). Active, trusted products of
-- active, unrevoked rulings only; optional held-chapter scope.
create function hts_rag.hts_rag_nearest_products(
  p_embedding text,
  p_embed_version text,
  p_limit integer default 200,
  p_scope_chapters text[] default null
)
returns table (product_id uuid, ruling_number text, distance real)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '30s'
set hnsw.ef_search = '400'
set hnsw.iterative_scan = 'relaxed_order'
as $function$
  select n.product_id, n.ruling_number, n.distance
  from (
    select e.product_id, e.ruling_number,
           (e.embedding operator(extensions.<=>) cast(p_embedding as extensions.halfvec(768)))::real as distance
    from hts_rag.hts_rag_product_embeddings e
    join hts_rag.hts_rag_ruling_products rp on rp.id = e.product_id
    join hts_rag.hts_rag_rulings r on r.ruling_number = e.ruling_number
    where e.embed_version = p_embed_version
      and rp.effective_status = 'active' and rp.review_state = 'trusted'
      and r.effective_status = 'active' and not coalesce(r.operationally_revoked, false)
      and (p_scope_chapters is null or rp.held_chapter = any (p_scope_chapters))
    order by e.embedding operator(extensions.<=>) cast(p_embedding as extensions.halfvec(768))
    limit least(greatest(coalesce(p_limit, 200), 1), 1000)
  ) n
  order by n.distance, n.product_id
$function$;
comment on function hts_rag.hts_rag_nearest_products(text, text, integer, text[]) is
  'Nearest active trusted ruling products for one embed_version (cosine). designflow-backend#278 Phase 3 step 2.';
revoke all on function hts_rag.hts_rag_nearest_products(text, text, integer, text[]) from public, anon, authenticated, service_role;
-- sandbox: omitted, names production service login(s) absent here: designflow_hts_prod_runtime, designflow_hts_alsand_runtime, designflow_hts_prod_worker, designflow_hts_alsand_worker

-- ===== replay of 20261204000501_hts_rag_type_code6_stats.sql =====
-- Issue #6590 (claim #6591, popcre/designflow-backend#278, plan_hts-4-upgrades.md Phase 2
-- step 5). 6-digit counterpart of hts_rag_type_heading_stats: per article type (all_materials
-- = true) and per type x material, the 6-digit codes CBP held, rejected or mentioned, with
-- product and ruling counts. Additive read model; refreshed only through the SECURITY DEFINER
-- routine below, never hand-written. Held codes use the product's held_code (as written by CBP);
-- decisions only count when CBP named at least six digits.

create materialized view hts_rag.hts_rag_type_code6_stats as
with codes as (
  select p.id as product_id, p.ruling_number, p.article_type_id, p.primary_material_id,
         'held'::text as outcome, left(regexp_replace(p.held_code, '\D', '', 'g'), 6) as code6
    from hts_rag.hts_rag_ruling_products p
   where p.held_code is not null
  union
  select p.id, p.ruling_number, p.article_type_id, p.primary_material_id,
         d.outcome, left(regexp_replace(d.code_prefix, '\D', '', 'g'), 6)
    from hts_rag.hts_rag_heading_decisions d
    join hts_rag.hts_rag_ruling_products p on p.id = d.product_id
   where d.outcome in ('rejected', 'alternative_mentioned')
     and length(regexp_replace(coalesce(d.code_prefix, ''), '\D', '', 'g')) >= 6
)
select c.article_type_id,
       (grouping(c.primary_material_id) = 1) as all_materials,
       c.primary_material_id,
       c.code6,
       left(c.code6, 4) as heading,
       left(c.code6, 2) as chapter,
       c.outcome,
       count(distinct c.product_id) as product_count,
       count(distinct c.ruling_number) as ruling_count,
       max(r.ruling_date) as newest_ruling_date
  from codes c
  join hts_rag.hts_rag_ruling_products p on p.id = c.product_id
  join hts_rag.hts_rag_rulings r on r.ruling_number = c.ruling_number
 where p.effective_status = 'active'
   and p.review_state = 'trusted'
   and c.article_type_id is not null
   and length(c.code6) = 6
 group by grouping sets (
   (c.article_type_id, c.code6, c.outcome),
   (c.article_type_id, c.primary_material_id, c.code6, c.outcome))
with no data;

create unique index hts_rag_type_code6_stats_uq
  on hts_rag.hts_rag_type_code6_stats
  (article_type_id, all_materials, primary_material_id, code6, outcome) nulls not distinct;
create index hts_rag_type_code6_stats_chapter_idx
  on hts_rag.hts_rag_type_code6_stats (article_type_id, chapter);

comment on materialized view hts_rag.hts_rag_type_code6_stats is
  'designflow-backend#278. 6-digit codes CBP held/rejected/mentioned per article type (all_materials = true) and per type x material; product and ruling counts. Tiebreak/statistics only. Refresh via hts_rag_refresh_type_code6_stats().';

revoke all on hts_rag.hts_rag_type_code6_stats
  from public, anon, authenticated, service_role;
-- sandbox: omitted, names production service login(s) absent here: designflow_hts_prod_worker, designflow_hts_alsand_worker

create function hts_rag.hts_rag_refresh_type_code6_stats()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from pg_matviews
              where schemaname = 'hts_rag' and matviewname = 'hts_rag_type_code6_stats' and ispopulated) then
    refresh materialized view concurrently hts_rag.hts_rag_type_code6_stats;
  else
    refresh materialized view hts_rag.hts_rag_type_code6_stats;
  end if;
end;
$$;

comment on function hts_rag.hts_rag_refresh_type_code6_stats() is
  'designflow-backend#278. Refreshes hts_rag_type_code6_stats after a harvest or extraction batch.';
revoke all on function hts_rag.hts_rag_refresh_type_code6_stats() from public, anon, authenticated, service_role;
-- sandbox: omitted, names production service login(s) absent here: designflow_hts_prod_worker, designflow_hts_alsand_worker

-- ===== replay of 20261204003329_dam_search_named_character_scope.sql =====
-- u2giants/popdam3#1037 Step 2 (claim popcre/shared-db#6607): named-character rule.
-- Owner ruling D1 (2026-11-17): "naming a character should show only products that contain that
-- character." Measured on production 2026-11-17: a character + product-type search returned other
-- characters' products matched by picture alone (the picture score for typed words is flat).
-- Change (body-only for search_dam_documents; same signature, grants, owner and settings):
--   * p_filters.requiredCharacterIds (core.character ids), requiredLegacyCharacterIds
--     (public.characters ids) and requiredCharacterNames (the typed names): when any is present, a
--     candidate from ANY leg is kept only if a non-deleted file of its style group (an ungrouped
--     asset: the file itself) is tagged with one of the ids, or its own search text carries one of
--     the names as whole words (21% of named style groups lack the tag, measured 2026-11-17).
--   * p_filters.semanticPropertyIds + semanticPropertyCharacterIds (plan D8): when present, a
--     picture-only match is kept only if it carries one of the properties or a file tagged with
--     one of the property's linked characters. Exact-word matches are untouched.
--   * All five keys are stripped in visibility_params like semanticLicensorIds, so the exact
--     total fast paths still apply. Absent keys = today's behaviour exactly.
-- New helpers public.dam_search_uuid_list(jsonb) / public.dam_search_name_queries(jsonb): read the
-- lists (bad entries ignored, oversize lists rejected with a clean 22023 error).
-- New public.dam_search_semantic_anchor_named(vector, text[], jsonb): best picture score under the
-- same scopes the search applies (licensor, property, character), so another character's closer
-- picture cannot raise the floor past every allowed match (#6024 lesson). No scope = exactly
-- public.dam_search_semantic_anchor; no in-scope picture in reach = the unscoped anchor.
begin;
set local lock_timeout='500ms';
set local statement_timeout='2500ms';
set local transaction_timeout='3s';
set local search_path=pg_catalog,public,extensions;

do $guard$
begin
  if not exists (select 1 from pg_proc p where p.oid=to_regprocedure('public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real)')
      and md5(p.prosrc) in ('88f0ba8eee3a8b4e68e6924bd0c8996f','7d49762f87b9ea8322808920734917b3')) then
    raise exception 'popdam3#1037 pre-change search_dam_documents differs from 20261110154439; reconcile rather than overwrite';
  end if;
  if to_regprocedure('public.dam_search_semantic_anchor(extensions.vector,text[])') is null then
    raise exception 'popdam3#1037 public.dam_search_semantic_anchor(vector,text[]) is missing';
  end if;
end;
$guard$;

create or replace function public.dam_search_uuid_list(p_ids jsonb)
returns uuid[]
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  v uuid[];
begin
  if p_ids is null or jsonb_typeof(p_ids) <> 'array' then
    return null;
  end if;
  if jsonb_array_length(p_ids) > 1000 then
    raise exception 'too many ids in a search scope (% > 1000)', jsonb_array_length(p_ids)
      using errcode = '22023';
  end if;
  select array_agg(distinct e.v #>> '{}'::text[])::uuid[] into v
  from jsonb_array_elements(p_ids) e(v)
  where jsonb_typeof(e.v) = 'string'
    and (e.v #>> '{}'::text[]) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  return v;
end;
$function$;
revoke all on function public.dam_search_uuid_list(jsonb) from public, anon, authenticated;
comment on function public.dam_search_uuid_list(jsonb) is
  'popdam3#1037: uuid[] from a jsonb array of id strings for search scopes; NULL when absent, empty or no valid ids; non-uuid entries ignored; more than 1000 entries raise 22023.';

create or replace function public.dam_search_name_queries(p_names jsonb)
returns tsquery[]
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  v tsquery[];
begin
  if p_names is null or jsonb_typeof(p_names) <> 'array' then
    return null;
  end if;
  if jsonb_array_length(p_names) > 50 then
    raise exception 'too many names in a search scope (% > 50)', jsonb_array_length(p_names)
      using errcode = '22023';
  end if;
  -- phraseto_tsquery is literal: operators and punctuation in a name are just separators.
  select array_agg(q) into v
  from (
    select distinct pg_catalog.phraseto_tsquery('simple'::regconfig, left(e.v #>> '{}'::text[], 200)) q
    from jsonb_array_elements(p_names) e(v)
    where jsonb_typeof(e.v) = 'string'
  ) x
  where q::text <> '';
  return v;
end;
$function$;
revoke all on function public.dam_search_name_queries(jsonb) from public, anon, authenticated;
comment on function public.dam_search_name_queries(jsonb) is
  'popdam3#1037: whole-word phrase queries (simple config) from a jsonb array of character names; NULL when absent, empty or blank; more than 50 entries raise 22023.';

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
      1000 summary_probe_limit,
      -- popdam3#892: when a search names a licensor, the caller passes its id(s) here and a
      -- document matched by its picture ALONE must belong to one of them. Keyword matches,
      -- and the picture score of a document that also matched by keyword, are untouched.
      (select array_agg(x.id::uuid)
       from jsonb_array_elements_text(
         case when jsonb_typeof(p_filters->'semanticLicensorIds')='array'
           then p_filters->'semanticLicensorIds' else '[]'::jsonb end) x(id)) semantic_licensor_ids,
      -- popdam3#1037 Step 2 (owner D1): a search that names a character returns only products
      -- that contain it, from EVERY leg: a document is kept only when one of its non-deleted
      -- files (its style group's files; an ungrouped asset itself) is tagged with one of these
      -- core (requiredCharacterIds) or legacy (requiredLegacyCharacterIds) character ids.
      public.dam_search_uuid_list(p_filters->'requiredCharacterIds') required_character_ids,
      public.dam_search_uuid_list(p_filters->'requiredLegacyCharacterIds') required_legacy_character_ids,
      -- ...or whose own search text carries one of the typed character names as whole words
      -- (21% of named style groups lack the tag; measured 2026-11-17, plan Step 2 fallback).
      public.dam_search_name_queries(p_filters->'requiredCharacterNames') required_character_names,
      -- popdam3#1037 Step 2 (D8): a search that names a property (and no character) keeps a
      -- picture-only match only when it carries that property or one of its linked characters.
      public.dam_search_uuid_list(p_filters->'semanticPropertyIds') semantic_property_ids,
      public.dam_search_uuid_list(p_filters->'semanticPropertyCharacterIds') semantic_property_character_ids
    where public.require_dam_access()
  ), queries as materialized (
    select q.query_text, websearch_to_tsquery('simple', regexp_replace(q.query_text, '[-_/]+', ' ', 'g')) tsq,
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
  ), full_text_matches as materialized (
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,d.title,d.title_key,d.title_tsv
    from public.dam_search_keys d
    where (p_document_types is null or d.document_type = any(p_document_types))
      and d.search_tsv @@ any(array(select distinct q.tsq from queries q))
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
  ), candidate_ranks as materialized (
    select c.document_type,c.entity_id,c.asset_id,c.style_group_id,max(c.keyword_rank)::real keyword_rank,
      max(c.semantic_rank)::real semantic_rank,
      (coalesce(max(c.keyword_rank),0) + coalesce(max(c.semantic_rank),0) * 0.35)::real rank
    from (select k.*,null::real semantic_rank from keyword_candidates k union all
      select s.document_type,s.entity_id,s.asset_id,s.style_group_id,null::real,s.semantic_rank from semantic_candidates s) c
    group by c.document_type,c.entity_id,c.asset_id,c.style_group_id
    having coalesce(max(c.keyword_rank),0) + coalesce(max(c.semantic_rank),0) * 0.35 >= (select min_rank from params)
      and ((select semantic_licensor_ids from params) is null
        or max(c.keyword_rank) is not null
        -- a grouped document takes its style group's licensor, an ungrouped asset its own
        or exists (select 1 from public.style_groups g
          where g.id = c.style_group_id
            and g.licensor_id = any((select semantic_licensor_ids from params)::uuid[]))
        or (c.style_group_id is null and exists (select 1 from public.assets a
          where a.id = c.asset_id
            and a.licensor_id = any((select semantic_licensor_ids from params)::uuid[]))))
      -- popdam3#1037: property accepted set, picture-only matches only.
      and ((select semantic_property_ids from params) is null
        or max(c.keyword_rank) is not null
        or exists (select 1 from public.style_groups g
          where g.id = c.style_group_id
            and g.property_id = any((select semantic_property_ids from params)::uuid[]))
        or (c.style_group_id is null and exists (select 1 from public.assets a
          where a.id = c.asset_id
            and a.property_id = any((select semantic_property_ids from params)::uuid[])))
        or exists (select 1 from public.assets m
          join public.asset_licensor_characters t on t.asset_id = m.id
          where ((c.style_group_id is not null and m.style_group_id = c.style_group_id)
              or (c.style_group_id is null and m.id = c.asset_id))
            and not m.is_deleted
            and t.character_id = any((select semantic_property_character_ids from params)::uuid[])))
      -- popdam3#1037: named character, every leg.
      and ((select required_character_ids from params) is null
           and (select required_legacy_character_ids from params) is null
           and (select required_character_names from params) is null
        or exists (select 1 from public.dam_search_keys k
          where k.document_type = c.document_type and k.entity_id = c.entity_id
            and k.search_tsv @@ any((select required_character_names from params)::tsquery[]))
        or exists (select 1 from public.assets m
          where ((c.style_group_id is not null and m.style_group_id = c.style_group_id)
              or (c.style_group_id is null and m.id = c.asset_id))
            and not m.is_deleted
            and (exists (select 1 from public.asset_licensor_characters t
                  where t.asset_id = m.id
                    and t.character_id = any((select required_character_ids from params)::uuid[]))
              or exists (select 1 from public.asset_characters t
                  where t.asset_id = m.id
                    and t.character_id = any((select required_legacy_character_ids from params)::uuid[])))))
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
    -- semanticLicensorIds and the #1037 character/property scopes are not visibility filters
    -- (they are applied to candidates above): strip them so the unfiltered fast paths still apply.
    select coalesce(p_filters,'{}'::jsonb)-'search'-'semanticLicensorIds'
      -'requiredCharacterIds'-'requiredLegacyCharacterIds'-'requiredCharacterNames'
      -'semanticPropertyIds'-'semanticPropertyCharacterIds' f,
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
  ), default_flag_state as materialized (
    -- #5747 Step 5: unfiltered exact-count fast path. Usable only when the
    -- request has no filters AND every candidate document carries a flag
    -- computed with the CURRENT thumbnail min date for the same members.
    -- Any doubt falls back to the per-document probe below (exact either way).
    select count(*) filter (where d.has_default_visible_member) flagged_visible,
      -- #5938: visible member assets summed over candidates. visible_assets has
      -- one row per (candidate, probe-visible member), so this sum is exactly
      -- its unlimited row count when every count is current.
      coalesce(sum(d.default_visible_member_count), 0) visible_member_rows,
      coalesce(bool_and(d.default_visible_member_count is not null), true) all_counts_current,
      coalesce(bool_and(d.has_default_visible_member is not null
        and d.default_visible_min_date = v.thumbnail_min_date
        and d.asset_id is not distinct from c.asset_id
        and d.style_group_id is not distinct from c.style_group_id), true) all_current
    from visibility_params v
    join ordered_candidates c on v.f = '{}'::jsonb
    left join public.dam_search_documents d
      on d.document_type = c.document_type and d.entity_id = c.entity_id
    group by v.thumbnail_min_date
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
    -- bounds. Fast path (#5747): unfiltered request with every flag current
    -- -> count maintained flags. Otherwise count EVERY candidate document
    -- that has at least one member asset passing the same visibility
    -- predicate, short-circuiting per document (LIMIT 1).
    select case
      when (select f from visibility_params) = '{}'::jsonb
       and coalesce((select all_current from default_flag_state), true)
      then coalesce((select flagged_visible from default_flag_state), 0)
      else (
        select count(*) from (
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
      )
    end total_count
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
  v_characters uuid[] := public.dam_search_uuid_list(p_filters->'requiredCharacterIds');
  v_legacy uuid[] := public.dam_search_uuid_list(p_filters->'requiredLegacyCharacterIds');
  v_names tsquery[] := public.dam_search_name_queries(p_filters->'requiredCharacterNames');
  v_properties uuid[] := public.dam_search_uuid_list(p_filters->'semanticPropertyIds');
  v_property_characters uuid[] := public.dam_search_uuid_list(p_filters->'semanticPropertyCharacterIds');
  v_score real;
begin
  if not coalesce(public.require_dam_access(), false) then
    return null;
  end if;
  if p_query_embedding is null
     or (v_licensors is null and v_characters is null and v_legacy is null and v_names is null
         and v_properties is null) then
    return public.dam_search_semantic_anchor(p_query_embedding, p_document_types);
  end if;

  perform pg_catalog.set_config('hnsw.ef_search', '100', true);
  perform pg_catalog.set_config('hnsw.iterative_scan', 'relaxed_order', true);
  perform pg_catalog.set_config('hnsw.max_scan_tuples', '2000', true);

  if p_document_types is not null and not ('asset' = any(p_document_types))
     and 'style_group' = any(p_document_types) then
    -- style-group-only: exact leg, as in search_dam_documents.
    select greatest(0, 1 - min(d.embedding operator(extensions.<=>) p_query_embedding))::real
    into v_score
    from dam.search_group_vectors d
    where d.embedding is not null
      and d.embedding_model = 'google/siglip2-base-patch16-naflex'
      and d.document_type = 'style_group'
      and (
        -- licensor scope (#892): grouped document -> its style group's licensor, ungrouped asset -> its own
        (v_licensors is null
          or (d.style_group_id is not null and exists (select 1 from public.style_groups g
                where g.id = d.style_group_id and g.licensor_id = any(v_licensors)))
          or (d.style_group_id is null and exists (select 1 from public.assets a
                where a.id = d.asset_id and a.licensor_id = any(v_licensors))))
        -- property accepted set (#1037): the property itself or one of its linked characters
        and (v_properties is null
          or (d.style_group_id is not null and exists (select 1 from public.style_groups g
                where g.id = d.style_group_id and g.property_id = any(v_properties)))
          or (d.style_group_id is null and exists (select 1 from public.assets a
                where a.id = d.asset_id and a.property_id = any(v_properties)))
          or exists (select 1 from public.assets m
                join public.asset_licensor_characters t on t.asset_id = m.id
                where ((d.style_group_id is not null and m.style_group_id = d.style_group_id)
                    or (d.style_group_id is null and m.id = d.asset_id))
                  and not m.is_deleted and t.character_id = any(v_property_characters)))
        -- named character (#1037): tagged on a non-deleted file, or named in the document's text
        and ((v_characters is null and v_legacy is null and v_names is null)
          or exists (select 1 from public.dam_search_keys k
                where k.document_type = d.document_type and k.entity_id = d.entity_id
                  and k.search_tsv @@ any(v_names))
          or exists (select 1 from public.assets m
                where ((d.style_group_id is not null and m.style_group_id = d.style_group_id)
                    or (d.style_group_id is null and m.id = d.asset_id))
                  and not m.is_deleted
                  and (exists (select 1 from public.asset_licensor_characters t
                         where t.asset_id = m.id and t.character_id = any(v_characters))
                    or exists (select 1 from public.asset_characters t
                         where t.asset_id = m.id and t.character_id = any(v_legacy))))))
    having count(*) > 0;
  elsif p_document_types is null
     or exists (select 1 from unnest(p_document_types) t where t is distinct from 'style_group') then
    select greatest(0, 1 - (d.embedding operator(extensions.<=>) p_query_embedding))::real
    into v_score
    from public.dam_search_documents d
    where d.embedding is not null
      and d.embedding_model = 'google/siglip2-base-patch16-naflex'
      and (p_document_types is null or d.document_type = any(p_document_types))
      and (
        -- licensor scope (#892): grouped document -> its style group's licensor, ungrouped asset -> its own
        (v_licensors is null
          or (d.style_group_id is not null and exists (select 1 from public.style_groups g
                where g.id = d.style_group_id and g.licensor_id = any(v_licensors)))
          or (d.style_group_id is null and exists (select 1 from public.assets a
                where a.id = d.asset_id and a.licensor_id = any(v_licensors))))
        -- property accepted set (#1037): the property itself or one of its linked characters
        and (v_properties is null
          or (d.style_group_id is not null and exists (select 1 from public.style_groups g
                where g.id = d.style_group_id and g.property_id = any(v_properties)))
          or (d.style_group_id is null and exists (select 1 from public.assets a
                where a.id = d.asset_id and a.property_id = any(v_properties)))
          or exists (select 1 from public.assets m
                join public.asset_licensor_characters t on t.asset_id = m.id
                where ((d.style_group_id is not null and m.style_group_id = d.style_group_id)
                    or (d.style_group_id is null and m.id = d.asset_id))
                  and not m.is_deleted and t.character_id = any(v_property_characters)))
        -- named character (#1037): tagged on a non-deleted file, or named in the document's text
        and ((v_characters is null and v_legacy is null and v_names is null)
          or exists (select 1 from public.dam_search_keys k
                where k.document_type = d.document_type and k.entity_id = d.entity_id
                  and k.search_tsv @@ any(v_names))
          or exists (select 1 from public.assets m
                where ((d.style_group_id is not null and m.style_group_id = d.style_group_id)
                    or (d.style_group_id is null and m.id = d.asset_id))
                  and not m.is_deleted
                  and (exists (select 1 from public.asset_licensor_characters t
                         where t.asset_id = m.id and t.character_id = any(v_characters))
                    or exists (select 1 from public.asset_characters t
                         where t.asset_id = m.id and t.character_id = any(v_legacy))))))
    order by d.embedding operator(extensions.<=>) p_query_embedding
    limit 1;
  end if;

  if v_score is null then
    perform pg_catalog.set_config('hnsw.max_scan_tuples', '20000', true);
    return public.dam_search_semantic_anchor(p_query_embedding, p_document_types);
  end if;
  return v_score;
end;
$function$;
revoke all on function public.dam_search_semantic_anchor_named(extensions.vector,text[],jsonb) from public, anon;
grant execute on function public.dam_search_semantic_anchor_named(extensions.vector,text[],jsonb) to authenticated, service_role;
comment on function public.dam_search_semantic_anchor_named(extensions.vector,text[],jsonb) is
  'popdam3#1037: best picture score under the p_filters scopes search_dam_documents applies (semanticLicensorIds, requiredCharacterIds, requiredLegacyCharacterIds, requiredCharacterNames, semanticPropertyIds/semanticPropertyCharacterIds). No scope = dam_search_semantic_anchor exactly; no in-scope picture = unscoped anchor.';

do $guard$
begin
  if not exists (select 1 from pg_proc p where p.oid=to_regprocedure('public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real)')
      and md5(p.prosrc)='7d49762f87b9ea8322808920734917b3'
      and pg_get_userbyid(p.proowner)='postgres'
      and p.prosecdef and p.provolatile='s' and p.proretset
      and pg_get_function_arguments(p.oid)='p_query text, p_filters jsonb, p_limit integer, p_offset integer, p_document_types text[] DEFAULT NULL::text[], p_query_embedding vector DEFAULT NULL::vector, p_min_rank real DEFAULT 0, p_min_semantic_score real DEFAULT NULL::real'
      and pg_get_function_result(p.oid)='TABLE(document_type text, entity_id uuid, asset_id uuid, style_group_id uuid, keyword_rank real, semantic_rank real, rank real, total_count bigint, has_more boolean, facets jsonb)'
      and p.proconfig=ARRAY['search_path=public, extensions','statement_timeout=30s']::text[]
      and p.proacl::text='{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}') then
    raise exception 'popdam3#1037 installed search contract differs; reconcile rather than overwrite';
  end if;
end;
$guard$;

commit;

-- ===== replay of 20261204003429_dam_search_text_vectors_reissue.sql =====
-- Claim popcre/shared-db#6605. Application issue u2giants/popdam3#1037, plan
-- docs/plans/issue-1037-typed-search-meaning-matching.md Step 3 (decisions D4,
-- D5, D6). Storage and work queue for PopDAM "text-meaning" vectors: one
-- Qwen/Qwen3-Embedding-0.6B vector (1024 dimensions, unit length, cosine) per
-- search document, built from a clean description of the product rather than
-- from its thumbnail. Nothing reads these vectors yet (Steps 5-6); the GPU
-- worker that fills them is Step 4.
--
-- What this adds (all additive; no existing column, index or function body of
-- the picture lane changes, and public.search_dam_documents is not touched):
--   dam.search_text_vectors        one vector per document, model stamped on
--                                  every row, HNSW (halfvec_cosine_ops) plus a
--                                  style-group-only partial HNSW.
--   dam.search_text_embed_jobs     its own queue and lease columns. The picture
--                                  lease columns on dam_search_documents are
--                                  never read or written (D5).
--   dam.search_text_embedding_input(text, uuid)
--                                  the text to embed: labelled lines, in plan
--                                  order, whitespace collapsed, at most 2,000
--                                  characters. Returns null when there is
--                                  nothing to say.
--   dam.enqueue_search_text_embedding()  trigger on dam_search_documents:
--                                  enqueues only when the embedding INPUT
--                                  changes. Invariant relied on: every field
--                                  the input reads also feeds search_text, so
--                                  the trigger fires on search_text changes
--                                  only; a thumbnail-only change never fires
--                                  it, and a search_text change that leaves
--                                  the input identical enqueues nothing.
--   four worker RPCs (claim / upsert / mark error / status), EXECUTE for
--   dam_image_embed_worker only; RLS on both tables with no policy; browser
--   and service roles get no table access.
--   public.get_search_embedding_health() gains a 'dam_text' corpus row (same
--   columns; existing rows unchanged) for the Production Canary.
--   admin_config SEARCH_TEXT_EMBEDDING_MODEL = the model stamp from Step 0.
--   No bulk backfill: existing documents are seeded into the queue in small
--   batches by the claim RPC, from a per-type cursor (dam.search_text_seed_state).
--
-- REISSUE of 20261204001000 (retired in production_migration_guard
-- HARD_BLOCKED). The original was applied to preview but its production apply
-- (run 44189714544) hit the server statement timeout after 2 minutes, almost
-- certainly on its single 183k-row backfill insert. This version drops that
-- insert, adds the seed cursor, and is idempotent so it also converges preview,
-- which already holds the original's objects and jobs.

begin;
set local lock_timeout = '20s';

-- ---------------------------------------------------------------- config
insert into public.admin_config(key, value)
values ('SEARCH_TEXT_EMBEDDING_MODEL',
        to_jsonb('Qwen/Qwen3-Embedding-0.6B@97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3'::text))
on conflict (key) do update set value = excluded.value, updated_at = now();

create or replace function dam.search_text_embedding_model()
returns text
language sql stable security definer set search_path = ''
as $function$
  select nullif(btrim(c.value #>> '{}'), '')
    from public.admin_config c
   where c.key = 'SEARCH_TEXT_EMBEDDING_MODEL';
$function$;
revoke all on function dam.search_text_embedding_model() from public, anon, authenticated;

-- ---------------------------------------------------------------- tables
create table if not exists dam.search_text_vectors (
  document_type text not null,
  entity_id uuid not null,
  model text not null check (btrim(model) <> ''),
  input_sha256 text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  embedding extensions.halfvec(1024) not null,
  embedded_at timestamptz not null default now(),
  primary key (document_type, entity_id),
  foreign key (document_type, entity_id)
    references public.dam_search_documents(document_type, entity_id) on update cascade on delete cascade
);
comment on table dam.search_text_vectors is
  'PopDAM text-meaning vectors (u2giants/popdam3#1037). One per search document; model stamp on every row. Independent of the picture vector (D5).';

create index if not exists search_text_vectors_embedding_hnsw
  on dam.search_text_vectors using hnsw (embedding extensions.halfvec_cosine_ops);
-- Style-group-only search must not walk an index dominated by 171k asset rows
-- (the picture side needed dam.search_group_vectors for the same reason).
-- Queries must use the literal document_type = 'style_group' to match it.
create index if not exists search_text_vectors_style_group_hnsw
  on dam.search_text_vectors using hnsw (embedding extensions.halfvec_cosine_ops)
  where document_type = 'style_group';

create table if not exists dam.search_text_embed_jobs (
  document_type text not null,
  entity_id uuid not null,
  input_sha256 text check (input_sha256 is null or input_sha256 ~ '^[0-9a-f]{64}$'),
  enqueued_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  next_retry_at timestamptz,
  lease_token uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  error text,
  error_category text check (error_category is null or error_category in ('transient', 'permanent')),
  primary key (document_type, entity_id),
  foreign key (document_type, entity_id)
    references public.dam_search_documents(document_type, entity_id) on update cascade on delete cascade
);
comment on table dam.search_text_embed_jobs is
  'Work queue for dam.search_text_vectors. A row exists while a document needs (re-)embedding; it is deleted when its vector is written.';
-- Claim order: style groups first, then oldest.
create index if not exists search_text_embed_jobs_claim_idx
  on dam.search_text_embed_jobs ((document_type <> 'style_group'), enqueued_at, document_type, entity_id)
  where error_category is distinct from 'permanent';

-- Seed cursor: documents that existed before this migration enter the queue in
-- primary-key order, a batch per claim, so no statement ever touches all ~183k.
-- New and changed documents are queued by the trigger regardless.
create table if not exists dam.search_text_seed_state (
  document_type text primary key check (document_type in ('style_group', 'asset')),
  last_entity_id uuid,
  done boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into dam.search_text_seed_state(document_type) values ('style_group'), ('asset')
on conflict (document_type) do nothing;
alter table dam.search_text_seed_state enable row level security;
revoke all on dam.search_text_seed_state from public, anon, authenticated, service_role;

alter table dam.search_text_vectors enable row level security;
alter table dam.search_text_embed_jobs enable row level security;
revoke all on dam.search_text_vectors, dam.search_text_embed_jobs
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- input
create or replace function dam.search_text_embedding_input(p_document_type text, p_entity_id uuid)
returns text
language plpgsql stable security definer set search_path = ''
as $function$
declare
  v_lines text[];
  v_path text;
  v_parts text[];
  v_n integer;
  v_out text;
begin
  if p_document_type = 'style_group' then
    select array[
        'Product type: ' || nullif(concat_ws(', ', variadic array(
          select distinct on (lower(btrim(x))) btrim(x)
            from unnest(array[sg.product_category, sg.mg01_name, sg.mg02_name, sg.mg03_name]) with ordinality u(x, o)
           where nullif(btrim(x), '') is not null
           order by lower(btrim(x)), o)), ''),
        'Item description: ' || nullif(btrim(sg.item_description), ''),
        'Cover description: ' || nullif(btrim(sg.cover_description), ''),
        'AI description: ' || nullif(btrim(sg.group_ai_description), ''),
        'Licensor: ' || nullif(btrim(sg.licensor_name), ''),
        'Property: ' || nullif(btrim(sg.property_name), ''),
        'Characters: ' || nullif(ch.names, ''),
        'Customer: ' || nullif(btrim(sg.customer), ''),
        'Program: ' || nullif(btrim(sg.program), '')],
      sg.folder_path
      into v_lines, v_path
      from public.style_groups sg
      left join lateral (
        select string_agg(n.name, ', ' order by n.k) names
          from (select distinct on (lower(btrim(c.name))) lower(btrim(c.name)) k, btrim(c.name) name
                  from (select pc.name from public.assets a
                          join public.asset_characters ac on ac.asset_id = a.id
                          join public.characters pc on pc.id = ac.character_id
                         where a.style_group_id = sg.id and not a.is_deleted
                        union all
                        select lc.name from public.assets a
                          join public.asset_licensor_characters alc on alc.asset_id = a.id
                          join core.character lc on lc.id = alc.character_id
                         where a.style_group_id = sg.id and not a.is_deleted) c
                 where nullif(btrim(c.name), '') is not null
                 order by lower(btrim(c.name)), btrim(c.name)) n) ch on true
     where sg.id = p_entity_id;
    if not found then return null; end if;
  elsif p_document_type = 'asset' then
    -- Only fields that also feed the asset's search_text (enqueue invariant).
    select array[
        'Product type: ' || nullif(btrim(a.product_category), ''),
        'Item description: ' || nullif(btrim(sg.item_description), ''),
        'Cover description: ' || nullif(btrim(a.cover_description), ''),
        'AI description: ' || nullif(btrim(coalesce(nullif(btrim(a.ai_description), ''), sg.group_ai_description)), ''),
        'Licensor: ' || nullif(btrim(case when a.style_group_id is null then a.licensor_name else sg.licensor_name end), ''),
        'Property: ' || nullif(btrim(case when a.style_group_id is null then a.property_name else sg.property_name end), ''),
        'Characters: ' || nullif(ch.names, ''),
        'Customer: ' || nullif(btrim(a.customer), ''),
        'Program: ' || nullif(btrim(a.program), '')],
      -- Folders only: drop the file name when the path ends with it.
      case when a.filename is not null
                and right(regexp_replace(coalesce(a.relative_path, ''), '[/\\]+$', ''), length(a.filename)) = a.filename
           then left(regexp_replace(a.relative_path, '[/\\]+$', ''),
                     length(regexp_replace(a.relative_path, '[/\\]+$', '')) - length(a.filename))
           else a.relative_path end
      into v_lines, v_path
      from public.assets a
      left join public.style_groups sg on sg.id = a.style_group_id
      left join lateral (
        select string_agg(n.name, ', ' order by n.k) names
          from (select distinct on (lower(btrim(c.name))) lower(btrim(c.name)) k, btrim(c.name) name
                  from (select pc.name from public.asset_characters ac
                          join public.characters pc on pc.id = ac.character_id
                         where ac.asset_id = a.id
                        union all
                        select lc.name from public.asset_licensor_characters alc
                          join core.character lc on lc.id = alc.character_id
                         where alc.asset_id = a.id) c
                 where nullif(btrim(c.name), '') is not null
                 order by lower(btrim(c.name)), btrim(c.name)) n) ch on true
     where a.id = p_entity_id and not a.is_deleted;
    if not found then return null; end if;
  else
    return null;
  end if;

  -- Last four folders, separators turned into spaces.
  v_parts := array_remove(regexp_split_to_array(coalesce(v_path, ''), '[/\\]+'), '');
  v_n := coalesce(array_length(v_parts, 1), 0);
  if v_n > 0 then
    v_lines := v_lines || ('Folders: ' || array_to_string(v_parts[greatest(1, v_n - 3):v_n], ' '));
  end if;

  select string_agg(regexp_replace(btrim(l), '\s+', ' ', 'g'), E'\n' order by o)
    into v_out
    from unnest(v_lines) with ordinality u(l, o)
   where l is not null and btrim(l) <> '';
  -- Model input limit (Step 0): keep under about 2,000 characters.
  return nullif(btrim(left(v_out, 2000)), '');
end;
$function$;
revoke all on function dam.search_text_embedding_input(text, uuid) from public, anon, authenticated;
grant execute on function dam.search_text_embedding_input(text, uuid) to service_role;
comment on function dam.search_text_embedding_input(text, uuid) is
  'Clean text embedded for a PopDAM search document (popdam3#1037): labelled lines Product type, Item description, Cover description, AI description, Licensor, Property, Characters (distinct), Customer, Program, Folders (last four); whitespace collapsed; truncated to 2,000 characters; null when empty.';

-- ---------------------------------------------------------------- enqueue
create or replace function dam.enqueue_search_text_embedding()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare
  v_text text;
  v_sha text;
begin
  v_text := dam.search_text_embedding_input(new.document_type, new.entity_id);
  v_sha := case when v_text is null then null
                else encode(sha256(convert_to(v_text, 'UTF8')), 'hex') end;
  if v_sha is not null and exists (
       select 1 from dam.search_text_vectors v
        where v.document_type = new.document_type and v.entity_id = new.entity_id
          and v.input_sha256 = v_sha and v.model = dam.search_text_embedding_model()) then
    -- Input is back to what is already embedded: nothing to do.
    delete from dam.search_text_embed_jobs j
     where j.document_type = new.document_type and j.entity_id = new.entity_id;
    return null;
  end if;
  insert into dam.search_text_embed_jobs as j (document_type, entity_id, input_sha256)
  values (new.document_type, new.entity_id, v_sha)
  on conflict (document_type, entity_id) do update
     set input_sha256 = excluded.input_sha256, enqueued_at = now(), attempts = 0,
         next_retry_at = null, error = null, error_category = null,
         lease_token = null, lease_owner = null, lease_expires_at = null
   where j.input_sha256 is distinct from excluded.input_sha256;
  return null;
end;
$function$;
revoke all on function dam.enqueue_search_text_embedding() from public, anon, authenticated;

drop trigger if exists trg_enqueue_search_text_embedding_insert on public.dam_search_documents;
create trigger trg_enqueue_search_text_embedding_insert
  after insert on public.dam_search_documents
  for each row execute function dam.enqueue_search_text_embedding();
drop trigger if exists trg_enqueue_search_text_embedding_update on public.dam_search_documents;
create trigger trg_enqueue_search_text_embedding_update
  after update of search_text on public.dam_search_documents
  for each row when (old.search_text is distinct from new.search_text)
  execute function dam.enqueue_search_text_embedding();

-- ---------------------------------------------------------------- worker RPCs
create or replace function public.claim_dam_search_text_embedding_documents(
  p_limit integer default 50, p_worker_id text default null, p_lease_seconds integer default 300)
returns table(document_type text, entity_id uuid, input_text text, input_sha256 text, model text,
              lease_token uuid, lease_expires_at timestamptz, attempt integer)
language plpgsql security definer set search_path = ''
as $function$
#variable_conflict use_column
declare
  v_model text := dam.search_text_embedding_model();
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 500));
  v_lease interval := make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 300), 3600)));
  v_scanned integer := 0;
  v_claimed integer := 0;
  r record;
  v_text text;
  v_sha text;
  s record;
  v_want integer;
  v_got integer;
  v_last uuid;
begin
  if (coalesce((select auth.role()) = 'service_role', false)
      or pg_has_role(session_user, 'dam_image_embed_worker', 'MEMBER')) is not true
     or nullif(btrim(p_worker_id), '') is null then
    raise exception 'authorized embedding actor and worker id required' using errcode = '42501';
  end if;
  if v_model is null then
    raise exception 'admin_config SEARCH_TEXT_EMBEDDING_MODEL is not set' using errcode = '22023';
  end if;
  -- Seed pre-existing documents from the cursor, a bounded batch per claim
  -- (style groups first). A cursor row locked by another worker is skipped.
  v_want := v_limit * 4;
  for s in
    select st.document_type, st.last_entity_id
      from dam.search_text_seed_state st
     where not st.done
     order by (st.document_type <> 'style_group')
     for update skip locked
  loop
    exit when v_want <= 0;
    with batch as materialized (
      select d.document_type, d.entity_id
        from public.dam_search_documents d
       where d.document_type = s.document_type
         and (s.last_entity_id is null or d.entity_id > s.last_entity_id)
       order by d.entity_id
       limit v_want
    ), ins as (
      insert into dam.search_text_embed_jobs (document_type, entity_id)
      select b.document_type, b.entity_id
        from batch b
       where not exists (select 1 from dam.search_text_vectors v
                          where v.document_type = b.document_type and v.entity_id = b.entity_id
                            and v.model = v_model)
      on conflict on constraint search_text_embed_jobs_pkey do nothing
      returning 1
    )
    select (select count(*) from batch),
           (select b.entity_id from batch b order by b.entity_id desc limit 1)
      into v_got, v_last;
    update dam.search_text_seed_state st
       set last_entity_id = coalesce(v_last, st.last_entity_id), done = (v_got < v_want), updated_at = now()
     where st.document_type = s.document_type;
    v_want := v_want - v_got;
  end loop;
  for r in
    select j.document_type, j.entity_id
      from dam.search_text_embed_jobs j
     where j.error_category is distinct from 'permanent'
       and j.attempts < j.max_attempts
       and (j.next_retry_at is null or j.next_retry_at <= now())
       and (j.lease_expires_at is null or j.lease_expires_at <= now())
     order by (j.document_type <> 'style_group'), j.enqueued_at, j.document_type, j.entity_id
     for update skip locked
  loop
    exit when v_claimed >= v_limit or v_scanned >= v_limit * 4;
    v_scanned := v_scanned + 1;
    v_text := dam.search_text_embedding_input(r.document_type, r.entity_id);
    if v_text is null then
      update dam.search_text_embed_jobs j
         set input_sha256 = null, error = 'empty embedding input', error_category = 'permanent',
             lease_token = null, lease_owner = null, lease_expires_at = null, next_retry_at = null
       where j.document_type = r.document_type and j.entity_id = r.entity_id;
      continue;
    end if;
    v_sha := encode(sha256(convert_to(v_text, 'UTF8')), 'hex');
    if exists (select 1 from dam.search_text_vectors v
                where v.document_type = r.document_type and v.entity_id = r.entity_id
                  and v.input_sha256 = v_sha and v.model = v_model) then
      delete from dam.search_text_embed_jobs j
       where j.document_type = r.document_type and j.entity_id = r.entity_id;
      continue;
    end if;
    update dam.search_text_embed_jobs j
       set input_sha256 = v_sha, lease_token = gen_random_uuid(), lease_owner = left(p_worker_id, 200),
           lease_expires_at = now() + v_lease, attempts = j.attempts + 1
     where j.document_type = r.document_type and j.entity_id = r.entity_id
    returning j.document_type, j.entity_id, v_text, j.input_sha256, v_model,
              j.lease_token, j.lease_expires_at, j.attempts
      into document_type, entity_id, input_text, input_sha256, model,
           lease_token, lease_expires_at, attempt;
    v_claimed := v_claimed + 1;
    return next;
  end loop;
end;
$function$;

create or replace function public.upsert_dam_search_text_embedding(
  p_document_type text, p_entity_id uuid, p_input_sha256 text, p_lease_token uuid,
  p_embedding extensions.halfvec, p_model text)
returns boolean
language plpgsql security definer set search_path = ''
as $function$
declare
  v_model text := dam.search_text_embedding_model();
begin
  if (coalesce((select auth.role()) = 'service_role', false)
      or pg_has_role(session_user, 'dam_image_embed_worker', 'MEMBER')) is not true then
    raise exception 'authorized embedding actor required' using errcode = '42501';
  end if;
  if p_model is distinct from v_model then
    raise exception 'embedding model % does not match SEARCH_TEXT_EMBEDDING_MODEL', p_model using errcode = '22023';
  end if;
  if p_embedding is null or extensions.vector_dims(p_embedding) <> 1024 then
    raise exception 'text embedding must have 1024 dimensions' using errcode = '22023';
  end if;
  delete from dam.search_text_embed_jobs j
   where j.document_type = p_document_type and j.entity_id = p_entity_id
     and j.input_sha256 = p_input_sha256 and j.lease_token = p_lease_token
     and j.lease_expires_at > now();
  if not found then return false; end if;
  insert into dam.search_text_vectors as v (document_type, entity_id, model, input_sha256, embedding, embedded_at)
  values (p_document_type, p_entity_id, p_model, p_input_sha256, p_embedding, now())
  on conflict (document_type, entity_id) do update
     set model = excluded.model, input_sha256 = excluded.input_sha256,
         embedding = excluded.embedding, embedded_at = excluded.embedded_at;
  return true;
end;
$function$;

create or replace function public.mark_dam_search_text_embedding_error(
  p_document_type text, p_entity_id uuid, p_input_sha256 text, p_lease_token uuid,
  p_error text, p_category text default 'transient')
returns boolean
language plpgsql security definer set search_path = ''
as $function$
begin
  if (coalesce((select auth.role()) = 'service_role', false)
      or pg_has_role(session_user, 'dam_image_embed_worker', 'MEMBER')) is not true then
    raise exception 'authorized embedding actor required' using errcode = '42501';
  end if;
  if p_category is null or p_category not in ('transient', 'permanent') then
    raise exception 'invalid embedding error category' using errcode = '22023';
  end if;
  update dam.search_text_embed_jobs j
     set error = left(coalesce(p_error, 'unknown embedding error'), 1000),
         error_category = case when p_category = 'permanent' or j.attempts >= j.max_attempts
                               then 'permanent' else 'transient' end,
         next_retry_at = case when p_category = 'transient' and j.attempts < j.max_attempts
                              then now() + make_interval(secs => least(3600, 30 * (2 ^ greatest(0, j.attempts - 1))::int)) end,
         lease_token = null, lease_owner = null, lease_expires_at = null
   where j.document_type = p_document_type and j.entity_id = p_entity_id
     and j.input_sha256 = p_input_sha256 and j.lease_token = p_lease_token
     and j.lease_expires_at > now();
  return found;
end;
$function$;

create or replace function public.get_dam_search_text_embedding_status()
returns table(model text, total_documents bigint, embedded_documents bigint,
              current_model_documents bigint, pending_documents bigint, leased_documents bigint,
              errored_documents bigint, exhausted_documents bigint,
              oldest_pending_enqueued_at timestamptz, last_embedded_at timestamptz)
language sql stable security definer set search_path = ''
as $function$
  with m as (select dam.search_text_embedding_model() model),
  v as (select count(*) n, count(*) filter (where v.model = (select model from m)) cur, max(v.embedded_at) last
          from dam.search_text_vectors v),
  j as (select count(*) filter (where j.attempts < j.max_attempts and j.error_category is distinct from 'permanent') pending,
               count(*) filter (where j.lease_expires_at > now()) leased,
               count(*) filter (where j.error is not null) errored,
               count(*) filter (where j.attempts >= j.max_attempts or j.error_category = 'permanent') exhausted,
               min(j.enqueued_at) filter (where j.attempts < j.max_attempts and j.error_category is distinct from 'permanent') oldest
          from dam.search_text_embed_jobs j),
  -- Documents not yet reached by the seed cursor count as pending too.
  u as (select count(*) unseeded
          from dam.search_text_seed_state st
          join public.dam_search_documents d
            on d.document_type = st.document_type
           and (st.last_entity_id is null or d.entity_id > st.last_entity_id)
         where not st.done
           and not exists (select 1 from dam.search_text_embed_jobs j
                            where j.document_type = d.document_type and j.entity_id = d.entity_id)
           and not exists (select 1 from dam.search_text_vectors v
                            where v.document_type = d.document_type and v.entity_id = d.entity_id))
  select (select model from m), (select count(*) from public.dam_search_documents),
         v.n, v.cur, j.pending + u.unseeded, j.leased, j.errored, j.exhausted, j.oldest, v.last
    from v, j, u;
$function$;

revoke all on function public.claim_dam_search_text_embedding_documents(integer, text, integer),
                       public.upsert_dam_search_text_embedding(text, uuid, text, uuid, extensions.halfvec, text),
                       public.mark_dam_search_text_embedding_error(text, uuid, text, uuid, text, text),
                       public.get_dam_search_text_embedding_status()
  from public, anon, authenticated, service_role;
-- sandbox: omitted, names production service login(s) absent here: dam_image_embed_worker
-- The definer RPCs call these helpers as their owner; the worker needs no direct grant.
-- sandbox: omitted, names production service login(s) absent here: dam_image_embed_worker

-- ---------------------------------------------------------------- health
-- Same signature and columns; adds corpus 'dam_text'. Pending excludes jobs
-- that can never drain (exhausted or permanent), as for the other corpora.
create or replace function public.get_search_embedding_health()
returns table(corpus text, pending bigint, errored bigint, last_write timestamptz,
              minutes_since_last_write numeric, stale boolean)
language plpgsql stable security definer set search_path = public
as $function$
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role'
     and coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role'
     and not coalesce(public.has_role(auth.uid(),'admin'),false) then
    raise exception 'admin required' using errcode='42501';
  end if;
  return query
  with sg_jobs as (
    select j.*
      from public.style_guide_search_embedding_jobs j
      join public.style_guide_search_documents d
        on d.style_guide_file_id = j.style_guide_file_id
       and d.content_sha256 = j.content_sha256
       and d.embedding is null
  ), counts as (
    select 'dam'::text name,
      (select count(*) from public.dam_search_documents d
       where d.embedding is null and d.embedding_attempts<d.embedding_max_attempts
         and d.embedding_error_category is distinct from 'permanent'
         and nullif(d.metadata->>'thumbnail_url','') is not null) pending_count,
      (select count(*) from public.dam_search_documents d where d.embedding_error is not null) error_count,
      (select max(d.embedding_updated_at) from public.dam_search_documents d where d.embedding_updated_at is not null) written,
      (select min(d.indexed_at) from public.dam_search_documents d
       where d.embedding is null and d.embedding_attempts<d.embedding_max_attempts
         and d.embedding_error_category is distinct from 'permanent'
         and nullif(d.metadata->>'thumbnail_url','') is not null) oldest
    union all
    select 'popsg',
      (select count(*) from public.style_guide_search_documents d
       where d.is_active and d.content_sha256 is not null and d.embedding is null
         and not exists (select 1 from sg_jobs j where j.style_guide_file_id = d.style_guide_file_id
                            and (j.attempt_count >= j.max_attempts or j.error_category = 'permanent'))
         and exists(select 1 from public.style_guide_files f where f.id=d.style_guide_file_id and f.thumbnail_url is not null)),
      (select count(*) from sg_jobs j where j.error is not null),
      (select max(d.embedding_updated_at) from public.style_guide_search_documents d where d.is_active and d.embedding_updated_at is not null),
      (select min(d.document_updated_at) from public.style_guide_search_documents d
       where d.is_active and d.content_sha256 is not null and d.embedding is null
         and not exists (select 1 from sg_jobs j where j.style_guide_file_id = d.style_guide_file_id
                            and (j.attempt_count >= j.max_attempts or j.error_category = 'permanent'))
         and exists(select 1 from public.style_guide_files f where f.id=d.style_guide_file_id and f.thumbnail_url is not null))
    union all
    select 'dam_text',
      (select pending_documents from public.get_dam_search_text_embedding_status()),
      (select count(*) from dam.search_text_embed_jobs j where j.error is not null),
      (select max(v.embedded_at) from dam.search_text_vectors v),
      (select min(j.enqueued_at) from dam.search_text_embed_jobs j
       where j.attempts<j.max_attempts and j.error_category is distinct from 'permanent')
  )
  select name,pending_count,error_count,written,extract(epoch from(now()-written))/60,
    pending_count>0 and (coalesce(written,oldest) is null or coalesce(written,oldest)<=now()-interval '120 minutes')
  from counts;
end;
$function$;

-- ---------------------------------------------------------------- verify
do $verify$
declare f text;
begin
  foreach f in array array[
    'public.claim_dam_search_text_embedding_documents(integer, text, integer)',
    'public.upsert_dam_search_text_embedding(text, uuid, text, uuid, extensions.halfvec, text)',
    'public.mark_dam_search_text_embedding_error(text, uuid, text, uuid, text, text)',
    'public.get_dam_search_text_embedding_status()'] loop
    if exists (select 1 from pg_roles where rolname = 'dam_image_embed_worker')
       and not has_function_privilege('dam_image_embed_worker', f, 'execute') then
      raise exception 'VERIFY FAILED: dam_image_embed_worker lacks execute on %', f;
    end if;
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception 'VERIFY FAILED: a browser role may execute %', f;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'dam.search_text_vectors', 'select')
     or has_table_privilege('anon', 'dam.search_text_vectors', 'select') then
    raise exception 'VERIFY FAILED: a browser role can read dam.search_text_vectors';
  end if;
end
$verify$;

commit;

-- ===== replay of 20261204003530_dam_search_property_scope_either_key.sql =====
-- u2giants/popdam3#1037 Step 2 follow-up (review finding popcre/shared-db#6609, claim #6607).
-- 20261204003329 applied the property accepted set only when semanticPropertyIds was present, so a
-- caller sending semanticPropertyCharacterIds alone got no scope (and the anchor ignored it too).
-- The edge function always sends both, but the contract should not depend on that: the scope now
-- applies when EITHER list is present (property match OR linked-character match), in the search
-- and in dam_search_semantic_anchor_named alike. Body-only changes; signatures, grants, owners and
-- settings unchanged. Absent keys = unchanged behaviour.
begin;
set local lock_timeout='500ms';
set local statement_timeout='2500ms';
set local transaction_timeout='3s';
set local search_path=pg_catalog,public,extensions;

do $guard$
begin
  if not exists (select 1 from pg_proc p where p.oid=to_regprocedure('public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real)')
      and md5(p.prosrc) in ('7d49762f87b9ea8322808920734917b3','eb6a2babf5fdee4f54f3bfd968679e32')) then
    raise exception 'popdam3#1037 pre-change search_dam_documents differs from 20261204003329; reconcile rather than overwrite';
  end if;
  if not exists (select 1 from pg_proc p where p.oid=to_regprocedure('public.dam_search_semantic_anchor_named(extensions.vector,text[],jsonb)')
      and md5(p.prosrc) in ('e26929fe2a0e8b9973f8f6620b20bf1a','8fee795ca09055b79cf20d1ed1c8ff81')) then
    raise exception 'popdam3#1037 pre-change dam_search_semantic_anchor_named differs from 20261204003329; reconcile rather than overwrite';
  end if;
end;
$guard$;

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
      1000 summary_probe_limit,
      -- popdam3#892: when a search names a licensor, the caller passes its id(s) here and a
      -- document matched by its picture ALONE must belong to one of them. Keyword matches,
      -- and the picture score of a document that also matched by keyword, are untouched.
      (select array_agg(x.id::uuid)
       from jsonb_array_elements_text(
         case when jsonb_typeof(p_filters->'semanticLicensorIds')='array'
           then p_filters->'semanticLicensorIds' else '[]'::jsonb end) x(id)) semantic_licensor_ids,
      -- popdam3#1037 Step 2 (owner D1): a search that names a character returns only products
      -- that contain it, from EVERY leg: a document is kept only when one of its non-deleted
      -- files (its style group's files; an ungrouped asset itself) is tagged with one of these
      -- core (requiredCharacterIds) or legacy (requiredLegacyCharacterIds) character ids.
      public.dam_search_uuid_list(p_filters->'requiredCharacterIds') required_character_ids,
      public.dam_search_uuid_list(p_filters->'requiredLegacyCharacterIds') required_legacy_character_ids,
      -- ...or whose own search text carries one of the typed character names as whole words
      -- (21% of named style groups lack the tag; measured 2026-11-17, plan Step 2 fallback).
      public.dam_search_name_queries(p_filters->'requiredCharacterNames') required_character_names,
      -- popdam3#1037 Step 2 (D8): a search that names a property (and no character) keeps a
      -- picture-only match only when it carries that property or one of its linked characters.
      public.dam_search_uuid_list(p_filters->'semanticPropertyIds') semantic_property_ids,
      public.dam_search_uuid_list(p_filters->'semanticPropertyCharacterIds') semantic_property_character_ids
    where public.require_dam_access()
  ), queries as materialized (
    select q.query_text, websearch_to_tsquery('simple', regexp_replace(q.query_text, '[-_/]+', ' ', 'g')) tsq,
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
  ), full_text_matches as materialized (
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,d.title,d.title_key,d.title_tsv
    from public.dam_search_keys d
    where (p_document_types is null or d.document_type = any(p_document_types))
      and d.search_tsv @@ any(array(select distinct q.tsq from queries q))
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
  ), candidate_ranks as materialized (
    select c.document_type,c.entity_id,c.asset_id,c.style_group_id,max(c.keyword_rank)::real keyword_rank,
      max(c.semantic_rank)::real semantic_rank,
      (coalesce(max(c.keyword_rank),0) + coalesce(max(c.semantic_rank),0) * 0.35)::real rank
    from (select k.*,null::real semantic_rank from keyword_candidates k union all
      select s.document_type,s.entity_id,s.asset_id,s.style_group_id,null::real,s.semantic_rank from semantic_candidates s) c
    group by c.document_type,c.entity_id,c.asset_id,c.style_group_id
    having coalesce(max(c.keyword_rank),0) + coalesce(max(c.semantic_rank),0) * 0.35 >= (select min_rank from params)
      and ((select semantic_licensor_ids from params) is null
        or max(c.keyword_rank) is not null
        -- a grouped document takes its style group's licensor, an ungrouped asset its own
        or exists (select 1 from public.style_groups g
          where g.id = c.style_group_id
            and g.licensor_id = any((select semantic_licensor_ids from params)::uuid[]))
        or (c.style_group_id is null and exists (select 1 from public.assets a
          where a.id = c.asset_id
            and a.licensor_id = any((select semantic_licensor_ids from params)::uuid[]))))
      -- popdam3#1037: property accepted set, picture-only matches only.
      and ((select semantic_property_ids from params) is null
           and (select semantic_property_character_ids from params) is null
        or max(c.keyword_rank) is not null
        or exists (select 1 from public.style_groups g
          where g.id = c.style_group_id
            and g.property_id = any((select semantic_property_ids from params)::uuid[]))
        or (c.style_group_id is null and exists (select 1 from public.assets a
          where a.id = c.asset_id
            and a.property_id = any((select semantic_property_ids from params)::uuid[])))
        or exists (select 1 from public.assets m
          join public.asset_licensor_characters t on t.asset_id = m.id
          where ((c.style_group_id is not null and m.style_group_id = c.style_group_id)
              or (c.style_group_id is null and m.id = c.asset_id))
            and not m.is_deleted
            and t.character_id = any((select semantic_property_character_ids from params)::uuid[])))
      -- popdam3#1037: named character, every leg.
      and ((select required_character_ids from params) is null
           and (select required_legacy_character_ids from params) is null
           and (select required_character_names from params) is null
        or exists (select 1 from public.dam_search_keys k
          where k.document_type = c.document_type and k.entity_id = c.entity_id
            and k.search_tsv @@ any((select required_character_names from params)::tsquery[]))
        or exists (select 1 from public.assets m
          where ((c.style_group_id is not null and m.style_group_id = c.style_group_id)
              or (c.style_group_id is null and m.id = c.asset_id))
            and not m.is_deleted
            and (exists (select 1 from public.asset_licensor_characters t
                  where t.asset_id = m.id
                    and t.character_id = any((select required_character_ids from params)::uuid[]))
              or exists (select 1 from public.asset_characters t
                  where t.asset_id = m.id
                    and t.character_id = any((select required_legacy_character_ids from params)::uuid[])))))
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
    -- semanticLicensorIds and the #1037 character/property scopes are not visibility filters
    -- (they are applied to candidates above): strip them so the unfiltered fast paths still apply.
    select coalesce(p_filters,'{}'::jsonb)-'search'-'semanticLicensorIds'
      -'requiredCharacterIds'-'requiredLegacyCharacterIds'-'requiredCharacterNames'
      -'semanticPropertyIds'-'semanticPropertyCharacterIds' f,
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
  ), default_flag_state as materialized (
    -- #5747 Step 5: unfiltered exact-count fast path. Usable only when the
    -- request has no filters AND every candidate document carries a flag
    -- computed with the CURRENT thumbnail min date for the same members.
    -- Any doubt falls back to the per-document probe below (exact either way).
    select count(*) filter (where d.has_default_visible_member) flagged_visible,
      -- #5938: visible member assets summed over candidates. visible_assets has
      -- one row per (candidate, probe-visible member), so this sum is exactly
      -- its unlimited row count when every count is current.
      coalesce(sum(d.default_visible_member_count), 0) visible_member_rows,
      coalesce(bool_and(d.default_visible_member_count is not null), true) all_counts_current,
      coalesce(bool_and(d.has_default_visible_member is not null
        and d.default_visible_min_date = v.thumbnail_min_date
        and d.asset_id is not distinct from c.asset_id
        and d.style_group_id is not distinct from c.style_group_id), true) all_current
    from visibility_params v
    join ordered_candidates c on v.f = '{}'::jsonb
    left join public.dam_search_documents d
      on d.document_type = c.document_type and d.entity_id = c.entity_id
    group by v.thumbnail_min_date
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
    -- bounds. Fast path (#5747): unfiltered request with every flag current
    -- -> count maintained flags. Otherwise count EVERY candidate document
    -- that has at least one member asset passing the same visibility
    -- predicate, short-circuiting per document (LIMIT 1).
    select case
      when (select f from visibility_params) = '{}'::jsonb
       and coalesce((select all_current from default_flag_state), true)
      then coalesce((select flagged_visible from default_flag_state), 0)
      else (
        select count(*) from (
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
      )
    end total_count
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
  v_characters uuid[] := public.dam_search_uuid_list(p_filters->'requiredCharacterIds');
  v_legacy uuid[] := public.dam_search_uuid_list(p_filters->'requiredLegacyCharacterIds');
  v_names tsquery[] := public.dam_search_name_queries(p_filters->'requiredCharacterNames');
  v_properties uuid[] := public.dam_search_uuid_list(p_filters->'semanticPropertyIds');
  v_property_characters uuid[] := public.dam_search_uuid_list(p_filters->'semanticPropertyCharacterIds');
  v_score real;
begin
  if not coalesce(public.require_dam_access(), false) then
    return null;
  end if;
  if p_query_embedding is null
     or (v_licensors is null and v_characters is null and v_legacy is null and v_names is null
         and v_properties is null and v_property_characters is null) then
    return public.dam_search_semantic_anchor(p_query_embedding, p_document_types);
  end if;

  perform pg_catalog.set_config('hnsw.ef_search', '100', true);
  perform pg_catalog.set_config('hnsw.iterative_scan', 'relaxed_order', true);
  perform pg_catalog.set_config('hnsw.max_scan_tuples', '2000', true);

  if p_document_types is not null and not ('asset' = any(p_document_types))
     and 'style_group' = any(p_document_types) then
    -- style-group-only: exact leg, as in search_dam_documents.
    select greatest(0, 1 - min(d.embedding operator(extensions.<=>) p_query_embedding))::real
    into v_score
    from dam.search_group_vectors d
    where d.embedding is not null
      and d.embedding_model = 'google/siglip2-base-patch16-naflex'
      and d.document_type = 'style_group'
      and (
        -- licensor scope (#892): grouped document -> its style group's licensor, ungrouped asset -> its own
        (v_licensors is null
          or (d.style_group_id is not null and exists (select 1 from public.style_groups g
                where g.id = d.style_group_id and g.licensor_id = any(v_licensors)))
          or (d.style_group_id is null and exists (select 1 from public.assets a
                where a.id = d.asset_id and a.licensor_id = any(v_licensors))))
        -- property accepted set (#1037): the property itself or one of its linked characters
        and ((v_properties is null and v_property_characters is null)
          or (d.style_group_id is not null and exists (select 1 from public.style_groups g
                where g.id = d.style_group_id and g.property_id = any(v_properties)))
          or (d.style_group_id is null and exists (select 1 from public.assets a
                where a.id = d.asset_id and a.property_id = any(v_properties)))
          or exists (select 1 from public.assets m
                join public.asset_licensor_characters t on t.asset_id = m.id
                where ((d.style_group_id is not null and m.style_group_id = d.style_group_id)
                    or (d.style_group_id is null and m.id = d.asset_id))
                  and not m.is_deleted and t.character_id = any(v_property_characters)))
        -- named character (#1037): tagged on a non-deleted file, or named in the document's text
        and ((v_characters is null and v_legacy is null and v_names is null)
          or exists (select 1 from public.dam_search_keys k
                where k.document_type = d.document_type and k.entity_id = d.entity_id
                  and k.search_tsv @@ any(v_names))
          or exists (select 1 from public.assets m
                where ((d.style_group_id is not null and m.style_group_id = d.style_group_id)
                    or (d.style_group_id is null and m.id = d.asset_id))
                  and not m.is_deleted
                  and (exists (select 1 from public.asset_licensor_characters t
                         where t.asset_id = m.id and t.character_id = any(v_characters))
                    or exists (select 1 from public.asset_characters t
                         where t.asset_id = m.id and t.character_id = any(v_legacy))))))
    having count(*) > 0;
  elsif p_document_types is null
     or exists (select 1 from unnest(p_document_types) t where t is distinct from 'style_group') then
    select greatest(0, 1 - (d.embedding operator(extensions.<=>) p_query_embedding))::real
    into v_score
    from public.dam_search_documents d
    where d.embedding is not null
      and d.embedding_model = 'google/siglip2-base-patch16-naflex'
      and (p_document_types is null or d.document_type = any(p_document_types))
      and (
        -- licensor scope (#892): grouped document -> its style group's licensor, ungrouped asset -> its own
        (v_licensors is null
          or (d.style_group_id is not null and exists (select 1 from public.style_groups g
                where g.id = d.style_group_id and g.licensor_id = any(v_licensors)))
          or (d.style_group_id is null and exists (select 1 from public.assets a
                where a.id = d.asset_id and a.licensor_id = any(v_licensors))))
        -- property accepted set (#1037): the property itself or one of its linked characters
        and ((v_properties is null and v_property_characters is null)
          or (d.style_group_id is not null and exists (select 1 from public.style_groups g
                where g.id = d.style_group_id and g.property_id = any(v_properties)))
          or (d.style_group_id is null and exists (select 1 from public.assets a
                where a.id = d.asset_id and a.property_id = any(v_properties)))
          or exists (select 1 from public.assets m
                join public.asset_licensor_characters t on t.asset_id = m.id
                where ((d.style_group_id is not null and m.style_group_id = d.style_group_id)
                    or (d.style_group_id is null and m.id = d.asset_id))
                  and not m.is_deleted and t.character_id = any(v_property_characters)))
        -- named character (#1037): tagged on a non-deleted file, or named in the document's text
        and ((v_characters is null and v_legacy is null and v_names is null)
          or exists (select 1 from public.dam_search_keys k
                where k.document_type = d.document_type and k.entity_id = d.entity_id
                  and k.search_tsv @@ any(v_names))
          or exists (select 1 from public.assets m
                where ((d.style_group_id is not null and m.style_group_id = d.style_group_id)
                    or (d.style_group_id is null and m.id = d.asset_id))
                  and not m.is_deleted
                  and (exists (select 1 from public.asset_licensor_characters t
                         where t.asset_id = m.id and t.character_id = any(v_characters))
                    or exists (select 1 from public.asset_characters t
                         where t.asset_id = m.id and t.character_id = any(v_legacy))))))
    order by d.embedding operator(extensions.<=>) p_query_embedding
    limit 1;
  end if;

  if v_score is null then
    perform pg_catalog.set_config('hnsw.max_scan_tuples', '20000', true);
    return public.dam_search_semantic_anchor(p_query_embedding, p_document_types);
  end if;
  return v_score;
end;
$function$;

do $guard$
begin
  if not exists (select 1 from pg_proc p where p.oid=to_regprocedure('public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real)')
      and md5(p.prosrc)='eb6a2babf5fdee4f54f3bfd968679e32'
      and pg_get_userbyid(p.proowner)='postgres'
      and p.prosecdef and p.provolatile='s' and p.proretset
      and p.proconfig=ARRAY['search_path=public, extensions','statement_timeout=30s']::text[]
      and p.proacl::text='{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}') then
    raise exception 'popdam3#1037 installed search contract differs; reconcile rather than overwrite';
  end if;
  if not exists (select 1 from pg_proc p where p.oid=to_regprocedure('public.dam_search_semantic_anchor_named(extensions.vector,text[],jsonb)')
      and md5(p.prosrc)='8fee795ca09055b79cf20d1ed1c8ff81' and p.prosecdef
      and not has_function_privilege('anon', p.oid, 'execute')) then
    raise exception 'popdam3#1037 installed anchor contract differs; reconcile rather than overwrite';
  end if;
end;
$guard$;

commit;

-- ===== replay of 20261204003532_search_embedding_health_fast.sql =====
-- Claim popcre/shared-db#6630. Application u2giants/popdam3#1037 (Production
-- Canary calls public.get_search_embedding_health()).
--
-- Problem (production, read-only, 2026-11-17 8 PM EST): the health function took
-- 63 s, so PostgREST returned 500. The time was full scans on an IO-capped disk:
--   dam   max(embedding_updated_at) and count(embedding_error) - seq scans of
--         public.dam_search_documents (462 MB heap): 28 s
--   popsg max(embedding_updated_at) - seq scan of style_guide_search_documents: 13 s
--   dam_text not-yet-seeded count over the asset key range: 6 s
--
-- Fix, same signature and columns, same stale rule (pending > 0 and no write
-- for 120 minutes):
--   * last write for dam and popsg comes from dam.search_embedding_last_write, a
--     two-row table kept current by row triggers that fire only when a row's
--     embedding_updated_at changes. It starts empty (no full scan is run to
--     seed it): until the first write after this migration last_write is null
--     and staleness is judged, as before, from the oldest pending document.
--     Read-only check at authoring: dam and popsg had 0 pending, so no false alarm.
--   * dam errored counts errors on documents without a picture vector, read
--     through the existing partial index on embedding IS NULL (an error is only
--     ever recorded on a leased, unembedded document; a successful write clears it).
--   * dam_text pending is queued jobs plus one for each seed cursor that has not
--     finished, so it stays > 0 while existing documents are still entering the
--     queue; the exact figure remains in get_dam_search_text_embedding_status().
--     dam_text last write reads a new index on dam.search_text_vectors(embedded_at).
-- Every statement here is bounded: two-row inserts, an index on a small table,
-- triggers (lock_timeout bounded) and function replacement.

begin;
set local lock_timeout = '20s';

create table if not exists dam.search_embedding_last_write (
  corpus text primary key check (corpus in ('dam', 'popsg')),
  last_write timestamptz,
  created_at timestamptz not null default now()
);
insert into dam.search_embedding_last_write(corpus) values ('dam'), ('popsg')
on conflict (corpus) do nothing;
alter table dam.search_embedding_last_write enable row level security;
revoke all on dam.search_embedding_last_write from public, anon, authenticated, service_role;

create or replace function dam.note_search_embedding_write()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
begin
  update dam.search_embedding_last_write w
     set last_write = greatest(coalesce(w.last_write, new.embedding_updated_at), new.embedding_updated_at)
   where w.corpus = tg_argv[0]
     and (w.last_write is null or w.last_write < new.embedding_updated_at);
  return null;
end;
$function$;
revoke all on function dam.note_search_embedding_write() from public, anon, authenticated;

drop trigger if exists trg_note_dam_search_embedding_write on public.dam_search_documents;
create trigger trg_note_dam_search_embedding_write
  after insert or update of embedding_updated_at on public.dam_search_documents
  for each row when (new.embedding_updated_at is not null)
  execute function dam.note_search_embedding_write('dam');

drop trigger if exists trg_note_sg_search_embedding_write on public.style_guide_search_documents;
create trigger trg_note_sg_search_embedding_write
  after insert or update of embedding_updated_at on public.style_guide_search_documents
  for each row when (new.embedding_updated_at is not null and new.is_active)
  execute function dam.note_search_embedding_write('popsg');

create index if not exists search_text_vectors_embedded_at_idx
  on dam.search_text_vectors (embedded_at desc);

create or replace function public.get_search_embedding_health()
returns table(corpus text, pending bigint, errored bigint, last_write timestamptz,
              minutes_since_last_write numeric, stale boolean)
language plpgsql stable security definer set search_path = public
as $function$
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role'
     and coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role'
     and not coalesce(public.has_role(auth.uid(),'admin'),false) then
    raise exception 'admin required' using errcode='42501';
  end if;
  return query
  with sg_jobs as (
    select j.*
      from public.style_guide_search_embedding_jobs j
      join public.style_guide_search_documents d
        on d.style_guide_file_id = j.style_guide_file_id
       and d.content_sha256 = j.content_sha256
       and d.embedding is null
  ), text_jobs as (
    -- One pass over the text queue.
    select count(*) filter (where j.attempts<j.max_attempts and j.error_category is distinct from 'permanent') pending,
           count(*) filter (where j.error is not null) errored,
           min(j.enqueued_at) filter (where j.attempts<j.max_attempts and j.error_category is distinct from 'permanent') oldest
      from dam.search_text_embed_jobs j
  ), counts as (
    select 'dam'::text name,
      (select count(*) from public.dam_search_documents d
       where d.embedding is null and d.embedding_attempts<d.embedding_max_attempts
         and d.embedding_error_category is distinct from 'permanent'
         and nullif(d.metadata->>'thumbnail_url','') is not null) pending_count,
      (select count(*) from public.dam_search_documents d
       where d.embedding is null and d.embedding_error is not null) error_count,
      (select w.last_write from dam.search_embedding_last_write w where w.corpus = 'dam') written,
      (select min(d.indexed_at) from public.dam_search_documents d
       where d.embedding is null and d.embedding_attempts<d.embedding_max_attempts
         and d.embedding_error_category is distinct from 'permanent'
         and nullif(d.metadata->>'thumbnail_url','') is not null) oldest
    union all
    select 'popsg',
      (select count(*) from public.style_guide_search_documents d
       where d.is_active and d.content_sha256 is not null and d.embedding is null
         and not exists (select 1 from sg_jobs j where j.style_guide_file_id = d.style_guide_file_id
                            and (j.attempt_count >= j.max_attempts or j.error_category = 'permanent'))
         and exists(select 1 from public.style_guide_files f where f.id=d.style_guide_file_id and f.thumbnail_url is not null)),
      (select count(*) from sg_jobs j where j.error is not null),
      (select w.last_write from dam.search_embedding_last_write w where w.corpus = 'popsg'),
      (select min(d.document_updated_at) from public.style_guide_search_documents d
       where d.is_active and d.content_sha256 is not null and d.embedding is null
         and not exists (select 1 from sg_jobs j where j.style_guide_file_id = d.style_guide_file_id
                            and (j.attempt_count >= j.max_attempts or j.error_category = 'permanent'))
         and exists(select 1 from public.style_guide_files f where f.id=d.style_guide_file_id and f.thumbnail_url is not null))
    union all
    select 'dam_text',
      tj.pending + (select count(*) from dam.search_text_seed_state st where not st.done),
      tj.errored,
      (select max(v.embedded_at) from dam.search_text_vectors v),
      tj.oldest
    from text_jobs tj
  )
  select name,pending_count,error_count,written,extract(epoch from(now()-written))/60,
    pending_count>0 and (coalesce(written,oldest) is null or coalesce(written,oldest)<=now()-interval '120 minutes')
  from counts;
end;
$function$;

commit;

-- ===== replay of 20261204003632_dam_search_text_meaning_leg.sql =====
-- u2giants/popdam3#1037 Step 6: text-meaning leg in public.search_dam_documents; picture-only
-- matches demoted when words or meaning found real answers.
-- Plan docs/plans/issue-1037-typed-search-meaning-matching.md (u2giants/popdam3) Step 6, D4/D5/D7/O3.
-- Change:
--   * Three new optional trailing parameters: p_query_text_embedding halfvec(1024) (Qwen3 vector
--     of the typed words, from the same model stamp as dam.search_text_vectors),
--     p_min_text_score (optional absolute text floor) and p_text_score_margin (relative floor,
--     default 0.10 below the best in-scope text score). One new output column, text_rank.
--     Every existing caller (named or positional, 8 arguments) is unaffected: with no text vector
--     the body ranks, filters and pages exactly as 20261204003530 did.
--   * With a text vector: text_candidates (HNSW over dam.search_text_vectors; style-group-only
--     searches walk the style-group partial index), model equal to
--     dam.search_text_embedding_model(); rank = keyword + 0.6 x text + 0.15 x picture; licensor,
--     property and named-character rules apply to text-only matches exactly as to picture-only
--     ones; a picture-only match is kept only when the word and text legs found fewer than 10
--     visible results.
--   * The signature gains parameters, so the function is dropped and recreated in this
--     transaction (a second overload would make PostgREST calls ambiguous). Owner, grants and
--     settings are restored and checked below. Its two SQL-language callers
--     (search_assets_full_text, search_style_groups_full_text) resolve by name at run time.
--   * admin_config SEARCH_TEXT_LEG_MODE = 'off' (insert only; never overwrites a set value).
--     The edge function sends a text vector only when it is 'on'.
begin;
set local lock_timeout='500ms';
set local statement_timeout='2500ms';
set local transaction_timeout='3s';
set local search_path=pg_catalog,public,extensions;

do $guard$
begin
  if not exists (select 1 from pg_proc p where p.oid=to_regprocedure('public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real)')
      and md5(p.prosrc)='eb6a2babf5fdee4f54f3bfd968679e32') then
    raise exception 'popdam3#1037 Step 6: pre-change search_dam_documents differs from 20261204003530; reconcile rather than overwrite';
  end if;
  if to_regprocedure('dam.search_text_embedding_model()') is null or to_regclass('dam.search_text_vectors') is null then
    raise exception 'popdam3#1037 Step 6: text-vector storage (20261204003429) is missing';
  end if;
end;
$guard$;

insert into public.admin_config(key, value)
values ('SEARCH_TEXT_LEG_MODE', to_jsonb('off'::text))
on conflict (key) do nothing;

drop function public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real);

CREATE FUNCTION public.search_dam_documents(p_query text, p_filters jsonb, p_limit integer, p_offset integer, p_document_types text[] DEFAULT NULL::text[], p_query_embedding extensions.vector DEFAULT NULL::extensions.vector, p_min_rank real DEFAULT 0, p_min_semantic_score real DEFAULT NULL::real, p_query_text_embedding extensions.halfvec DEFAULT NULL::extensions.halfvec, p_min_text_score real DEFAULT NULL::real, p_text_score_margin real DEFAULT NULL::real)
 RETURNS TABLE(document_type text, entity_id uuid, asset_id uuid, style_group_id uuid, keyword_rank real, semantic_rank real, rank real, total_count bigint, has_more boolean, facets jsonb, text_rank real)
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
      -- popdam3#1037 Step 2 (owner D1): a search that names a character returns only products
      -- that contain it, from EVERY leg: a document is kept only when one of its non-deleted
      -- files (its style group's files; an ungrouped asset itself) is tagged with one of these
      -- core (requiredCharacterIds) or legacy (requiredLegacyCharacterIds) character ids.
      public.dam_search_uuid_list(p_filters->'requiredCharacterIds') required_character_ids,
      public.dam_search_uuid_list(p_filters->'requiredLegacyCharacterIds') required_legacy_character_ids,
      -- ...or whose own search text carries one of the typed character names as whole words
      -- (21% of named style groups lack the tag; measured 2026-11-17, plan Step 2 fallback).
      public.dam_search_name_queries(p_filters->'requiredCharacterNames') required_character_names,
      -- popdam3#1037 Step 2 (D8): a search that names a property (and no character) keeps a
      -- picture-only match only when it carries that property or one of its linked characters.
      public.dam_search_uuid_list(p_filters->'semanticPropertyIds') semantic_property_ids,
      public.dam_search_uuid_list(p_filters->'semanticPropertyCharacterIds') semantic_property_character_ids
    where public.require_dam_access()
  ), queries as materialized (
    select q.query_text, websearch_to_tsquery('simple', regexp_replace(q.query_text, '[-_/]+', ' ', 'g')) tsq,
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
  ), full_text_matches as materialized (
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,d.title,d.title_key,d.title_tsv
    from public.dam_search_keys d
    where (p_document_types is null or d.document_type = any(p_document_types))
      and d.search_tsv @@ any(array(select distinct q.tsq from queries q))
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
    limit 2000
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
    limit 2000
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
      and ((select semantic_property_ids from params) is null
           and (select semantic_property_character_ids from params) is null
        or max(c.keyword_rank) is not null
        or exists (select 1 from public.style_groups g
          where g.id = c.style_group_id
            and g.property_id = any((select semantic_property_ids from params)::uuid[]))
        or (c.style_group_id is null and exists (select 1 from public.assets a
          where a.id = c.asset_id
            and a.property_id = any((select semantic_property_ids from params)::uuid[])))
        or exists (select 1 from public.assets m
          join public.asset_licensor_characters t on t.asset_id = m.id
          where ((c.style_group_id is not null and m.style_group_id = c.style_group_id)
              or (c.style_group_id is null and m.id = c.asset_id))
            and not m.is_deleted
            and t.character_id = any((select semantic_property_character_ids from params)::uuid[])))
      -- popdam3#1037: named character, every leg.
      and ((select required_character_ids from params) is null
           and (select required_legacy_character_ids from params) is null
           and (select required_character_names from params) is null
        or exists (select 1 from public.dam_search_keys k
          where k.document_type = c.document_type and k.entity_id = c.entity_id
            and k.search_tsv @@ any((select required_character_names from params)::tsquery[]))
        or exists (select 1 from public.assets m
          where ((c.style_group_id is not null and m.style_group_id = c.style_group_id)
              or (c.style_group_id is null and m.id = c.asset_id))
            and not m.is_deleted
            and (exists (select 1 from public.asset_licensor_characters t
                  where t.asset_id = m.id
                    and t.character_id = any((select required_character_ids from params)::uuid[]))
              or exists (select 1 from public.asset_characters t
                  where t.asset_id = m.id
                    and t.character_id = any((select required_legacy_character_ids from params)::uuid[])))))
  ), text_floor as materialized (
    select greatest(coalesce((select min_text_score from params),0),
      max(c.text_rank_raw) - (select text_score_margin from params))::real floor
    from candidate_pool c
  ), classified as materialized (
    select c.document_type,c.entity_id,c.asset_id,c.style_group_id,c.keyword_rank,c.semantic_rank,
      (case when c.text_rank_raw >= (select floor from text_floor) then c.text_rank_raw end)::real text_rank
    from candidate_pool c
  ), visibility_params as materialized (
    -- semanticLicensorIds and the #1037 character/property scopes are not visibility filters
    -- (they are applied to candidates above): strip them so the unfiltered fast paths still apply.
    select coalesce(p_filters,'{}'::jsonb)-'search'-'semanticLicensorIds'
      -'requiredCharacterIds'-'requiredLegacyCharacterIds'-'requiredCharacterNames'
      -'semanticPropertyIds'-'semanticPropertyCharacterIds' f,
    public.assets_thumbnail_min_date() thumbnail_min_date
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
          where public.dam_asset_matches_filters(
            a.id, a.is_deleted, a.modified_at, a.file_created_at, a.thumbnail_url,
            a.style_group_id, a.licensor_id, sg.licensor_id, a.property_id, sg.property_id,
            a.customer_id, sg.customer_id, a.file_type, a.content_type, a.product_material,
            a.status, a.workflow_status, a.stage, a.is_licensed, a.asset_type, a.art_source,
            a.thumbnail_error, a.product_category, a.relative_path, a.customer, a.program,
            v.f, v.thumbnail_min_date))
      limit 10
    ) j
  ), candidate_ranks as materialized (
    -- Text leg off: rank = keyword + 0.35 x picture (unchanged). On (plan O3 start):
    -- rank = keyword + 0.6 x text + 0.15 x picture.
    select r.* from (
      select c.document_type,c.entity_id,c.asset_id,c.style_group_id,c.keyword_rank,c.semantic_rank,c.text_rank,
        (coalesce(c.keyword_rank,0) + case when (select has_text_embedding from params)
          then coalesce(c.text_rank,0) * 0.6 + coalesce(c.semantic_rank,0) * 0.15
          else coalesce(c.semantic_rank,0) * 0.35 end)::real rank
      from classified c
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
    where public.dam_asset_matches_filters(
          a.id, a.is_deleted, a.modified_at, a.file_created_at, a.thumbnail_url,
          a.style_group_id, a.licensor_id, sg.licensor_id, a.property_id, sg.property_id,
          a.customer_id, sg.customer_id, a.file_type, a.content_type, a.product_material,
          a.status, a.workflow_status, a.stage, a.is_licensed, a.asset_type, a.art_source,
          a.thumbnail_error, a.product_category, a.relative_path, a.customer, a.program,
          v.f, v.thumbnail_min_date)
    order by c.rn
    limit (select summary_probe_limit + 1 from params)
  ), default_flag_state as materialized (
    -- #5747 Step 5: unfiltered exact-count fast path. Usable only when the
    -- request has no filters AND every candidate document carries a flag
    -- computed with the CURRENT thumbnail min date for the same members.
    -- Any doubt falls back to the per-document probe below (exact either way).
    select count(*) filter (where d.has_default_visible_member) flagged_visible,
      -- #5938: visible member assets summed over candidates. visible_assets has
      -- one row per (candidate, probe-visible member), so this sum is exactly
      -- its unlimited row count when every count is current.
      coalesce(sum(d.default_visible_member_count), 0) visible_member_rows,
      coalesce(bool_and(d.default_visible_member_count is not null), true) all_counts_current,
      coalesce(bool_and(d.has_default_visible_member is not null
        and d.default_visible_min_date = v.thumbnail_min_date
        and d.asset_id is not distinct from c.asset_id
        and d.style_group_id is not distinct from c.style_group_id), true) all_current
    from visibility_params v
    join ordered_candidates c on v.f = '{}'::jsonb
    left join public.dam_search_documents d
      on d.document_type = c.document_type and d.entity_id = c.entity_id
    group by v.thumbnail_min_date
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
    -- bounds. Fast path (#5747): unfiltered request with every flag current
    -- -> count maintained flags. Otherwise count EVERY candidate document
    -- that has at least one member asset passing the same visibility
    -- predicate, short-circuiting per document (LIMIT 1).
    select case
      when (select f from visibility_params) = '{}'::jsonb
       and coalesce((select all_current from default_flag_state), true)
      then coalesce((select flagged_visible from default_flag_state), 0)
      else (
        select count(*) from (
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
      )
    end total_count
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
    select r.document_type,r.entity_id,r.asset_id,r.style_group_id,r.keyword_rank,r.semantic_rank,r.rank,r.text_rank
    from page_documents r order by r.rn
    offset (select page_offset from params) limit (select page_limit from params)
  )
  select p.document_type,p.entity_id,p.asset_id,p.style_group_id,p.keyword_rank,p.semantic_rank,p.rank,
    s.total_count,
    (select visible_through_page from page_state) > (select page_offset+page_limit from params),
    s.facets, p.text_rank
  from summary s
  left join page p on true
  order by p.rank desc nulls last, p.document_type nulls last, p.entity_id nulls last;
$function$;

alter function public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real,extensions.halfvec,real,real) owner to postgres;
revoke all on function public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real,extensions.halfvec,real,real) from public, anon;
grant execute on function public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real,extensions.halfvec,real,real) to service_role;
grant execute on function public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real,extensions.halfvec,real,real) to authenticated;

do $guard$
declare
  f regprocedure := to_regprocedure('public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real,extensions.halfvec,real,real)');
begin
  if f is null
     or (select count(*) from pg_proc where proname='search_dam_documents' and pronamespace='public'::regnamespace) <> 1
     or not exists (select 1 from pg_proc p where p.oid=f
       and pg_get_userbyid(p.proowner)='postgres'
       and p.prosecdef and p.provolatile='s' and p.proretset
       and p.proconfig=ARRAY['search_path=public, extensions','statement_timeout=30s']::text[])
     or has_function_privilege('anon', f, 'execute')
     or not has_function_privilege('authenticated', f, 'execute')
     or not has_function_privilege('service_role', f, 'execute') then
    raise exception 'popdam3#1037 Step 6: installed search contract differs; reconcile rather than overwrite';
  end if;
end;
$guard$;

notify pgrst, 'reload schema';

commit;

-- ===== replay of 20261204003633_dam_search_named_scope_sets.sql =====
-- u2giants/popdam3#1037 Step 2 performance fix (claim popcre/shared-db#6607).
-- Measured on production 2026-11-17 after 20261204003329/003530: a character search through
-- search_dam_documents took 16.0 s (3.0 s without the scope) and dam_search_semantic_anchor_named
-- took 42.3 s (style groups) / 4.2 s (all types), past its 5 s limit, so character searches
-- returned "Search unavailable". Cause: the scope ran correlated subqueries per candidate / per
-- vector. Fix: new public.dam_search_named_scope(jsonb) computes the allowed style groups and
-- asset documents ONCE (indexed lookups by character id, GIN lookups by name); the search tests
-- membership and the anchor takes an exact distance over the allowed documents only.
-- Semantics kept: character scope on every leg; property set on picture-only matches; tags on
-- non-deleted files; a style group whose own text names the character counts. Changed: an asset
-- document now qualifies through its style group (tag or group text) or, ungrouped, its own tag;
-- name matching no longer reads the 171k asset texts (~10k rows, 13 s cold for a common name).
-- Body-only changes to both existing functions.
begin;
set local lock_timeout='500ms';
set local statement_timeout='2500ms';
set local transaction_timeout='3s';
set local search_path=pg_catalog,public,extensions;

do $guard$
begin
  if not exists (select 1 from pg_proc p where p.oid=to_regprocedure('public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real,extensions.halfvec,real,real)')
      and md5(p.prosrc) in ('d66a2af948ed737b1b163c9e209f9b17','3e63567a19109fa8803d646680f020c5')) then
    raise exception 'popdam3#1037 pre-change search_dam_documents differs from 20261204003632; reconcile rather than overwrite';
  end if;
  if not exists (select 1 from pg_proc p where p.oid=to_regprocedure('public.dam_search_semantic_anchor_named(extensions.vector,text[],jsonb)')
      and md5(p.prosrc) in ('8fee795ca09055b79cf20d1ed1c8ff81','a2761ff6cbb39d36c869cc46ef682de0')) then
    raise exception 'popdam3#1037 pre-change dam_search_semantic_anchor_named differs from 20261204003530; reconcile rather than overwrite';
  end if;
end;
$guard$;

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
  if v_properties is not null or v_property_characters is not null then
    select coalesce(array_agg(distinct x.id), '{}') into property_groups from (
      select g.id from public.style_groups g where g.property_id = any(v_properties)
      union all
      select a.style_group_id
      from public.asset_licensor_characters t
      join public.assets a on a.id = t.asset_id
      where t.character_id = any(v_property_characters) and not a.is_deleted and a.style_group_id is not null
    ) x where x.id is not null;
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
end;
$function$;
revoke all on function public.dam_search_named_scope(jsonb) from public, anon, authenticated;
comment on function public.dam_search_named_scope(jsonb) is
  'popdam3#1037: allowed style groups / asset documents for the named-character (requiredCharacterIds, requiredLegacyCharacterIds, requiredCharacterNames) and property (semanticPropertyIds, semanticPropertyCharacterIds) scopes of search_dam_documents. NULL = no scope; empty array = nothing allowed.';

CREATE OR REPLACE FUNCTION public.search_dam_documents(p_query text, p_filters jsonb, p_limit integer, p_offset integer, p_document_types text[] DEFAULT NULL::text[], p_query_embedding extensions.vector DEFAULT NULL::extensions.vector, p_min_rank real DEFAULT 0, p_min_semantic_score real DEFAULT NULL::real, p_query_text_embedding extensions.halfvec DEFAULT NULL::extensions.halfvec, p_min_text_score real DEFAULT NULL::real, p_text_score_margin real DEFAULT NULL::real)
 RETURNS TABLE(document_type text, entity_id uuid, asset_id uuid, style_group_id uuid, keyword_rank real, semantic_rank real, rank real, total_count bigint, has_more boolean, facets jsonb, text_rank real)
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
      ns.character_groups, ns.character_assets, ns.property_groups, ns.property_assets
    from public.dam_search_named_scope(p_filters) ns
    where public.require_dam_access()
  ), queries as materialized (
    select q.query_text, websearch_to_tsquery('simple', regexp_replace(q.query_text, '[-_/]+', ' ', 'g')) tsq,
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
  ), full_text_matches as materialized (
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,d.title,d.title_key,d.title_tsv
    from public.dam_search_keys d
    where (p_document_types is null or d.document_type = any(p_document_types))
      and d.search_tsv @@ any(array(select distinct q.tsq from queries q))
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
    limit 2000
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
    limit 2000
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
  ), visibility_params as materialized (
    -- semanticLicensorIds and the #1037 character/property scopes are not visibility filters
    -- (they are applied to candidates above): strip them so the unfiltered fast paths still apply.
    select coalesce(p_filters,'{}'::jsonb)-'search'-'semanticLicensorIds'
      -'requiredCharacterIds'-'requiredLegacyCharacterIds'-'requiredCharacterNames'
      -'semanticPropertyIds'-'semanticPropertyCharacterIds' f,
    public.assets_thumbnail_min_date() thumbnail_min_date
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
          where public.dam_asset_matches_filters(
            a.id, a.is_deleted, a.modified_at, a.file_created_at, a.thumbnail_url,
            a.style_group_id, a.licensor_id, sg.licensor_id, a.property_id, sg.property_id,
            a.customer_id, sg.customer_id, a.file_type, a.content_type, a.product_material,
            a.status, a.workflow_status, a.stage, a.is_licensed, a.asset_type, a.art_source,
            a.thumbnail_error, a.product_category, a.relative_path, a.customer, a.program,
            v.f, v.thumbnail_min_date))
      limit 10
    ) j
  ), candidate_ranks as materialized (
    -- Text leg off: rank = keyword + 0.35 x picture (unchanged). On (plan O3 start):
    -- rank = keyword + 0.6 x text + 0.15 x picture.
    select r.* from (
      select c.document_type,c.entity_id,c.asset_id,c.style_group_id,c.keyword_rank,c.semantic_rank,c.text_rank,
        (coalesce(c.keyword_rank,0) + case when (select has_text_embedding from params)
          then coalesce(c.text_rank,0) * 0.6 + coalesce(c.semantic_rank,0) * 0.15
          else coalesce(c.semantic_rank,0) * 0.35 end)::real rank
      from classified c
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
    where public.dam_asset_matches_filters(
          a.id, a.is_deleted, a.modified_at, a.file_created_at, a.thumbnail_url,
          a.style_group_id, a.licensor_id, sg.licensor_id, a.property_id, sg.property_id,
          a.customer_id, sg.customer_id, a.file_type, a.content_type, a.product_material,
          a.status, a.workflow_status, a.stage, a.is_licensed, a.asset_type, a.art_source,
          a.thumbnail_error, a.product_category, a.relative_path, a.customer, a.program,
          v.f, v.thumbnail_min_date)
    order by c.rn
    limit (select summary_probe_limit + 1 from params)
  ), default_flag_state as materialized (
    -- #5747 Step 5: unfiltered exact-count fast path. Usable only when the
    -- request has no filters AND every candidate document carries a flag
    -- computed with the CURRENT thumbnail min date for the same members.
    -- Any doubt falls back to the per-document probe below (exact either way).
    select count(*) filter (where d.has_default_visible_member) flagged_visible,
      -- #5938: visible member assets summed over candidates. visible_assets has
      -- one row per (candidate, probe-visible member), so this sum is exactly
      -- its unlimited row count when every count is current.
      coalesce(sum(d.default_visible_member_count), 0) visible_member_rows,
      coalesce(bool_and(d.default_visible_member_count is not null), true) all_counts_current,
      coalesce(bool_and(d.has_default_visible_member is not null
        and d.default_visible_min_date = v.thumbnail_min_date
        and d.asset_id is not distinct from c.asset_id
        and d.style_group_id is not distinct from c.style_group_id), true) all_current
    from visibility_params v
    join ordered_candidates c on v.f = '{}'::jsonb
    left join public.dam_search_documents d
      on d.document_type = c.document_type and d.entity_id = c.entity_id
    group by v.thumbnail_min_date
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
    -- bounds. Fast path (#5747): unfiltered request with every flag current
    -- -> count maintained flags. Otherwise count EVERY candidate document
    -- that has at least one member asset passing the same visibility
    -- predicate, short-circuiting per document (LIMIT 1).
    select case
      when (select f from visibility_params) = '{}'::jsonb
       and coalesce((select all_current from default_flag_state), true)
      then coalesce((select flagged_visible from default_flag_state), 0)
      else (
        select count(*) from (
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
      )
    end total_count
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
    select r.document_type,r.entity_id,r.asset_id,r.style_group_id,r.keyword_rank,r.semantic_rank,r.rank,r.text_rank
    from page_documents r order by r.rn
    offset (select page_offset from params) limit (select page_limit from params)
  )
  select p.document_type,p.entity_id,p.asset_id,p.style_group_id,p.keyword_rank,p.semantic_rank,p.rank,
    s.total_count,
    (select visible_through_page from page_state) > (select page_offset+page_limit from params),
    s.facets, p.text_rank
  from summary s
  left join page p on true
  order by p.rank desc nulls last, p.document_type nulls last, p.entity_id nulls last;
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
  s record;
  v_score real;
begin
  if not coalesce(public.require_dam_access(), false) then
    return null;
  end if;
  s := public.dam_search_named_scope(p_filters);
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
  if p_document_types is not null and not ('asset' = any(p_document_types))
     and 'style_group' = any(p_document_types) then
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

do $guard$
begin
  if not exists (select 1 from pg_proc p where p.oid=to_regprocedure('public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real,extensions.halfvec,real,real)')
      and md5(p.prosrc)='3e63567a19109fa8803d646680f020c5'
      and pg_get_userbyid(p.proowner)='postgres'
      and p.prosecdef and p.provolatile='s' and p.proretset
      and p.proconfig=ARRAY['search_path=public, extensions','statement_timeout=30s']::text[]
      and not has_function_privilege('anon', p.oid, 'execute')
      and has_function_privilege('authenticated', p.oid, 'execute')
      and has_function_privilege('service_role', p.oid, 'execute')) then
    raise exception 'popdam3#1037 installed search contract differs; reconcile rather than overwrite';
  end if;
  if not exists (select 1 from pg_proc p where p.oid=to_regprocedure('public.dam_search_semantic_anchor_named(extensions.vector,text[],jsonb)')
      and md5(p.prosrc)='a2761ff6cbb39d36c869cc46ef682de0' and p.prosecdef
      and not has_function_privilege('anon', p.oid, 'execute')) then
    raise exception 'popdam3#1037 installed anchor contract differs; reconcile rather than overwrite';
  end if;
end;
$guard$;

commit;

-- ===== replay of 20261218043336_style_guide_matviews_gated_projection_reissue.sql =====
--
-- REISSUE of 20261218025935 (#6663): identical SQL plus the statement
-- terminator missing after the $function$ closer before the DO assertion
-- block (preview apply 44235566632 SQLSTATE 42601 statement 11). The
-- original is retired in RETIRED_VERSION_REASONS and never applied anywhere.
--
-- #6418: matview API surface contract for public.style_guide_folders and
-- public.style_guide_file_groups. Part of the #2326 program (plan Step 6,
-- Step 2 finding 2, materialized_view_in_api half).
--
-- WHY
-- ---
-- Materialized views cannot carry RLS and cannot gate per caller: any role with
-- SELECT reads the entire stored snapshot. Live catalog 2026-11-15: both grant
-- SELECT to authenticated (the 2026-09-10 HTTP probe showed a PopDAM viewer
-- reading 22,045 style_guide_file_groups rows AND a CRM identity reading 384
-- style_guide_folders rows cross-app; anon 401). The matviews also carry
-- meaningless INSERT grants.
--
-- CENSUS (durable artifact: docs/verification/database-efficiency/
-- 20261116T040000Z-step6-6418-matview-census/matview-app-reference-census.md)
-- -----------------------------------------------------------------------
-- Exactly ONE application reads these relations directly: PopDAM's
-- src/pages/popsg/PopSGLibraryPage.tsx (three PostgREST reads of both names, as
-- authenticated), plus popdam3's scripts/popsg-readiness-baseline.mjs (service
-- role). popcrm / poppim-web / dflow_plm / popdam have no direct reads (only
-- generated type files). So: single-app, and PopDAM reads them from the browser
-- as authenticated -> the issue's disposition rule prescribes a caller-gated
-- projection over the matview plus a narrowed matview grant. PopDAM keeps
-- working UNCHANGED because the gated projection takes over the exact REST
-- names.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- 1. Rename the snapshots (OIDs, columns and REFRESH capability preserved):
--      style_guide_folders      -> style_guide_folders_snapshot
--      style_guide_file_groups  -> style_guide_file_groups_snapshot
-- 2. Narrow the snapshot grants: revoke ALL from anon and authenticated
--    (keeps postgres / service_role for the refresh path).
-- 3. Recreate the ORIGINAL names as caller-gated definer views over the
--    snapshots, gated on app.has_app_access('dam') — the #2662 batch 1 pattern
--    (20260911124746_crm_definer_views_caller_gate.sql). CRM/anon identities
--    see zero rows; PopDAM identities (app_access dam) see the same rows.
-- 4. Re-point public.refresh_style_guide_matviews(uuid,integer,text) at the
--    renamed snapshots (its two REFRESH statements are the only live
--    references — verified read-only 2026-11-15: no other function or view
--    references either name).
--
-- ROLLBACK (named)
-- ----------------
-- Forward migration: recreate the direct-read path for one release —
--   drop view public.style_guide_folders; drop view public.style_guide_file_groups;
--   alter materialized view public.style_guide_folders_snapshot rename to style_guide_folders;
--   alter materialized view public.style_guide_file_groups_snapshot rename to style_guide_file_groups;
--   grant select, insert on public.style_guide_folders to authenticated;  -- captured grants
--   grant select, insert on public.style_guide_file_groups to authenticated;
--   CREATE OR REPLACE FUNCTION public.refresh_style_guide_matviews(uuid,integer,text)
--     with the ORIGINAL body (pre-change capture is the two REFRESH lines
--     before renaming; the exact pre-image is the function definition on main
--     before this migration).
-- The old read path (the two names) keeps serving rows through the views for
-- one release; the snapshots are then droppable in a later governed change if
-- the gate is retired.
--
-- PREVIEW PROOF (plan; capture with the PR)
-- -----------------------------------------
-- 1. HTTP probe before/after on preview (status codes + Content-Range counts
--    only): out-of-app identity (anon) stays 401; a no-app-access identity
--    goes from full-snapshot count to 0; a dam-identity keeps its count.
-- 2. PopDAM journey (PopSGLibraryPage reads) unchanged: same relation names,
--    same columns.
-- 3. Contract tests green.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- 1. Rename the snapshots. OID-preserving: grants, indexes and the unique
--    index backing REFRESH CONCURRENTLY all follow the relation.
alter materialized view public.style_guide_folders rename to style_guide_folders_snapshot;
alter materialized view public.style_guide_file_groups rename to style_guide_file_groups_snapshot;

-- 2. Narrow the snapshot grants (hygiene + the real fix: no API-role reads).
revoke all on public.style_guide_folders_snapshot from anon, authenticated;
revoke all on public.style_guide_file_groups_snapshot from anon, authenticated;

-- 3. Same-name caller-gated projections (#2662 pattern: definer semantics
--    with an explicit in-view gate).
create view public.style_guide_folders with (security_invoker = false) as
  select * from public.style_guide_folders_snapshot
  where (select app.has_app_access('dam'::app.app_name));

create view public.style_guide_file_groups with (security_invoker = false) as
  select * from public.style_guide_file_groups_snapshot
  where (select app.has_app_access('dam'::app.app_name));

grant select on public.style_guide_folders to authenticated, service_role;
grant select on public.style_guide_file_groups to authenticated, service_role;

-- 4. Re-point the refresh function at the renamed snapshots (full body; only
--    the two REFRESH target names change).

CREATE OR REPLACE FUNCTION public.refresh_style_guide_matviews(p_run_id uuid, p_search_batch_size integer, p_step text)
 RETURNS TABLE(refreshed_at timestamp with time zone, search_documents_synced integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_batch integer := greatest(0, least(coalesce(p_search_batch_size, 5000), 50000));
  v_synced integer := 0;
  v_now timestamptz;
  v_started timestamptz := clock_timestamp();
  v_step text := coalesce(p_step, '');
begin
  if v_step not in ('all', 'file_groups', 'folders', 'search') then
    raise exception
      'refresh_style_guide_matviews: unknown p_step %, expected all|file_groups|folders|search',
      p_step;
  end if;

  if p_run_id is not null then
    update public.style_guide_crawl_runs
       set lifecycle_state = case when lifecycle_state in ('completed','failed','attention_required')
                                  then lifecycle_state else 'refreshing' end,
           refresh_started_at = coalesce(refresh_started_at, now())
     where id = p_run_id;
  end if;

  if v_step in ('all', 'file_groups') then
    refresh materialized view concurrently public.style_guide_file_groups_snapshot;
  end if;

  if v_step in ('all', 'folders') then
    refresh materialized view concurrently public.style_guide_folders_snapshot;
  end if;

  if v_step in ('all', 'search') and v_batch > 0 then
    with candidates as (
      select f.id,
             f.root_label,
             f.licensor_name,
             f.property_folder,
             f.style_guide_folder,
             coalesce(nullif(f.style_guide_folder, ''), nullif(f.property_folder, ''),
                      f.licensor_name, 'Unfiled') as style_guide_name,
             f.directory_path,
             f.relative_path,
             f.filename,
             f.file_extension,
             f.tag_names,
             f.size_bytes,
             f.modified_at,
             f.thumbnail_url,
             f.is_active,
             md5(f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' ||
                 coalesce(f.modified_at::text, '') || '|' || coalesce(f.tag_search_text, '') || '|' ||
                 coalesce(f.style_guide_folder, '') || '|' || coalesce(f.property_folder, '') || '|' ||
                 coalesce(f.licensor_name, '') || '|' || f.is_active::text) as source_identity
        from public.style_guide_search_sync_queue q
        join public.style_guide_files f on f.id = q.style_guide_file_id
        left join public.style_guide_search_documents d on d.style_guide_file_id = f.id
       where (p_run_id is null or f.crawl_run_id = p_run_id)
         and f.is_active
         and (d.style_guide_file_id is null
              -- A file that went stale and later came back unchanged keeps its
              -- stored source_identity, but reconcile_stale_sg_files_batch left
              -- the document is_active = false. Without this clause the row is
              -- never re-selected and stays invisible to unified search forever.
              or d.is_active is distinct from f.is_active
              -- #4437 review B1: thumbnail-only changes must re-sync too; they
              -- change content_sha256 and must invalidate the stored vector.
              or d.thumbnail_url is distinct from f.thumbnail_url
              or d.source_identity is distinct from
                 md5(f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' ||
                     coalesce(f.modified_at::text, '') || '|' || coalesce(f.tag_search_text, '') || '|' ||
                     coalesce(f.style_guide_folder, '') || '|' || coalesce(f.property_folder, '') || '|' ||
                     coalesce(f.licensor_name, '') || '|' || f.is_active::text))
       order by q.style_guide_file_id
       limit v_batch
    ), upserted as (
      insert into public.style_guide_search_documents as d (
        style_guide_file_id, root_label, licensor_name, property_folder, style_guide_folder,
        style_guide_name, directory_path, relative_path, filename, file_extension,
        tag_names, size_bytes, modified_at, thumbnail_url, is_active,
        pdf_text_status, pdf_text_length, source_identity, content_sha256, search_vector,
        document_updated_at)
      select c.id, c.root_label, c.licensor_name, c.property_folder, c.style_guide_folder,
             c.style_guide_name, c.directory_path, c.relative_path, c.filename, c.file_extension,
             c.tag_names, c.size_bytes, c.modified_at, c.thumbnail_url, c.is_active,
             t.status, coalesce(t.text_length, 0), c.source_identity,
             encode(extensions.digest(c.source_identity || '|' || coalesce(c.thumbnail_url, ''), 'sha256'), 'hex'),
             setweight(to_tsvector('simple', coalesce(c.filename, '')), 'A')
             || setweight(to_tsvector('simple', coalesce(c.style_guide_name, '') || ' ' ||
                                                coalesce(c.property_folder, '') || ' ' ||
                                                coalesce(c.licensor_name, '')), 'B')
             || setweight(to_tsvector('simple', coalesce(c.relative_path, '') || ' ' ||
                                                array_to_string(c.tag_names, ' ')), 'C')
             || setweight(to_tsvector('simple', left(coalesce(t.extracted_text, ''), 200000)), 'D'),
             now()
        from candidates c
        left join public.style_guide_pdf_text t on t.style_guide_file_id = c.id
      on conflict (style_guide_file_id) do update
        set root_label = excluded.root_label,
            licensor_name = excluded.licensor_name,
            property_folder = excluded.property_folder,
            style_guide_folder = excluded.style_guide_folder,
            style_guide_name = excluded.style_guide_name,
            directory_path = excluded.directory_path,
            relative_path = excluded.relative_path,
            filename = excluded.filename,
            file_extension = excluded.file_extension,
            tag_names = excluded.tag_names,
            size_bytes = excluded.size_bytes,
            modified_at = excluded.modified_at,
            thumbnail_url = excluded.thumbnail_url,
            is_active = excluded.is_active,
            pdf_text_status = excluded.pdf_text_status,
            pdf_text_length = excluded.pdf_text_length,
            source_identity = excluded.source_identity,
            content_sha256 = excluded.content_sha256,
            -- #4437: a changed content identity invalidates the embedding and
            -- requeues it; unchanged content keeps vector, stamp and retry state.
            embedding = case when d.content_sha256
                                  = excluded.content_sha256
                        then d.embedding end,
            embedding_model = case when d.content_sha256
                                        = excluded.content_sha256
                              then d.embedding_model end,
            embedding_updated_at = case when d.content_sha256
                                              = excluded.content_sha256
                                  then d.embedding_updated_at end,
            embedding_error = case when d.content_sha256
                                        = excluded.content_sha256
                              then d.embedding_error end,
            embedding_error_category = case when d.content_sha256
                                                  = excluded.content_sha256
                                        then d.embedding_error_category end,
            embedding_next_retry_at = case when d.content_sha256
                                                  = excluded.content_sha256
                                        then d.embedding_next_retry_at end,
            embedding_attempts = case when d.content_sha256
                                            = excluded.content_sha256
                                then d.embedding_attempts else 0 end,
            embedding_max_attempts = case when d.content_sha256
                                                = excluded.content_sha256
                                    then d.embedding_max_attempts
                                    else 5 end,
            embedding_lease_token = case when d.content_sha256
                                                = excluded.content_sha256
                                        then d.embedding_lease_token end,
            embedding_lease_owner = case when d.content_sha256
                                                = excluded.content_sha256
                                        then d.embedding_lease_owner end,
            embedding_lease_expires_at = case when d.content_sha256
                                                    = excluded.content_sha256
                                            then d.embedding_lease_expires_at end,
            search_vector = excluded.search_vector,
            document_updated_at = now()
      returning d.style_guide_file_id
    )
    select count(*)::integer into v_synced from upserted;

    -- Retire queue entries that are satisfied: the file is gone or inactive
    -- (reconcile deactivates file and document together, and reactivation
    -- requeues), or its document already matches the file's current identity.
    -- Only entries queued before this call started are retired. The trigger
    -- re-stamps queued_at on every change, which locks the entry, so a change
    -- that races this call is re-checked and kept for the next call.
    delete from public.style_guide_search_sync_queue q
     where q.queued_at < v_started
       and not exists (
       select 1
         from public.style_guide_files f
         left join public.style_guide_search_documents d on d.style_guide_file_id = f.id
        where f.id = q.style_guide_file_id
          and f.is_active
          and (d.style_guide_file_id is null
               or d.is_active is distinct from f.is_active
               or d.thumbnail_url is distinct from f.thumbnail_url
               or d.source_identity is distinct from
                 md5(f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' ||
                     coalesce(f.modified_at::text, '') || '|' || coalesce(f.tag_search_text, '') || '|' ||
                     coalesce(f.style_guide_folder, '') || '|' || coalesce(f.property_folder, '') || '|' ||
                     coalesce(f.licensor_name, '') || '|' || f.is_active::text)));
  end if;

  v_now := now();

  -- Completion stamp only on the step that can finish the refresh work.
  -- Matview-only steps leave the run in 'refreshing' with refresh_completed_at
  -- untouched so a later 'search' call (or a caller that knows no search is
  -- needed) closes the run. 'search' and 'all' accumulate the synced count the
  -- existing popdam3 loop already reads.
  if p_run_id is not null and v_step in ('all', 'search') and v_batch > 0 then
    update public.style_guide_crawl_runs
       set refresh_completed_at = v_now,
           -- qualified: `search_documents_synced` is also this function's output
           -- parameter, so the bare name would be ambiguous
           search_documents_synced = style_guide_crawl_runs.search_documents_synced + v_synced
     where id = p_run_id;
  end if;

  refreshed_at := v_now;
  search_documents_synced := v_synced;
  return next;
end;
$function$;

-- 5. Assertions: the gate is in place, the snapshots are closed to API roles,
--    and the refresh function no longer names the API-visible relations.
do $$
declare
  v text;
begin
  foreach v in array array['style_guide_folders', 'style_guide_file_groups']
  loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v and c.relkind = 'v'
    ) then
      raise exception '#6418: gated view public.% missing', v;
    end if;
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v || '_snapshot' and c.relkind = 'm'
    ) then
      raise exception '#6418: snapshot public.%_snapshot missing', v;
    end if;
    if has_table_privilege('anon', 'public.' || v || '_snapshot', 'SELECT')
       or has_table_privilege('authenticated', 'public.' || v || '_snapshot', 'SELECT') then
      raise exception '#6418: snapshot public.%_snapshot still readable by API roles', v;
    end if;
    if pg_get_viewdef(('public.' || v)::regclass) not like '%has_app_access%' then
      raise exception '#6418: gated view public.% lost its caller gate', v;
    end if;
  end loop;

  if pg_get_functiondef(to_regprocedure('public.refresh_style_guide_matviews(uuid,integer,text)'))
     like '%refresh materialized view concurrently public.style_guide_file_groups;%' then
    raise exception '#6418: refresh function still targets the API-visible relation';
  end if;
end $$;

commit;

-- ===== replay of 20261218084103_dam_search_text_leg_nearest_300.sql =====
-- u2giants/popdam3#1037 Step 6 follow-up: the text-meaning leg reads the nearest 300 text vectors
-- instead of 2000 (text_ann_raw, text_exact_raw). Measured on production, read-only, 2026-11-17
-- ~9:40 PM EST with the database under load: nearest 2000 on the style-group text index 6.1 s
-- cold, nearest 300 0.23 s. The relative text floor (0.10 below the best in-scope text score)
-- keeps far fewer than 300 in practice. Body-only; nothing else changes.
begin;
set local lock_timeout='500ms';
set local statement_timeout='2500ms';
set local transaction_timeout='3s';
set local search_path=pg_catalog,public,extensions;

do $guard$
begin
  if not exists (select 1 from pg_proc p where p.oid=to_regprocedure('public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real,extensions.halfvec,real,real)')
      and md5(p.prosrc) in ('3e63567a19109fa8803d646680f020c5','ca6ce05927555cffab16105fbb2dfe3a')) then
    raise exception 'popdam3#1037 pre-change search_dam_documents differs from 20261204003633; reconcile rather than overwrite';
  end if;
end;
$guard$;

CREATE OR REPLACE FUNCTION public.search_dam_documents(p_query text, p_filters jsonb, p_limit integer, p_offset integer, p_document_types text[] DEFAULT NULL::text[], p_query_embedding extensions.vector DEFAULT NULL::extensions.vector, p_min_rank real DEFAULT 0, p_min_semantic_score real DEFAULT NULL::real, p_query_text_embedding extensions.halfvec DEFAULT NULL::extensions.halfvec, p_min_text_score real DEFAULT NULL::real, p_text_score_margin real DEFAULT NULL::real)
 RETURNS TABLE(document_type text, entity_id uuid, asset_id uuid, style_group_id uuid, keyword_rank real, semantic_rank real, rank real, total_count bigint, has_more boolean, facets jsonb, text_rank real)
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
      ns.character_groups, ns.character_assets, ns.property_groups, ns.property_assets
    from public.dam_search_named_scope(p_filters) ns
    where public.require_dam_access()
  ), queries as materialized (
    select q.query_text, websearch_to_tsquery('simple', regexp_replace(q.query_text, '[-_/]+', ' ', 'g')) tsq,
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
  ), full_text_matches as materialized (
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,d.title,d.title_key,d.title_tsv
    from public.dam_search_keys d
    where (p_document_types is null or d.document_type = any(p_document_types))
      and d.search_tsv @@ any(array(select distinct q.tsq from queries q))
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
  ), visibility_params as materialized (
    -- semanticLicensorIds and the #1037 character/property scopes are not visibility filters
    -- (they are applied to candidates above): strip them so the unfiltered fast paths still apply.
    select coalesce(p_filters,'{}'::jsonb)-'search'-'semanticLicensorIds'
      -'requiredCharacterIds'-'requiredLegacyCharacterIds'-'requiredCharacterNames'
      -'semanticPropertyIds'-'semanticPropertyCharacterIds' f,
    public.assets_thumbnail_min_date() thumbnail_min_date
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
          where public.dam_asset_matches_filters(
            a.id, a.is_deleted, a.modified_at, a.file_created_at, a.thumbnail_url,
            a.style_group_id, a.licensor_id, sg.licensor_id, a.property_id, sg.property_id,
            a.customer_id, sg.customer_id, a.file_type, a.content_type, a.product_material,
            a.status, a.workflow_status, a.stage, a.is_licensed, a.asset_type, a.art_source,
            a.thumbnail_error, a.product_category, a.relative_path, a.customer, a.program,
            v.f, v.thumbnail_min_date))
      limit 10
    ) j
  ), candidate_ranks as materialized (
    -- Text leg off: rank = keyword + 0.35 x picture (unchanged). On (plan O3 start):
    -- rank = keyword + 0.6 x text + 0.15 x picture.
    select r.* from (
      select c.document_type,c.entity_id,c.asset_id,c.style_group_id,c.keyword_rank,c.semantic_rank,c.text_rank,
        (coalesce(c.keyword_rank,0) + case when (select has_text_embedding from params)
          then coalesce(c.text_rank,0) * 0.6 + coalesce(c.semantic_rank,0) * 0.15
          else coalesce(c.semantic_rank,0) * 0.35 end)::real rank
      from classified c
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
    where public.dam_asset_matches_filters(
          a.id, a.is_deleted, a.modified_at, a.file_created_at, a.thumbnail_url,
          a.style_group_id, a.licensor_id, sg.licensor_id, a.property_id, sg.property_id,
          a.customer_id, sg.customer_id, a.file_type, a.content_type, a.product_material,
          a.status, a.workflow_status, a.stage, a.is_licensed, a.asset_type, a.art_source,
          a.thumbnail_error, a.product_category, a.relative_path, a.customer, a.program,
          v.f, v.thumbnail_min_date)
    order by c.rn
    limit (select summary_probe_limit + 1 from params)
  ), default_flag_state as materialized (
    -- #5747 Step 5: unfiltered exact-count fast path. Usable only when the
    -- request has no filters AND every candidate document carries a flag
    -- computed with the CURRENT thumbnail min date for the same members.
    -- Any doubt falls back to the per-document probe below (exact either way).
    select count(*) filter (where d.has_default_visible_member) flagged_visible,
      -- #5938: visible member assets summed over candidates. visible_assets has
      -- one row per (candidate, probe-visible member), so this sum is exactly
      -- its unlimited row count when every count is current.
      coalesce(sum(d.default_visible_member_count), 0) visible_member_rows,
      coalesce(bool_and(d.default_visible_member_count is not null), true) all_counts_current,
      coalesce(bool_and(d.has_default_visible_member is not null
        and d.default_visible_min_date = v.thumbnail_min_date
        and d.asset_id is not distinct from c.asset_id
        and d.style_group_id is not distinct from c.style_group_id), true) all_current
    from visibility_params v
    join ordered_candidates c on v.f = '{}'::jsonb
    left join public.dam_search_documents d
      on d.document_type = c.document_type and d.entity_id = c.entity_id
    group by v.thumbnail_min_date
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
    -- bounds. Fast path (#5747): unfiltered request with every flag current
    -- -> count maintained flags. Otherwise count EVERY candidate document
    -- that has at least one member asset passing the same visibility
    -- predicate, short-circuiting per document (LIMIT 1).
    select case
      when (select f from visibility_params) = '{}'::jsonb
       and coalesce((select all_current from default_flag_state), true)
      then coalesce((select flagged_visible from default_flag_state), 0)
      else (
        select count(*) from (
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
      )
    end total_count
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
    select r.document_type,r.entity_id,r.asset_id,r.style_group_id,r.keyword_rank,r.semantic_rank,r.rank,r.text_rank
    from page_documents r order by r.rn
    offset (select page_offset from params) limit (select page_limit from params)
  )
  select p.document_type,p.entity_id,p.asset_id,p.style_group_id,p.keyword_rank,p.semantic_rank,p.rank,
    s.total_count,
    (select visible_through_page from page_state) > (select page_offset+page_limit from params),
    s.facets, p.text_rank
  from summary s
  left join page p on true
  order by p.rank desc nulls last, p.document_type nulls last, p.entity_id nulls last;
$function$;

do $guard$
begin
  if not exists (select 1 from pg_proc p where p.oid=to_regprocedure('public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real,extensions.halfvec,real,real)')
      and md5(p.prosrc)='ca6ce05927555cffab16105fbb2dfe3a'
      and pg_get_userbyid(p.proowner)='postgres'
      and p.prosecdef and p.provolatile='s' and p.proretset
      and p.proconfig=ARRAY['search_path=public, extensions','statement_timeout=30s']::text[]
      and p.proacl::text='{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}') then
    raise exception 'popdam3#1037 installed search contract differs; reconcile rather than overwrite';
  end if;
end;
$guard$;

commit;

-- ===== replay of 20261218084203_dam_search_word_forms.sql =====
-- u2giants/popdam3#1037 Step 7 (claim popcre/shared-db#6673): English word forms in the exact-word
-- leg of public.search_dam_documents ("frame" also finds "framed" and "frames").
--
-- Owner D3 (Nov 17, 2026): close wording is solved by a rule, never by a per-term word list.
--
-- What this adds:
--   public.dam_search_keys.search_tsv_en  English (stemmed) lexemes of search_tsv. A plain nullable
--       column kept by a BEFORE trigger, not a GENERATED column: adding a stored generated column
--       rewrites the 183k-row table in one statement, and the production apply has a 2-minute
--       statement limit (20261204001000 was retired for exactly that). The column is derived from
--       search_tsv itself, so it needs no other source text.
--   public.dam_search_keys_tsv_en_idx  GIN index beside the 'simple' dam_search_keys_tsv_idx,
--       which is untouched (product codes and names stay exact). Built here while the new column
--       is still empty (all nulls), so the build is short; rows enter it as they are filled.
--   public.dam_search_tsv_en_backfill()  fills 20,000 null rows per call (batch size from the
--       2026 compute incident); pg_cron job dam-search-tsv-en-backfill calls it every minute and
--       unschedules itself when nothing is left (about 10 runs). Until then the word-form
--       alternative simply finds fewer rows; exact matching is unaffected.
--   public.dam_search_exact_names(text, jsonb)  the recognised names in a query that must stay in
--       exact form: the character names the edge function already recognised and sends
--       (p_filters.requiredCharacterNames, with its guards: no product words, 3+ characters),
--       plus licensor names and property names that appear as a whole phrase in the
--       query (curated lists, 39 + 855 rows; core.licensor_alias is not in every replay baseline,
--       so aliases are not read; the edge function only forwards those in picture
--       mode, so they are matched here).
--   search_dam_documents: full_text_matches gains a second, lower-scored alternative. Exact-word
--       matches keep today's score; a document found only by word form scores 0.05-0.09, below
--       every exact match (>= 0.1). Signature, grants and every other leg are unchanged.
begin;
set local lock_timeout='2s';
set local statement_timeout='60s';
set local search_path=pg_catalog,public,extensions;

do $guard$
begin
  if not exists (select 1 from pg_proc p where p.oid=to_regprocedure('public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real,extensions.halfvec,real,real)')
      and md5(p.prosrc) in ('ca6ce05927555cffab16105fbb2dfe3a','06c5644e5c9d5d47cdf382c56f10f433')) then
    raise exception 'popdam3#1037 pre-change search_dam_documents differs from 20261218084103; reconcile rather than overwrite';
  end if;
end;
$guard$;

create or replace function public.dam_search_tsv_en(p_tsv tsvector)
returns tsvector
language sql immutable parallel safe
set search_path = ''
as $function$
  select pg_catalog.to_tsvector('pg_catalog.english'::regconfig,
    pg_catalog.array_to_string(pg_catalog.tsvector_to_array(coalesce(p_tsv, ''::tsvector)), ' '))
$function$;
revoke all on function public.dam_search_tsv_en(tsvector) from public, anon, authenticated;

alter table public.dam_search_keys add column if not exists search_tsv_en tsvector;
comment on column public.dam_search_keys.search_tsv_en is
  'English word forms of search_tsv (popdam3#1037 Step 7). Kept by trigger dam_search_keys_tsv_en_trg; never replaces search_tsv.';

create or replace function public.dam_search_keys_set_tsv_en()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.search_tsv_en := public.dam_search_tsv_en(new.search_tsv);
  return new;
end;
$function$;
revoke all on function public.dam_search_keys_set_tsv_en() from public, anon, authenticated;

drop trigger if exists dam_search_keys_tsv_en_trg on public.dam_search_keys;
create trigger dam_search_keys_tsv_en_trg
  before insert or update of search_tsv on public.dam_search_keys
  for each row execute function public.dam_search_keys_set_tsv_en();

create index if not exists dam_search_keys_tsv_en_idx
  on public.dam_search_keys using gin (search_tsv_en);

create or replace function public.dam_search_tsv_en_backfill()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  n integer;
begin
  update public.dam_search_keys k
     set search_tsv_en = public.dam_search_tsv_en(k.search_tsv)
    from (select d.document_type, d.entity_id
            from public.dam_search_keys d
           where d.search_tsv_en is null
           limit 20000
           for update skip locked) x
   where k.document_type = x.document_type and k.entity_id = x.entity_id;
  get diagnostics n = row_count;
  if n = 0 then
    perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'dam-search-tsv-en-backfill';
  end if;
  return n;
end;
$function$;
revoke all on function public.dam_search_tsv_en_backfill() from public, anon, authenticated, service_role;

create or replace function public.dam_search_exact_names(p_query text, p_filters jsonb)
returns tsquery
language sql stable
set search_path = ''
as $function$
  with qv as (
    select pg_catalog.to_tsvector('pg_catalog.simple'::regconfig,
      pg_catalog.regexp_replace(left(coalesce(p_query, ''), 500), '[-_/]+', ' ', 'g')) v
  ), names as (
    select n.q
    from pg_catalog.unnest(public.dam_search_name_queries(p_filters->'requiredCharacterNames')) n(q)
    union
    select pg_catalog.phraseto_tsquery('pg_catalog.simple'::regconfig, left(x.name, 200))
    from (select l.name from core.licensor l
          union select p.name from core.property p) x
    where length(btrim(x.name)) >= 3
  )
  select pg_catalog.string_agg('(' || n.q::text || ')', ' & ')::tsquery
  from names n cross join qv
  where n.q::text <> '' and qv.v @@ n.q
$function$;
revoke all on function public.dam_search_exact_names(text, jsonb) from public, anon, authenticated;

do $cron$
begin
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'dam-search-tsv-en-backfill';
  perform cron.schedule('dam-search-tsv-en-backfill', '* * * * *',
    $job$set statement_timeout = '90s'; select public.dam_search_tsv_en_backfill()$job$);
end;
$cron$;

CREATE OR REPLACE FUNCTION public.search_dam_documents(p_query text, p_filters jsonb, p_limit integer, p_offset integer, p_document_types text[] DEFAULT NULL::text[], p_query_embedding extensions.vector DEFAULT NULL::extensions.vector, p_min_rank real DEFAULT 0, p_min_semantic_score real DEFAULT NULL::real, p_query_text_embedding extensions.halfvec DEFAULT NULL::extensions.halfvec, p_min_text_score real DEFAULT NULL::real, p_text_score_margin real DEFAULT NULL::real)
 RETURNS TABLE(document_type text, entity_id uuid, asset_id uuid, style_group_id uuid, keyword_rank real, semantic_rank real, rank real, total_count bigint, has_more boolean, facets jsonb, text_rank real)
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
      ns.character_groups, ns.character_assets, ns.property_groups, ns.property_assets
    from public.dam_search_named_scope(p_filters) ns
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
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,d.title,d.title_key,d.title_tsv
    from public.dam_search_keys d
    where (p_document_types is null or d.document_type = any(p_document_types))
      and d.search_tsv @@ any(array(select distinct q.tsq from queries q))
  ), full_text_matches as materialized (
    -- popdam3#1037 Step 7: exact words first (today's index and score); then documents that match
    -- only by English word form (search_tsv_en), scored below every exact match. A recognised
    -- character, licensor or property name in the query must still appear in its exact form.
    select e.*, false stem_only from exact_text_matches e
    union all
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,d.title,d.title_key,d.title_tsv,true
    from public.dam_search_keys d
    where (p_document_types is null or d.document_type = any(p_document_types))
      and d.search_tsv_en @@ any(array(select distinct q.tsq_en from queries q where q.tsq_en::text <> ''))
      and exists (select 1 from queries q
        where q.tsq_en::text <> '' and d.search_tsv_en @@ q.tsq_en
          and (q.names_tsq is null or d.search_tsv @@ q.names_tsq))
      and not exists (select 1 from exact_text_matches e
        where e.document_type = d.document_type and e.entity_id = d.entity_id)
  ), substring_matches as materialized (
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,d.title,d.path,d.customer,d.program,d.title_key,d.title_tsv
    from substring_regex r
    join public.dam_search_keys d on r.rx is not null and
      (d.title ~* r.rx or d.path ~* r.rx or d.customer ~* r.rx or d.program ~* r.rx)
    where (p_document_types is null or d.document_type = any(p_document_types))
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
  ), visibility_params as materialized (
    -- semanticLicensorIds and the #1037 character/property scopes are not visibility filters
    -- (they are applied to candidates above): strip them so the unfiltered fast paths still apply.
    select coalesce(p_filters,'{}'::jsonb)-'search'-'semanticLicensorIds'
      -'requiredCharacterIds'-'requiredLegacyCharacterIds'-'requiredCharacterNames'
      -'semanticPropertyIds'-'semanticPropertyCharacterIds' f,
    public.assets_thumbnail_min_date() thumbnail_min_date
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
          where public.dam_asset_matches_filters(
            a.id, a.is_deleted, a.modified_at, a.file_created_at, a.thumbnail_url,
            a.style_group_id, a.licensor_id, sg.licensor_id, a.property_id, sg.property_id,
            a.customer_id, sg.customer_id, a.file_type, a.content_type, a.product_material,
            a.status, a.workflow_status, a.stage, a.is_licensed, a.asset_type, a.art_source,
            a.thumbnail_error, a.product_category, a.relative_path, a.customer, a.program,
            v.f, v.thumbnail_min_date))
      limit 10
    ) j
  ), candidate_ranks as materialized (
    -- Text leg off: rank = keyword + 0.35 x picture (unchanged). On (plan O3 start):
    -- rank = keyword + 0.6 x text + 0.15 x picture.
    select r.* from (
      select c.document_type,c.entity_id,c.asset_id,c.style_group_id,c.keyword_rank,c.semantic_rank,c.text_rank,
        (coalesce(c.keyword_rank,0) + case when (select has_text_embedding from params)
          then coalesce(c.text_rank,0) * 0.6 + coalesce(c.semantic_rank,0) * 0.15
          else coalesce(c.semantic_rank,0) * 0.35 end)::real rank
      from classified c
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
    where public.dam_asset_matches_filters(
          a.id, a.is_deleted, a.modified_at, a.file_created_at, a.thumbnail_url,
          a.style_group_id, a.licensor_id, sg.licensor_id, a.property_id, sg.property_id,
          a.customer_id, sg.customer_id, a.file_type, a.content_type, a.product_material,
          a.status, a.workflow_status, a.stage, a.is_licensed, a.asset_type, a.art_source,
          a.thumbnail_error, a.product_category, a.relative_path, a.customer, a.program,
          v.f, v.thumbnail_min_date)
    order by c.rn
    limit (select summary_probe_limit + 1 from params)
  ), default_flag_state as materialized (
    -- #5747 Step 5: unfiltered exact-count fast path. Usable only when the
    -- request has no filters AND every candidate document carries a flag
    -- computed with the CURRENT thumbnail min date for the same members.
    -- Any doubt falls back to the per-document probe below (exact either way).
    select count(*) filter (where d.has_default_visible_member) flagged_visible,
      -- #5938: visible member assets summed over candidates. visible_assets has
      -- one row per (candidate, probe-visible member), so this sum is exactly
      -- its unlimited row count when every count is current.
      coalesce(sum(d.default_visible_member_count), 0) visible_member_rows,
      coalesce(bool_and(d.default_visible_member_count is not null), true) all_counts_current,
      coalesce(bool_and(d.has_default_visible_member is not null
        and d.default_visible_min_date = v.thumbnail_min_date
        and d.asset_id is not distinct from c.asset_id
        and d.style_group_id is not distinct from c.style_group_id), true) all_current
    from visibility_params v
    join ordered_candidates c on v.f = '{}'::jsonb
    left join public.dam_search_documents d
      on d.document_type = c.document_type and d.entity_id = c.entity_id
    group by v.thumbnail_min_date
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
    -- bounds. Fast path (#5747): unfiltered request with every flag current
    -- -> count maintained flags. Otherwise count EVERY candidate document
    -- that has at least one member asset passing the same visibility
    -- predicate, short-circuiting per document (LIMIT 1).
    select case
      when (select f from visibility_params) = '{}'::jsonb
       and coalesce((select all_current from default_flag_state), true)
      then coalesce((select flagged_visible from default_flag_state), 0)
      else (
        select count(*) from (
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
      )
    end total_count
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
    select r.document_type,r.entity_id,r.asset_id,r.style_group_id,r.keyword_rank,r.semantic_rank,r.rank,r.text_rank
    from page_documents r order by r.rn
    offset (select page_offset from params) limit (select page_limit from params)
  )
  select p.document_type,p.entity_id,p.asset_id,p.style_group_id,p.keyword_rank,p.semantic_rank,p.rank,
    s.total_count,
    (select visible_through_page from page_state) > (select page_offset+page_limit from params),
    s.facets, p.text_rank
  from summary s
  left join page p on true
  order by p.rank desc nulls last, p.document_type nulls last, p.entity_id nulls last;
$function$;

do $guard$
begin
  if not exists (select 1 from pg_proc p where p.oid=to_regprocedure('public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real,extensions.halfvec,real,real)')
      and md5(p.prosrc)='06c5644e5c9d5d47cdf382c56f10f433'
      and pg_get_userbyid(p.proowner)='postgres'
      and p.prosecdef and p.provolatile='s' and p.proretset
      and p.proconfig=ARRAY['search_path=public, extensions','statement_timeout=30s']::text[]
      and p.proacl::text='{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}') then
    raise exception 'popdam3#1037 installed search contract differs; reconcile rather than overwrite';
  end if;
end;
$guard$;

commit;

-- ===== replay of 20261218084706_dam_ranked_word_form_exclusion.sql =====
-- popcre/shared-db#4508, claim #6702, u2giants/popdam3#1037
-- Broad word-form searches can compare millions of candidate pairs in a nested anti join.
-- Deduplicate against the same exact-word keys with one hashed membership check instead.
begin;
set local lock_timeout='2s';
set local statement_timeout='60s';
set local search_path=pg_catalog,public,extensions;

do $guard$
begin
  if not exists (
    select 1 from pg_proc p where p.oid=to_regprocedure('public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real,extensions.halfvec,real,real)')
      and md5(p.prosrc)='06c5644e5c9d5d47cdf382c56f10f433'
  ) then
    raise exception 'DAM ranked search source differs from 20261218084203; reconcile rather than overwrite';
  end if;
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid='public.dam_search_keys'::regclass and c.contype='p'
      and pg_get_constraintdef(c.oid)='PRIMARY KEY (document_type, entity_id)'
  ) then
    raise exception 'DAM word-form exclusion needs the non-null document_type and entity_id primary key';
  end if;
end;
$guard$;

CREATE OR REPLACE FUNCTION public.search_dam_documents(p_query text, p_filters jsonb, p_limit integer, p_offset integer, p_document_types text[] DEFAULT NULL::text[], p_query_embedding extensions.vector DEFAULT NULL::extensions.vector, p_min_rank real DEFAULT 0, p_min_semantic_score real DEFAULT NULL::real, p_query_text_embedding extensions.halfvec DEFAULT NULL::extensions.halfvec, p_min_text_score real DEFAULT NULL::real, p_text_score_margin real DEFAULT NULL::real)
 RETURNS TABLE(document_type text, entity_id uuid, asset_id uuid, style_group_id uuid, keyword_rank real, semantic_rank real, rank real, total_count bigint, has_more boolean, facets jsonb, text_rank real)
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
      ns.character_groups, ns.character_assets, ns.property_groups, ns.property_assets
    from public.dam_search_named_scope(p_filters) ns
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
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,d.title,d.title_key,d.title_tsv
    from public.dam_search_keys d
    where (p_document_types is null or d.document_type = any(p_document_types))
      and d.search_tsv @@ any(array(select distinct q.tsq from queries q))
  ), full_text_matches as materialized (
    -- popdam3#1037 Step 7: exact words first (today's index and score); then documents that match
    -- only by English word form (search_tsv_en), scored below every exact match. A recognised
    -- character, licensor or property name in the query must still appear in its exact form.
    select e.*, false stem_only from exact_text_matches e
    union all
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,d.title,d.title_key,d.title_tsv,true
    from public.dam_search_keys d
    where (p_document_types is null or d.document_type = any(p_document_types))
      and d.search_tsv_en @@ any(array(select distinct q.tsq_en from queries q where q.tsq_en::text <> ''))
      and exists (select 1 from queries q
        where q.tsq_en::text <> '' and d.search_tsv_en @@ q.tsq_en
          and (q.names_tsq is null or d.search_tsv @@ q.names_tsq))
      -- Both sides use the same NOT NULL primary key from dam_search_keys. Hash the
      -- exact keys once instead of comparing every stem match with the materialized CTE.
      and (d.document_type, d.entity_id) not in (
        select e.document_type, e.entity_id from exact_text_matches e)
  ), substring_matches as materialized (
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,d.title,d.path,d.customer,d.program,d.title_key,d.title_tsv
    from substring_regex r
    join public.dam_search_keys d on r.rx is not null and
      (d.title ~* r.rx or d.path ~* r.rx or d.customer ~* r.rx or d.program ~* r.rx)
    where (p_document_types is null or d.document_type = any(p_document_types))
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
  ), visibility_params as materialized (
    -- semanticLicensorIds and the #1037 character/property scopes are not visibility filters
    -- (they are applied to candidates above): strip them so the unfiltered fast paths still apply.
    select coalesce(p_filters,'{}'::jsonb)-'search'-'semanticLicensorIds'
      -'requiredCharacterIds'-'requiredLegacyCharacterIds'-'requiredCharacterNames'
      -'semanticPropertyIds'-'semanticPropertyCharacterIds' f,
    public.assets_thumbnail_min_date() thumbnail_min_date
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
          where public.dam_asset_matches_filters(
            a.id, a.is_deleted, a.modified_at, a.file_created_at, a.thumbnail_url,
            a.style_group_id, a.licensor_id, sg.licensor_id, a.property_id, sg.property_id,
            a.customer_id, sg.customer_id, a.file_type, a.content_type, a.product_material,
            a.status, a.workflow_status, a.stage, a.is_licensed, a.asset_type, a.art_source,
            a.thumbnail_error, a.product_category, a.relative_path, a.customer, a.program,
            v.f, v.thumbnail_min_date))
      limit 10
    ) j
  ), candidate_ranks as materialized (
    -- Text leg off: rank = keyword + 0.35 x picture (unchanged). On (plan O3 start):
    -- rank = keyword + 0.6 x text + 0.15 x picture.
    select r.* from (
      select c.document_type,c.entity_id,c.asset_id,c.style_group_id,c.keyword_rank,c.semantic_rank,c.text_rank,
        (coalesce(c.keyword_rank,0) + case when (select has_text_embedding from params)
          then coalesce(c.text_rank,0) * 0.6 + coalesce(c.semantic_rank,0) * 0.15
          else coalesce(c.semantic_rank,0) * 0.35 end)::real rank
      from classified c
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
    where public.dam_asset_matches_filters(
          a.id, a.is_deleted, a.modified_at, a.file_created_at, a.thumbnail_url,
          a.style_group_id, a.licensor_id, sg.licensor_id, a.property_id, sg.property_id,
          a.customer_id, sg.customer_id, a.file_type, a.content_type, a.product_material,
          a.status, a.workflow_status, a.stage, a.is_licensed, a.asset_type, a.art_source,
          a.thumbnail_error, a.product_category, a.relative_path, a.customer, a.program,
          v.f, v.thumbnail_min_date)
    order by c.rn
    limit (select summary_probe_limit + 1 from params)
  ), default_flag_state as materialized (
    -- #5747 Step 5: unfiltered exact-count fast path. Usable only when the
    -- request has no filters AND every candidate document carries a flag
    -- computed with the CURRENT thumbnail min date for the same members.
    -- Any doubt falls back to the per-document probe below (exact either way).
    select count(*) filter (where d.has_default_visible_member) flagged_visible,
      -- #5938: visible member assets summed over candidates. visible_assets has
      -- one row per (candidate, probe-visible member), so this sum is exactly
      -- its unlimited row count when every count is current.
      coalesce(sum(d.default_visible_member_count), 0) visible_member_rows,
      coalesce(bool_and(d.default_visible_member_count is not null), true) all_counts_current,
      coalesce(bool_and(d.has_default_visible_member is not null
        and d.default_visible_min_date = v.thumbnail_min_date
        and d.asset_id is not distinct from c.asset_id
        and d.style_group_id is not distinct from c.style_group_id), true) all_current
    from visibility_params v
    join ordered_candidates c on v.f = '{}'::jsonb
    left join public.dam_search_documents d
      on d.document_type = c.document_type and d.entity_id = c.entity_id
    group by v.thumbnail_min_date
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
    -- bounds. Fast path (#5747): unfiltered request with every flag current
    -- -> count maintained flags. Otherwise count EVERY candidate document
    -- that has at least one member asset passing the same visibility
    -- predicate, short-circuiting per document (LIMIT 1).
    select case
      when (select f from visibility_params) = '{}'::jsonb
       and coalesce((select all_current from default_flag_state), true)
      then coalesce((select flagged_visible from default_flag_state), 0)
      else (
        select count(*) from (
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
      )
    end total_count
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
    select r.document_type,r.entity_id,r.asset_id,r.style_group_id,r.keyword_rank,r.semantic_rank,r.rank,r.text_rank
    from page_documents r order by r.rn
    offset (select page_offset from params) limit (select page_limit from params)
  )
  select p.document_type,p.entity_id,p.asset_id,p.style_group_id,p.keyword_rank,p.semantic_rank,p.rank,
    s.total_count,
    (select visible_through_page from page_state) > (select page_offset+page_limit from params),
    s.facets, p.text_rank
  from summary s
  left join page p on true
  order by p.rank desc nulls last, p.document_type nulls last, p.entity_id nulls last;
$function$;

do $guard$
begin
  if not exists (select 1 from pg_proc p where p.oid=to_regprocedure('public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real,extensions.halfvec,real,real)')
      and md5(p.prosrc)='1483210ba34245a52e60ec3ea6fd7737'
      and pg_get_userbyid(p.proowner)='postgres'
      and p.prosecdef and p.provolatile='s' and p.proretset
      and p.proconfig=ARRAY['search_path=public, extensions','statement_timeout=30s']::text[]
      and p.proacl::text='{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}') then
    raise exception 'DAM ranked search install changed the routine contract; reconcile before release';
  end if;
end;
$guard$;

commit;

-- ===== replay of 20261218084707_dam_search_named_lookup.sql =====
-- popcre/shared-db#6706, claim #6707, u2giants/popdam3#1037
-- Resolve only the names and property associations relevant to a typed search.
begin;
set local lock_timeout = '1s';
set local statement_timeout = '5s';

-- Match JavaScript's lowercasing followed by ASCII word normalization. Only
-- U+0130 (i plus a combining separator) and U+212A (k) lowercase into ASCII
-- from outside ASCII. The explicit mappings and C collation make indexes
-- independent of the database locale.
create index character_dam_search_name_idx on core.character (
  (btrim(regexp_replace(lower(replace(replace(name, U&'\0130', 'i '), U&'\212A', 'k') collate pg_catalog."C"), '[^a-z0-9]+', ' ', 'g')))
);
create index characters_dam_search_name_idx on public.characters (
  (btrim(regexp_replace(lower(replace(replace(name, U&'\0130', 'i '), U&'\212A', 'k') collate pg_catalog."C"), '[^a-z0-9]+', ' ', 'g')))
);

create function public.get_dam_search_named_rows(p_keys text[])
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  -- Two 500-character inputs contain at most 3,944 contiguous one-to-eight-word phrases.
  if p_keys is null or cardinality(p_keys) > 4000 or coalesce(array_ndims(p_keys), 1) <> 1 then
    raise exception using errcode = '22023', message = 'Invalid DAM named search phrase list';
  end if;
  if exists (
    select 1 from unnest(p_keys) as phrases(phrase)
    where phrase is null or octet_length(phrase) > 500
      or phrase collate pg_catalog."C" !~ '^[a-z0-9]+( [a-z0-9]+){0,7}$'
  ) then
    raise exception using errcode = '22023', message = 'Invalid DAM named search phrase';
  end if;

  return (
    with properties as materialized (
      select p.id, p.name
      from core.property p
      where btrim(regexp_replace(lower(replace(replace(p.name, U&'\0130', 'i '), U&'\212A', 'k') collate pg_catalog."C"), '[^a-z0-9]+', ' ', 'g')) = any(p_keys)
    ), licensors as (
      select i.name
      from core.licensor i
      where btrim(regexp_replace(lower(replace(replace(i.name, U&'\0130', 'i '), U&'\212A', 'k') collate pg_catalog."C"), '[^a-z0-9]+', ' ', 'g')) = any(p_keys)
      union all
      select a.alias
      from core.licensor_alias a
      where btrim(regexp_replace(lower(replace(replace(a.alias, U&'\0130', 'i '), U&'\212A', 'k') collate pg_catalog."C"), '[^a-z0-9]+', ' ', 'g')) = any(p_keys)
    )
    select jsonb_build_object(
      'characters', coalesce((
        select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name))
        from core.character c
        where btrim(regexp_replace(lower(replace(replace(c.name, U&'\0130', 'i '), U&'\212A', 'k') collate pg_catalog."C"), '[^a-z0-9]+', ' ', 'g')) = any(p_keys)
      ), '[]'::jsonb),
      'aliases', coalesce((
        select jsonb_agg(jsonb_build_object('characterId', a.character_id, 'alias', a.alias))
        from core.character_alias a
        where btrim(regexp_replace(lower(replace(replace(a.alias, U&'\0130', 'i '), U&'\212A', 'k') collate pg_catalog."C"), '[^a-z0-9]+', ' ', 'g')) = any(p_keys)
      ), '[]'::jsonb),
      'legacyCharacters', coalesce((
        select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name))
        from public.characters c
        where btrim(regexp_replace(lower(replace(replace(c.name, U&'\0130', 'i '), U&'\212A', 'k') collate pg_catalog."C"), '[^a-z0-9]+', ' ', 'g')) = any(p_keys)
      ), '[]'::jsonb),
      'properties', coalesce((
        select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name)) from properties p
      ), '[]'::jsonb),
      'propertyCharacters', coalesce((
        select jsonb_agg(jsonb_build_object('propertyId', a.property_id, 'characterId', a.character_id))
        from core.property_character_associations_current a
        join properties p on p.id = a.property_id
      ), '[]'::jsonb),
      'licensorNames', coalesce((select jsonb_agg(i.name) from licensors i), '[]'::jsonb)
    )
  );
end;
$function$;

revoke all on function public.get_dam_search_named_rows(text[]) from public, anon, authenticated;
grant execute on function public.get_dam_search_named_rows(text[]) to service_role;

commit;

-- ===== replay of 20261218090000_style_guide_gated_views_service_role.sql =====
-- #6452: follow-up to #6418 (20261218043336) review findings.
--
-- 1. Service-role readers (popdam3 popsg-readiness-baseline) were cut to zero
--    rows: app.has_app_access('dam') is false without a user JWT. The gate now
--    also admits the verified service_role request role.
-- 2. Snapshot matviews get an explicit service_role SELECT grant and lose any
--    PUBLIC grant; the gated views lose any PUBLIC/anon grant.
-- 3. Views keep `select *` (frozen column list). Documented on each view and
--    asserted below: column count must equal its snapshot's. Any future
--    ALTER on a snapshot must recreate its view.
-- 4. Verification checks BOTH refresh targets, and PostgREST reloads schema.
--
-- ROLLBACK (forward migration): recreate both views with the 20261218043336
-- gate text `where (select app.has_app_access('dam'::app.app_name))`.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace view public.style_guide_folders with (security_invoker = false) as
  select * from public.style_guide_folders_snapshot
  where (select app.has_app_access('dam'::app.app_name) or auth.role() = 'service_role');

create or replace view public.style_guide_file_groups with (security_invoker = false) as
  select * from public.style_guide_file_groups_snapshot
  where (select app.has_app_access('dam'::app.app_name) or auth.role() = 'service_role');

revoke all on public.style_guide_folders_snapshot from public, anon, authenticated;
revoke all on public.style_guide_file_groups_snapshot from public, anon, authenticated;
grant select on public.style_guide_folders_snapshot to service_role;
grant select on public.style_guide_file_groups_snapshot to service_role;

revoke all on public.style_guide_folders from public, anon;
revoke all on public.style_guide_file_groups from public, anon;
grant select on public.style_guide_folders to authenticated, service_role;
grant select on public.style_guide_file_groups to authenticated, service_role;

comment on view public.style_guide_folders is
  'Caller-gated projection of style_guide_folders_snapshot (#6418/#6452). select * is frozen at creation: recreate this view after any column change on the snapshot.';
comment on view public.style_guide_file_groups is
  'Caller-gated projection of style_guide_file_groups_snapshot (#6418/#6452). select * is frozen at creation: recreate this view after any column change on the snapshot.';

do $verify$
declare
  v text;
  v_def text;
  v_body text;
begin
  foreach v in array array['style_guide_folders', 'style_guide_file_groups'] loop
    v_def := pg_get_viewdef(format('public.%I', v)::regclass);
    if v_def not like '%has_app_access%' or v_def not like '%service_role%' then
      raise exception '#6452: view public.% gate incomplete', v;
    end if;
    if (select count(*) from pg_attribute where attrelid = format('public.%I', v)::regclass and attnum > 0 and not attisdropped)
       <> (select count(*) from pg_attribute where attrelid = format('public.%I_snapshot', v)::regclass and attnum > 0 and not attisdropped) then
      raise exception '#6452: view public.% column list differs from its snapshot', v;
    end if;
    foreach v_def in array array['public', 'anon', 'authenticated'] loop
      if has_table_privilege(v_def, format('public.%I_snapshot', v), 'select') then
        raise exception '#6452: snapshot public.%_snapshot readable by %', v, v_def;
      end if;
    end loop;
    if has_table_privilege('public', format('public.%I', v), 'select')
       or has_table_privilege('anon', format('public.%I', v), 'select') then
      raise exception '#6452: view public.% readable by public/anon', v;
    end if;
    if not has_table_privilege('service_role', format('public.%I_snapshot', v), 'select')
       or not has_table_privilege('service_role', format('public.%I', v), 'select') then
      raise exception '#6452: service_role lost read on public.%', v;
    end if;
  end loop;

  select pg_get_functiondef('public.refresh_style_guide_matviews(uuid,integer,text)'::regprocedure) into v_body;
  if v_body not like '%concurrently public.style_guide_file_groups_snapshot%'
     or v_body not like '%concurrently public.style_guide_folders_snapshot%'
     or v_body ~ 'concurrently public\.style_guide_(file_groups|folders)\s*;' then
    raise exception '#6452: refresh function does not target both snapshots';
  end if;
end
$verify$;

notify pgrst, 'reload schema';

commit;

-- ===== replay of 20261218093000_dam_search_word_form_candidate_cap.sql =====
-- u2giants/popdam3#1037 Step 7 performance follow-up
-- Bare "frame" went from 0.3 s to 8.8 s cold / 3.2 s warm after word forms (20261218084203):
-- the word-form-only step re-tested every row's word list (and its exact-name list when a name
-- was recognised), detoasting ~10.7k rows. Now: the GIN index proves the match; the name test
-- runs only on surviving rows; unfiltered searches rank only the best greatest(300, page end)
-- word-form-only rows (they score 0.05-0.09, below every exact match), or none when exact
-- matches already fill twice the requested page; rows left out still count toward the exact
-- total. Read-only parity on production: identical pages and totals for frame (two pages),
-- frames, framed, sticker, print and marie frame. Function body only; no data change.
begin;
set local lock_timeout='2s';
set local statement_timeout='60s';
set local search_path=pg_catalog,public,extensions;

do $guard$
begin
  if not exists (
    select 1 from pg_proc p where p.oid=to_regprocedure('public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real,extensions.halfvec,real,real)')
      and md5(p.prosrc) in ('1483210ba34245a52e60ec3ea6fd7737','25acea0ef28fc884d64a922c9f2f1e52')
  ) then
    raise exception 'DAM ranked search source differs from 20261218084706; reconcile rather than overwrite';
  end if;
end;
$guard$;

CREATE OR REPLACE FUNCTION public.search_dam_documents(p_query text, p_filters jsonb, p_limit integer, p_offset integer, p_document_types text[] DEFAULT NULL::text[], p_query_embedding extensions.vector DEFAULT NULL::extensions.vector, p_min_rank real DEFAULT 0, p_min_semantic_score real DEFAULT NULL::real, p_query_text_embedding extensions.halfvec DEFAULT NULL::extensions.halfvec, p_min_text_score real DEFAULT NULL::real, p_text_score_margin real DEFAULT NULL::real)
 RETURNS TABLE(document_type text, entity_id uuid, asset_id uuid, style_group_id uuid, keyword_rank real, semantic_rank real, rank real, total_count bigint, has_more boolean, facets jsonb, text_rank real)
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
      ns.character_groups, ns.character_assets, ns.property_groups, ns.property_assets
    from public.dam_search_named_scope(p_filters) ns
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
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,d.title,d.title_key,d.title_tsv
    from public.dam_search_keys d
    where (p_document_types is null or d.document_type = any(p_document_types))
      and d.search_tsv @@ any(array(select distinct q.tsq from queries q))
  ), word_form_keys as materialized (
    -- popdam3#1037 Step 7 performance (20261218093000): the GIN index alone proves the word-form
    -- match, so no per-row re-test here (re-testing detoasted ~10.7k word lists: 8.8 s cold for
    -- "frame"). Only narrow key columns are read. The named-character scope (applied to every leg
    -- in candidate_pool anyway) is applied here too so the cap below never drops an in-scope row.
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,greatest(length(d.title_key),1) key_len
    from public.dam_search_keys d
    where (p_document_types is null or d.document_type = any(p_document_types))
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
    where (p_document_types is null or d.document_type = any(p_document_types))
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
  ), visibility_params as materialized (
    -- semanticLicensorIds and the #1037 character/property scopes are not visibility filters
    -- (they are applied to candidates above): strip them so the unfiltered fast paths still apply.
    select coalesce(p_filters,'{}'::jsonb)-'search'-'semanticLicensorIds'
      -'requiredCharacterIds'-'requiredLegacyCharacterIds'-'requiredCharacterNames'
      -'semanticPropertyIds'-'semanticPropertyCharacterIds' f,
    public.assets_thumbnail_min_date() thumbnail_min_date
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
          where public.dam_asset_matches_filters(
            a.id, a.is_deleted, a.modified_at, a.file_created_at, a.thumbnail_url,
            a.style_group_id, a.licensor_id, sg.licensor_id, a.property_id, sg.property_id,
            a.customer_id, sg.customer_id, a.file_type, a.content_type, a.product_material,
            a.status, a.workflow_status, a.stage, a.is_licensed, a.asset_type, a.art_source,
            a.thumbnail_error, a.product_category, a.relative_path, a.customer, a.program,
            v.f, v.thumbnail_min_date))
      limit 10
    ) j
  ), candidate_ranks as materialized (
    -- Text leg off: rank = keyword + 0.35 x picture (unchanged). On (plan O3 start):
    -- rank = keyword + 0.6 x text + 0.15 x picture.
    select r.* from (
      select c.document_type,c.entity_id,c.asset_id,c.style_group_id,c.keyword_rank,c.semantic_rank,c.text_rank,
        (coalesce(c.keyword_rank,0) + case when (select has_text_embedding from params)
          then coalesce(c.text_rank,0) * 0.6 + coalesce(c.semantic_rank,0) * 0.15
          else coalesce(c.semantic_rank,0) * 0.35 end)::real rank
      from classified c
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
    where public.dam_asset_matches_filters(
          a.id, a.is_deleted, a.modified_at, a.file_created_at, a.thumbnail_url,
          a.style_group_id, a.licensor_id, sg.licensor_id, a.property_id, sg.property_id,
          a.customer_id, sg.customer_id, a.file_type, a.content_type, a.product_material,
          a.status, a.workflow_status, a.stage, a.is_licensed, a.asset_type, a.art_source,
          a.thumbnail_error, a.product_category, a.relative_path, a.customer, a.program,
          v.f, v.thumbnail_min_date)
    order by c.rn
    limit (select summary_probe_limit + 1 from params)
  ), default_flag_state as materialized (
    -- #5747 Step 5: unfiltered exact-count fast path. Usable only when the
    -- request has no filters AND every candidate document carries a flag
    -- computed with the CURRENT thumbnail min date for the same members.
    -- Any doubt falls back to the per-document probe below (exact either way).
    select count(*) filter (where d.has_default_visible_member) flagged_visible,
      -- #5938: visible member assets summed over candidates. visible_assets has
      -- one row per (candidate, probe-visible member), so this sum is exactly
      -- its unlimited row count when every count is current.
      coalesce(sum(d.default_visible_member_count), 0) visible_member_rows,
      coalesce(bool_and(d.default_visible_member_count is not null), true) all_counts_current,
      coalesce(bool_and(d.has_default_visible_member is not null
        and d.default_visible_min_date = v.thumbnail_min_date
        and d.asset_id is not distinct from c.asset_id
        and d.style_group_id is not distinct from c.style_group_id), true) all_current
    from visibility_params v
    join ordered_candidates c on v.f = '{}'::jsonb
    left join public.dam_search_documents d
      on d.document_type = c.document_type and d.entity_id = c.entity_id
    group by v.thumbnail_min_date
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
  ), word_form_overflow as materialized (
    -- 20261218093000: word-form-only rows left out by word_form_cap (unfiltered requests only)
    -- still count toward the exact total (owner ask #5053): a maintained flag when current,
    -- otherwise the same per-document visibility probe. Rows another leg already brought in are
    -- counted by exact_docs and skipped here.
    select count(*) n
    from word_form_matches w
    left join public.dam_search_documents d
      on d.document_type = w.document_type and d.entity_id = w.entity_id
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
          where public.dam_asset_matches_filters(
            a.id, a.is_deleted, a.modified_at, a.file_created_at, a.thumbnail_url,
            a.style_group_id, a.licensor_id, sg.licensor_id, a.property_id, sg.property_id,
            a.customer_id, sg.customer_id, a.file_type, a.content_type, a.product_material,
            a.status, a.workflow_status, a.stage, a.is_licensed, a.asset_type, a.art_source,
            a.thumbnail_error, a.product_category, a.relative_path, a.customer, a.program,
            v.f, v.thumbnail_min_date)
          limit 1)
      end
  ), exact_docs as materialized (
    -- Owner ask 2026-10-29 (issue #5053): totals must be exact, never lower
    -- bounds. Fast path (#5747): unfiltered request with every flag current
    -- -> count maintained flags. Otherwise count EVERY candidate document
    -- that has at least one member asset passing the same visibility
    -- predicate, short-circuiting per document (LIMIT 1).
    select case
      when (select f from visibility_params) = '{}'::jsonb
       and coalesce((select all_current from default_flag_state), true)
      then coalesce((select flagged_visible from default_flag_state), 0)
      else (
        select count(*) from (
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
      )
    end total_count
  ), summary as materialized (
    select
      ((select total_count from exact_docs) + (select n from word_form_overflow)) total_count,
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
    select r.document_type,r.entity_id,r.asset_id,r.style_group_id,r.keyword_rank,r.semantic_rank,r.rank,r.text_rank
    from page_documents r order by r.rn
    offset (select page_offset from params) limit (select page_limit from params)
  )
  select p.document_type,p.entity_id,p.asset_id,p.style_group_id,p.keyword_rank,p.semantic_rank,p.rank,
    s.total_count,
    (select visible_through_page from page_state) > (select page_offset+page_limit from params),
    s.facets, p.text_rank
  from summary s
  left join page p on true
  order by p.rank desc nulls last, p.document_type nulls last, p.entity_id nulls last;
$function$;
do $guard$
begin
  if not exists (select 1 from pg_proc p where p.oid=to_regprocedure('public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real,extensions.halfvec,real,real)')
      and md5(p.prosrc)='25acea0ef28fc884d64a922c9f2f1e52'
      and pg_get_userbyid(p.proowner)='postgres'
      and p.prosecdef and p.provolatile='s' and p.proretset
      and p.proconfig=ARRAY['search_path=public, extensions','statement_timeout=30s']::text[]
      and p.proacl::text='{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}') then
    raise exception 'DAM ranked search install changed the routine contract; reconcile before release';
  end if;
end;
$guard$;

commit;

-- ===== replay of 20261218230700_dam_search_visibility_pretest.sql =====
-- u2giants/popdam3#1037: filtered typed search speed (visibility pre-test).
-- "frame" with a filter that matches few or no products took 13-35 s: every candidate's member
-- assets (~22k for frame) went through public.dam_asset_matches_filters, a non-inlinable SQL
-- function (~0.3 ms per call), in each of up to three passes (visible_assets, page_documents,
-- exact_docs). Now the filter values are parsed once (visibility_params) and a typed pre-test
-- that the function implies runs in front of every call, so rejected rows never reach the
-- function. Rows that pass are still decided by the function: pages, totals and facets are
-- unchanged. The filter values are read by a new helper, public.dam_search_filter_pretest_values
-- (no grants beyond the owner; only the search body calls it). No data change.
begin;
set local lock_timeout='2s';
set local statement_timeout='60s';
set local search_path=pg_catalog,public,extensions;

do $guard$
begin
  if not exists (
    select 1 from pg_proc p where p.oid=to_regprocedure('public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real,extensions.halfvec,real,real)')
      and md5(p.prosrc) in ('25acea0ef28fc884d64a922c9f2f1e52','0209882590307ebaa792a3928aba5fb2')
  ) then
    raise exception 'DAM ranked search source differs from 20261218093000; reconcile rather than overwrite';
  end if;
end;
$guard$;

-- Typed values for the visibility pre-test (read once per search). A value the per-asset helper
-- could not read (not an array, not a uuid or boolean) returns NULL here, which leaves that
-- pre-test off, so the helper behaves exactly as before for it.
create or replace function public.dam_search_filter_pretest_values(p_filters jsonb,
  out pf_licensor uuid, out pf_property uuid, out pf_customer_id uuid,
  out pf_file_type text[], out pf_content_type text[], out pf_status text[],
  out pf_workflow_status text[], out pf_stage text[], out pf_asset_type text[],
  out pf_art_source text[], out pf_is_licensed boolean, out pf_customer text, out pf_program text,
  out pf_on boolean)
 language sql
 stable parallel safe
 set search_path to 'pg_catalog'
as $pretest$
  select x.*, (x.l is not null or x.p is not null or x.c is not null or x.ft is not null
      or x.ct is not null or x.st is not null or x.wf is not null or x.sg is not null
      or x.at is not null or x.src is not null or x.il is not null or x.cu is not null
      or x.pr is not null)
  from (select
    case when pg_input_is_valid(nullif(p_filters->>'licensorId',''),'uuid') then (p_filters->>'licensorId')::uuid end l,
    case when pg_input_is_valid(nullif(p_filters->>'propertyId',''),'uuid') then (p_filters->>'propertyId')::uuid end p,
    case when pg_input_is_valid(nullif(p_filters->>'customerId',''),'uuid') then (p_filters->>'customerId')::uuid end c,
    case when jsonb_typeof(p_filters->'fileType')='array' and jsonb_array_length(p_filters->'fileType')>0
      then array(select jsonb_array_elements_text(p_filters->'fileType')) end ft,
    case when jsonb_typeof(p_filters->'contentType')='array' and jsonb_array_length(p_filters->'contentType')>0
      then array(select jsonb_array_elements_text(p_filters->'contentType')) end ct,
    case when jsonb_typeof(p_filters->'status')='array' and jsonb_array_length(p_filters->'status')>0
      then array(select jsonb_array_elements_text(p_filters->'status')) end st,
    case when jsonb_typeof(p_filters->'workflowStatus')='array' and jsonb_array_length(p_filters->'workflowStatus')>0
      then array(select jsonb_array_elements_text(p_filters->'workflowStatus')) end wf,
    case when jsonb_typeof(p_filters->'stage')='array' and jsonb_array_length(p_filters->'stage')>0
      then array(select jsonb_array_elements_text(p_filters->'stage')) end sg,
    case when jsonb_typeof(p_filters->'assetType')='array' and jsonb_array_length(p_filters->'assetType')>0
      then array(select jsonb_array_elements_text(p_filters->'assetType')) end at,
    case when jsonb_typeof(p_filters->'artSource')='array' and jsonb_array_length(p_filters->'artSource')>0
      then array(select jsonb_array_elements_text(p_filters->'artSource')) end src,
    case when pg_input_is_valid(p_filters->>'isLicensed','boolean') then (p_filters->>'isLicensed')::boolean end il,
    nullif(p_filters->>'customer','') cu,
    nullif(p_filters->>'program','') pr) x
$pretest$;
revoke all on function public.dam_search_filter_pretest_values(jsonb) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.search_dam_documents(p_query text, p_filters jsonb, p_limit integer, p_offset integer, p_document_types text[] DEFAULT NULL::text[], p_query_embedding extensions.vector DEFAULT NULL::extensions.vector, p_min_rank real DEFAULT 0, p_min_semantic_score real DEFAULT NULL::real, p_query_text_embedding extensions.halfvec DEFAULT NULL::extensions.halfvec, p_min_text_score real DEFAULT NULL::real, p_text_score_margin real DEFAULT NULL::real)
 RETURNS TABLE(document_type text, entity_id uuid, asset_id uuid, style_group_id uuid, keyword_rank real, semantic_rank real, rank real, total_count bigint, has_more boolean, facets jsonb, text_rank real)
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
      ns.character_groups, ns.character_assets, ns.property_groups, ns.property_assets
    from public.dam_search_named_scope(p_filters) ns
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
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,d.title,d.title_key,d.title_tsv
    from public.dam_search_keys d
    where (p_document_types is null or d.document_type = any(p_document_types))
      and d.search_tsv @@ any(array(select distinct q.tsq from queries q))
  ), word_form_keys as materialized (
    -- popdam3#1037 Step 7 performance (20261218093000): the GIN index alone proves the word-form
    -- match, so no per-row re-test here (re-testing detoasted ~10.7k word lists: 8.8 s cold for
    -- "frame"). Only narrow key columns are read. The named-character scope (applied to every leg
    -- in candidate_pool anyway) is applied here too so the cap below never drops an in-scope row.
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,greatest(length(d.title_key),1) key_len
    from public.dam_search_keys d
    where (p_document_types is null or d.document_type = any(p_document_types))
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
    where (p_document_types is null or d.document_type = any(p_document_types))
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
  ), candidate_ranks as materialized (
    -- Text leg off: rank = keyword + 0.35 x picture (unchanged). On (plan O3 start):
    -- rank = keyword + 0.6 x text + 0.15 x picture.
    select r.* from (
      select c.document_type,c.entity_id,c.asset_id,c.style_group_id,c.keyword_rank,c.semantic_rank,c.text_rank,
        (coalesce(c.keyword_rank,0) + case when (select has_text_embedding from params)
          then coalesce(c.text_rank,0) * 0.6 + coalesce(c.semantic_rank,0) * 0.15
          else coalesce(c.semantic_rank,0) * 0.35 end)::real rank
      from classified c
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
  ), default_flag_state as materialized (
    -- #5747 Step 5: unfiltered exact-count fast path. Usable only when the
    -- request has no filters AND every candidate document carries a flag
    -- computed with the CURRENT thumbnail min date for the same members.
    -- Any doubt falls back to the per-document probe below (exact either way).
    select count(*) filter (where d.has_default_visible_member) flagged_visible,
      -- #5938: visible member assets summed over candidates. visible_assets has
      -- one row per (candidate, probe-visible member), so this sum is exactly
      -- its unlimited row count when every count is current.
      coalesce(sum(d.default_visible_member_count), 0) visible_member_rows,
      coalesce(bool_and(d.default_visible_member_count is not null), true) all_counts_current,
      coalesce(bool_and(d.has_default_visible_member is not null
        and d.default_visible_min_date = v.thumbnail_min_date
        and d.asset_id is not distinct from c.asset_id
        and d.style_group_id is not distinct from c.style_group_id), true) all_current
    from visibility_params v
    join ordered_candidates c on v.f = '{}'::jsonb
    left join public.dam_search_documents d
      on d.document_type = c.document_type and d.entity_id = c.entity_id
    group by v.thumbnail_min_date
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
    ), false)
    order by c.rn
    limit (select page_offset + page_limit + 1 from params)
  ), page_state as materialized (
    select count(*) visible_through_page from page_documents
  ), word_form_overflow as materialized (
    -- 20261218093000: word-form-only rows left out by word_form_cap (unfiltered requests only)
    -- still count toward the exact total (owner ask #5053): a maintained flag when current,
    -- otherwise the same per-document visibility probe. Rows another leg already brought in are
    -- counted by exact_docs and skipped here.
    select count(*) n
    from word_form_matches w
    left join public.dam_search_documents d
      on d.document_type = w.document_type and d.entity_id = w.entity_id
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
  ), exact_docs as materialized (
    -- Owner ask 2026-10-29 (issue #5053): totals must be exact, never lower
    -- bounds. Fast path (#5747): unfiltered request with every flag current
    -- -> count maintained flags. Otherwise count EVERY candidate document
    -- that has at least one member asset passing the same visibility
    -- predicate, short-circuiting per document (LIMIT 1).
    select case
      when (select f from visibility_params) = '{}'::jsonb
       and coalesce((select all_current from default_flag_state), true)
      then coalesce((select flagged_visible from default_flag_state), 0)
      else (
        select count(*) from (
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
        ) d
      )
    end total_count
  ), summary as materialized (
    select
      ((select total_count from exact_docs) + (select n from word_form_overflow)) total_count,
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
    select r.document_type,r.entity_id,r.asset_id,r.style_group_id,r.keyword_rank,r.semantic_rank,r.rank,r.text_rank
    from page_documents r order by r.rn
    offset (select page_offset from params) limit (select page_limit from params)
  )
  select p.document_type,p.entity_id,p.asset_id,p.style_group_id,p.keyword_rank,p.semantic_rank,p.rank,
    s.total_count,
    (select visible_through_page from page_state) > (select page_offset+page_limit from params),
    s.facets, p.text_rank
  from summary s
  left join page p on true
  order by p.rank desc nulls last, p.document_type nulls last, p.entity_id nulls last;
$function$;
do $guard$
begin
  if not exists (select 1 from pg_proc p where p.oid=to_regprocedure('public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real,extensions.halfvec,real,real)')
      and md5(p.prosrc)='0209882590307ebaa792a3928aba5fb2'
      and pg_get_userbyid(p.proowner)='postgres'
      and p.prosecdef and p.provolatile='s' and p.proretset
      and p.proconfig=ARRAY['search_path=public, extensions','statement_timeout=30s']::text[]
      and p.proacl::text='{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}') then
    raise exception 'DAM ranked search install changed the routine contract; reconcile before release';
  end if;
end;
$guard$;

commit;
