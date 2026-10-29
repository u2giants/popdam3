-- #4999: cheap "best picture score" for one query embedding.
-- derived-from: none
-- New object; no earlier migration defines it. Its two legs copy the semantic_ann /
-- semantic_exact legs of public.search_dam_documents as of 20261027114004.
-- dam-search-ai passes p_min_semantic_score = best_score - 0.045 to
-- search_dam_documents so only near-best picture matches survive. Getting the best
-- score through search_dam_documents itself costs ~2.4 s; this reads one row.
-- Index paths:
--   * any requested type other than style_group: HNSW order-by-distance, limit 1
--     (idx_dam_search_documents_embedding_hnsw);
--   * style_group only: exact distance sort with the literal document_type and
--     "+ 0" so the planner stays off the HNSW index (a filtered HNSW walk over the
--     asset-dominated index is far slower for style groups).
-- Returns NULL when p_query_embedding is NULL or no row has a SigLIP2 embedding;
-- callers must treat NULL as "no anchor" (do not apply a floor).
-- Access: public.require_dam_access() unconditionally, like search_dam_documents;
-- not executable by PUBLIC/anon.

do $guard$
begin
  if to_regprocedure('public.require_dam_access()') is null then
    raise exception '#4999: public.require_dam_access() is missing';
  end if;
  if not exists (
    select 1 from pg_attribute a
    where a.attrelid = 'public.dam_search_documents'::regclass
      and a.attname = 'embedding' and not a.attisdropped
      and a.atttypid = 'extensions.vector'::regtype and a.atttypmod = 768
  ) then
    raise exception '#4999: public.dam_search_documents.embedding is not extensions.vector(768)';
  end if;
  if not exists (
    select 1 from pg_indexes i
    where i.schemaname = 'public' and i.tablename = 'dam_search_documents'
      and i.indexdef ilike '%using hnsw%vector_cosine_ops%'
  ) then
    raise exception '#4999: HNSW cosine index on public.dam_search_documents.embedding is missing';
  end if;
end
$guard$;

create or replace function public.dam_search_semantic_anchor(
  p_query_embedding extensions.vector,
  p_document_types text[] default null
)
returns real
language sql
stable
security definer
set search_path = public, extensions
set statement_timeout = '5s'
as $$
  select set_config('hnsw.ef_search', '100', true);
  select set_config('hnsw.iterative_scan', 'relaxed_order', true);
  select set_config('hnsw.max_scan_tuples', '20000', true);
  with params as materialized (
    select (p_query_embedding is not null) has_embedding
    where public.require_dam_access()
  ), semantic_ann as materialized (
    select greatest(0, 1 - (d.embedding <=> p_query_embedding))::real score
    from params p
    join public.dam_search_documents d
      on p.has_embedding
      and d.embedding is not null
      and d.embedding_model = 'google/siglip2-base-patch16-naflex'
    where (p_document_types is null
        or exists (select 1 from unnest(p_document_types) t where t is distinct from 'style_group'))
      and (p_document_types is null or d.document_type = any(p_document_types))
    order by d.embedding <=> p_query_embedding
    limit 1
  ), semantic_exact as materialized (
    select greatest(0, 1 - (d.embedding <=> p_query_embedding))::real score
    from params p
    join public.dam_search_documents d
      on p.has_embedding
      and d.embedding is not null
      and d.embedding_model = 'google/siglip2-base-patch16-naflex'
    where p_document_types is not null and not ('asset' = any(p_document_types))
      and 'style_group' = any(p_document_types)
      and d.document_type = 'style_group'  -- literal: a parameter here makes the planner seq-scan
    order by (d.embedding <=> p_query_embedding) + 0
    limit 1
  )
  select max(s.score)::real
  from (select score from semantic_ann union all select score from semantic_exact) s;
$$;

revoke all on function public.dam_search_semantic_anchor(extensions.vector, text[]) from public, anon;
grant execute on function public.dam_search_semantic_anchor(extensions.vector, text[]) to authenticated, service_role;

comment on function public.dam_search_semantic_anchor(extensions.vector, text[]) is
  'Best SigLIP2 cosine score (0..1) for a query embedding over dam_search_documents; NULL when no embedding or no rows. DAM access required (#4999).';
