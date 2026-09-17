-- Issue #3009; claim #3136. Keep the unfiltered PopSG v2 default browse (the
-- landing view: no query and no filter) well inside the unchanged eight-second
-- authenticated statement timeout, in both Files and Guides mode.
-- derived-from: 20260915111626
-- Production diagnosis (read-only EXPLAIN ANALYZE, about 217k active files in
-- 1,712 guides): the unfiltered Guides body took 6.35 s. Nearly all of it is
-- building the whole active child set (about 200k heap fetches on the wide
-- style_guide_files table and about 30k cold search-document pages), a 1.06M-row
-- tag fan-out, and per-guide distinct facet aggregates. With no query and no
-- filter none of that depends on the caller.
-- This migration:
--   * precomputes, with the exact unfiltered expressions of the previous body,
--     the Files and Guides totals and facets
--     (public.style_guide_library_default_summary) and every Guides result row
--     (public.style_guide_library_default_guides);
--   * refreshes both concurrently every five minutes through
--     public.refresh_style_guide_library_default_snapshot (pg_cron job
--     refresh-style-guide-library-default-snapshot). Totals, facets and guide
--     rows on the unfiltered landing view may therefore lag the corpus by up to
--     one refresh interval;
--   * makes public.search_style_guide_library_v2 read them only when no query
--     and no filter of any kind is supplied. Files page rows stay live and are
--     paged through the existing stable-page index. Every filtered or queried
--     call, and any call while the snapshot is absent, runs the previous body
--     unchanged. Authorization, grants, RLS and the statement timeout are
--     unchanged.

create materialized view public.style_guide_library_default_summary as
with render_rollup as materialized (
  select
    q.style_guide_file_id,
    bool_or(q.status in ('pending', 'claimed', 'processing')) as has_open_work,
    bool_or(q.status = 'failed' and q.attempts < 3) as has_recoverable_error,
    bool_or(q.status = 'failed' and q.attempts >= 3) as has_terminal_error
  from public.style_guide_render_queue q
  group by q.style_guide_file_id
), live_files as not materialized (
  select id, true as has_preview, false as has_error from public.style_guide_files
    where is_active and thumbnail_url is not null
  union all
  select id, false, false from public.style_guide_files
    where is_active and thumbnail_url is null and thumbnail_error is null
  union all
  select id, false, true from public.style_guide_files
    where is_active and thumbnail_url is null and thumbnail_error is not null
), active_children as materialized (
  select
    concat_ws(chr(31),
      coalesce(length(d.root_label)||':'||d.root_label, '-'),
      coalesce(length(d.licensor_name)||':'||d.licensor_name, '-'),
      coalesce(length(d.property_folder)||':'||d.property_folder, '-'),
      coalesce(length(d.style_guide_folder)||':'||d.style_guide_folder, '-'),
      coalesce(length(d.style_guide_name)||':'||d.style_guide_name, '-')) as group_id,
    d.licensor_name, d.property_folder, d.style_guide_name,
    lower(d.file_extension) as extension, d.tag_names,
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
    end as pdf_content_state
  from public.style_guide_search_documents d
  join live_files f on f.id = d.style_guide_file_id
  left join render_rollup r on r.style_guide_file_id = d.style_guide_file_id
  where d.is_active
), entities as materialized (
  select d.group_id, min(d.licensor_name) as licensor_name,
         min(d.property_folder) as property_folder, min(d.style_guide_name) as style_guide_name
  from active_children d
  group by d.group_id
), guide_facets as materialized (
  select category, jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value) as facet_values from (
    select 'extensions'::text as category, value, count(*) as count from (select distinct d.group_id, d.extension as value from active_children d where d.extension is not null) u group by value
    union all select 'tags', value, count(*) from (select distinct d.group_id, t.value from active_children d cross join lateral unnest(d.tag_names) t(value) where t.value is not null) u group by value
    union all select 'preview_states', value, count(*) from (select distinct d.group_id, d.preview_state as value from active_children d) u group by value
    union all select 'render_exception_states', value, count(*) from (select distinct d.group_id, d.render_exception_state as value from active_children d) u group by value
    union all select 'pdf_content_states', value, count(*) from (select distinct d.group_id, d.pdf_content_state as value from active_children d) u group by value
  ) counts
  group by category
)
select 'files'::text as result_mode,
  (select count(*) from active_children) as total,
  jsonb_build_object(
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
  ) as facets
union all
select 'guides'::text,
  (select count(*) from entities),
  jsonb_build_object(
    'licensors', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                            from (select licensor_name value, count(*) count from entities
                                   where licensor_name is not null group by 1) facet), '[]'::jsonb),
    'properties', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                            from (select property_folder value, count(*) count from entities
                                   where property_folder is not null group by 1) facet), '[]'::jsonb),
    'style_guides', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                              from (select style_guide_name value, count(*) count from entities group by 1) facet), '[]'::jsonb),
    'extensions', coalesce((select facet_values from guide_facets where category = 'extensions'), '[]'::jsonb),
    'tags', coalesce((select facet_values from guide_facets where category = 'tags'), '[]'::jsonb),
    'preview_states', coalesce((select facet_values from guide_facets where category = 'preview_states'), '[]'::jsonb),
    'render_exception_states', coalesce((select facet_values from guide_facets where category = 'render_exception_states'), '[]'::jsonb),
    'pdf_content_states', coalesce((select facet_values from guide_facets where category = 'pdf_content_states'), '[]'::jsonb)
  );

create unique index style_guide_library_default_summary_mode_uidx
  on public.style_guide_library_default_summary (result_mode);

create materialized view public.style_guide_library_default_guides as
with render_rollup as materialized (
  select
    q.style_guide_file_id,
    bool_or(q.status in ('pending', 'claimed', 'processing')) as has_open_work,
    bool_or(q.status = 'failed' and q.attempts < 3) as has_recoverable_error,
    bool_or(q.status = 'failed' and q.attempts >= 3) as has_terminal_error
  from public.style_guide_render_queue q
  group by q.style_guide_file_id
), live_files as not materialized (
  select id, true as has_preview, false as has_error from public.style_guide_files
    where is_active and thumbnail_url is not null
  union all
  select id, false, false from public.style_guide_files
    where is_active and thumbnail_url is null and thumbnail_error is null
  union all
  select id, false, true from public.style_guide_files
    where is_active and thumbnail_url is null and thumbnail_error is not null
), active_children as materialized (
  select
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
    0::real as rank
  from public.style_guide_search_documents d
  join live_files f on f.id = d.style_guide_file_id
  left join render_rollup r on r.style_guide_file_id = d.style_guide_file_id
  where d.is_active
), entities as materialized (
  select g.group_id,
    concat_ws(chr(31), g.root_label, coalesce(g.licensor_name, ''), coalesce(g.property_folder, ''), coalesce(g.style_guide_folder, ''), g.style_guide_name) as entity_key,
    g.modified_at, lower(g.style_guide_name) as sort_name,
    g.root_label, g.licensor_name, g.property_folder, g.style_guide_folder, g.style_guide_name
  from (select d.group_id, max(d.modified_at) as modified_at, min(d.root_label) as root_label,
               min(d.licensor_name) as licensor_name, min(d.property_folder) as property_folder,
               min(d.style_guide_folder) as style_guide_folder, min(d.style_guide_name) as style_guide_name
          from active_children d
         group by d.group_id) g
)
select e.group_id, e.entity_key, e.modified_at, e.sort_name,
  jsonb_build_object(
    'result_mode', 'guides',
    'guide_key', e.entity_key,
    'root_label', e.root_label,
    'licensor_name', e.licensor_name,
    'property_folder', e.property_folder,
    'style_guide_folder', e.style_guide_folder,
    'style_guide_name', e.style_guide_name,
    'matched_file_count', count(distinct d.style_guide_file_id),
    'file_extensions', to_jsonb(coalesce(array_agg(distinct d.extension)
                          filter (where d.extension is not null), '{}'::text[])),
    'tag_names', to_jsonb(coalesce(array_agg(distinct tag.value order by tag.value)
                                   filter (where tag.value is not null), '{}'::text[])),
    'modified_at', max(d.modified_at),
    'thumbnail_url', (array_agg(live_payload.thumbnail_url order by
                         (live_payload.thumbnail_url is null), d.modified_at desc nulls last,
                         d.style_guide_file_id)
                      filter (where live_payload.thumbnail_url is not null))[1],
    'preview_states', to_jsonb(array_agg(distinct d.preview_state order by d.preview_state)),
    'render_exception_states', to_jsonb(array_agg(distinct d.render_exception_state order by d.render_exception_state)),
    'pdf_content_states', to_jsonb(array_agg(distinct d.pdf_content_state order by d.pdf_content_state)),
    'rank', max(d.rank)
  ) as result
from entities e
join active_children d on d.group_id = e.group_id
join public.style_guide_files live_payload on live_payload.id = d.style_guide_file_id
left join lateral unnest(d.tag_names) tag(value) on true
group by e.group_id, e.entity_key, e.modified_at, e.sort_name, e.root_label, e.licensor_name,
         e.property_folder, e.style_guide_folder, e.style_guide_name;

create unique index style_guide_library_default_guides_group_uidx
  on public.style_guide_library_default_guides (group_id);
create index style_guide_library_default_guides_modified_idx
  on public.style_guide_library_default_guides (modified_at desc nulls last, entity_key);
create index style_guide_library_default_guides_name_idx
  on public.style_guide_library_default_guides (sort_name, entity_key);

-- Internal read models: only the SECURITY DEFINER search function reads them.
revoke all on public.style_guide_library_default_summary from public, anon, authenticated;
revoke all on public.style_guide_library_default_guides from public, anon, authenticated;
grant select on public.style_guide_library_default_summary to service_role;
grant select on public.style_guide_library_default_guides to service_role;

create or replace function public.refresh_style_guide_library_default_snapshot()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  refresh materialized view concurrently public.style_guide_library_default_guides;
  refresh materialized view concurrently public.style_guide_library_default_summary;
end
$function$;

revoke all on function public.refresh_style_guide_library_default_snapshot() from public, anon, authenticated;
grant execute on function public.refresh_style_guide_library_default_snapshot() to service_role;

do $cron$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'refresh-style-guide-library-default-snapshot'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'refresh-style-guide-library-default-snapshot',
    '*/5 * * * *',
    $cron_body$ select public.refresh_style_guide_library_default_snapshot() $cron_body$
  );
end;
$cron$;


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
  ), page_results as (select pg.rn, jsonb_build_object(
        'result_mode', 'guides',
        'guide_key', pg.entity_key,
        'root_label', pg.root_label,
        'licensor_name', pg.licensor_name,
        'property_folder', pg.property_folder,
        'style_guide_folder', pg.style_guide_folder,
        'style_guide_name', pg.style_guide_name,
        'matched_file_count', count(distinct d.style_guide_file_id),
        'file_extensions', to_jsonb(coalesce(array_agg(distinct d.extension)
                              filter (where d.extension is not null), '{}'::text[])),
        'tag_names', to_jsonb(coalesce(array_agg(distinct tag.value order by tag.value)
                                       filter (where tag.value is not null), '{}'::text[])),
        'modified_at', max(d.modified_at),
        'thumbnail_url', (array_agg(live_payload.thumbnail_url order by
                             (live_payload.thumbnail_url is null), d.modified_at desc nulls last,
                             d.style_guide_file_id)
                          filter (where live_payload.thumbnail_url is not null))[1],
        'preview_states', to_jsonb(array_agg(distinct d.preview_state order by d.preview_state)),
        'render_exception_states', to_jsonb(array_agg(distinct d.render_exception_state order by d.render_exception_state)),
        'pdf_content_states', to_jsonb(array_agg(distinct d.pdf_content_state order by d.pdf_content_state)),
        'rank', max(d.rank)
      ) as result from page pg join active_children d on d.group_id=pg.group_id join public.style_guide_files live_payload on live_payload.id=d.style_guide_file_id left join lateral unnest(d.tag_names) tag(value) on true group by pg.rn,pg.entity_key,pg.root_label,pg.licensor_name,pg.property_folder,pg.style_guide_folder,pg.style_guide_name)
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
