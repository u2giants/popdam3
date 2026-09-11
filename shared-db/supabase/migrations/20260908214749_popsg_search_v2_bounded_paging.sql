-- Issue #2506; guarded forward reservation 20260908214749 on claim #2510.
-- derived-from: 20260907131610
-- Keep every authorized filter, exact total/facet and child-before-guide rule.
-- Narrow intermediate rows; page before building response JSON. Guide facets
-- count distinct complete typed identities, including null versus empty fields.
-- No indexes, data writes, privilege changes, or v1 replacement.
--
-- Guides mode re-joins children to their grouped identity on whole-array
-- equality over [root_label, licensor_name, property_folder, style_guide_folder,
-- style_guide_name]. That is deliberate on both counts. It is NULL-safe:
-- PostgreSQL array equality compares element by element and treats two NULL
-- elements as equal, so an identity carrying a NULL folder still matches, while
-- NULL and the empty string stay distinct -- exactly the rule the facet comment
-- above states, and the behaviour contract 8 in
-- supabase/tests/popsg_search_style_guide_library_v2_contracts.sql pins. It is
-- also required for the budget this migration exists to meet: rewriting either
-- join as per-column IS NOT DISTINCT FROM defeats the hash join, and the guides
-- forward query measured 4.1s with array equality against a timeout past the
-- unchanged 8s budget without it. Do not "fix" these joins to IS NOT DISTINCT
-- FROM.

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
as $function$
declare
  v_mode text := lower(coalesce(nullif(btrim(p_result_mode), ''), 'files'));
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
  ), tsq as not materialized (
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
  ), active_children as materialized (
    select
      d.style_guide_file_id, d.root_label, d.licensor_name, d.property_folder, d.style_guide_folder, d.style_guide_name, d.filename, d.file_extension, d.tag_names, d.modified_at, d.pdf_text_length,
      f.thumbnail_url as live_thumbnail_url,
      case when f.thumbnail_url is not null then 'available' else 'missing' end as preview_state,
      case
        when f.thumbnail_url is not null then 'none'
        when coalesce(r.has_open_work, false) then 'waiting'
        when coalesce(r.has_recoverable_error, false) then 'recoverable_error'
        when f.thumbnail_error is not null or coalesce(r.has_terminal_error, false) then 'terminal_exception'
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
    join public.style_guide_files f on f.id = d.style_guide_file_id
    left join render_rollup r on r.style_guide_file_id = d.style_guide_file_id
    cross join tsq t
    cross join params p
    where d.is_active
      and f.is_active
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
           or (case when f.thumbnail_url is not null then 'available' else 'missing' end) = any (p.preview_states))
      and (cardinality(p.render_states) = 0 or case
             when f.thumbnail_url is not null then 'none'
             when coalesce(r.has_open_work, false) then 'waiting'
             when coalesce(r.has_recoverable_error, false) then 'recoverable_error'
             when f.thumbnail_error is not null or coalesce(r.has_terminal_error, false) then 'terminal_exception'
             else 'unclassified'
           end = any (p.render_states))
      and (cardinality(p.pdf_states) = 0 or case
             when lower(coalesce(d.file_extension, '')) <> 'pdf' then 'not_applicable'
             when d.pdf_text_status = 'extracted' and d.pdf_text_length > 0 then 'available'
             else 'unavailable'
           end = any (p.pdf_states))
  ), file_entities as (
    select
      d.style_guide_file_id::text as entity_key,
      d.rank,
      d.modified_at,
      lower(d.filename) as sort_name,
      d.licensor_name,
      d.property_folder,
      d.style_guide_name,
      case when d.file_extension is null then '{}'::text[]
           else array[lower(d.file_extension)] end as extensions,
      d.tag_names as tags,
      array[d.preview_state] as preview_states,
      array[d.render_exception_state] as render_states,
      array[d.pdf_content_state] as pdf_states
    from active_children d
  ), entities as materialized (
    select * from file_entities
  ), page as materialized (select e.*,row_number() over(order by case when p.sort_key = 'relevance' then e.rank end desc nulls last,
             case when p.sort_key in ('relevance', 'modified_desc') then e.modified_at end desc nulls last,
             case when p.sort_key = 'modified_asc' then e.modified_at end asc nulls last,
             case when p.sort_key = 'name_asc' then e.sort_name end asc nulls last,
             e.entity_key) as rn from (select e.* from entities e cross join params p order by case when p.sort_key = 'relevance' then e.rank end desc nulls last,
             case when p.sort_key in ('relevance', 'modified_desc') then e.modified_at end desc nulls last,
             case when p.sort_key = 'modified_asc' then e.modified_at end asc nulls last,
             case when p.sort_key = 'name_asc' then e.sort_name end asc nulls last,
             e.entity_key limit (select lim from params) offset (select off from params)) e cross join params p
  )
  select jsonb_build_object(
    'result_mode', v_mode,
    'total', (select count(*) from entities),
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
        'directory_path', payload.directory_path,
        'relative_path', payload.relative_path,
        'filename', d.filename,
        'file_extension', d.file_extension,
        'tag_names', to_jsonb(d.tag_names),
        'size_bytes', payload.size_bytes,
        'modified_at', d.modified_at,
        'thumbnail_url', d.live_thumbnail_url,
        'preview_state', d.preview_state,
        'render_exception_state', d.render_exception_state,
        'pdf_content_state', d.pdf_content_state,
        'pdf_text_status', payload.pdf_text_status,
        'pdf_text_length', payload.pdf_text_length,
        'rank', d.rank
      ) order by pg.rn) from page pg left join active_children d on d.style_guide_file_id::text=pg.entity_key left join public.style_guide_search_documents payload on payload.style_guide_file_id=d.style_guide_file_id), '[]'::jsonb),
    'facets', jsonb_build_object(
      'licensors', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                              from (select licensor_name value, count(*) count from entities
                                     where licensor_name is not null group by 1) facet), '[]'::jsonb),
      'properties', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                              from (select property_folder value, count(*) count from entities
                                     where property_folder is not null group by 1) facet), '[]'::jsonb),
      'style_guides', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                                from (select style_guide_name value, count(*) count from entities group by 1) facet), '[]'::jsonb),
      'extensions', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                              from (select u.value, count(*) count from entities
                                    cross join lateral unnest(extensions) as u(value) group by 1) facet), '[]'::jsonb),
      'tags', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                        from (select u.value, count(*) count from entities
                              cross join lateral unnest(tags) as u(value) group by 1) facet), '[]'::jsonb),
      'preview_states', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                                  from (select u.value, count(*) count from entities
                                        cross join lateral unnest(preview_states) as u(value) group by 1) facet), '[]'::jsonb),
      'render_exception_states', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                                           from (select u.value, count(*) count from entities
                                                 cross join lateral unnest(render_states) as u(value) group by 1) facet), '[]'::jsonb),
      'pdf_content_states', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                                      from (select u.value, count(*) count from entities
                                            cross join lateral unnest(pdf_states) as u(value) group by 1) facet), '[]'::jsonb)
    )
  ) into v_result
  from params p;
  else
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
  ), tsq as not materialized (
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
  ), active_children as materialized (
    select
      d.style_guide_file_id, d.root_label, d.licensor_name, d.property_folder, d.style_guide_folder, d.style_guide_name, d.file_extension, d.tag_names, d.modified_at, d.pdf_text_length,
      f.thumbnail_url as live_thumbnail_url,
      case when f.thumbnail_url is not null then 'available' else 'missing' end as preview_state,
      case
        when f.thumbnail_url is not null then 'none'
        when coalesce(r.has_open_work, false) then 'waiting'
        when coalesce(r.has_recoverable_error, false) then 'recoverable_error'
        when f.thumbnail_error is not null or coalesce(r.has_terminal_error, false) then 'terminal_exception'
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
    join public.style_guide_files f on f.id = d.style_guide_file_id
    left join render_rollup r on r.style_guide_file_id = d.style_guide_file_id
    cross join tsq t
    cross join params p
    where d.is_active
      and f.is_active
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
           or (case when f.thumbnail_url is not null then 'available' else 'missing' end) = any (p.preview_states))
      and (cardinality(p.render_states) = 0 or case
             when f.thumbnail_url is not null then 'none'
             when coalesce(r.has_open_work, false) then 'waiting'
             when coalesce(r.has_recoverable_error, false) then 'recoverable_error'
             when f.thumbnail_error is not null or coalesce(r.has_terminal_error, false) then 'terminal_exception'
             else 'unclassified'
           end = any (p.render_states))
      and (cardinality(p.pdf_states) = 0 or case
             when lower(coalesce(d.file_extension, '')) <> 'pdf' then 'not_applicable'
             when d.pdf_text_status = 'extracted' and d.pdf_text_length > 0 then 'available'
             else 'unavailable'
           end = any (p.pdf_states))
  ), entities as materialized (select concat_ws(chr(31), d.root_label, coalesce(d.licensor_name,''), coalesce(d.property_folder,''), coalesce(d.style_guide_folder,''), d.style_guide_name) as entity_key,array[d.root_label,d.licensor_name,d.property_folder,d.style_guide_folder,d.style_guide_name] as guide_identity,row_number() over() as group_id,max(d.rank) as rank,max(d.modified_at) as modified_at,lower(d.style_guide_name) as sort_name,d.root_label,d.licensor_name,d.property_folder,d.style_guide_folder,d.style_guide_name from active_children d group by d.root_label,d.licensor_name,d.property_folder,d.style_guide_folder,d.style_guide_name  ), mapped_children as materialized (select e.group_id,d.file_extension,d.tag_names,d.preview_state,d.render_exception_state,d.pdf_content_state from active_children d join entities e on array[d.root_label,d.licensor_name,d.property_folder,d.style_guide_folder,d.style_guide_name]=e.guide_identity  ), guide_facets as materialized (select category,jsonb_agg(jsonb_build_object('value',value,'count',count) order by count desc,value) as facet_values from (select category,value,count(*) as count from (select distinct d.group_id,u.category,u.value from mapped_children d cross join lateral (select 'extensions'::text as category,lower(d.file_extension) as value union all select 'tags',unnest(d.tag_names) union all select 'preview_states',d.preview_state union all select 'render_exception_states',d.render_exception_state union all select 'pdf_content_states',d.pdf_content_state)u where u.value is not null) unique_values group by category,value) counts group by category  ), page as materialized (select e.*,row_number() over(order by case when p.sort_key = 'relevance' then e.rank end desc nulls last,
             case when p.sort_key in ('relevance', 'modified_desc') then e.modified_at end desc nulls last,
             case when p.sort_key = 'modified_asc' then e.modified_at end asc nulls last,
             case when p.sort_key = 'name_asc' then e.sort_name end asc nulls last,
             e.entity_key) as rn from (select e.* from entities e cross join params p order by case when p.sort_key = 'relevance' then e.rank end desc nulls last,
             case when p.sort_key in ('relevance', 'modified_desc') then e.modified_at end desc nulls last,
             case when p.sort_key = 'modified_asc' then e.modified_at end asc nulls last,
             case when p.sort_key = 'name_asc' then e.sort_name end asc nulls last,
             e.entity_key limit (select lim from params) offset (select off from params)) e cross join params p
  ), page_results as (select pg.rn, jsonb_build_object(
        'result_mode', 'guides',
        'guide_key', concat_ws(chr(31), d.root_label, coalesce(d.licensor_name, ''),
                    coalesce(d.property_folder, ''), coalesce(d.style_guide_folder, ''),
                    d.style_guide_name),
        'root_label', d.root_label,
        'licensor_name', d.licensor_name,
        'property_folder', d.property_folder,
        'style_guide_folder', d.style_guide_folder,
        'style_guide_name', d.style_guide_name,
        'matched_file_count', count(distinct d.style_guide_file_id),
        'file_extensions', to_jsonb(coalesce(array_agg(distinct lower(d.file_extension))
                              filter (where d.file_extension is not null), '{}'::text[])),
        'tag_names', to_jsonb(coalesce(array_agg(distinct tag.value order by tag.value)
                                       filter (where tag.value is not null), '{}'::text[])),
        'modified_at', max(d.modified_at),
        'thumbnail_url', (array_agg(d.live_thumbnail_url order by
                             (d.live_thumbnail_url is null), d.modified_at desc nulls last,
                             d.style_guide_file_id)
                          filter (where d.live_thumbnail_url is not null))[1],
        'preview_states', to_jsonb(array_agg(distinct d.preview_state order by d.preview_state)),
        'render_exception_states', to_jsonb(array_agg(distinct d.render_exception_state order by d.render_exception_state)),
        'pdf_content_states', to_jsonb(array_agg(distinct d.pdf_content_state order by d.pdf_content_state)),
        'rank', max(d.rank)
      ) as result from page pg join active_children d on array[d.root_label,d.licensor_name,d.property_folder,d.style_guide_folder,d.style_guide_name]=array[pg.root_label,pg.licensor_name,pg.property_folder,pg.style_guide_folder,pg.style_guide_name] left join lateral unnest(d.tag_names) tag(value) on true group by pg.rn,d.root_label,d.licensor_name,d.property_folder,d.style_guide_folder,d.style_guide_name)
  select jsonb_build_object(
    'result_mode', v_mode,
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
  ) into v_result
  from params p;
  end if;
  return v_result;
end
$function$;
