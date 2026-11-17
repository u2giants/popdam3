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
-- derived-from: 20261110154439
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
