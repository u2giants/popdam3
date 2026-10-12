-- #2421 behavior contracts. Synthetic rows only; every change rolls back.
BEGIN;

DO $test$
DECLARE
  base_cursor uuid := 'ffffffff-ffff-4fff-8fff-ffffffffffc0';
  a1 uuid := 'ffffffff-ffff-4fff-8fff-ffffffffffc1';
  a2 uuid := 'ffffffff-ffff-4fff-8fff-ffffffffffc2';
  a3 uuid := 'ffffffff-ffff-4fff-8fff-ffffffffffc3';
  g1 uuid;
  cutoff timestamptz;
  old_clock timestamptz;
  original_file_time timestamptz := '2026-01-02 03:04:05+00';
  result record;
  cursor_id uuid;
  n integer := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM public.assets WHERE NOT is_deleted AND id > base_cursor) THEN
    RAISE EXCEPTION 'SETUP: existing rows overlap watermark fixture UUID range';
  END IF;
  INSERT INTO public.assets (id, filename, relative_path, file_type, quick_hash, modified_at, is_deleted)
  VALUES
    (a1, 'one.png', 'contract/AAA2421AA/one.png', 'png', '2421-one', original_file_time, false),
    (a2, 'two.png', 'contract/BBB2421BB/two.png', 'png', '2421-two', original_file_time, false),
    (a3, 'three.png', 'contract/plain/three.png', 'png', '2421-three', original_file_time, false);
  PERFORM public.rebuild_style_groups_batch(base_cursor, 100);
  SELECT style_group_id, style_group_changed_at INTO g1, old_clock FROM public.assets WHERE id = a1;
  cutoff := clock_timestamp();

  SELECT * INTO result FROM public.rebuild_style_groups_batch(base_cursor, 100, cutoff);
  IF result.rows_examined <> 1 OR result.assets_assigned <> 0 OR result.assets_ungrouped <> 0 THEN
    RAISE EXCEPTION 'CONTRACT: clean grouped assets were walked, or null-group recovery was omitted: %', result;
  END IF;
  IF (SELECT style_group_changed_at FROM public.assets WHERE id = a1) IS DISTINCT FROM old_clock THEN
    RAISE EXCEPTION 'CONTRACT: converged no-op rebuild caused a clock feedback loop';
  END IF;

  -- Rename without changing the file date or app-maintained modified_at.
  UPDATE public.assets SET relative_path = 'contract/plain/one.png' WHERE id = a1;
  IF (SELECT modified_at FROM public.assets WHERE id = a1) IS DISTINCT FROM original_file_time
     OR (SELECT style_group_changed_at FROM public.assets WHERE id = a1) <= cutoff THEN
    RAISE EXCEPTION 'CONTRACT: changed path was missed or source-file date overwritten';
  END IF;
  SELECT * INTO result FROM public.rebuild_style_groups_batch(base_cursor, 100, cutoff);
  IF result.rows_examined <> 2 OR result.assets_ungrouped <> 1
     OR (SELECT style_group_id FROM public.assets WHERE id = a1) IS NOT NULL THEN
    RAISE EXCEPTION 'CONTRACT: a renamed SKU-less asset retained its stale group';
  END IF;

  -- Group/tag changes must include member assets even when their own clock is old.
  cutoff := clock_timestamp();
  SELECT style_group_id INTO g1 FROM public.assets WHERE id = a2;
  INSERT INTO public.style_group_tags (style_group_id, tag, category, source, status)
  VALUES (g1, 'watermark-contract', 'other', 'manual', 'active');
  IF (SELECT style_group_changed_at FROM public.style_groups WHERE id = g1) <= cutoff THEN
    RAISE EXCEPTION 'CONTRACT: tag insertion did not dirty its group';
  END IF;
  SELECT * INTO result FROM public.rebuild_style_groups_batch(base_cursor, 100, cutoff);
  IF result.rows_examined <> 3 THEN
    RAISE EXCEPTION 'CONTRACT: tag-only group change omitted member asset';
  END IF;
  cutoff := clock_timestamp();
  UPDATE public.style_groups SET asset_count = asset_count + 1 WHERE id = g1;
  SELECT * INTO result FROM public.rebuild_style_groups_batch(base_cursor, 100, cutoff);
  IF result.rows_examined <> 2 THEN
    RAISE EXCEPTION 'CONTRACT: derived count writes perpetually dirty group membership';
  END IF;

  -- Overlapping candidate arms and a one-row cursor must neither duplicate nor skip.
  cutoff := clock_timestamp();
  UPDATE public.assets SET filename = filename || '-changed' WHERE id IN (a1, a2, a3);
  UPDATE public.style_groups SET property_name = 'watermark changed' WHERE id = g1;
  cursor_id := base_cursor;
  LOOP
    SELECT * INTO result FROM public.rebuild_style_groups_batch(cursor_id, 1, cutoff);
    n := n + result.rows_examined;
    EXIT WHEN result.done;
    IF result.next_cursor IS NULL OR result.next_cursor <= cursor_id THEN
      RAISE EXCEPTION 'CONTRACT: differential cursor failed to advance';
    END IF;
    cursor_id := result.next_cursor;
    IF n > 3 THEN RAISE EXCEPTION 'CONTRACT: overlap duplicated candidate assets'; END IF;
  END LOOP;
  IF n <> 3 THEN RAISE EXCEPTION 'CONTRACT: overlapping arms lost candidates'; END IF;
  SELECT * INTO result FROM public.rebuild_style_groups_batch(base_cursor, 100, NULL::timestamptz);
  IF result.rows_examined <> 3 THEN RAISE EXCEPTION 'CONTRACT: weekly full pass omitted rows'; END IF;
  IF NOT has_function_privilege('service_role', 'public.rebuild_style_groups_batch(uuid,integer,timestamptz)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.rebuild_style_groups_batch(uuid,integer,timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.rebuild_style_groups_batch(uuid,integer,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'CONTRACT: new worker RPC privilege boundary changed';
  END IF;
END;
$test$;

DO $state$
DECLARE
  op text := 'rebuild-style-groups';
  marker text := 'style-group-change-watermark';
  counts text := 'style-group-counts-reconcile';
  run_id text := '2421-contract-run';
  prior timestamptz := now() - interval '2 days';
  captured timestamptz := now() - interval '1 day';
  body jsonb;
  original_def text;
BEGIN
  -- Controlled enqueue clock only inside this rollback test transaction.
  SELECT pg_get_functiondef('public.queue_nightly_rebuild_style_groups()'::regprocedure) INTO original_def;
  EXECUTE replace(original_def, 'c_enqueue_hour  constant integer := 6', 'c_enqueue_hour  constant integer := 0');
  body := jsonb_build_object(
    op, jsonb_build_object('status', 'failed', 'run_id', run_id,
      'params', jsonb_build_object('watermark_protocol', 1, 'changed_cutoff', captured)),
    marker, jsonb_build_object('last_successful_cutoff', prior, 'last_full_cutoff', prior,
      'pending_run_id', run_id, 'pending_cutoff', captured, 'pending_mode', 'incremental'),
    counts, jsonb_build_object('last_enqueued_at', now(), 'last_reconciled_at', now()));
  INSERT INTO public.admin_config(key,value,updated_at) VALUES ('BULK_OPERATIONS',body,now())
  ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value;
  PERFORM public.queue_nightly_rebuild_style_groups();
  IF (SELECT (value -> marker ->> 'last_successful_cutoff')::timestamptz FROM public.admin_config WHERE key='BULK_OPERATIONS') <> prior THEN
    RAISE EXCEPTION 'CONTRACT: failed run advanced successful watermark';
  END IF;
  UPDATE public.admin_config SET value = jsonb_set(value, ARRAY[op,'status'], '"running"') WHERE key='BULK_OPERATIONS';
  PERFORM public.queue_nightly_rebuild_style_groups();
  IF (SELECT (value -> marker ->> 'last_successful_cutoff')::timestamptz FROM public.admin_config WHERE key='BULK_OPERATIONS') <> prior THEN
    RAISE EXCEPTION 'CONTRACT: partial run advanced successful watermark';
  END IF;
  UPDATE public.admin_config SET value = jsonb_set(body, ARRAY[op,'status'], '"completed"') WHERE key='BULK_OPERATIONS';
  PERFORM public.queue_nightly_rebuild_style_groups();
  IF (SELECT (value -> marker ->> 'last_successful_cutoff')::timestamptz FROM public.admin_config WHERE key='BULK_OPERATIONS') <> captured THEN
    RAISE EXCEPTION 'CONTRACT: matching completed run did not advance captured cutoff';
  END IF;
  -- Replay is idempotent, and daily enqueue retains the completed lower bound.
  UPDATE public.admin_config SET value = jsonb_set(value,ARRAY[counts,'last_enqueued_at'],to_jsonb((now()-interval '1 day')::text)) WHERE key='BULK_OPERATIONS';
  PERFORM public.queue_nightly_rebuild_style_groups();
  SELECT value INTO body FROM public.admin_config WHERE key='BULK_OPERATIONS';
  IF body -> op -> 'params' ->> 'rebuild_mode' <> 'incremental'
     OR (body -> op -> 'params' ->> 'changed_since')::timestamptz <> captured THEN
    RAISE EXCEPTION 'CONTRACT: daily enqueue lost completed watermark bounds';
  END IF;
  -- A seven-day full floor remains load-bearing after any partial failure.
  body := jsonb_set(body, ARRAY[op,'status'], '"failed"');
  body := jsonb_set(body, ARRAY[counts,'last_enqueued_at'],to_jsonb((now()-interval '1 day')::text));
  body := jsonb_set(body, ARRAY[marker,'last_full_cutoff'],to_jsonb((now()-interval '8 days')::text));
  UPDATE public.admin_config SET value=body WHERE key='BULK_OPERATIONS';
  PERFORM public.queue_nightly_rebuild_style_groups();
  SELECT value INTO body FROM public.admin_config WHERE key='BULK_OPERATIONS';
  IF body -> op -> 'params' ->> 'rebuild_mode' <> 'full'
     OR body -> op -> 'params' ->> 'changed_since' IS NOT NULL THEN
    RAISE EXCEPTION 'CONTRACT: overdue weekly pass did not retain full recovery';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid()
    AND mode='ExclusiveLock' AND objid=hashtext('style-group-change-clock-2421')::oid) THEN
    RAISE EXCEPTION 'CONTRACT: enqueue/reconcile leaked its exclusive session lock';
  END IF;
  EXECUTE original_def;
END;
$state$;

ROLLBACK;
