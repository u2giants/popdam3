-- Issue #2509 / claim #2511: keep PopSG preview health exact without reading the
-- wide style_guide_files heap for every Settings request.
-- derived-from: 20260506002757
--
-- Writes exactly:
--   function public.get_sg_preview_stats
--   index public.idx_sgf_active_preview_category

create index if not exists idx_sgf_active_preview_category
on public.style_guide_files ((
  case
    when thumbnail_url is not null then 'has_preview'
    when lower(file_extension) not in
      ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff')
      then 'unsupported'
    when thumbnail_error is null
      and lower(file_extension) in
        ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff')
      then 'renderable_no_preview'
    when thumbnail_error is not null
      and lower(file_extension) in
        ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff')
      and (
        lower(thumbnail_error) in
          ('no_pdf_compat', 'no_preview_or_render_failed', 'blank_render')
        or lower(thumbnail_error) like '%enoent%'
        or lower(thumbnail_error) like '%not found%'
        or lower(thumbnail_error) like '%missing%'
        or lower(thumbnail_error) like '%unsupported%'
        or lower(thumbnail_error) like '%corrupt%'
      ) then 'renderable_terminal'
    when thumbnail_error is not null
      and lower(file_extension) in
        ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff')
      then 'renderable_recoverable'
    when thumbnail_error is not null
      and (
        lower(thumbnail_error) in
          ('no_pdf_compat', 'no_preview_or_render_failed', 'blank_render')
        or lower(thumbnail_error) like '%enoent%'
        or lower(thumbnail_error) like '%not found%'
        or lower(thumbnail_error) like '%missing%'
        or lower(thumbnail_error) like '%unsupported%'
        or lower(thumbnail_error) like '%corrupt%'
      ) then 'other_terminal'
    when thumbnail_error is not null then 'other_recoverable'
    else 'other_unexplained'
  end
))
where is_active;

create or replace function public.get_sg_preview_stats()
returns json
language sql
stable
security definer
set search_path = public
as $function$
  with category_counts as materialized (
    select preview_category, count(*)::bigint as row_count
    from (
      select case
        when f.thumbnail_url is not null then 'has_preview'
        when lower(f.file_extension) not in
          ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff')
          then 'unsupported'
        when f.thumbnail_error is null
          and lower(f.file_extension) in
            ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff')
          then 'renderable_no_preview'
        when f.thumbnail_error is not null
          and lower(f.file_extension) in
            ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff')
          and (
            lower(f.thumbnail_error) in
              ('no_pdf_compat', 'no_preview_or_render_failed', 'blank_render')
            or lower(f.thumbnail_error) like '%enoent%'
            or lower(f.thumbnail_error) like '%not found%'
            or lower(f.thumbnail_error) like '%missing%'
            or lower(f.thumbnail_error) like '%unsupported%'
            or lower(f.thumbnail_error) like '%corrupt%'
          ) then 'renderable_terminal'
        when f.thumbnail_error is not null
          and lower(f.file_extension) in
            ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff')
          then 'renderable_recoverable'
        when f.thumbnail_error is not null
          and (
            lower(f.thumbnail_error) in
              ('no_pdf_compat', 'no_preview_or_render_failed', 'blank_render')
            or lower(f.thumbnail_error) like '%enoent%'
            or lower(f.thumbnail_error) like '%not found%'
            or lower(f.thumbnail_error) like '%missing%'
            or lower(f.thumbnail_error) like '%unsupported%'
            or lower(f.thumbnail_error) like '%corrupt%'
          ) then 'other_terminal'
        when f.thumbnail_error is not null then 'other_recoverable'
        else 'other_unexplained'
      end as preview_category
      from public.style_guide_files f
      where f.is_active
    ) classified
    group by preview_category
  ),
  file_stats as (
    select
      coalesce(sum(row_count), 0)::bigint as total_active,
      coalesce(sum(row_count) filter
        (where preview_category = 'has_preview'), 0)::bigint as has_preview,
      coalesce(sum(row_count) filter
        (where preview_category = 'renderable_no_preview'), 0)::bigint
        as renderable_no_preview,
      coalesce(sum(row_count) filter
        (where preview_category in ('renderable_terminal', 'renderable_recoverable')), 0)::bigint
        as render_errored,
      coalesce(sum(row_count) filter
        (where preview_category = 'unsupported'), 0)::bigint as unsupported,
      coalesce(sum(row_count) filter
        (where preview_category in ('renderable_recoverable', 'other_recoverable')), 0)::bigint
        as recoverable_error,
      coalesce(sum(row_count) filter
        (where preview_category in ('renderable_terminal', 'other_terminal', 'unsupported')), 0)::bigint
        as reviewed_terminal_exception,
      coalesce(sum(row_count) filter
        (where preview_category in ('renderable_no_preview', 'other_unexplained')), 0)::bigint
        as unexplained
    from category_counts
  ),
  live_queue_files as materialized (
    select distinct q.style_guide_file_id
    from public.style_guide_render_queue q
    where q.status in ('pending', 'claimed', 'processing')
  ),
  queued_file_stats as (
    select
      count(*)::bigint as waiting_queued,
      count(*) filter (where queued.preview_category in
        ('renderable_recoverable', 'other_recoverable'))::bigint as queued_recoverable,
      count(*) filter (where queued.preview_category in
        ('renderable_terminal', 'other_terminal', 'unsupported'))::bigint as queued_terminal,
      count(*) filter (where queued.preview_category in
        ('renderable_no_preview', 'other_unexplained'))::bigint as queued_unexplained
    from (
      select case
        when lower(f.file_extension) not in
          ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff')
          then 'unsupported'
        when f.thumbnail_error is null
          and lower(f.file_extension) in
            ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff')
          then 'renderable_no_preview'
        when f.thumbnail_error is not null
          and lower(f.file_extension) in
            ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff')
          and (
            lower(f.thumbnail_error) in
              ('no_pdf_compat', 'no_preview_or_render_failed', 'blank_render')
            or lower(f.thumbnail_error) like '%enoent%'
            or lower(f.thumbnail_error) like '%not found%'
            or lower(f.thumbnail_error) like '%missing%'
            or lower(f.thumbnail_error) like '%unsupported%'
            or lower(f.thumbnail_error) like '%corrupt%'
          ) then 'renderable_terminal'
        when f.thumbnail_error is not null
          and lower(f.file_extension) in
            ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff')
          then 'renderable_recoverable'
        when f.thumbnail_error is not null
          and (
            lower(f.thumbnail_error) in
              ('no_pdf_compat', 'no_preview_or_render_failed', 'blank_render')
            or lower(f.thumbnail_error) like '%enoent%'
            or lower(f.thumbnail_error) like '%not found%'
            or lower(f.thumbnail_error) like '%missing%'
            or lower(f.thumbnail_error) like '%unsupported%'
            or lower(f.thumbnail_error) like '%corrupt%'
          ) then 'other_terminal'
        when f.thumbnail_error is not null then 'other_recoverable'
        else 'other_unexplained'
      end as preview_category
      from live_queue_files lq
      join public.style_guide_files f on f.id = lq.style_guide_file_id
      where f.is_active and f.thumbnail_url is null
    ) queued
  ),
  legacy_queue_stats as (
    select count(*)::bigint as queued_now
    from public.style_guide_render_queue
    where status in ('pending', 'claimed')
  )
  select json_build_object(
    'total_active', fs.total_active,
    'has_preview', fs.has_preview,
    'renderable_no_preview', fs.renderable_no_preview,
    'render_errored', fs.render_errored,
    'unsupported', fs.unsupported,
    'queued_now', lqs.queued_now,
    'waiting_queued', qfs.waiting_queued,
    'recoverable_error', fs.recoverable_error - qfs.queued_recoverable,
    'reviewed_terminal_exception',
      fs.reviewed_terminal_exception - qfs.queued_terminal,
    'unexplained', fs.unexplained - qfs.queued_unexplained
  )
  from file_stats fs
  cross join queued_file_stats qfs
  cross join legacy_queue_stats lqs;
$function$;

revoke execute on function public.get_sg_preview_stats() from public, anon;
grant execute on function public.get_sg_preview_stats() to authenticated, service_role;
