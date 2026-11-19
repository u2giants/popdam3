-- Sandbox catch-up batch 24 (#6472): DesignFlow sandbox (xupnyeifmpsacrqahwwm) ONLY. Never apply to shared preview or production.
-- Batch 23's apply (run 44483769361) committed its overload drop and the 20261204003632, 003633 and 20261218084103
-- blocks, then stopped in 084203 because the sandbox has no pg_cron (relation "cron.job" does not exist).
-- Batch 23 is blocked on the sandbox route. This batch replays the rest in production order: 20261218084203,
-- 084504, 084706, 084707, 090000, 093000, 230700 and 20261222090000, unchanged except that grants and policies
-- naming production service logins (excluded from the sandbox by #6356) are omitted and, where pg_cron is absent,
-- 084203's backfill job is replaced by an inline fill of the same column. It also adds production's
-- idx_style_groups_primary_asset_id, which production has outside any migration file.
-- derived-from: none

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
  if to_regclass('cron.job') is null then
    -- sandbox: no pg_cron; fill the column inline instead of scheduling the backfill job.
    update public.dam_search_keys set search_tsv_en = public.dam_search_tsv_en(search_tsv) where search_tsv_en is null;
    return;
  end if;
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

-- ===== replay of 20261218084504_plm_licensor_submission_pdf_identifiers.sql =====
-- popcre/shared-db#5952: preserve distinct identifiers from the source PDF.
-- Existing captures remain immutable. A NULL array records unverified evidence.

alter table plm.licensor_submission_pdf
  add column submission_numbers text[],
  add column brand_assurance_numbers text[];

comment on column plm.licensor_submission_pdf.submission_numbers is
  'Submission identifiers explicitly supported by this PDF. NULL when not verified.';

comment on column plm.licensor_submission_pdf.brand_assurance_numbers is
  'Brand Assurance identifiers explicitly supported by this PDF. NULL when not verified.';

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

-- ===== replay of 20261222090000_popsg_reconcile_preview_sidetable_count.sql =====
-- popcre/shared-db#3458 (u2giants/popdam3#107): nightly PopSG crawls now fail at
-- reconcile, before the matview refresh, with "canceling statement due to
-- statement timeout" (production runs 2026-11-12..2026-11-16). The first
-- reconcile_stale_sg_files_batch call runs preview_stale_sg_files, which joined
-- every crawl_seen row back to style_guide_files to re-check is_active. Right
-- after an ingest rewrites ~223k file rows the visibility map is cleared, so that
-- index-only scan becomes ~61k heap fetches: 4.2 s idle, past 8 s under load.
-- style_guide_file_crawl_seen holds exactly one row per ACTIVE file: the
-- trg_style_guide_files_crawl_seen trigger deletes the row when is_active turns
-- false and the foreign key cascades file deletes (production 2026-11-18: 223446
-- side rows, 223446 active files, 0 side rows on inactive files). Counting the
-- side table alone gives identical numbers in 0.2 s. Function body only; grants
-- are unchanged by CREATE OR REPLACE.
begin;
set local lock_timeout='2s';
set local statement_timeout='60s';
set local search_path=pg_catalog,public;

do $guard$
begin
  if not exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.preview_stale_sg_files(text,uuid,numeric)')
       and md5(p.prosrc) = 'e7c49634b4a489a397670885c123244a') then
    raise exception 'preview_stale_sg_files source differs from 20261111132448; reconcile rather than overwrite';
  end if;
  -- The side-table invariant this body relies on must still be enforced.
  if not exists (
       select 1 from pg_trigger t
        where t.tgrelid = 'public.style_guide_files'::regclass
          and t.tgname = 'trg_style_guide_files_crawl_seen' and t.tgenabled <> 'D')
     or not exists (
       select 1 from pg_constraint c
        where c.conrelid = 'public.style_guide_file_crawl_seen'::regclass
          and c.confrelid = 'public.style_guide_files'::regclass
          and c.contype = 'f' and c.confdeltype = 'c') then
    raise exception 'style_guide_file_crawl_seen is no longer kept to active files only';
  end if;
end;
$guard$;

create or replace function public.preview_stale_sg_files(p_root_label text, p_run_id uuid, p_min_ratio numeric DEFAULT 0.5)
 RETURNS TABLE(root_label text, run_id uuid, active_total bigint, run_active_total bigint, stale_candidates bigint, run_files_found integer, root_inaccessible boolean, guard_state text, guard_reason text, safe_to_reconcile boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_active bigint;
  v_run_active bigint;
  v_stale bigint;
  v_found integer;
  v_inaccessible boolean;
  v_state text;
  v_reason text;
  v_ratio numeric;
begin
  if p_root_label is null or p_run_id is null then
    raise exception 'preview_stale_sg_files requires a root label and a run id';
  end if;

  -- popdam3#804 / #3458: the side table holds one row per active file only
  -- (trigger delete on deactivation, cascade on file delete), so it is counted
  -- alone; no per-row recheck of style_guide_files.
  select count(*),
         count(*) filter (where s.crawl_run_id = p_run_id)
    into v_active, v_run_active
    from public.style_guide_file_crawl_seen s
   where s.root_label = p_root_label;

  v_stale := v_active - v_run_active;

  select r.files_found,
         coalesce(p_root_label = any (coalesce(r.inaccessible_roots, array[]::text[])), false)
    into v_found, v_inaccessible
    from public.style_guide_crawl_runs r
   where r.id = p_run_id;

  if not found then
    v_state := 'empty_crawl';
    v_reason := format('crawl run %s does not exist', p_run_id);
  elsif v_inaccessible then
    v_state := 'inaccessible_roots';
    v_reason := format('root %L is listed in the run''s inaccessible_roots; current rows are left active', p_root_label);
  elsif coalesce(v_found, 0) = 0 or v_run_active = 0 then
    v_state := 'empty_crawl';
    v_reason := format('run reported files_found=%s and %s active rows for this root; refusing to inactivate %s current rows',
                       coalesce(v_found, 0), v_run_active, v_active);
  else
    v_ratio := case when v_active > 0 then v_run_active::numeric / v_active::numeric else 1 end;
    if v_active > 0 and v_ratio < coalesce(p_min_ratio, 0.5) then
      v_state := 'low_nonzero';
      v_reason := format('run saw %s of %s active rows (ratio %s < %s); suspicious partial crawl, current rows left active',
                         v_run_active, v_active, round(v_ratio, 4), coalesce(p_min_ratio, 0.5));
    else
      v_state := 'ok';
      v_reason := null;
    end if;
  end if;

  root_label        := p_root_label;
  run_id            := p_run_id;
  active_total      := v_active;
  run_active_total  := v_run_active;
  stale_candidates  := v_stale;
  run_files_found   := v_found;
  root_inaccessible := coalesce(v_inaccessible, false);
  guard_state       := v_state;
  guard_reason      := v_reason;
  safe_to_reconcile := (v_state = 'ok');
  return next;
end;
$function$;

commit;

-- ===== production index without a migration file =====
create index idx_style_groups_primary_asset_id on public.style_groups using btree (primary_asset_id);
