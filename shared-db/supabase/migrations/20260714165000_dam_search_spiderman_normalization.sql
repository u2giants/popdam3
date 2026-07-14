-- Make DAM library search tolerant of the common "spiderman" spelling while
-- most licensed art metadata is tokenized as "Spider-Man" / "Spider Man".

create or replace function public.search_dam_documents(
  p_query text,
  p_limit int default 500,
  p_document_types text[] default null,
  p_query_embedding extensions.vector(384) default null
)
returns table(
  document_type text,
  entity_id uuid,
  asset_id uuid,
  style_group_id uuid,
  keyword_rank real,
  semantic_rank real,
  rank real
)
language sql
stable
security definer
set search_path = public, extensions
set statement_timeout = '8s'
as $$
  with normalized as (
    select nullif(trim(p_query), '') as query_text,
           greatest(1, least(coalesce(p_limit, 500), 20000)) as result_limit,
           p_query_embedding as query_embedding
  ),
  query_variants as (
    select query_text, result_limit, query_embedding
    from normalized
    where query_text is not null

    union

    select
      regexp_replace(query_text, '(^|[^[:alnum:]])spiderman([^[:alnum:]]|$)', '\1spider man\2', 'gi') as query_text,
      result_limit,
      query_embedding
    from normalized
    where query_text is not null
      and query_text ~* '(^|[^[:alnum:]])spiderman([^[:alnum:]]|$)'
  ),
  q as (
    select websearch_to_tsquery('simple', query_text) as tsq,
           '%' || query_text || '%' as like_pattern,
           result_limit,
           query_embedding
    from query_variants
  ),
  keyword_matches as (
    select
      d.document_type,
      d.entity_id,
      d.asset_id,
      d.style_group_id,
      greatest(
        ts_rank_cd(d.search_tsv, q.tsq),
        case
          when d.title ilike q.like_pattern then 0.04
          when d.path ilike q.like_pattern then 0.03
          when d.customer ilike q.like_pattern or d.program ilike q.like_pattern then 0.02
          else 0.01
        end
      )::real as keyword_rank,
      null::real as semantic_rank
    from public.dam_search_documents d
    cross join q
    where (p_document_types is null or d.document_type = any(p_document_types))
      and (
        d.search_tsv @@ q.tsq
        or d.title ilike q.like_pattern
        or d.path ilike q.like_pattern
        or d.customer ilike q.like_pattern
        or d.program ilike q.like_pattern
      )
  ),
  semantic_matches as (
    select
      d.document_type,
      d.entity_id,
      d.asset_id,
      d.style_group_id,
      null::real as keyword_rank,
      greatest(0, 1 - (d.embedding <=> q.query_embedding))::real as semantic_rank
    from public.dam_search_documents d
    cross join q
    where q.query_embedding is not null
      and d.embedding is not null
      and (p_document_types is null or d.document_type = any(p_document_types))
    order by d.embedding <=> q.query_embedding
    limit (select result_limit from normalized)
  ),
  combined as (
    select * from keyword_matches
    union all
    select * from semantic_matches
  )
  select
    combined.document_type,
    combined.entity_id,
    combined.asset_id,
    combined.style_group_id,
    max(combined.keyword_rank)::real as keyword_rank,
    max(combined.semantic_rank)::real as semantic_rank,
    (
      coalesce(max(combined.keyword_rank), 0) +
      coalesce(max(combined.semantic_rank), 0) * 0.35
    )::real as rank
  from combined
  group by combined.document_type, combined.entity_id, combined.asset_id, combined.style_group_id
  order by (
    coalesce(max(combined.keyword_rank), 0) +
    coalesce(max(combined.semantic_rank), 0) * 0.35
  ) desc, combined.document_type, combined.entity_id
  limit (select result_limit from normalized);
$$;

grant execute on function public.search_dam_documents(text, int, text[], extensions.vector(384)) to authenticated, service_role;
