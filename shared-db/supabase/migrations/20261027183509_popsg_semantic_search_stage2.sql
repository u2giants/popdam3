-- Version: 20261027183509
-- derived-from: 20261022155012, 20261025121119, 20261027012301
-- Issue: popcre/shared-db#4437 (app u2giants/popdam3#107), claim #4820 stage 2.
-- Semantic-plus-keyword search: thread p_query_embedding (SigLIP2/768, the one
-- embedding mechanism per #4664) and a semantic score floor into
-- search_style_guide_library_v2 as trailing default-null parameters.
--
-- Contract preserved from the keyword function:
--   * authorization at function entry, every facet/date/tag filter applied to
--     keyword AND semantic children alike, before counting or paging;
--   * p_query_embedding null (the app until wired, or an embedding outage)
--     reproduces the exact keyword behavior: the semantic_candidates CTE is
--     empty, the blended rank degenerates to the bare keyword rank, and the
--     empty snapshot fast path is unchanged;
--   * totals, facets, sorting, tie-breaks and pagination shape untouched;
--   * the floor applies only to semantic candidates (DAM precedent
--     20260925222432): a keyword hit below the floor survives with its
--     keyword rank; a semantic-only document below the floor is excluded.
--
-- Signature change: two trailing defaults are added and the 15-argument
-- overload is dropped first, because PostgREST cannot disambiguate overloads
-- that differ only in optional parameters. Grants are re-issued after the
-- drop. statement_timeout = 30s (20261025121119) is pinned into the
-- definition so the setting survives the replacement.
--
-- The ANN leg mirrors the reviewed DAM implementation (20261025163006):
-- ORDER BY distance only (HNSW returns distance order), limit 2000,
-- hnsw.ef_search = 100, model-stamped vectors only, PopSG corpus separated by
-- table.

set statement_timeout = '15min';

do $baseline$
begin
  -- Live body must be the reviewed 20261022155012 function (md5 below), with
  -- either proconfig shape: the original, or after the 20261025121119
  -- statement_timeout ALTER (preview and production may differ; standing
  -- fact 11). The replacement below converges both.
  if not exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.search_style_guide_library_v2(text,text,text[],text[],text[],text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer)')
       and md5(p.prosrc) = '4cdde9e8fed849a203374f7e93139afd'
       and p.prosecdef and p.provolatile = 's' and p.prorettype = 'jsonb'::regtype
       and (select coalesce(array_agg(s.setting order by s.setting), '{}'::text[])
              from unnest(coalesce(p.proconfig, '{}'::text[])) s(setting))
           in (array['search_path=pg_catalog, auth','work_mem=64MB'],
               array['search_path=pg_catalog, auth','statement_timeout=30s','work_mem=64MB'])
  ) or not has_function_privilege('authenticated', 'public.search_style_guide_library_v2(text,text,text[],text[],text[],text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer)', 'execute')
    or has_function_privilege('anon', 'public.search_style_guide_library_v2(text,text,text[],text[],text[],text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer)', 'execute') then
    raise exception 'PopSG search baseline differs; reconcile before applying';
  end if;
end
$baseline$;

drop function if exists public.search_style_guide_library_v2(text,text,text[],text[],text[],text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer);

create or replace function public.search_style_guide_library_v2(
  p_result_mode text default 'files',
  p_query text default null,
  p_licensors text[] default null,
  p_properties text[] default null,
  p_style_guides text[] default null,
  p_extensions text[] default null,
  p_tags text[] default null,
  p_preview_states text[] default null,
  p_render_exception_states text[] default null,
  p_pdf_content_states text[] default null,
  p_modified_after timestamptz default null,
  p_modified_before timestamptz default null,
  p_sort text default 'relevance',
  p_limit integer default 50,
  p_offset integer default 0,
  p_query_embedding extensions.vector(768) default null,
  p_min_semantic_score real default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, auth
set work_mem = '64MB'
set statement_timeout = '30s'
as $function$
declare
  v_mode text := lower(coalesce(nullif(btrim(p_result_mode), ''), 'files'));
  v_sort text;
  v_lim integer;
  v_off integer;
  v_total bigint;
  v_facets jsonb;
  v_ids uuid[];
  v_result jsonb;
begin
  -- HNSW candidate list for the semantic leg (transaction-local; harmless on
  -- the keyword-only path). Mirrors the reviewed DAM leg.
  perform set_config('hnsw.ef_search', '100', true);

  -- SECURITY DEFINER is intentional: authorization is decided here before the
  -- result set is counted or paged, instead of depending on permissive legacy
  -- table policies.
  if coalesce(auth.role(), '') <> 'service_role'
     and (
       auth.uid() is null
       or not public.has_app_access(auth.uid(), 'styleguides'::public.app_name)
     ) then
    raise exception 'PopSG access required' using errcode = '42501';
  end if;

  if v_mode not in ('files', 'guides') then
    raise exception 'p_result_mode must be files or guides' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_preview_states, '{}'::text[])) as u(value)
     where lower(u.value) not in ('available', 'missing')
  ) then
    raise exception 'invalid preview state' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_render_exception_states, '{}'::text[])) as u(value)
     where lower(u.value) not in ('none', 'waiting', 'recoverable_error', 'terminal_exception', 'unclassified')
  ) then
    raise exception 'invalid render exception state' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_pdf_content_states, '{}'::text[])) as u(value)
     where lower(u.value) not in ('available', 'unavailable', 'not_applicable')
  ) then
    raise exception 'invalid PDF content state' using errcode = '22023';
  end if;

  -- Unfiltered default browse (#3009): no query and no filter of any kind.
  -- Totals, facets and Guides rows come from the refreshed snapshot; Files page
  -- rows stay live. Anything else, an absent snapshot, or the session setting
  -- popsg.library_snapshot_bypass = 'on' (used by equivalence tests) runs the
  -- full body below, unchanged.
  if nullif(btrim(coalesce(p_query, '')), '') is null
     and coalesce(cardinality(p_licensors), 0) = 0
     and coalesce(cardinality(p_properties), 0) = 0
     and coalesce(cardinality(p_style_guides), 0) = 0
     and coalesce(cardinality(p_extensions), 0) = 0
     and coalesce(cardinality(p_tags), 0) = 0
     and coalesce(cardinality(p_preview_states), 0) = 0
     and coalesce(cardinality(p_render_exception_states), 0) = 0
     and coalesce(cardinality(p_pdf_content_states), 0) = 0
     and p_modified_after is null
     and p_modified_before is null
     and p_query_embedding is null
     and coalesce(current_setting('popsg.library_snapshot_bypass', true), '') <> 'on' then
    select s.total, s.facets into v_total, v_facets
      from public.style_guide_library_default_summary s
     where s.result_mode = v_mode;
  end if;

  if v_facets is not null then
    v_sort := case
      when lower(coalesce(p_sort, 'relevance')) in ('relevance', 'modified_desc', 'modified_asc', 'name_asc')
        then lower(coalesce(p_sort, 'relevance'))
      else 'relevance'
    end;
    v_lim := greatest(1, least(coalesce(p_limit, 50), 200));
    v_off := greatest(0, coalesce(p_offset, 0));

    if v_mode = 'files' then
      -- With no query every rank is 0, so relevance equals modified_desc. The
      -- uuid tie-break orders exactly like its lowercase canonical text.
      if v_sort in ('relevance', 'modified_desc') then
        select array_agg(x.id order by x.ord) into v_ids from (
          select y.id, row_number() over () as ord from (
            select d.style_guide_file_id as id
              from public.style_guide_search_documents d
             where d.is_active
               and exists (select 1 from public.style_guide_files f
                            where f.id = d.style_guide_file_id and f.is_active)
             order by d.modified_at desc nulls last, d.style_guide_file_id
             limit v_lim offset v_off) y) x;
      elsif v_sort = 'modified_asc' then
        select array_agg(x.id order by x.ord) into v_ids from (
          select y.id, row_number() over () as ord from (
            select d.style_guide_file_id as id
              from public.style_guide_search_documents d
             where d.is_active
               and exists (select 1 from public.style_guide_files f
                            where f.id = d.style_guide_file_id and f.is_active)
             order by d.modified_at asc nulls last, d.style_guide_file_id
             limit v_lim offset v_off) y) x;
      else
        select array_agg(x.id order by x.ord) into v_ids from (
          select y.id, row_number() over () as ord from (
            select d.style_guide_file_id as id
              from public.style_guide_search_documents d
             where d.is_active
               and exists (select 1 from public.style_guide_files f
                            where f.id = d.style_guide_file_id and f.is_active)
             order by lower(d.filename) asc nulls last, d.style_guide_file_id
             limit v_lim offset v_off) y) x;
      end if;

      select coalesce(jsonb_agg(jsonb_build_object(
          'result_mode', 'files',
          'style_guide_file_id', d.style_guide_file_id,
          'root_label', d.root_label,
          'licensor_name', d.licensor_name,
          'property_folder', d.property_folder,
          'style_guide_folder', d.style_guide_folder,
          'style_guide_name', d.style_guide_name,
          'directory_path', d.directory_path,
          'relative_path', d.relative_path,
          'filename', d.filename,
          'file_extension', d.file_extension,
          'tag_names', to_jsonb(d.tag_names),
          'size_bytes', d.size_bytes,
          'modified_at', d.modified_at,
          'thumbnail_url', f.thumbnail_url,
          'preview_state', case when f.thumbnail_url is not null then 'available' else 'missing' end,
          'render_exception_state', case
             when f.thumbnail_url is not null then 'none'
             when coalesce(r.has_open_work, false) then 'waiting'
             when coalesce(r.has_recoverable_error, false) then 'recoverable_error'
             when f.thumbnail_error is not null or coalesce(r.has_terminal_error, false) then 'terminal_exception'
             else 'unclassified'
           end,
          'pdf_content_state', case
             when lower(coalesce(d.file_extension, '')) <> 'pdf' then 'not_applicable'
             when d.pdf_text_status = 'extracted' and d.pdf_text_length > 0 then 'available'
             else 'unavailable'
           end,
          'pdf_text_status', d.pdf_text_status,
          'pdf_text_length', d.pdf_text_length,
          'rank', 0::real
        ) order by ids.ord), '[]'::jsonb)
        into v_result
        from unnest(v_ids) with ordinality as ids(id, ord)
        join public.style_guide_search_documents d on d.style_guide_file_id = ids.id
        join public.style_guide_files f on f.id = ids.id
        left join lateral (
          select
            bool_or(q.status in ('pending', 'claimed', 'processing')) as has_open_work,
            bool_or(q.status = 'failed' and q.attempts < 3) as has_recoverable_error,
            bool_or(q.status = 'failed' and q.attempts >= 3) as has_terminal_error
          from public.style_guide_render_queue q
          where q.style_guide_file_id = ids.id
        ) r on true;
    else
      select coalesce(jsonb_agg(x.result order by x.ord), '[]'::jsonb) into v_result from (
        select y.result, row_number() over () as ord from (
          select g.result
            from public.style_guide_library_default_guides g
           order by
             case when v_sort in ('relevance', 'modified_desc') then g.modified_at end desc nulls last,
             case when v_sort = 'modified_asc' then g.modified_at end asc nulls last,
             case when v_sort = 'name_asc' then g.sort_name end asc nulls last,
             g.entity_key
           limit v_lim offset v_off) y) x;
    end if;

    return jsonb_build_object(
      'result_mode', v_mode,
      'total', v_total,
      'limit', v_lim,
      'offset', v_off,
      'sort', v_sort,
      'query', null,
      'results', v_result,
      'facets', v_facets
    );
  end if;

  if v_mode = 'files' then
with params as not materialized (
    select
      nullif(btrim(coalesce(p_query, '')), '') as q,
      case
        when lower(coalesce(p_sort, 'relevance')) in
          ('relevance', 'modified_desc', 'modified_asc', 'name_asc')
          then lower(coalesce(p_sort, 'relevance'))
        else 'relevance'
      end as sort_key,
      greatest(1, least(coalesce(p_limit, 50), 200)) as lim,
      greatest(0, coalesce(p_offset, 0)) as off,
      coalesce((select array_agg(distinct lower(u.value))
                  from unnest(p_preview_states) as u(value)), '{}'::text[]) as preview_states,
      coalesce((select array_agg(distinct lower(u.value))
                  from unnest(p_render_exception_states) as u(value)), '{}'::text[]) as render_states,
      coalesce((select array_agg(distinct lower(u.value))
                  from unnest(p_pdf_content_states) as u(value)), '{}'::text[]) as pdf_states,
      (p_query_embedding is not null) as has_embedding,
      case when p_min_semantic_score is null then null
           else greatest(0, least(1, p_min_semantic_score))::real end as min_semantic_score
  ), tsq as materialized (
    select case when p.q is null then null
                else websearch_to_tsquery('simple', p.q) end as query
      from params p
  ), semantic_candidates as materialized (
    -- Semantic leg: authorization ran at function entry and every row below is
    -- re-filtered by the same active/facet predicates inside active_children.
    -- HNSW returns distance order only; no secondary sort key (20261025163006).
    -- ANN cap 2000 with ef_search 100 mirrors the reviewed DAM leg; PopSG's
    -- corpus is separated by table.
    select d.style_guide_file_id,
           greatest(0, 1 - (d.embedding operator(extensions.<=>) p_query_embedding))::real as semantic_rank
      from params p
      join public.style_guide_search_documents d
        on p.has_embedding
       and d.is_active
       and d.embedding is not null
       and d.embedding_model = 'google/siglip2-base-patch16-naflex'
     where p.min_semantic_score is null
        or greatest(0, 1 - (d.embedding operator(extensions.<=>) p_query_embedding)) >= p.min_semantic_score
     order by d.embedding operator(extensions.<=>) p_query_embedding
     limit 2000
  ), render_rollup as materialized (
    select
      q.style_guide_file_id,
      bool_or(q.status in ('pending', 'claimed', 'processing')) as has_open_work,
      bool_or(q.status = 'failed' and q.attempts < 3) as has_recoverable_error,
      bool_or(q.status = 'failed' and q.attempts >= 3) as has_terminal_error
    from public.style_guide_render_queue q
    group by q.style_guide_file_id
  ), live_files as materialized (
    select s.style_guide_file_id as id, s.has_preview, s.has_error
      from public.style_guide_file_preview_state s
     where s.is_active
  ), active_children as materialized (
    select
      d.style_guide_file_id, d.licensor_name, d.property_folder, d.style_guide_name,
      lower(d.file_extension) as extension, d.tag_names, d.modified_at,
      case when p.sort_key = 'name_asc' then lower(d.filename) end as sort_name,
      case when f.has_preview then 'available' else 'missing' end as preview_state,
      case
        when f.has_preview then 'none'
        when coalesce(r.has_open_work, false) then 'waiting'
        when coalesce(r.has_recoverable_error, false) then 'recoverable_error'
        when f.has_error or coalesce(r.has_terminal_error, false) then 'terminal_exception'
        else 'unclassified'
      end as render_exception_state,
      case
        when lower(coalesce(d.file_extension, '')) <> 'pdf' then 'not_applicable'
        when d.pdf_text_status = 'extracted' and d.pdf_text_length > 0 then 'available'
        else 'unavailable'
      end as pdf_content_state,
      -- keyword parity when no embedding is supplied (semantic_candidates is
      -- empty then, so sc.semantic_rank is null and coalesce yields the bare
      -- keyword rank, byte-identical to the previous ordering)
      case when t.query is null then 0::real
           else ts_rank_cd(d.search_vector, t.query) end
        + coalesce(sc.semantic_rank, 0) * 0.35 as rank
    from (
      -- Three disjoint index-driven arms: keyword matches (GIN), the whole
      -- active corpus when no query text (snapshot bypass / embedding-only
      -- browse), and semantic candidates the keyword leg missed (HNSW).
      select m.* from public.style_guide_search_documents m, tsq mt
       where mt.query is not null and m.is_active and m.search_vector @@ mt.query
      union all
      select a.* from public.style_guide_search_documents a, tsq at
       where at.query is null and a.is_active
      union all
      select s.* from public.style_guide_search_documents s
        join semantic_candidates sc0 on sc0.style_guide_file_id = s.style_guide_file_id
       where s.is_active
         and not exists (select 1 from tsq st where st.query is null or s.search_vector @@ st.query)
    ) d
    join live_files f on f.id = d.style_guide_file_id
    left join render_rollup r on r.style_guide_file_id = d.style_guide_file_id
    left join semantic_candidates sc on sc.style_guide_file_id = d.style_guide_file_id
    cross join tsq t
    cross join params p
    where true
      and (p_licensors is null or cardinality(p_licensors) = 0 or d.licensor_name = any (p_licensors))
      and (p_properties is null or cardinality(p_properties) = 0 or d.property_folder = any (p_properties))
      and (p_style_guides is null or cardinality(p_style_guides) = 0 or d.style_guide_name = any (p_style_guides))
      and (p_extensions is null or cardinality(p_extensions) = 0
           or lower(coalesce(d.file_extension, '')) = any (
             select lower(u.value) from unnest(p_extensions) as u(value)
           ))
      and (p_tags is null or cardinality(p_tags) = 0 or d.tag_names && p_tags)
      and (p_modified_after is null or d.modified_at >= p_modified_after)
      and (p_modified_before is null or d.modified_at <= p_modified_before)
      and (cardinality(p.preview_states) = 0
           or (case when f.has_preview then 'available' else 'missing' end) = any (p.preview_states))
      and (cardinality(p.render_states) = 0 or case
             when f.has_preview then 'none'
             when coalesce(r.has_open_work, false) then 'waiting'
             when coalesce(r.has_recoverable_error, false) then 'recoverable_error'
             when f.has_error or coalesce(r.has_terminal_error, false) then 'terminal_exception'
             else 'unclassified'
           end = any (p.render_states))
      and (cardinality(p.pdf_states) = 0 or case
             when lower(coalesce(d.file_extension, '')) <> 'pdf' then 'not_applicable'
             when d.pdf_text_status = 'extracted' and d.pdf_text_length > 0 then 'available'
             else 'unavailable'
           end = any (p.pdf_states))
  ), page as materialized (select e.*,row_number() over(order by case when p.sort_key = 'relevance' then e.rank end desc nulls last,
             case when p.sort_key in ('relevance', 'modified_desc') then e.modified_at end desc nulls last,
             case when p.sort_key = 'modified_asc' then e.modified_at end asc nulls last,
             case when p.sort_key = 'name_asc' then e.sort_name end asc nulls last,
             e.entity_key) as rn from (select c.style_guide_file_id::text as entity_key,c.style_guide_file_id,c.rank,c.modified_at,c.sort_name,c.preview_state,c.render_exception_state,c.pdf_content_state from active_children c cross join params p order by case when p.sort_key = 'relevance' then c.rank end desc nulls last,
             case when p.sort_key in ('relevance', 'modified_desc') then c.modified_at end desc nulls last,
             case when p.sort_key = 'modified_asc' then c.modified_at end asc nulls last,
             case when p.sort_key = 'name_asc' then c.sort_name end asc nulls last,
             c.style_guide_file_id::text limit (select lim from params) offset (select off from params)) e cross join params p
  )
  select jsonb_build_object(
    'result_mode', v_mode,
    'total', (select count(*) from active_children),
    'limit', p.lim,
    'offset', p.off,
    'sort', p.sort_key,
    'query', p.q,
    'results', coalesce((select jsonb_agg(jsonb_build_object(
        'result_mode', 'files',
        'style_guide_file_id', d.style_guide_file_id,
        'root_label', d.root_label,
        'licensor_name', d.licensor_name,
        'property_folder', d.property_folder,
        'style_guide_folder', d.style_guide_folder,
        'style_guide_name', d.style_guide_name,
        'directory_path', d.directory_path,
        'relative_path', d.relative_path,
        'filename', d.filename,
        'file_extension', d.file_extension,
        'tag_names', to_jsonb(d.tag_names),
        'size_bytes', d.size_bytes,
        'modified_at', d.modified_at,
        'thumbnail_url', live_payload.thumbnail_url,
        'preview_state', pg.preview_state,
        'render_exception_state', pg.render_exception_state,
        'pdf_content_state', pg.pdf_content_state,
        'pdf_text_status', d.pdf_text_status,
        'pdf_text_length', d.pdf_text_length,
        'rank', pg.rank
      ) order by pg.rn) from page pg join public.style_guide_search_documents d on d.style_guide_file_id=pg.style_guide_file_id left join public.style_guide_files live_payload on live_payload.id=pg.style_guide_file_id), '[]'::jsonb),
    'facets', jsonb_build_object(
      'licensors', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                              from (select c.licensor_name value, count(*) count from active_children c
                                     where c.licensor_name is not null group by 1) facet), '[]'::jsonb),
      'properties', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                              from (select c.property_folder value, count(*) count from active_children c
                                     where c.property_folder is not null group by 1) facet), '[]'::jsonb),
      'style_guides', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                                from (select c.style_guide_name value, count(*) count from active_children c group by 1) facet), '[]'::jsonb),
      'extensions', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                              from (select c.extension value, count(*) count from active_children c
                                     where c.extension is not null group by 1) facet), '[]'::jsonb),
      'tags', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                        from (select t.value, count(*) count from active_children c
                               cross join lateral unnest(c.tag_names) t(value) group by 1) facet), '[]'::jsonb),
      'preview_states', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                                  from (select c.preview_state value, count(*) count from active_children c group by 1) facet), '[]'::jsonb),
      'render_exception_states', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                                           from (select c.render_exception_state value, count(*) count from active_children c group by 1) facet), '[]'::jsonb),
      'pdf_content_states', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                                      from (select c.pdf_content_state value, count(*) count from active_children c group by 1) facet), '[]'::jsonb)
    )
  ) into v_result
  from params p;
  else
execute $guides_query$
with params as not materialized (
    select
      nullif(btrim(coalesce($2, '')), '') as q,
      case
        when lower(coalesce($13, 'relevance')) in
          ('relevance', 'modified_desc', 'modified_asc', 'name_asc')
          then lower(coalesce($13, 'relevance'))
        else 'relevance'
      end as sort_key,
      greatest(1, least(coalesce($14, 50), 200)) as lim,
      greatest(0, coalesce($15, 0)) as off,
      coalesce((select array_agg(distinct lower(u.value))
                  from unnest($8) as u(value)), '{}'::text[]) as preview_states,
      coalesce((select array_agg(distinct lower(u.value))
                  from unnest($9) as u(value)), '{}'::text[]) as render_states,
      coalesce((select array_agg(distinct lower(u.value))
                  from unnest($10) as u(value)), '{}'::text[]) as pdf_states,
      ($16 is not null) as has_embedding,
      case when $17 is null then null
           else greatest(0, least(1, $17))::real end as min_semantic_score
  ), tsq as materialized (
    select case when p.q is null then null
                else websearch_to_tsquery('simple', p.q) end as query
      from params p
  ), semantic_candidates as materialized (
    -- see the files-mode copy: same ANN contract, positional binding
    select d.style_guide_file_id,
           greatest(0, 1 - (d.embedding operator(extensions.<=>) $16))::real as semantic_rank
      from params p
      join public.style_guide_search_documents d
        on p.has_embedding
       and d.is_active
       and d.embedding is not null
       and d.embedding_model = 'google/siglip2-base-patch16-naflex'
     where p.min_semantic_score is null
        or greatest(0, 1 - (d.embedding operator(extensions.<=>) $16)) >= p.min_semantic_score
     order by d.embedding operator(extensions.<=>) $16
     limit 2000
  ), render_rollup as materialized (
    select
      q.style_guide_file_id,
      bool_or(q.status in ('pending', 'claimed', 'processing')) as has_open_work,
      bool_or(q.status = 'failed' and q.attempts < 3) as has_recoverable_error,
      bool_or(q.status = 'failed' and q.attempts >= 3) as has_terminal_error
    from public.style_guide_render_queue q
    group by q.style_guide_file_id
  ), live_files as materialized (
    select s.style_guide_file_id as id, s.has_preview, s.has_error
      from public.style_guide_file_preview_state s
     where s.is_active
  ), active_children as materialized (
    select
      d.style_guide_file_id, d.root_label, d.licensor_name, d.property_folder, d.style_guide_folder, d.style_guide_name,
      lower(d.file_extension) as extension, d.tag_names, d.modified_at,
      f.has_preview, f.has_error,
      coalesce(r.has_open_work, false) as has_open_work,
      coalesce(r.has_recoverable_error, false) as has_recoverable_error,
      coalesce(r.has_terminal_error, false) as has_terminal_error,
      ((d.pdf_text_status = 'extracted' and d.pdf_text_length > 0) is true) as pdf_text_available,
      -- keyword parity when no embedding is supplied (semantic_candidates is
      -- empty then, so sc.semantic_rank is null and coalesce yields the bare
      -- keyword rank, byte-identical to the previous ordering)
      case when t.query is null then 0::real
           else ts_rank_cd(d.search_vector, t.query) end
        + coalesce(sc.semantic_rank, 0) * 0.35 as rank
    from (
      select m.* from public.style_guide_search_documents m, tsq mt
       where mt.query is not null and m.is_active and m.search_vector @@ mt.query
      union all
      select a.* from public.style_guide_search_documents a, tsq at
       where at.query is null and a.is_active
      union all
      select s.* from public.style_guide_search_documents s
        join semantic_candidates sc0 on sc0.style_guide_file_id = s.style_guide_file_id
       where s.is_active
         and not exists (select 1 from tsq st where st.query is null or s.search_vector @@ st.query)
    ) d
    join live_files f on f.id = d.style_guide_file_id
    left join render_rollup r on r.style_guide_file_id = d.style_guide_file_id
    left join semantic_candidates sc on sc.style_guide_file_id = d.style_guide_file_id
    cross join tsq t
    cross join params p
    where true
      and ($3 is null or cardinality($3) = 0 or d.licensor_name = any ($3))
      and ($4 is null or cardinality($4) = 0 or d.property_folder = any ($4))
      and ($5 is null or cardinality($5) = 0 or d.style_guide_name = any ($5))
      and ($6 is null or cardinality($6) = 0
           or lower(coalesce(d.file_extension, '')) = any (
             select lower(u.value) from unnest($6) as u(value)
           ))
      and ($7 is null or cardinality($7) = 0 or d.tag_names && $7)
      and ($11 is null or d.modified_at >= $11)
      and ($12 is null or d.modified_at <= $12)
      and (cardinality(p.preview_states) = 0
           or (case when f.has_preview then 'available' else 'missing' end) = any (p.preview_states))
      and (cardinality(p.render_states) = 0 or case
             when f.has_preview then 'none'
             when coalesce(r.has_open_work, false) then 'waiting'
             when coalesce(r.has_recoverable_error, false) then 'recoverable_error'
             when f.has_error or coalesce(r.has_terminal_error, false) then 'terminal_exception'
             else 'unclassified'
           end = any (p.render_states))
      and (cardinality(p.pdf_states) = 0 or case
             when lower(coalesce(d.file_extension, '')) <> 'pdf' then 'not_applicable'
             when d.pdf_text_status = 'extracted' and d.pdf_text_length > 0 then 'available'
             else 'unavailable'
           end = any (p.pdf_states))
  ), entities as materialized (
    select
      concat_ws(chr(31), g.root_label, coalesce(g.licensor_name,''), coalesce(g.property_folder,''), coalesce(g.style_guide_folder,''), g.style_guide_name) as entity_key,
      concat_ws(chr(31),
        coalesce(length(g.root_label)||':'||g.root_label, '-'),
        coalesce(length(g.licensor_name)||':'||g.licensor_name, '-'),
        coalesce(length(g.property_folder)||':'||g.property_folder, '-'),
        coalesce(length(g.style_guide_folder)||':'||g.style_guide_folder, '-'),
        coalesce(length(g.style_guide_name)||':'||g.style_guide_name, '-')) as group_id,
      g.rank, g.modified_at, lower(g.style_guide_name) as sort_name,
      g.root_label, g.licensor_name, g.property_folder, g.style_guide_folder, g.style_guide_name
    from (
      select
        d.root_label, d.licensor_name, d.property_folder, d.style_guide_folder, d.style_guide_name,
        max(d.rank) as rank, max(d.modified_at) as modified_at
      from active_children d
      group by d.root_label, d.licensor_name, d.property_folder, d.style_guide_folder, d.style_guide_name
    ) g
  ), guide_facets as materialized (
    select category,
           jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value) as facet_values
      from (
        select category, value, count(*) as count
          from (
            select distinct
              d.root_label, d.licensor_name, d.property_folder, d.style_guide_folder, d.style_guide_name,
              'tags'::text as category, tag.value
            from active_children d
            cross join lateral unnest(d.tag_names) tag(value)
            where tag.value is not null
            union all
            select
              d.root_label, d.licensor_name, d.property_folder, d.style_guide_folder, d.style_guide_name,
              f.category, f.value
            from (
              select distinct
                c.root_label, c.licensor_name, c.property_folder, c.style_guide_folder, c.style_guide_name,
                c.extension, c.has_preview, c.has_open_work, c.has_recoverable_error, c.has_error,
                c.has_terminal_error, c.pdf_text_available
              from active_children c
            ) d
            cross join lateral (
              select 'extensions'::text as category, d.extension as value
               where d.extension is not null
              union all
              select 'preview_states',
                     case when d.has_preview then 'available' else 'missing' end
              union all
              select 'render_exception_states',
                     case
                       when d.has_preview then 'none'
                       when d.has_open_work then 'waiting'
                       when d.has_recoverable_error then 'recoverable_error'
                       when d.has_error or d.has_terminal_error then 'terminal_exception'
                       else 'unclassified'
                     end
              union all
              select 'pdf_content_states',
                     case
                       when coalesce(d.extension, '') <> 'pdf' then 'not_applicable'
                       when d.pdf_text_available then 'available'
                       else 'unavailable'
                     end
            ) f(category, value)
            group by d.root_label, d.licensor_name, d.property_folder, d.style_guide_folder, d.style_guide_name,
                     f.category, f.value
          ) pairs
         group by category, value
      ) counts
     group by category
  ), page as materialized (select e.*,row_number() over(order by case when p.sort_key = 'relevance' then e.rank end desc nulls last,
             case when p.sort_key in ('relevance', 'modified_desc') then e.modified_at end desc nulls last,
             case when p.sort_key = 'modified_asc' then e.modified_at end asc nulls last,
             case when p.sort_key = 'name_asc' then e.sort_name end asc nulls last,
             e.entity_key) as rn from (select e.* from entities e cross join params p order by case when p.sort_key = 'relevance' then e.rank end desc nulls last,
             case when p.sort_key in ('relevance', 'modified_desc') then e.modified_at end desc nulls last,
             case when p.sort_key = 'modified_asc' then e.modified_at end asc nulls last,
             case when p.sort_key = 'name_asc' then e.sort_name end asc nulls last,
             e.entity_key limit (select lim from params) offset (select off from params)) e cross join params p
  ), page_children as materialized (
    select d.*, pg.group_id
    from active_children d
    join page pg
      on pg.group_id = concat_ws(chr(31),
        coalesce(length(d.root_label)||':'||d.root_label, '-'),
        coalesce(length(d.licensor_name)||':'||d.licensor_name, '-'),
        coalesce(length(d.property_folder)||':'||d.property_folder, '-'),
        coalesce(length(d.style_guide_folder)||':'||d.style_guide_folder, '-'),
        coalesce(length(d.style_guide_name)||':'||d.style_guide_name, '-'))
  ), page_thumb_ids as materialized (
    select d.group_id,
           (array_agg(d.style_guide_file_id
              order by d.modified_at desc nulls last, d.style_guide_file_id)
            filter (where d.has_preview))[1] as style_guide_file_id
      from page_children d
     group by d.group_id
  ), page_thumb as materialized (
    select t.group_id, f.thumbnail_url
      from page_thumb_ids t
      join public.style_guide_files f on f.id = t.style_guide_file_id
  ), page_metadata as materialized (
    select d.group_id,
           count(distinct d.style_guide_file_id) as matched_file_count,
           coalesce(array_agg(distinct d.extension) filter (where d.extension is not null), '{}'::text[]) as file_extensions,
           max(d.modified_at) as modified_at,
           array_agg(distinct
                      case when d.has_preview then 'available' else 'missing' end
                      order by case when d.has_preview then 'available' else 'missing' end
                    ) as preview_states,
           array_agg(distinct
                      case
                        when d.has_preview then 'none'
                        when d.has_open_work then 'waiting'
                        when d.has_recoverable_error then 'recoverable_error'
                        when d.has_error or d.has_terminal_error then 'terminal_exception'
                        else 'unclassified'
                      end
                      order by
                      case
                        when d.has_preview then 'none'
                        when d.has_open_work then 'waiting'
                        when d.has_recoverable_error then 'recoverable_error'
                        when d.has_error or d.has_terminal_error then 'terminal_exception'
                        else 'unclassified'
                      end
                    ) as render_exception_states,
           array_agg(distinct
                      case
                        when coalesce(d.extension, '') <> 'pdf' then 'not_applicable'
                        when d.pdf_text_available then 'available'
                        else 'unavailable'
                      end
                      order by
                      case
                        when coalesce(d.extension, '') <> 'pdf' then 'not_applicable'
                        when d.pdf_text_available then 'available'
                        else 'unavailable'
                      end
                    ) as pdf_content_states,
           max(d.rank) as rank
      from page_children d
     group by d.group_id
  ), page_tags as materialized (
    select d.group_id,
           coalesce(array_agg(distinct tag.value order by tag.value) filter (where tag.value is not null), '{}'::text[]) as tag_names
      from page_children d
      left join lateral unnest(d.tag_names) tag(value) on true
     group by d.group_id
  ), page_results as (
 select pg.rn,jsonb_build_object('result_mode','guides','guide_key',pg.entity_key,
 'root_label',pg.root_label,'licensor_name',pg.licensor_name,'property_folder',pg.property_folder,
 'style_guide_folder',pg.style_guide_folder,'style_guide_name',pg.style_guide_name,
 'matched_file_count',m.matched_file_count,'file_extensions',to_jsonb(m.file_extensions),'tag_names',to_jsonb(t.tag_names),
 'modified_at',m.modified_at,'thumbnail_url',th.thumbnail_url,'preview_states',to_jsonb(m.preview_states),
 'render_exception_states',to_jsonb(m.render_exception_states),'pdf_content_states',to_jsonb(m.pdf_content_states),'rank',m.rank) as result
 from page pg join page_metadata m on m.group_id=pg.group_id join page_tags t on t.group_id=pg.group_id
 left join page_thumb th on th.group_id=pg.group_id
)
  select jsonb_build_object(
    'result_mode', $1,
    'total', (select count(*) from entities),
    'limit', p.lim,
    'offset', p.off,
    'sort', p.sort_key,
    'query', p.q,
    'results', coalesce((select jsonb_agg(pg.result order by pg.rn) from page_results pg), '[]'::jsonb),
    'facets', jsonb_build_object(
      'licensors', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                              from (select licensor_name value, count(*) count from entities
                                     where licensor_name is not null group by 1) facet), '[]'::jsonb),
      'properties', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                              from (select property_folder value, count(*) count from entities
                                     where property_folder is not null group by 1) facet), '[]'::jsonb),
      'style_guides', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                                from (select style_guide_name value, count(*) count from entities group by 1) facet), '[]'::jsonb),
      'extensions', coalesce((select facet_values from guide_facets where category='extensions'), '[]'::jsonb),
      'tags', coalesce((select facet_values from guide_facets where category='tags'), '[]'::jsonb),
      'preview_states', coalesce((select facet_values from guide_facets where category='preview_states'), '[]'::jsonb),
      'render_exception_states', coalesce((select facet_values from guide_facets where category='render_exception_states'), '[]'::jsonb),
      'pdf_content_states', coalesce((select facet_values from guide_facets where category='pdf_content_states'), '[]'::jsonb)
    )
  ) 
  from params p
$guides_query$ into v_result using v_mode, p_query, p_licensors, p_properties, p_style_guides, p_extensions, p_tags, p_preview_states, p_render_exception_states, p_pdf_content_states, p_modified_after, p_modified_before, p_sort, p_limit, p_offset, p_query_embedding, p_min_semantic_score;
  end if;
  return v_result;
end
$function$;

revoke all on function public.search_style_guide_library_v2(text,text,text[],text[],text[],text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer,extensions.vector(768),real) from public, anon;
grant execute on function public.search_style_guide_library_v2(text,text,text[],text[],text[],text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer,extensions.vector(768),real) to authenticated, service_role;

comment on function public.search_style_guide_library_v2(text,text,text[],text[],text[],text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer,extensions.vector(768),real) is
  'PopSG library search, semantic-plus-keyword. p_query_embedding (SigLIP2/768) and p_min_semantic_score are optional; without them the function is byte-equivalent to the keyword-only contract. Authorization and all filters run before semantic candidate ranking; a semantic outage degrades to keyword search.';

do $verify$
begin
  if not exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.search_style_guide_library_v2(text,text,text[],text[],text[],text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer,extensions.vector(768),real)')
       and md5(p.prosrc) = '1dfc9194a2288feb3a0feace89487f78'
       and p.prosecdef and p.provolatile = 's' and p.prorettype = 'jsonb'::regtype
       and (select coalesce(array_agg(s.setting order by s.setting), '{}'::text[])
              from unnest(coalesce(p.proconfig, '{}'::text[])) s(setting))
           = array['search_path=pg_catalog, auth','statement_timeout=30s','work_mem=64MB']
  ) or not has_function_privilege('authenticated', 'public.search_style_guide_library_v2(text,text,text[],text[],text[],text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer,extensions.vector(768),real)', 'execute')
    or has_function_privilege('anon', 'public.search_style_guide_library_v2(text,text,text[],text[],text[],text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer,extensions.vector(768),real)', 'execute')
    or to_regprocedure('public.search_style_guide_library_v2(text,text,text[],text[],text[],text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer)') is not null then
    raise exception 'stage-2 semantic search did not install the expected contract';
  end if;
end
$verify$;


-- ---------------------------------------------------------------------------
-- INCIDENT FIX 2026-10-27 (#4437, claim #4820): the stage-1 coverage meter
-- get_sg_search_embedding_status timed out on production (SQLSTATE 57014,
-- 09:19Z and intermittently after) as the embedding backfill filled
-- vector(768) payloads: its single aggregate seq-scanned every heap page of
-- style_guide_search_documents (460 MB heap at 72,496/234,396 embedded),
-- because count(*) filter (embedding is not null) reads the embedding column
-- of every row. claim_sg_search_embedding_documents misplanned the same
-- table into a seq-scan + sort once (09:19Z). The backfill is stopped at
-- embedded=72,496 / pending=146,384 / errored=0 pending a fresh dispatch.
--
-- Fix: the meter is rewritten as split scalar counts whose document side is
-- served index-only by the partial indexes below (never touching the
-- embedding heap pages); the files side is a primary-key probe into a
-- narrow, vector-free heap. Bucket semantics are preserved exactly,
-- including the left-join behavior the stage-1 fixture pins: a document
-- whose file row is missing OR has no live thumbnail counts in
-- waiting_for_thumbnail_documents, and pending_documents counts only
-- claimable work (active, identified, thumbnail present, retries left,
-- error category not permanent). claim_sg_search_embedding_documents keeps
-- its reviewed body byte-for-byte: idx_sg_search_documents_meter_pending
-- bakes the attempt/category predicate into a document_updated_at-ordered
-- partial index, giving the planner the tight ordered path it misplanned
-- around (the remaining retry/lease/freshness filters are heap checks on
-- pending rows only, which carry no vector payload).

do $meter_baseline$
begin
  if not exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.get_sg_search_embedding_status()')
       and md5(p.prosrc) = 'cf3e8ebccc8074463a1d4f88cf241e86'
  ) then
    raise exception 'stage-1 coverage meter baseline differs; reconcile before applying';
  end if;
end
$meter_baseline$;

create index if not exists idx_sg_search_documents_meter_embedded
  on public.style_guide_search_documents using btree (style_guide_file_id)
  where embedding is not null;

create index if not exists idx_sg_search_documents_meter_pending
  on public.style_guide_search_documents using btree (document_updated_at, style_guide_file_id)
  where is_active and content_sha256 is not null and embedding is null
    and embedding_attempts < embedding_max_attempts
    and embedding_error_category is distinct from 'permanent';

create index if not exists idx_sg_search_documents_meter_unidentified
  on public.style_guide_search_documents using btree (style_guide_file_id)
  where content_sha256 is null;

create index if not exists idx_sg_search_documents_meter_errored
  on public.style_guide_search_documents using btree (style_guide_file_id)
  where embedding_error is not null;

create index if not exists idx_sg_search_documents_meter_exhausted
  on public.style_guide_search_documents using btree (style_guide_file_id)
  where embedding is null
    and (embedding_attempts >= embedding_max_attempts
         or embedding_error_category = 'permanent');

create index if not exists idx_sg_search_documents_meter_lease
  on public.style_guide_search_documents using btree (embedding_lease_expires_at);

create index if not exists idx_sg_search_documents_meter_updated_at
  on public.style_guide_search_documents using btree (document_updated_at);

create or replace function public.get_sg_search_embedding_status()
returns jsonb
language sql
stable
security definer
set search_path = 'public'
as $meter$
select jsonb_build_object(
  'total_documents', (select count(*) from public.style_guide_search_documents),
  'embedded_documents', (select count(*) from public.style_guide_search_documents where embedding is not null),
  'pending_documents', (
    select count(*) from public.style_guide_search_documents d
     where d.is_active and d.content_sha256 is not null and d.embedding is null
       and d.embedding_attempts < d.embedding_max_attempts
       and d.embedding_error_category is distinct from 'permanent'
       and exists (select 1 from public.style_guide_files f
                    where f.id = d.style_guide_file_id
                      and f.thumbnail_url is not null)),
  'waiting_for_thumbnail_documents', (
    select count(*) from public.style_guide_search_documents d
     where d.is_active and d.content_sha256 is not null and d.embedding is null
       and not exists (select 1 from public.style_guide_files f
                        where f.id = d.style_guide_file_id
                          and f.thumbnail_url is not null)),
  'unidentified_documents', (select count(*) from public.style_guide_search_documents where content_sha256 is null),
  'leased_documents', (select count(*) from public.style_guide_search_documents where embedding_lease_expires_at > now()),
  'errored_documents', (select count(*) from public.style_guide_search_documents where embedding_error is not null),
  'exhausted_documents', (
    select count(*) from public.style_guide_search_documents
     where embedding is null
       and (embedding_attempts >= embedding_max_attempts
            or embedding_error_category = 'permanent')),
  'oldest_pending_updated_at', (
    select d.document_updated_at from public.style_guide_search_documents d
     where d.is_active and d.content_sha256 is not null and d.embedding is null
       and exists (select 1 from public.style_guide_files f
                    where f.id = d.style_guide_file_id
                      and f.thumbnail_url is not null)
     order by d.document_updated_at
     limit 1),
  'newest_updated_at', (select max(document_updated_at) from public.style_guide_search_documents)
)
$meter$;

revoke all on function public.get_sg_search_embedding_status() from public, anon;
grant execute on function public.get_sg_search_embedding_status() to service_role;

do $meter_verify$
begin
  if not exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.get_sg_search_embedding_status()')
       and md5(p.prosrc) = '0366a4d0bddee2c5a8b8f2d4ba73c69a'
       and p.prosecdef and p.provolatile = 's'
       and (select coalesce(array_agg(s.setting order by s.setting), '{}'::text[])
              from unnest(coalesce(p.proconfig, '{}'::text[])) s(setting))
           = array['search_path=public']
  ) or not has_function_privilege('service_role', 'public.get_sg_search_embedding_status()', 'execute')
    or has_function_privilege('anon', 'public.get_sg_search_embedding_status()', 'execute')
    or has_function_privilege('authenticated', 'public.get_sg_search_embedding_status()', 'execute')
    or exists (select 1 from (values
      ('idx_sg_search_documents_meter_embedded'),
      ('idx_sg_search_documents_meter_pending'),
      ('idx_sg_search_documents_meter_unidentified'),
      ('idx_sg_search_documents_meter_errored'),
      ('idx_sg_search_documents_meter_exhausted'),
      ('idx_sg_search_documents_meter_lease'),
      ('idx_sg_search_documents_meter_updated_at')
    ) wanted(name) where not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relname = wanted.name and n.nspname = 'public' and c.relkind = 'i'))
  then
    raise exception 'stage-2 incident fix did not install the expected meter contract';
  end if;
end
$meter_verify$;

notify pgrst, 'reload config';
