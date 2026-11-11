-- popcre/shared-db#6024 (u2giants/popdam3#897): picture-score anchor that honors the same
-- licensor scope as search_dam_documents p_filters.semanticLicensorIds.
-- derived-from: none
-- New object; dam_search_semantic_anchor(s) and search_dam_documents are unchanged.
-- Why: dam-search-ai keeps picture matches within 0.035 of the anchor. With an unscoped anchor,
-- another licensor's better picture raises the floor and every picture-only match of the
-- licensor the search names is dropped (measured live 2026-11-10: 4 of 60 licensor queries).
-- Scope (identical to search_dam_documents): a grouped document takes its style group's
-- licensor, an ungrouped asset its own.
-- Behaviour:
--   * p_licensor_ids NULL or empty: returns exactly public.dam_search_semantic_anchor(...).
--   * otherwise: the best in-scope picture score. The ANN leg walks at most 2000 HNSW tuples,
--     the same depth as search_dam_documents' 2000-row picture leg, so a licensor picture the
--     search could return is found and the cost stays near the unscoped anchor's. The
--     style-group-only leg is an exact sort over dam.search_group_vectors, like the search.
--   * no in-scope picture in reach: falls back to the unscoped anchor (today's floor), since
--     the search then has no in-scope picture-only match for the floor to keep.
-- Access: public.require_dam_access() first, like the other anchors; not executable by anon.
begin;
set local lock_timeout = '500ms';
set local statement_timeout = '2500ms';
set local transaction_timeout = '3s';

do $guard$
begin
  if to_regprocedure('public.dam_search_semantic_anchor_scoped(extensions.vector,text[],uuid[])') is not null then
    raise exception '#6024 target already exists; reconcile rather than overwrite';
  end if;
  if to_regprocedure('public.dam_search_semantic_anchor(extensions.vector,text[])') is null then
    raise exception '#6024 public.dam_search_semantic_anchor(vector,text[]) is missing';
  end if;
  if to_regclass('dam.search_group_vectors') is null then
    raise exception '#6024 dam.search_group_vectors is missing';
  end if;
end;
$guard$;

create function public.dam_search_semantic_anchor_scoped(
  p_query_embedding extensions.vector,
  p_document_types text[] default null,
  p_licensor_ids uuid[] default null
)
returns real
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions
set statement_timeout = '5s'
as $function$
declare
  v_ids uuid[];
  v_score real;
begin
  if not coalesce(public.require_dam_access(), false) then
    return null;
  end if;
  v_ids := array(select distinct x from unnest(p_licensor_ids) x where x is not null);
  if p_query_embedding is null or cardinality(v_ids) = 0 then
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
    join public.style_groups g on g.id = d.style_group_id
    where d.embedding is not null
      and d.embedding_model = 'google/siglip2-base-patch16-naflex'
      and d.document_type = 'style_group'
      and g.licensor_id = any(v_ids)
    having count(*) > 0;
  elsif p_document_types is null
     or exists (select 1 from unnest(p_document_types) t where t is distinct from 'style_group') then
    select greatest(0, 1 - (d.embedding operator(extensions.<=>) p_query_embedding))::real
    into v_score
    from public.dam_search_documents d
    where d.embedding is not null
      and d.embedding_model = 'google/siglip2-base-patch16-naflex'
      and (p_document_types is null or d.document_type = any(p_document_types))
      and case when d.style_group_id is not null
            then exists (select 1 from public.style_groups g
                         where g.id = d.style_group_id and g.licensor_id = any(v_ids))
            else exists (select 1 from public.assets a
                         where a.id = d.asset_id and a.licensor_id = any(v_ids)) end
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

revoke all on function public.dam_search_semantic_anchor_scoped(extensions.vector,text[],uuid[]) from public, anon;
grant execute on function public.dam_search_semantic_anchor_scoped(extensions.vector,text[],uuid[]) to authenticated, service_role;
comment on function public.dam_search_semantic_anchor_scoped(extensions.vector,text[],uuid[]) is
  '#6024: best picture score within the licensor scope of search_dam_documents p_filters.semanticLicensorIds (grouped document -> style group licensor, ungrouped asset -> own). NULL/empty ids = dam_search_semantic_anchor exactly; no in-scope picture = unscoped anchor.';
commit;
