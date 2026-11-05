-- #5703: at most two independent anchors, one exact dense-vector pass.
begin;
set local lock_timeout = '500ms';
set local statement_timeout = '2500ms';
set local transaction_timeout = '3s';

do $guard$
begin
  if to_regprocedure('public.dam_search_semantic_anchors(extensions.vector,extensions.vector,text[])') is not null then
    raise exception '#5703 target already exists; reconcile rather than overwrite';
  end if;
  if (select md5(prosrc) from pg_proc where oid='public.dam_search_semantic_anchor(extensions.vector,text[])'::regprocedure)
       is distinct from 'dd26e420c8dbd998696b4db95d5d7091' then
    raise exception '#5703 original anchor changed; rebase and prove equivalence first';
  end if;
end;
$guard$;

create function public.dam_search_semantic_anchors(
  p_first_embedding extensions.vector,
  p_second_embedding extensions.vector default null,
  p_document_types text[] default null
)
returns table(query_index integer, score real)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions
set statement_timeout = '5s'
as $function$
declare
  v_authorized boolean;
begin
  -- Evaluate the same access helper exactly once, before input/data work.
  -- A false/NULL result still prevents both data legs; it is never ignored.
  v_authorized := public.require_dam_access();
  if p_first_embedding is null
     or extensions.vector_dims(p_first_embedding) <> 768
     or (p_second_embedding is not null and extensions.vector_dims(p_second_embedding) <> 768) then
    raise exception using errcode='22023', message='Expected one or two 768-dimensional query vectors';
  end if;

  perform pg_catalog.set_config('hnsw.ef_search','100',true);
  perform pg_catalog.set_config('hnsw.iterative_scan','relaxed_order',true);
  perform pg_catalog.set_config('hnsw.max_scan_tuples','20000',true);

  return query
  with params as materialized (
    select p_first_embedding first_embedding, p_second_embedding second_embedding
    where v_authorized
  ), inputs as materialized (
    select q.n, q.embedding
    from (values (1,p_first_embedding),(2,p_second_embedding)) q(n,embedding)
    where q.n=1 or p_second_embedding is not null
  ), semantic_ann as materialized (
    select q.n, a.score
    from params p cross join inputs q
    cross join lateral (
      select greatest(0,1-(d.embedding operator(extensions.<=>) q.embedding))::real score
      from public.dam_search_documents d
      where d.embedding is not null
        and d.embedding_model='google/siglip2-base-patch16-naflex'
        and (p_document_types is null or d.document_type=any(p_document_types))
      order by d.embedding operator(extensions.<=>) q.embedding
      limit 1
    ) a
    where p_document_types is null
       or exists (select 1 from unnest(p_document_types) t where t is distinct from 'style_group')
  ), semantic_exact as materialized (
    -- MIN(distance) matches the old ascending ORDER BY, including NaN ordering.
    -- MAX(score) would let one zero-vector NaN dominate otherwise valid scores.
    select case when count(*)=0 then null
                else greatest(0,1-min(d.embedding operator(extensions.<=>) p.first_embedding))::real end first_score,
           case when count(*)=0 then null
                else greatest(0,1-min(d.embedding operator(extensions.<=>) p.second_embedding))::real end second_score
    from params p join dam.search_group_vectors d
      on d.embedding is not null
      and d.embedding_model='google/siglip2-base-patch16-naflex'
    where p_document_types is not null and not ('asset'=any(p_document_types))
      and 'style_group'=any(p_document_types)
      and d.document_type='style_group'
  ), exact_scores as (
    select q.n, case when q.n=1 then e.first_score else e.second_score end score
    from inputs q cross join semantic_exact e
  ), combined as (
    select a.n,a.score from semantic_ann a
    union all
    select e.n,e.score from exact_scores e
  )
  select q.n,max(s.score)::real
  from inputs q left join combined s on s.n=q.n
  group by q.n
  order by q.n;
end;
$function$;

revoke all on function public.dam_search_semantic_anchors(extensions.vector,extensions.vector,text[]) from public,anon;
grant execute on function public.dam_search_semantic_anchors(extensions.vector,extensions.vector,text[]) to authenticated,service_role;
comment on function public.dam_search_semantic_anchors(extensions.vector,extensions.vector,text[]) is
  '#5703: one or two ordered independent anchors; shared exact dense pass, unchanged ANN/scope/access semantics and five-second budget. Existing single-anchor RPC is unchanged. Caller must fail required search on errors, missing/NULL/non-numeric scores; never silently fall back.';
commit;
