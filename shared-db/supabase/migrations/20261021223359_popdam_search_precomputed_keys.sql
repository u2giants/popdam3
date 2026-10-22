-- #4573 / PopDAM #97: structural fix for broad DAM search terms and deep pages.
-- derived-from: 20261021203304
-- (20261021203304 is live on production.)
-- SUPERSEDES (never promote these): 20261021063716 and 20261021152741.
--
-- Problem (production, 2026-10-21): wall-art-canvas expands to "wall art",
-- which matches ~50,000 of 150,754 search documents. Every keyword match was
-- fetched from dam_search_documents, whose rows average ~2.2 KB in the heap
-- (the 384-dim embedding, ~1.5 KB, is stored inline), so a cold call read
-- ~260 MB (33k blocks) just to recheck the substring leg (10.5s cold for that
-- leg alone) and then recomputed a regex title key and a title tsvector per
-- match. Cold first calls hit the 8s timeout ("wall-art-canvas http=500
-- 8098ms"); offsets 3000+ also timed out.
--
-- Fix (structure): public.dam_search_keys, a narrow precomputed key table,
-- one row per search document: ids, title, path, customer, program, the
-- precomputed ranking inputs title_key and title_tsv, and search_tsv stored
-- out of line. It carries its own GIN full-text and trigram indexes and is
-- kept in step by trigger dam_search_documents_sync_keys (insert, delete,
-- and updates of the keyed/text columns; embedding-only updates do not fire).
-- Backfilled in path order so documents sharing a folder share heap pages.
-- search_dam_documents's keyword legs read it; the semantic leg, visibility
-- probe, summary and page logic are unchanged.
--
-- Contract unchanged from 20261021203304 (and 20261021190510): every keyword
-- and semantic candidate is ranked before any bound; an exact (case/
-- separator/extension-insensitive) title ranks 1.0; the page is the first
-- offset+limit visible documents in rank order and has_more is exact;
-- total_count/facets are exact when facets.totalExact is true, otherwise a
-- flagged lower bound (totalKind = 'lower_bound'). title_key/title_tsv use
-- exactly the expressions the previous body computed inline.
--
-- Unchanged: signature, wrappers (search_assets_full_text,
-- search_style_groups_full_text), grants, 8s timeout. No PopSG object.
-- Retirement path: the tsv/trigram indexes on dam_search_documents become
-- unused by search; a follow-up on #4573 may drop them.

create table if not exists public.dam_search_keys (
  document_type text not null,
  entity_id uuid not null,
  asset_id uuid,
  style_group_id uuid,
  title text not null,
  path text not null,
  customer text,
  program text,
  title_key text not null,
  title_tsv tsvector not null,
  search_tsv tsvector not null,
  primary key (document_type, entity_id)
) with (toast_tuple_target = 128);

-- Keep the short columns in the row; push only the full-text vector out of
-- line so the heap stays narrow.
alter table public.dam_search_keys
  alter column title set storage main,
  alter column path set storage main,
  alter column customer set storage main,
  alter column program set storage main,
  alter column title_key set storage main,
  alter column title_tsv set storage main,
  alter column search_tsv set storage external;

alter table public.dam_search_keys enable row level security;
revoke all on table public.dam_search_keys from public, anon, authenticated;
grant all on table public.dam_search_keys to service_role;

comment on table public.dam_search_keys is
  'Narrow precomputed keyword-search keys for dam_search_documents (one row per document), maintained only by trigger dam_search_documents_sync_keys. Read by search_dam_documents. Do not write directly.';

create or replace function public.sync_dam_search_keys()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $fn$
begin
  if tg_op in ('DELETE','UPDATE') then
    if tg_op = 'DELETE'
       or old.document_type is distinct from new.document_type
       or old.entity_id is distinct from new.entity_id then
      delete from public.dam_search_keys k
      where k.document_type = old.document_type and k.entity_id = old.entity_id;
    end if;
    if tg_op = 'DELETE' then
      return null;
    end if;
  end if;
  insert into public.dam_search_keys as k (
    document_type, entity_id, asset_id, style_group_id, title, path, customer, program,
    title_key, title_tsv, search_tsv)
  values (
    new.document_type, new.entity_id, new.asset_id, new.style_group_id, new.title, new.path,
    new.customer, new.program,
    btrim(lower(regexp_replace(regexp_replace(btrim(coalesce(new.title,'')), '\.[[:alnum:]]{1,5}$', ''), '[-_/[:space:]]+', ' ', 'g'))),
    to_tsvector('simple', regexp_replace(coalesce(new.title,''), '[-_/]+', ' ', 'g')),
    coalesce(new.search_tsv, ''::tsvector))
  on conflict (document_type, entity_id) do update set
    asset_id = excluded.asset_id, style_group_id = excluded.style_group_id,
    title = excluded.title, path = excluded.path, customer = excluded.customer,
    program = excluded.program, title_key = excluded.title_key,
    title_tsv = excluded.title_tsv, search_tsv = excluded.search_tsv
  where (k.asset_id, k.style_group_id, k.title, k.path, k.customer, k.program)
          is distinct from
        (excluded.asset_id, excluded.style_group_id, excluded.title, excluded.path, excluded.customer, excluded.program)
     or k.search_tsv is distinct from excluded.search_tsv;
  return null;
end;
$fn$;

revoke all on function public.sync_dam_search_keys() from public, anon, authenticated;

drop trigger if exists dam_search_documents_sync_keys on public.dam_search_documents;
create trigger dam_search_documents_sync_keys
after insert or delete or update of document_type, entity_id, asset_id, style_group_id, title, path, customer, program, search_text
on public.dam_search_documents
for each row execute function public.sync_dam_search_keys();

-- Backfill (same transaction as the trigger, so no write is missed), in path
-- order so one folder's documents share heap pages.
truncate public.dam_search_keys;
insert into public.dam_search_keys (
  document_type, entity_id, asset_id, style_group_id, title, path, customer, program,
  title_key, title_tsv, search_tsv)
select d.document_type, d.entity_id, d.asset_id, d.style_group_id, d.title, d.path, d.customer, d.program,
  btrim(lower(regexp_replace(regexp_replace(btrim(coalesce(d.title,'')), '\.[[:alnum:]]{1,5}$', ''), '[-_/[:space:]]+', ' ', 'g'))),
  to_tsvector('simple', regexp_replace(coalesce(d.title,''), '[-_/]+', ' ', 'g')),
  coalesce(d.search_tsv, ''::tsvector)
from public.dam_search_documents d
order by d.path, d.document_type, d.entity_id;

create index if not exists dam_search_keys_tsv_idx on public.dam_search_keys using gin (search_tsv);
create index if not exists dam_search_keys_title_trgm_idx on public.dam_search_keys using gin (title extensions.gin_trgm_ops);
create index if not exists dam_search_keys_path_trgm_idx on public.dam_search_keys using gin (path extensions.gin_trgm_ops);
create index if not exists dam_search_keys_customer_trgm_idx on public.dam_search_keys using gin (customer extensions.gin_trgm_ops);
create index if not exists dam_search_keys_program_trgm_idx on public.dam_search_keys using gin (program extensions.gin_trgm_ops);
analyze public.dam_search_keys;

create or replace function public.search_dam_documents(
  p_query text, p_filters jsonb, p_limit int, p_offset int,
  p_document_types text[] default null,
  p_query_embedding extensions.vector(384) default null,
  p_min_rank real default 0,
  p_min_semantic_score real default null
)
returns table(document_type text, entity_id uuid, asset_id uuid, style_group_id uuid,
  keyword_rank real, semantic_rank real, rank real, total_count bigint, has_more boolean, facets jsonb)
language sql stable security definer
set search_path = public, extensions
set statement_timeout = '8s'
as $$
  with params as materialized (
    select nullif(trim(p_query),'') query_text,
      greatest(1,least(coalesce(p_limit,100),20000)) page_limit,
      greatest(coalesce(p_offset,0),0) page_offset,
      greatest(coalesce(p_min_rank,0),0)::real min_rank,
      case when p_min_semantic_score is null then null
        else greatest(0,least(1,p_min_semantic_score))::real end min_semantic_score,
      case when p_query_embedding is null then false else true end has_embedding,
      -- summary probe bound (assets, rank order); see header "Totals contract"
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
      -- the query as an escaped regex literal: ~* literal == ILIKE '%literal%'
      regexp_replace(q.query_text, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') regex_literal
    from queries q
  ), substring_regex as materialized (
    -- ONE alternation for every substring-eligible query: one trigram bitmap
    -- per column and one regex evaluation per recheck row, instead of one
    -- heap pass and one ILIKE per query and column (2.5s -> 1.0s warm for
    -- wall-art-canvas's 4 synonym patterns, production 2026-10-21).
    select '(' || string_agg(distinct q.regex_literal, '|') || ')' rx
    from distinct_queries q where q.allow_substring
  ), rank_queries as materialized (
    -- Ranking needs one row per normalized query: hyphen and space variants
    -- of the same words share a tsquery and a title key.
    select q.normalized_query, q.tsq,
      coalesce(array_agg(distinct q.like_pattern) filter (where q.allow_substring), '{}'::text[]) like_patterns
    from distinct_queries q
    group by q.normalized_query, q.tsq
  ), full_text_matches as materialized (
    -- Served by the narrow key table (dam_search_keys, kept in step with
    -- dam_search_documents by trigger): its GIN index answers the tsquery
    -- and the heap fetch reads ~0.4 KB rows instead of the ~2.2 KB wide rows
    -- (embedding inline) that made cold calls read ~260 MB. title_key and
    -- title_tsv are precomputed, so ranking does no per-row regex/tsvector
    -- work. search_tsv is stored out of line and never projected.
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,d.title,d.title_key,d.title_tsv
    from public.dam_search_keys d
    where (p_document_types is null or d.document_type = any(p_document_types))
      and d.search_tsv @@ any(array(select q.tsq from queries q))
  ), substring_matches as materialized (
    -- Rows whose title/path/customer/program contains a query. One row per
    -- document (a single scan, so no duplicates per query).
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,d.title,d.path,d.customer,d.program,d.title_key,d.title_tsv
    from substring_regex r
    join public.dam_search_keys d on r.rx is not null and
      (d.title ~* r.rx or d.path ~* r.rx or d.customer ~* r.rx or d.program ~* r.rx)
    where (p_document_types is null or d.document_type = any(p_document_types))
  ), keyword_features as materialized (
    -- The COMPLETE keyword match set (FTS + substring), never truncated, one
    -- row per document, with its per-row ranking inputs computed ONCE (not
    -- once per rank query). in_substring marks rows whose
    -- title/path/customer/program contains a query; only those carry the
    -- long columns and only they pay ILIKE.
    select m.document_type,m.entity_id,m.asset_id,m.style_group_id,m.in_substring,
      m.title,m.path,m.customer,m.program,
      -- precomputed in dam_search_keys (see sync_dam_search_keys)
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
    -- Relevance for EVERY keyword match, before any page slice or bound:
    --   1.00 title equals the query (exact identifier; case/separator-insensitive)
    --   0.60 title contains the query
    --   0.45 title matches the full-text query
    --   0.30 path contains the query
    --   0.20 customer/program contains the query
    --   0.10 match only in the wider indexed text
    -- plus up to 0.09 for title tightness (query length / title length).
    -- Computed from short display columns only (never search_tsv). The best
    -- tier over the rank queries is a per-row scalar subquery: keyword_features
    -- is already one row per document, so no hash aggregate (which spilled to
    -- disk for 50k rows) is needed.
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
  ), semantic_candidates as materialized (
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,
      greatest(0,1-(d.embedding <=> p_query_embedding))::real semantic_rank
    from params p
    join public.dam_search_documents d
      on p.has_embedding
      and d.embedding is not null
      and d.embedding_model = 'gte-small'
      and extensions.vector_dims(d.embedding) = 384
    where (p_document_types is null or d.document_type = any(p_document_types))
      and (p.min_semantic_score is null
        or greatest(0,1-(d.embedding <=> p_query_embedding)) >= p.min_semantic_score)
    order by d.embedding <=> p_query_embedding, d.entity_id
    limit 50000
  ), candidate_ranks as materialized (
    select c.document_type,c.entity_id,c.asset_id,c.style_group_id,max(c.keyword_rank)::real keyword_rank,
      max(c.semantic_rank)::real semantic_rank,
      (coalesce(max(c.keyword_rank),0) + coalesce(max(c.semantic_rank),0) * 0.35)::real rank
    from (select k.*,null::real semantic_rank from keyword_candidates k union all
      select s.document_type,s.entity_id,s.asset_id,s.style_group_id,null::real,s.semantic_rank from semantic_candidates s) c
    group by c.document_type,c.entity_id,c.asset_id,c.style_group_id
    having coalesce(max(c.keyword_rank),0) + coalesce(max(c.semantic_rank),0) * 0.35 >= (select min_rank from params)
  ), ordered_candidates as materialized (
    -- Every candidate ranked BEFORE any visibility probe or bound.
    select c.document_type,c.entity_id,c.asset_id,c.style_group_id,c.keyword_rank,c.semantic_rank,c.rank,
      row_number() over (order by c.rank desc, c.document_type, c.entity_id) rn
    from candidate_ranks c
  ), candidate_asset_ids as not materialized (
    -- Expanded LAZILY in rank order inside each probe below: a Style Group's
    -- member assets are read only when the probe reaches that document.
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
    -- Summary probe: visible assets in rank order, stopping after
    -- summary_probe_limit rows (an ordered nested-loop probe, never a full
    -- visibility pass over a 20k-50k key set: the assets heap is ~2 GB and
    -- each cold probe is a random read).
    select c.document_type,c.entity_id,c.asset_id,c.style_group_id,c.keyword_rank,c.semantic_rank,c.rank,
      a.id, a.style_group_id asset_style_group_id, a.file_type, a.status,
      a.workflow_status, a.stage, a.is_licensed, c.rn
    from candidate_asset_ids c
    join public.assets a on a.id = c.id
    left join public.style_groups sg on sg.id=a.style_group_id
    cross join visibility_params v
    where not a.is_deleted
      and (a.modified_at >= v.thumbnail_min_date or a.file_created_at >= v.thumbnail_min_date or a.thumbnail_url is not null)
      and (nullif(v.f->>'licensorId','') is null or case when a.style_group_id is null then a.licensor_id else sg.licensor_id end=(v.f->>'licensorId')::uuid)
      and (nullif(v.f->>'propertyId','') is null or case when a.style_group_id is null then a.property_id else sg.property_id end=(v.f->>'propertyId')::uuid)
      and (nullif(v.f->>'customerId','') is null or case when a.style_group_id is null then a.customer_id else sg.customer_id end=(v.f->>'customerId')::uuid)
      and (nullif(v.f->>'tagFilter','') is null or exists(select 1 from public.asset_effective_tags e where e.asset_id=a.id and e.tag=v.f->>'tagFilter'))
      and (jsonb_array_length(coalesce(v.f->'fileType','[]'))=0 or a.file_type::text in(select jsonb_array_elements_text(v.f->'fileType')))
      and (jsonb_array_length(coalesce(v.f->'contentType','[]'))=0 or a.content_type in(select jsonb_array_elements_text(v.f->'contentType')))
      and (jsonb_array_length(coalesce(v.f->'productMaterial','[]'))=0 or a.product_material && array(select jsonb_array_elements_text(v.f->'productMaterial')))
      and (jsonb_array_length(coalesce(v.f->'status','[]'))=0 or a.status::text in(select jsonb_array_elements_text(v.f->'status')))
      and (jsonb_array_length(coalesce(v.f->'workflowStatus','[]'))=0 or a.workflow_status::text in(select jsonb_array_elements_text(v.f->'workflowStatus')))
      and (jsonb_array_length(coalesce(v.f->'stage','[]'))=0 or a.stage in(select jsonb_array_elements_text(v.f->'stage')))
      and ((v.f->>'isLicensed') is null or a.is_licensed=(v.f->>'isLicensed')::boolean)
      and (jsonb_array_length(coalesce(v.f->'assetType','[]'))=0 or a.asset_type::text in(select jsonb_array_elements_text(v.f->'assetType')))
      and (jsonb_array_length(coalesce(v.f->'artSource','[]'))=0 or a.art_source::text in(select jsonb_array_elements_text(v.f->'artSource')))
      and (jsonb_array_length(coalesce(v.f->'fileStatus','[]'))=0 or exists(select 1 from jsonb_array_elements_text(v.f->'fileStatus') fs where
        (fs='has_preview' and a.thumbnail_url is not null) or
        (fs='no_preview_renderable' and a.thumbnail_url is null and a.thumbnail_error is null) or
        (fs='no_pdf_compat' and a.thumbnail_url is null and a.thumbnail_error='no_pdf_compat') or
        (fs='no_preview_unsupported' and a.thumbnail_url is null and a.thumbnail_error='no_preview_or_render_failed')))
      and (jsonb_array_length(coalesce(v.f->'productCategory','[]'))=0 or a.product_category in(select jsonb_array_elements_text(v.f->'productCategory')) or
        ('Wall' in(select jsonb_array_elements_text(v.f->'productCategory')) and (a.relative_path ilike '%WALL ART%' or a.relative_path ilike '%3FZ%')))
      and (nullif(v.f->>'customer','') is null or a.customer=v.f->>'customer')
      and (nullif(v.f->>'program','') is null or a.program=v.f->>'program')
    order by c.rn
    limit (select summary_probe_limit + 1 from params)
  ), page_documents as materialized (
    -- Page probe: the first offset+limit+1 VISIBLE documents in rank order.
    -- Independent of the summary bound, so every offset pages correctly and
    -- has_more is exact. A document is visible when ANY of its assets is, so
    -- the probe stops at the first visible member of a Style Group instead of
    -- reading every member (deep offsets read ~1 asset per document).
    select c.document_type,c.entity_id,c.asset_id,c.style_group_id,
      c.keyword_rank,c.semantic_rank,c.rank,c.rn
    -- Read in rank order so the probe runs only until the Limit is filled.
    from (select * from ordered_candidates order by rn) c
    -- A correlated scalar probe (LIMIT 1), not EXISTS: EXISTS is pulled up
    -- into a semi-join that checks every candidate before the Limit applies.
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
      where not a.is_deleted
          and (a.modified_at >= v.thumbnail_min_date or a.file_created_at >= v.thumbnail_min_date or a.thumbnail_url is not null)
          and (nullif(v.f->>'licensorId','') is null or case when a.style_group_id is null then a.licensor_id else sg.licensor_id end=(v.f->>'licensorId')::uuid)
          and (nullif(v.f->>'propertyId','') is null or case when a.style_group_id is null then a.property_id else sg.property_id end=(v.f->>'propertyId')::uuid)
          and (nullif(v.f->>'customerId','') is null or case when a.style_group_id is null then a.customer_id else sg.customer_id end=(v.f->>'customerId')::uuid)
          and (nullif(v.f->>'tagFilter','') is null or exists(select 1 from public.asset_effective_tags e where e.asset_id=a.id and e.tag=v.f->>'tagFilter'))
          and (jsonb_array_length(coalesce(v.f->'fileType','[]'))=0 or a.file_type::text in(select jsonb_array_elements_text(v.f->'fileType')))
          and (jsonb_array_length(coalesce(v.f->'contentType','[]'))=0 or a.content_type in(select jsonb_array_elements_text(v.f->'contentType')))
          and (jsonb_array_length(coalesce(v.f->'productMaterial','[]'))=0 or a.product_material && array(select jsonb_array_elements_text(v.f->'productMaterial')))
          and (jsonb_array_length(coalesce(v.f->'status','[]'))=0 or a.status::text in(select jsonb_array_elements_text(v.f->'status')))
          and (jsonb_array_length(coalesce(v.f->'workflowStatus','[]'))=0 or a.workflow_status::text in(select jsonb_array_elements_text(v.f->'workflowStatus')))
          and (jsonb_array_length(coalesce(v.f->'stage','[]'))=0 or a.stage in(select jsonb_array_elements_text(v.f->'stage')))
          and ((v.f->>'isLicensed') is null or a.is_licensed=(v.f->>'isLicensed')::boolean)
          and (jsonb_array_length(coalesce(v.f->'assetType','[]'))=0 or a.asset_type::text in(select jsonb_array_elements_text(v.f->'assetType')))
          and (jsonb_array_length(coalesce(v.f->'artSource','[]'))=0 or a.art_source::text in(select jsonb_array_elements_text(v.f->'artSource')))
          and (jsonb_array_length(coalesce(v.f->'fileStatus','[]'))=0 or exists(select 1 from jsonb_array_elements_text(v.f->'fileStatus') fs where
            (fs='has_preview' and a.thumbnail_url is not null) or
            (fs='no_preview_renderable' and a.thumbnail_url is null and a.thumbnail_error is null) or
            (fs='no_pdf_compat' and a.thumbnail_url is null and a.thumbnail_error='no_pdf_compat') or
            (fs='no_preview_unsupported' and a.thumbnail_url is null and a.thumbnail_error='no_preview_or_render_failed')))
          and (jsonb_array_length(coalesce(v.f->'productCategory','[]'))=0 or a.product_category in(select jsonb_array_elements_text(v.f->'productCategory')) or
            ('Wall' in(select jsonb_array_elements_text(v.f->'productCategory')) and (a.relative_path ilike '%WALL ART%' or a.relative_path ilike '%3FZ%')))
          and (nullif(v.f->>'customer','') is null or a.customer=v.f->>'customer')
          and (nullif(v.f->>'program','') is null or a.program=v.f->>'program')
      limit 1
    ), false)
    order by c.rn
    limit (select page_offset + page_limit + 1 from params)
  ), probe_state as materialized (
    select count(*) > (select summary_probe_limit from params) truncated
    from visible_assets
  ), summary_assets as materialized (
    -- When truncated, drop the boundary document (it may be partially probed).
    select a.document_type,a.entity_id,a.asset_id,a.style_group_id,a.keyword_rank,a.semantic_rank,a.rank,
      a.id,a.asset_style_group_id,a.file_type,a.status,a.workflow_status,a.stage,a.is_licensed,a.rn
    from visible_assets a
    where not (select truncated from probe_state)
       or a.rn < (select max(x.rn) from visible_assets x)
  ), ranked_documents as materialized (
    select distinct a.document_type, a.entity_id, a.asset_id, a.style_group_id,
      a.keyword_rank, a.semantic_rank, a.rank
    from summary_assets a
  ), matched_assets as materialized (
    select distinct a.id,a.asset_style_group_id style_group_id,a.file_type,a.status,a.workflow_status,a.stage,a.is_licensed from summary_assets a
  ), page_state as materialized (
    select count(*) visible_through_page from page_documents
  ), summary as materialized (
    select
      case when (select truncated from probe_state)
        then greatest(count(*), (select visible_through_page from page_state))
        else count(*) end total_count,
      jsonb_build_object(
      'fileType',coalesce((select jsonb_object_agg(k,c) from (select file_type::text k,count(*) c from matched_assets group by 1)x),'{}'::jsonb),
      'status',coalesce((select jsonb_object_agg(k,c) from (select status::text k,count(*) c from matched_assets group by 1)x),'{}'::jsonb),
      'workflowStatus',coalesce((select jsonb_object_agg(k,c) from (select workflow_status::text k,count(*) c from matched_assets where workflow_status is not null group by 1)x),'{}'::jsonb),
      'stage',coalesce((select jsonb_object_agg(k,c) from (select stage k,count(*) c from matched_assets where stage is not null group by 1)x),'{}'::jsonb),
      'isLicensed',jsonb_build_object('true',(select count(*) from matched_assets where is_licensed is true),'false',(select count(*) from matched_assets where is_licensed is not true)),
      'totalExact',not (select truncated from probe_state),
      'totalKind',case when (select truncated from probe_state) then 'lower_bound' else 'exact' end
    ) facets from ranked_documents
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
$$;

revoke all on function public.search_dam_documents(text,jsonb,int,int,text[],extensions.vector(384),real,real) from public, anon;
grant execute on function public.search_dam_documents(text,jsonb,int,int,text[],extensions.vector(384),real,real) to authenticated, service_role;

comment on function public.search_dam_documents(text,jsonb,int,int,text[],extensions.vector(384),real,real) is 'DAM-entitled ranked search (keyword legs served by dam_search_keys). Every keyword (FTS + substring) and semantic candidate is ranked before any bound; exact title matches rank 1.0. The page is the first offset+limit visible documents in rank order (rank-ordered probe) and has_more is exact. total_count/facets are exact when facets.totalExact is true; otherwise they cover a rank-ordered probe of 1000 assets and total_count is a lower bound (facets.totalKind = lower_bound). Summary envelope always returned (null-entity row on empty/out-of-range). Semantic leg model/dims-checked, floor before blend.';

