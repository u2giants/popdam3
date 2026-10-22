-- Issue #4210; exact-object claim #4212. Parse the query once in each mode.
-- Preserve result, facet, ranking, authorization, grants and timeout.
-- Guides plan against this call's bound values and aggregate page metadata
-- separately from tags; no SQL string contains user-controlled text.
-- derived-from: 20260917024050
do $baseline$
begin
  if not exists (select 1 from pg_proc where oid = to_regprocedure('public.search_style_guide_library_v2(text,text,text[],text[],text[],text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer)')
    and md5(prosrc) = '3547b0f7d28d044ff6d6e031dcbeebbb' and proowner = 'postgres'::regrole and prosecdef and provolatile = 's') then
    raise exception 'PopSG search baseline differs; reconcile before applying';
  end if;
end
$baseline$;

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
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, auth
set work_mem = '64MB'
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
                  from unnest(p_pdf_content_states) as u(value)), '{}'::text[]) as pdf_states
  ), tsq as materialized (
    select case when p.q is null then null
                else websearch_to_tsquery('simple', p.q) end as query
      from params p
  ), render_rollup as materialized (
    select
      q.style_guide_file_id,
      bool_or(q.status in ('pending', 'claimed', 'processing')) as has_open_work,
      bool_or(q.status = 'failed' and q.attempts < 3) as has_recoverable_error,
      bool_or(q.status = 'failed' and q.attempts >= 3) as has_terminal_error
    from public.style_guide_render_queue q
    group by q.style_guide_file_id
  ), live_files as not materialized (
    select id,true as has_preview,false as has_error from public.style_guide_files
      where is_active and thumbnail_url is not null
    union all
    select id,false,false from public.style_guide_files
      where is_active and thumbnail_url is null and thumbnail_error is null
    union all
    select id,false,true from public.style_guide_files
      where is_active and thumbnail_url is null and thumbnail_error is not null
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
      case when t.query is null then 0::real
           else ts_rank_cd(d.search_vector, t.query) end as rank
    from public.style_guide_search_documents d
    join live_files f on f.id = d.style_guide_file_id
    left join render_rollup r on r.style_guide_file_id = d.style_guide_file_id
    cross join tsq t
    cross join params p
    where d.is_active
      and (t.query is null or d.search_vector @@ t.query)
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
                  from unnest($10) as u(value)), '{}'::text[]) as pdf_states
  ), tsq as materialized (
    select case when p.q is null then null
                else websearch_to_tsquery('simple', p.q) end as query
      from params p
  ), render_rollup as materialized (
    select
      q.style_guide_file_id,
      bool_or(q.status in ('pending', 'claimed', 'processing')) as has_open_work,
      bool_or(q.status = 'failed' and q.attempts < 3) as has_recoverable_error,
      bool_or(q.status = 'failed' and q.attempts >= 3) as has_terminal_error
    from public.style_guide_render_queue q
    group by q.style_guide_file_id
  ), live_files as not materialized (
    select id,true as has_preview,false as has_error from public.style_guide_files
      where is_active and thumbnail_url is not null
    union all
    select id,false,false from public.style_guide_files
      where is_active and thumbnail_url is null and thumbnail_error is null
    union all
    select id,false,true from public.style_guide_files
      where is_active and thumbnail_url is null and thumbnail_error is not null
  ), active_children as materialized (
    select
      -- Exact guide identity as one hashable text value: every part is
      -- length-prefixed and SQL NULL is '-', so NULL and '' folders stay
      -- different identities, exactly like the previous array-equality join.
      concat_ws(chr(31),
        coalesce(length(d.root_label)||':'||d.root_label, '-'),
        coalesce(length(d.licensor_name)||':'||d.licensor_name, '-'),
        coalesce(length(d.property_folder)||':'||d.property_folder, '-'),
        coalesce(length(d.style_guide_folder)||':'||d.style_guide_folder, '-'),
        coalesce(length(d.style_guide_name)||':'||d.style_guide_name, '-')) as group_id,
      d.style_guide_file_id, d.root_label, d.licensor_name, d.property_folder, d.style_guide_folder, d.style_guide_name,
      lower(d.file_extension) as extension, d.tag_names, d.modified_at,
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
      case when t.query is null then 0::real
           else ts_rank_cd(d.search_vector, t.query) end as rank
    from public.style_guide_search_documents d
    join live_files f on f.id = d.style_guide_file_id
    left join render_rollup r on r.style_guide_file_id = d.style_guide_file_id
    cross join tsq t
    cross join params p
    where d.is_active
      and (t.query is null or d.search_vector @@ t.query)
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
  ), entities as materialized (select g.group_id,concat_ws(chr(31), g.root_label, coalesce(g.licensor_name,''), coalesce(g.property_folder,''), coalesce(g.style_guide_folder,''), g.style_guide_name) as entity_key,g.rank,g.modified_at,lower(g.style_guide_name) as sort_name,g.root_label,g.licensor_name,g.property_folder,g.style_guide_folder,g.style_guide_name from (select d.group_id,max(d.rank) as rank,max(d.modified_at) as modified_at,min(d.root_label) as root_label,min(d.licensor_name) as licensor_name,min(d.property_folder) as property_folder,min(d.style_guide_folder) as style_guide_folder,min(d.style_guide_name) as style_guide_name from active_children d group by d.group_id) g
  ), guide_facets as materialized (select category,jsonb_agg(jsonb_build_object('value',value,'count',count) order by count desc,value) as facet_values from (
      select 'extensions'::text as category,value,count(*) as count from (select distinct d.group_id,d.extension as value from active_children d where d.extension is not null) u group by value
      union all select 'tags',value,count(*) from (select distinct d.group_id,t.value from active_children d cross join lateral unnest(d.tag_names) t(value) where t.value is not null) u group by value
      union all select 'preview_states',value,count(*) from (select distinct d.group_id,d.preview_state as value from active_children d) u group by value
      union all select 'render_exception_states',value,count(*) from (select distinct d.group_id,d.render_exception_state as value from active_children d) u group by value
      union all select 'pdf_content_states',value,count(*) from (select distinct d.group_id,d.pdf_content_state as value from active_children d) u group by value
    ) counts group by category
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
 select d.*, live_payload.thumbnail_url from active_children d join page pg on pg.group_id=d.group_id
 join public.style_guide_files live_payload on live_payload.id=d.style_guide_file_id
), page_metadata as materialized (
 select d.group_id, count(distinct d.style_guide_file_id) as matched_file_count,
 coalesce(array_agg(distinct d.extension) filter(where d.extension is not null),'{}'::text[]) as file_extensions,
 max(d.modified_at) as modified_at,
 (array_agg(d.thumbnail_url order by (d.thumbnail_url is null),d.modified_at desc nulls last,d.style_guide_file_id) filter(where d.thumbnail_url is not null))[1] as thumbnail_url,
 array_agg(distinct d.preview_state order by d.preview_state) as preview_states,
 array_agg(distinct d.render_exception_state order by d.render_exception_state) as render_exception_states,
 array_agg(distinct d.pdf_content_state order by d.pdf_content_state) as pdf_content_states,
 max(d.rank) as rank from page_children d group by d.group_id
), page_tags as materialized (
 select d.group_id,coalesce(array_agg(distinct tag.value order by tag.value) filter(where tag.value is not null),'{}'::text[]) as tag_names
 from page_children d left join lateral unnest(d.tag_names) tag(value) on true group by d.group_id
), page_results as (
 select pg.rn,jsonb_build_object('result_mode','guides','guide_key',pg.entity_key,
 'root_label',pg.root_label,'licensor_name',pg.licensor_name,'property_folder',pg.property_folder,
 'style_guide_folder',pg.style_guide_folder,'style_guide_name',pg.style_guide_name,
 'matched_file_count',m.matched_file_count,'file_extensions',to_jsonb(m.file_extensions),'tag_names',to_jsonb(t.tag_names),
 'modified_at',m.modified_at,'thumbnail_url',m.thumbnail_url,'preview_states',to_jsonb(m.preview_states),
 'render_exception_states',to_jsonb(m.render_exception_states),'pdf_content_states',to_jsonb(m.pdf_content_states),'rank',m.rank) as result
 from page pg join page_metadata m on m.group_id=pg.group_id join page_tags t on t.group_id=pg.group_id
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
$guides_query$ into v_result using v_mode, p_query, p_licensors, p_properties, p_style_guides, p_extensions, p_tags, p_preview_states, p_render_exception_states, p_pdf_content_states, p_modified_after, p_modified_before, p_sort, p_limit, p_offset;
  end if;
  return v_result;
end
$function$;
