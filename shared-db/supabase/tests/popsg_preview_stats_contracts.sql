begin;

do $$
declare
  v_indexdef text;
  v_function text := lower(pg_get_functiondef(
    'public.get_sg_preview_stats()'::regprocedure));
begin
  select lower(indexdef) into v_indexdef
  from pg_indexes
  where schemaname = 'public'
    and indexname = 'idx_sgf_active_preview_category';

  if v_indexdef is null
     or position('where is_active' in v_indexdef) = 0
     or position('renderable_terminal' in v_indexdef) = 0
     or position('other_unexplained' in v_indexdef) = 0 then
    raise exception 'preview category index is missing or incomplete: %', v_indexdef;
  end if;

  if position('security definer' in v_function) = 0
     or position('stable' in v_function) = 0
     or position('set search_path to ''public''' in v_function) = 0
     or position('idx_sgf_active_preview_category' in v_indexdef) = 0
     or v_function ~ '\m(insert|update|delete|merge|truncate)\M' then
    raise exception 'preview stats function lost its read-only security contract';
  end if;

  if has_function_privilege('anon',
       'public.get_sg_preview_stats()', 'EXECUTE')
     or not has_function_privilege('authenticated',
       'public.get_sg_preview_stats()', 'EXECUTE')
     or not has_function_privilege('service_role',
       'public.get_sg_preview_stats()', 'EXECUTE') then
    raise exception 'preview stats function privileges changed';
  end if;
end;
$$;

do $$
declare
  v_ids uuid[] := array[
    gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
    gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
    gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
    gen_random_uuid()
  ];
  v_before json;
  v_after json;
  v_file_digest_before text;
  v_file_digest_after text;
  v_queue_digest_before text;
  v_queue_digest_after text;
begin
  v_before := public.get_sg_preview_stats();

  insert into public.style_guide_files
    (id, root_label, relative_path, directory_path, filename,
     basename_no_ext, normalized_name, file_extension, is_active,
     thumbnail_url, thumbnail_error)
  values
    (v_ids[1], 'ZZ2509', 'ZZ2509/preview.pdf', 'ZZ2509', 'preview.pdf',
     'preview', 'preview', 'pdf', true, 'https://example.invalid/preview.png', null),
    (v_ids[2], 'ZZ2509', 'ZZ2509/unexplained.pdf', 'ZZ2509', 'unexplained.pdf',
     'unexplained', 'unexplained', 'pdf', true, null, null),
    (v_ids[3], 'ZZ2509', 'ZZ2509/terminal.ai', 'ZZ2509', 'terminal.ai',
     'terminal', 'terminal', 'ai', true, null, 'no_pdf_compat'),
    (v_ids[4], 'ZZ2509', 'ZZ2509/recoverable.pdf', 'ZZ2509', 'recoverable.pdf',
     'recoverable', 'recoverable', 'pdf', true, null, 'renderer_busy'),
    (v_ids[5], 'ZZ2509', 'ZZ2509/unsupported.txt', 'ZZ2509', 'unsupported.txt',
     'unsupported', 'unsupported', 'txt', true, null, null),
    (v_ids[6], 'ZZ2509', 'ZZ2509/no-extension', 'ZZ2509', 'no-extension',
     'no-extension', 'no-extension', null, true, null, null),
    (v_ids[7], 'ZZ2509', 'ZZ2509/other-error', 'ZZ2509', 'other-error',
     'other-error', 'other-error', null, true, null, 'renderer_busy'),
    (v_ids[8], 'ZZ2509', 'ZZ2509/waiting.pdf', 'ZZ2509', 'waiting.pdf',
     'waiting', 'waiting', 'pdf', true, null, null),
    (v_ids[9], 'ZZ2509', 'ZZ2509/processing.ai', 'ZZ2509', 'processing.ai',
     'processing', 'processing', 'ai', true, null, 'no_pdf_compat'),
    (v_ids[10], 'ZZ2509', 'ZZ2509/inactive.pdf', 'ZZ2509', 'inactive.pdf',
     'inactive', 'inactive', 'pdf', false, null, null);

  insert into public.style_guide_render_queue
    (style_guide_file_id, status, attempts)
  values
    (v_ids[8], 'pending', 0),
    (v_ids[9], 'processing', 1);

  select md5(string_agg(
    id::text || '|' || coalesce(thumbnail_url, '') || '|' ||
    coalesce(thumbnail_error, '') || '|' || is_active::text,
    ',' order by id))
  into v_file_digest_before
  from public.style_guide_files
  where id = any(v_ids);

  select md5(string_agg(
    style_guide_file_id::text || '|' || status::text || '|' || attempts::text,
    ',' order by style_guide_file_id))
  into v_queue_digest_before
  from public.style_guide_render_queue
  where style_guide_file_id = any(v_ids);

  v_after := public.get_sg_preview_stats();

  if (v_after->>'total_active')::bigint -
       (v_before->>'total_active')::bigint <> 9
     or (v_after->>'has_preview')::bigint -
       (v_before->>'has_preview')::bigint <> 1
     or (v_after->>'renderable_no_preview')::bigint -
       (v_before->>'renderable_no_preview')::bigint <> 2
     or (v_after->>'render_errored')::bigint -
       (v_before->>'render_errored')::bigint <> 3
     or (v_after->>'unsupported')::bigint -
       (v_before->>'unsupported')::bigint <> 1
     or (v_after->>'queued_now')::bigint -
       (v_before->>'queued_now')::bigint <> 1 then
    raise exception 'legacy preview stats changed: before %, after %',
      v_before, v_after;
  end if;

  if (v_after->>'waiting_queued')::bigint -
       (v_before->>'waiting_queued')::bigint <> 2
     or (v_after->>'recoverable_error')::bigint -
       (v_before->>'recoverable_error')::bigint <> 2
     or (v_after->>'reviewed_terminal_exception')::bigint -
       (v_before->>'reviewed_terminal_exception')::bigint <> 2
     or (v_after->>'unexplained')::bigint -
       (v_before->>'unexplained')::bigint <> 2 then
    raise exception 'stable preview categories are not exact: before %, after %',
      v_before, v_after;
  end if;

  if (v_after->>'total_active')::bigint <>
       (v_after->>'has_preview')::bigint +
       (v_after->>'waiting_queued')::bigint +
       (v_after->>'recoverable_error')::bigint +
       (v_after->>'reviewed_terminal_exception')::bigint +
       (v_after->>'unexplained')::bigint then
    raise exception 'stable preview categories do not partition active files: %',
      v_after;
  end if;

  select md5(string_agg(
    id::text || '|' || coalesce(thumbnail_url, '') || '|' ||
    coalesce(thumbnail_error, '') || '|' || is_active::text,
    ',' order by id))
  into v_file_digest_after
  from public.style_guide_files
  where id = any(v_ids);

  select md5(string_agg(
    style_guide_file_id::text || '|' || status::text || '|' || attempts::text,
    ',' order by style_guide_file_id))
  into v_queue_digest_after
  from public.style_guide_render_queue
  where style_guide_file_id = any(v_ids);

  if v_file_digest_before is distinct from v_file_digest_after
     or v_queue_digest_before is distinct from v_queue_digest_after then
    raise exception 'preview stats function changed file or queue rows';
  end if;

end;
$$;

-- Capture every response field before the volume insert for exact parity.
create temporary table preview_stats_volume_baseline on commit drop as
select public.get_sg_preview_stats()::jsonb as stats;
grant select on preview_stats_volume_baseline to authenticated;

-- Exercise a population larger than the observed active production set. The
-- enclosing transaction rolls every fixture back, and the lower local timeout
-- proves the function does not depend on relaxing the caller's timeout.
insert into public.style_guide_files
  (id, root_label, relative_path, directory_path, filename,
   basename_no_ext, normalized_name, file_extension, is_active,
   thumbnail_url, thumbnail_error)
select gen_random_uuid(), 'ZZ2509-VOLUME', 'ZZ2509-VOLUME/' || g || '.pdf',
       'ZZ2509-VOLUME', g || '.pdf', g::text, g::text, 'pdf', true,
       'https://example.invalid/' || g || '.png', null
from generate_series(1, 250000) g;

analyze public.style_guide_files;
analyze public.style_guide_render_queue;

-- Prove the expression index against representative cardinality. On the tiny
-- fixture above PostgreSQL correctly prefers the narrower is_active bitmap
-- index, which says nothing about the production aggregate plan.
do $$
declare
  v_plan json;
  v_seqscan text := current_setting('enable_seqscan');
  v_bitmapscan text := current_setting('enable_bitmapscan');
  v_hashagg text := current_setting('enable_hashagg');
begin
  perform set_config('enable_seqscan', 'off', true);
  perform set_config('enable_bitmapscan', 'off', true);
  perform set_config('enable_hashagg', 'off', true);

  execute $explain$
    explain (format json)
    select case
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
    end,
    count(*)
    from public.style_guide_files
    where is_active
    group by 1
  $explain$ into v_plan;

  if position('idx_sgf_active_preview_category' in v_plan::text) = 0 then
    raise exception 'preview category index cannot serve the representative aggregate plan: %',
      v_plan;
  end if;
  -- This check proves index usability only. Restore the caller's exact
  -- planner settings before testing its natural plan and authenticated timing.
  perform set_config('enable_seqscan', v_seqscan, true);
  perform set_config('enable_bitmapscan', v_bitmapscan, true);
  perform set_config('enable_hashagg', v_hashagg, true);
end;
$$;

set local role authenticated;
set local statement_timeout = '5s';

do $$
declare
  v_stats jsonb;
  v_expected jsonb;
begin
  if current_user <> 'authenticated' then
    raise exception 'representative-volume call is not authenticated';
  end if;
  select jsonb_set(
    jsonb_set(stats, '{total_active}',
      to_jsonb((stats->>'total_active')::bigint + 250000)),
    '{has_preview}', to_jsonb((stats->>'has_preview')::bigint + 250000))
  into strict v_expected from preview_stats_volume_baseline;
  v_stats := public.get_sg_preview_stats()::jsonb;
  if v_stats is distinct from v_expected then
    raise exception 'natural-plan authenticated count parity failed: expected %, actual %',
      v_expected, v_stats;
  end if;
end;
$$;

rollback;
