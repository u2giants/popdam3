-- derived-from: 20260925061508, 20260909005945
-- #2421. Add processing clocks; preserve original file dates and both recovery routines.
-- Reliable cutoff: writers hold a shared transaction lock until commit. The queue
-- waits exclusively before capturing its cutoff. Later writers stamp later than it.
-- The exclusive session lock is balanced on normal paths and all exception classes,
-- and is released before the existing counts scan. No session bypass suppresses clocks.
-- Cutoff remains the START of a completed run, so mutations made after its cursor
-- passes are always reconsidered next time. Seven days is a load-bearing full pass.
-- Rollback: a forward migration restoring the prior queue; keep additive clocks and
-- the unchanged two-argument rebuild/clear functions for explicit recovery.
ALTER TABLE public.assets ADD COLUMN style_group_changed_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.style_groups ADD COLUMN style_group_changed_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX assets_style_group_changed_at_idx ON public.assets (style_group_changed_at, id) WHERE is_deleted = false;
CREATE INDEX assets_ungrouped_style_cursor_idx ON public.assets (id) WHERE is_deleted = false AND style_group_id IS NULL;
CREATE INDEX style_groups_style_group_changed_at_idx ON public.style_groups (style_group_changed_at, id);
CREATE OR REPLACE FUNCTION public.stamp_style_group_asset_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $clock$
BEGIN
  IF TG_OP = 'INSERT' OR ROW(NEW.relative_path, NEW.filename, NEW.file_type, NEW.is_licensed, NEW.licensor_id, NEW.licensor_code, NEW.licensor_name, NEW.property_id, NEW.property_code, NEW.property_name, NEW.product_category, NEW.division_code, NEW.division_name, NEW.mg01_code, NEW.mg01_name, NEW.mg02_code, NEW.mg02_name, NEW.mg03_code, NEW.mg03_name, NEW.size_code, NEW.size_name, NEW.style_group_id, NEW.is_deleted) IS DISTINCT FROM ROW(OLD.relative_path, OLD.filename, OLD.file_type, OLD.is_licensed, OLD.licensor_id, OLD.licensor_code, OLD.licensor_name, OLD.property_id, OLD.property_code, OLD.property_name, OLD.product_category, OLD.division_code, OLD.division_name, OLD.mg01_code, OLD.mg01_name, OLD.mg02_code, OLD.mg02_name, OLD.mg03_code, OLD.mg03_name, OLD.size_code, OLD.size_name, OLD.style_group_id, OLD.is_deleted) THEN
    PERFORM pg_advisory_xact_lock_shared(hashtext('style-group-change-clock-2421'));
    NEW.style_group_changed_at := clock_timestamp();
  ELSE
    -- Never let a caller silently replace the processing clock.
    NEW.style_group_changed_at := OLD.style_group_changed_at;
  END IF;
  RETURN NEW;
END;
$clock$;
REVOKE ALL ON FUNCTION public.stamp_style_group_asset_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER assets_style_group_change_clock BEFORE INSERT OR UPDATE ON public.assets
FOR EACH ROW EXECUTE FUNCTION public.stamp_style_group_asset_change();
CREATE OR REPLACE FUNCTION public.stamp_style_group_definition_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $clock$
BEGIN
  IF TG_OP = 'INSERT' OR ROW(NEW.sku, NEW.folder_path, NEW.is_licensed, NEW.licensor_id, NEW.licensor_code, NEW.licensor_name, NEW.property_id, NEW.property_code, NEW.property_name, NEW.product_category, NEW.division_code, NEW.division_name, NEW.mg01_code, NEW.mg01_name, NEW.mg02_code, NEW.mg02_name, NEW.mg03_code, NEW.mg03_name, NEW.size_code, NEW.size_name) IS DISTINCT FROM ROW(OLD.sku, OLD.folder_path, OLD.is_licensed, OLD.licensor_id, OLD.licensor_code, OLD.licensor_name, OLD.property_id, OLD.property_code, OLD.property_name, OLD.product_category, OLD.division_code, OLD.division_name, OLD.mg01_code, OLD.mg01_name, OLD.mg02_code, OLD.mg02_name, OLD.mg03_code, OLD.mg03_name, OLD.size_code, OLD.size_name) OR NEW.style_group_changed_at IS DISTINCT FROM OLD.style_group_changed_at THEN
    PERFORM pg_advisory_xact_lock_shared(hashtext('style-group-change-clock-2421'));
    NEW.style_group_changed_at := clock_timestamp();
  ELSE
    -- Never let a caller silently replace the processing clock.
    NEW.style_group_changed_at := OLD.style_group_changed_at;
  END IF;
  RETURN NEW;
END;
$clock$;
REVOKE ALL ON FUNCTION public.stamp_style_group_definition_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER style_groups_style_group_change_clock BEFORE INSERT OR UPDATE ON public.style_groups
FOR EACH ROW EXECUTE FUNCTION public.stamp_style_group_definition_change();
CREATE OR REPLACE FUNCTION public.touch_style_group_tag_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $tag$
BEGIN
  PERFORM pg_advisory_xact_lock_shared(hashtext('style-group-change-clock-2421'));
  -- Existing effective-tag triggers retain projection authority. This timestamp
  -- only includes their changed group in the next differential membership pass.
  UPDATE public.style_groups SET style_group_changed_at = clock_timestamp()
  WHERE id IN (CASE WHEN TG_OP <> 'INSERT' THEN OLD.style_group_id END,
               CASE WHEN TG_OP <> 'DELETE' THEN NEW.style_group_id END);
  RETURN NULL;
END;
$tag$;
REVOKE ALL ON FUNCTION public.touch_style_group_tag_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER style_group_tags_change_clock AFTER INSERT OR UPDATE OR DELETE ON public.style_group_tags
FOR EACH ROW EXECUTE FUNCTION public.touch_style_group_tag_change();

CREATE OR REPLACE FUNCTION public.rebuild_style_groups_batch(
  p_last_asset_id uuid,
  p_batch_size int,
  p_changed_since timestamptz
)
RETURNS TABLE(
  next_cursor uuid,
  groups_created int,
  assets_assigned int,
  assets_ungrouped int,
  done boolean,
  rows_examined int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
SET lock_timeout = '0'
AS $$
DECLARE
  v_last_id uuid;
  v_groups_created int := 0;
  v_assets_assigned int := 0;
  v_ungrouped int := 0;
  v_done boolean;
  v_examined int := 0;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size <= 0 THEN
    RAISE EXCEPTION 'a positive bounded batch size is required' USING ERRCODE = '22023';
  END IF;
  WITH changed_groups AS MATERIALIZED (
    SELECT id FROM public.style_groups
    WHERE p_changed_since IS NOT NULL AND style_group_changed_at > p_changed_since
  ), candidate_ids AS (
    -- The full arm uses the existing UUID primary key with an active filter.
    -- The changed-clock index filters changed rows; UUID ordering may sort that
    -- changed set. Changed-group cardinality is not capped by the output limit:
    -- mass edits can require many lateral probes and hit statement_timeout.
    -- The weekly full arm remains the convergence path after such a failed run.
    -- Each indexed arm contributes at most a batch; the global union deduplicates
    -- overlap before selecting the first batch in UUID order. No arm skips a
    -- candidate below the global cursor, even when membership overlaps clocks.
    SELECT id FROM (
      (SELECT a.id FROM public.assets a
       WHERE p_changed_since IS NULL AND a.is_deleted = false
         AND (p_last_asset_id IS NULL OR a.id > p_last_asset_id)
       ORDER BY a.id LIMIT p_batch_size)
      UNION
      (SELECT a.id FROM public.assets a
       WHERE p_changed_since IS NOT NULL AND a.is_deleted = false
         AND a.style_group_id IS NULL
         AND (p_last_asset_id IS NULL OR a.id > p_last_asset_id)
       ORDER BY a.id LIMIT p_batch_size)
      UNION
      (SELECT a.id FROM public.assets a
       WHERE p_changed_since IS NOT NULL AND a.is_deleted = false
         AND a.style_group_changed_at > p_changed_since
         AND (p_last_asset_id IS NULL OR a.id > p_last_asset_id)
       ORDER BY a.id LIMIT p_batch_size)
      UNION
      (SELECT member.id FROM changed_groups sg
       CROSS JOIN LATERAL (
         SELECT a.id FROM public.assets a
         WHERE a.style_group_id = sg.id AND a.is_deleted = false
           AND (p_last_asset_id IS NULL OR a.id > p_last_asset_id)
         ORDER BY a.id LIMIT p_batch_size
       ) member
       ORDER BY member.id LIMIT p_batch_size)
    ) candidates ORDER BY id LIMIT p_batch_size
  ),
  asset_batch AS (
    SELECT a.id, a.relative_path, a.filename, a.file_type,
           a.is_licensed, a.licensor_id, a.licensor_code, a.licensor_name,
           a.property_id, a.property_code, a.property_name,
           a.product_category, a.division_code, a.division_name,
           a.mg01_code, a.mg01_name, a.mg02_code, a.mg02_name,
           a.mg03_code, a.mg03_name, a.size_code, a.size_name
    FROM candidate_ids selected
    CROSS JOIN LATERAL (SELECT a.* FROM public.assets a WHERE a.id = selected.id LIMIT 1) a
  ),
  asset_skus AS (
    SELECT ab.*,
      public.style_group_key_for_sku(ab.relative_path) AS sku
    FROM asset_batch ab
  ),
  batch_stats AS (
    SELECT count(*)::int AS total_fetched,
           (SELECT s.id FROM asset_skus s ORDER BY s.id DESC LIMIT 1) AS last_id
    FROM asset_skus
  ),
  grouped_assets AS (
    SELECT * FROM asset_skus WHERE sku IS NOT NULL
  ),
  -- Issue #2408 change 2: the complementary half of the batch. These are the assets
  -- whose path no longer yields a SKU; if one still carries a style group, that group
  -- is stale and is resolving the wrong licensor for it in the DAM libraries.
  ungroupable_assets AS (
    SELECT id FROM asset_skus WHERE sku IS NULL
  ),
  sku_representatives AS (
    SELECT DISTINCT ON (sku)
      sku,
      relative_path, is_licensed, licensor_id, licensor_code, licensor_name,
      property_id, property_code, property_name, product_category,
      division_code, division_name, mg01_code, mg01_name,
      mg02_code, mg02_name, mg03_code, mg03_name, size_code, size_name
    FROM grouped_assets
    ORDER BY sku, id
  ),
  sku_with_folder AS (
    SELECT sr.*,
      (
        SELECT string_agg(seg, '/' ORDER BY ord)
        FROM unnest(string_to_array(sr.relative_path, '/')) WITH ORDINALITY AS t(seg, ord)
        WHERE ord <= (
          SELECT min(t2.ord)
          FROM unnest(string_to_array(sr.relative_path, '/')) WITH ORDINALITY AS t2(seg, ord)
          WHERE t2.seg = sr.sku
        )
      ) AS folder_path
    FROM sku_representatives sr
  ),
  upserted_groups AS (
    INSERT INTO public.style_groups (
      sku, folder_path, is_licensed, licensor_id, licensor_code, licensor_name,
      property_id, property_code, property_name, product_category,
      division_code, division_name, mg01_code, mg01_name,
      mg02_code, mg02_name, mg03_code, mg03_name, size_code, size_name
    )
    SELECT
      sku, COALESCE(folder_path, sku), COALESCE(is_licensed, false), licensor_id, licensor_code, licensor_name,
      property_id, property_code, property_name, product_category,
      division_code, division_name, mg01_code, mg01_name,
      mg02_code, mg02_name, mg03_code, mg03_name, size_code, size_name
    FROM sku_with_folder
    ON CONFLICT (sku) DO UPDATE SET
      folder_path = COALESCE(EXCLUDED.folder_path, style_groups.folder_path),
      is_licensed = COALESCE(EXCLUDED.is_licensed, style_groups.is_licensed),
      licensor_id = COALESCE(EXCLUDED.licensor_id, style_groups.licensor_id),
      licensor_code = COALESCE(EXCLUDED.licensor_code, style_groups.licensor_code),
      licensor_name = COALESCE(EXCLUDED.licensor_name, style_groups.licensor_name),
      property_id = COALESCE(EXCLUDED.property_id, style_groups.property_id),
      property_code = COALESCE(EXCLUDED.property_code, style_groups.property_code),
      property_name = COALESCE(EXCLUDED.property_name, style_groups.property_name),
      product_category = COALESCE(EXCLUDED.product_category, style_groups.product_category),
      division_code = COALESCE(EXCLUDED.division_code, style_groups.division_code),
      division_name = COALESCE(EXCLUDED.division_name, style_groups.division_name),
      mg01_code = COALESCE(EXCLUDED.mg01_code, style_groups.mg01_code),
      mg01_name = COALESCE(EXCLUDED.mg01_name, style_groups.mg01_name),
      mg02_code = COALESCE(EXCLUDED.mg02_code, style_groups.mg02_code),
      mg02_name = COALESCE(EXCLUDED.mg02_name, style_groups.mg02_name),
      mg03_code = COALESCE(EXCLUDED.mg03_code, style_groups.mg03_code),
      mg03_name = COALESCE(EXCLUDED.mg03_name, style_groups.mg03_name),
      size_code = COALESCE(EXCLUDED.size_code, style_groups.size_code),
      size_name = COALESCE(EXCLUDED.size_name, style_groups.size_name),
      updated_at = now()
    -- Issue #2408 change 3: write the group only when the SET list would actually
    -- change one of its values. Derived mechanically from the SET list above, one
    -- clause per assigned column, in the same order. `updated_at` is intentionally
    -- absent - see the header.
    WHERE (
         style_groups.folder_path      IS DISTINCT FROM COALESCE(EXCLUDED.folder_path, style_groups.folder_path)
      OR style_groups.is_licensed      IS DISTINCT FROM COALESCE(EXCLUDED.is_licensed, style_groups.is_licensed)
      OR style_groups.licensor_id      IS DISTINCT FROM COALESCE(EXCLUDED.licensor_id, style_groups.licensor_id)
      OR style_groups.licensor_code    IS DISTINCT FROM COALESCE(EXCLUDED.licensor_code, style_groups.licensor_code)
      OR style_groups.licensor_name    IS DISTINCT FROM COALESCE(EXCLUDED.licensor_name, style_groups.licensor_name)
      OR style_groups.property_id      IS DISTINCT FROM COALESCE(EXCLUDED.property_id, style_groups.property_id)
      OR style_groups.property_code    IS DISTINCT FROM COALESCE(EXCLUDED.property_code, style_groups.property_code)
      OR style_groups.property_name    IS DISTINCT FROM COALESCE(EXCLUDED.property_name, style_groups.property_name)
      OR style_groups.product_category IS DISTINCT FROM COALESCE(EXCLUDED.product_category, style_groups.product_category)
      OR style_groups.division_code    IS DISTINCT FROM COALESCE(EXCLUDED.division_code, style_groups.division_code)
      OR style_groups.division_name    IS DISTINCT FROM COALESCE(EXCLUDED.division_name, style_groups.division_name)
      OR style_groups.mg01_code        IS DISTINCT FROM COALESCE(EXCLUDED.mg01_code, style_groups.mg01_code)
      OR style_groups.mg01_name        IS DISTINCT FROM COALESCE(EXCLUDED.mg01_name, style_groups.mg01_name)
      OR style_groups.mg02_code        IS DISTINCT FROM COALESCE(EXCLUDED.mg02_code, style_groups.mg02_code)
      OR style_groups.mg02_name        IS DISTINCT FROM COALESCE(EXCLUDED.mg02_name, style_groups.mg02_name)
      OR style_groups.mg03_code        IS DISTINCT FROM COALESCE(EXCLUDED.mg03_code, style_groups.mg03_code)
      OR style_groups.mg03_name        IS DISTINCT FROM COALESCE(EXCLUDED.mg03_name, style_groups.mg03_name)
      OR style_groups.size_code        IS DISTINCT FROM COALESCE(EXCLUDED.size_code, style_groups.size_code)
      OR style_groups.size_name        IS DISTINCT FROM COALESCE(EXCLUDED.size_name, style_groups.size_name)
    )
    RETURNING id, sku
  ),
  -- Issue #2408: the assignment target set. `upserted_groups` alone is NO LONGER a
  -- complete list of this batch's groups, because the WHERE guard above suppresses the
  -- RETURNING row for every group that did not need writing. Reading style_groups alone
  -- is not complete either: this statement's own INSERTs are invisible to a sibling
  -- CTE's snapshot. The UNION of the two is complete and duplicate-free - see header.
  batch_groups AS (
    SELECT ug.id, ug.sku FROM upserted_groups ug
    UNION
    SELECT sg.id, sg.sku
    FROM public.style_groups sg
    JOIN sku_with_folder swf ON swf.sku = sg.sku
  ),
  assigned AS (
    UPDATE public.assets a
    SET style_group_id = bg.id
    FROM grouped_assets ga
    JOIN batch_groups bg ON bg.sku = ga.sku
    WHERE a.id = ga.id
      -- Issue #2408 change 1: never re-stamp an asset that already holds this group.
      -- IS DISTINCT FROM, not `<>`: style_group_id is nullable and `<>` would return
      -- NULL for the NULL-to-value transition, silently skipping every new assignment.
      AND a.style_group_id IS DISTINCT FROM bg.id
    RETURNING 1
  ),
  -- Issue #2408 change 2: the ungroup arm. Disjoint from `assigned` by construction
  -- (sku IS NULL vs sku IS NOT NULL over the same asset_skus rows). The
  -- `style_group_id IS NOT NULL` guard keeps the ~37,593 legitimately ungrouped assets
  -- from being rewritten every night.
  ungrouped_assets AS (
    UPDATE public.assets a
    SET style_group_id = NULL
    FROM ungroupable_assets ua
    WHERE a.id = ua.id
      AND a.style_group_id IS NOT NULL
    RETURNING 1
  )
  SELECT
    (SELECT bs.last_id FROM batch_stats bs),
    (SELECT count(*)::int FROM upserted_groups),
    (SELECT count(*)::int FROM assigned),
    (SELECT count(*)::int FROM ungrouped_assets),
    (SELECT bs.total_fetched FROM batch_stats bs) < p_batch_size,
    (SELECT bs.total_fetched FROM batch_stats bs)
  INTO v_last_id, v_groups_created, v_assets_assigned, v_ungrouped, v_done, v_examined;

  -- rows_examined is selected candidate cardinality, summed across batches by
  -- the worker. It is not physical index/heap I/O; measure that with EXPLAIN.
  RETURN QUERY SELECT v_last_id, v_groups_created, v_assets_assigned, v_ungrouped, COALESCE(v_done, true), v_examined;
END;
$$;
REVOKE ALL ON FUNCTION public.rebuild_style_groups_batch(uuid, integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rebuild_style_groups_batch(uuid, integer, timestamptz) TO service_role, postgres;

create or replace function public.queue_nightly_rebuild_style_groups()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  -- The BULK_OPERATIONS key the PopDAM worker owns. This function never invents its
  -- shape; it writes exactly the enqueue state the baseline body wrote.
  c_op            constant text := 'rebuild-style-groups';

  -- This function's own key, which no other writer touches. See the header.
  c_marker        constant text := 'style-group-counts-reconcile';
  c_watermark     constant text := 'style-group-change-watermark';

  -- 06:00 UTC, the hour the retired `0 6 * * *` schedule fired.
  c_enqueue_hour  constant integer := 6;

  -- The floor. Requirement 3 on #2440: bound the silence this change introduces.
  c_floor_days    constant integer := 7;

  -- Chunk size for the reconcile. Requirement 4.
  c_chunk         constant integer := 500;

  v_current         jsonb;
  v_op              jsonb;
  v_marker          jsonb;
  v_status          text;
  v_run_id          text;
  v_last_enqueued   timestamptz;
  v_last_reconciled timestamptz;
  v_last_run        text;
  v_op_seen_at      timestamptz;
  v_in_flight       boolean;
  v_reason          text;
  v_now             timestamptz := now();
  v_state           jsonb;
  v_chunk_ids       uuid[];
  v_offset          integer := 0;
  v_written         integer := 0;
  v_watermark       jsonb;
  v_cutoff          timestamptz;
  v_since           timestamptz;
  v_full            boolean;
  v_change_locked   boolean := false;
begin
  -- Serialize every BULK_OPERATIONS writer, exactly as the baseline body did. This is
  -- also what makes the run_id marker safe against two overlapping poll invocations.
  -- Acquire before BULK_OPERATIONS: never invert a writer which first stamps
  -- its change and then updates operation state in the same transaction.
  SELECT true INTO v_change_locked
  FROM pg_advisory_lock(hashtext('style-group-change-clock-2421'));
  perform pg_advisory_xact_lock(hashtext('BULK_OPERATIONS'));
  v_cutoff := clock_timestamp();

  select value into v_current
  from admin_config
  where key = 'BULK_OPERATIONS';

  v_current := coalesce(v_current, '{}'::jsonb);
  v_watermark := coalesce(v_current -> c_watermark, '{}'::jsonb);

  v_op := case when jsonb_typeof(v_current -> c_op) = 'object'
               then v_current -> c_op end;
  v_marker := case when jsonb_typeof(v_current -> c_marker) = 'object'
                   then v_current -> c_marker
                   else '{}'::jsonb end;

  v_status          := v_op ->> 'status';
  v_run_id          := nullif(btrim(coalesce(v_op ->> 'run_id', '')), '');
  v_last_enqueued   := nullif(btrim(coalesce(v_marker ->> 'last_enqueued_at', '')), '')::timestamptz;
  v_last_reconciled := nullif(btrim(coalesce(v_marker ->> 'last_reconciled_at', '')), '')::timestamptz;
  v_last_run        := nullif(btrim(coalesce(v_marker ->> 'last_reconciled_run_id', '')), '');

  -- Only a matching successful worker run acknowledges the captured cutoff.
  -- Failed/interrupted/partial/manual runs never advance it. Older workers may
  -- still do a full walk, which is a safe superset during staged application rollout.
  if v_status = 'completed'
     and v_run_id = v_watermark ->> 'pending_run_id'
     and v_op -> 'params' ->> 'watermark_protocol' = '1'
     and (v_op -> 'params' ->> 'changed_cutoff')::timestamptz
         = (v_watermark ->> 'pending_cutoff')::timestamptz
     and v_run_id is distinct from v_watermark ->> 'last_successful_run_id'
  then
    v_watermark := v_watermark || jsonb_build_object(
      'last_successful_cutoff', v_watermark ->> 'pending_cutoff',
      'last_successful_run_id', v_run_id,
      'last_full_cutoff', case when v_watermark ->> 'pending_mode' = 'full'
        then v_watermark ->> 'pending_cutoff' else v_watermark ->> 'last_full_cutoff' end);
  end if;

  -- The last moment anything claimed this operation was alive. The worker stamps
  -- 'updated_at' on every progress write and 'started_at' on the enqueue; if the object
  -- carries neither, ARM 1's own 'last_enqueued_at' is the fallback.
  v_op_seen_at := coalesce(
    nullif(btrim(coalesce(v_op ->> 'updated_at', '')), '')::timestamptz,
    nullif(btrim(coalesce(v_op ->> 'started_at', '')), '')::timestamptz,
    v_last_enqueued
  );

  -- A rebuild is IN FLIGHT only if it says 'running'/'queued' AND something has touched it
  -- inside the floor window. An operation stuck at 'queued' for longer than the floor is a
  -- dead worker, not a running rebuild, and must not suppress ARM 3 forever. See
  -- "WHY THE FLOOR IS GATED ON THE REBUILD NOT BEING IN FLIGHT".
  v_in_flight := coalesce(v_status, '') in ('running', 'queued')
                 and v_op_seen_at is not null
                 and v_op_seen_at >= v_now - make_interval(days => c_floor_days);

  -- ======================================================================
  -- ARM 2 - CHAINED RECONCILE, evaluated FIRST. An unreconciled completed run must be
  -- reconciled before ARM 1 is allowed to overwrite the operation object with a fresh
  -- 'queued' state and a new run_id. See "WHY ARM 2 IS EVALUATED FIRST".
  -- ======================================================================
  if v_status = 'completed'
     and v_run_id is not null
     and v_run_id is distinct from v_last_run
  then
    v_reason := 'rebuild_completed';
  end if;

  -- ======================================================================
  -- ARM 1 - ENQUEUE. The retired `0 6 * * *` behaviour, expressed as state.
  -- ======================================================================
  if v_reason is null
     and coalesce(v_status, '') not in ('running', 'queued')
     and extract(hour from (v_now at time zone 'UTC')) >= c_enqueue_hour
     and (
       v_last_enqueued is null
       or (v_last_enqueued at time zone 'UTC')::date < (v_now at time zone 'UTC')::date
     )
  then
    -- First run and every successful seven-day interval retain full convergence.
    v_full := v_watermark ->> 'last_full_cutoff' is null
      or (v_watermark ->> 'last_full_cutoff')::timestamptz <= v_cutoff - interval '7 days';
    v_since := case when v_full then null
      else (v_watermark ->> 'last_successful_cutoff')::timestamptz end;
    v_state := jsonb_build_object(
      'status',         'queued',
      'cursor',         0,
      'params',         jsonb_build_object('force_restart', true,
        'watermark_protocol', 1, 'changed_since', v_since,
        'changed_cutoff', v_cutoff, 'rebuild_mode', case when v_full then 'full' else 'incremental' end),
      'started_at',     v_now::text,
      'updated_at',     v_now::text,
      'progress',       '{}'::jsonb,
      'run_id',         gen_random_uuid()::text,
      'queue_position', (extract(epoch from v_now) * 1000)::bigint,
      'requested_by',   'pg_cron'
    );

    v_watermark := v_watermark || jsonb_build_object(
      'pending_run_id', v_state ->> 'run_id', 'pending_cutoff', v_cutoff,
      'pending_mode', case when v_full then 'full' else 'incremental' end);
    v_current := jsonb_set(v_current, array[c_watermark], v_watermark, true);
    v_current := jsonb_set(v_current, array[c_op], v_state, true);
    v_current := jsonb_set(
      v_current,
      array[c_marker],
      v_marker || jsonb_build_object('last_enqueued_at', v_now::text),
      true
    );

    insert into admin_config (key, value, updated_at)
    values ('BULK_OPERATIONS', v_current, v_now)
    on conflict (key) do update
      set value      = excluded.value,
          updated_at = excluded.updated_at;

    -- A run has just been queued; there is nothing to reconcile on this pass.
    perform pg_advisory_unlock(hashtext('style-group-change-clock-2421'));
    v_change_locked := false;
    return;
  end if;

  -- The counts-only work retains its old BULK lock but never holds this new
  -- exclusive change-clock lock during its potentially long scan.
  perform pg_advisory_unlock(hashtext('style-group-change-clock-2421'));
  v_change_locked := false;

  -- ======================================================================
  -- ARM 3 - THE FLOOR. Never while the rebuild is in flight: the ~98s recompute is
  -- justified only against membership the rebuild has finished changing, and running it
  -- mid-rebuild is the HIGH finding documented in the header above.
  -- ======================================================================
  if v_reason is null
     and not v_in_flight
     and (
       v_last_reconciled is null
       or v_last_reconciled < v_now - make_interval(days => c_floor_days)
     )
  then
    v_reason := 'floor';
  end if;

  if v_reason is null then
    return;
  end if;

  -- Requirement 4: ordered chunks, never one array of every group. Ordering by the
  -- primary key over a single transaction snapshot makes the OFFSET walk stable, and
  -- each call gets its own statement_timeout window.
  loop
    select array_agg(s.id)
      into v_chunk_ids
    from (
      select sg.id
      from public.style_groups sg
      order by sg.id
      offset v_offset
      limit c_chunk
    ) s;

    exit when v_chunk_ids is null;

    v_written := v_written + coalesce(public.refresh_style_group_counts_batch(v_chunk_ids), 0);
    v_offset  := v_offset + c_chunk;
  end loop;

  -- Re-read under the same advisory lock before stamping. The reconcile above can run for
  -- minutes; writing back the object read before it would discard any concurrent change
  -- made by a writer that does not take this lock.
  select value into v_current
  from admin_config
  where key = 'BULK_OPERATIONS';

  v_current := coalesce(v_current, '{}'::jsonb);
  v_marker := case when jsonb_typeof(v_current -> c_marker) = 'object'
                   then v_current -> c_marker
                   else '{}'::jsonb end;

  v_current := jsonb_set(
    v_current,
    array[c_marker],
    v_marker || jsonb_build_object(
      'last_reconciled_at',            v_now::text,
      -- On a floor pass there is no completed run to attribute, so the previously
      -- reconciled run_id is carried forward unchanged. Overwriting it with the current
      -- (failed or interrupted) run would make ARM 2 skip that run once it finally
      -- succeeds.
      'last_reconciled_run_id',        case when v_reason = 'rebuild_completed'
                                            then to_jsonb(v_run_id)
                                            else coalesce(to_jsonb(v_last_run), 'null'::jsonb) end,
      'last_reconcile_reason',         v_reason,
      'last_reconcile_rows_written',   v_written,
      'last_reconcile_trigger_status', coalesce(v_status, 'unknown')
    ),
    true
  );

  -- Other callers of this queue serialize through the transaction-scoped BULK
  -- lock, which remains held during counts. Preserve a new pending run even if
  -- an external state writer does not use that lock.
  if v_current -> c_watermark ->> 'pending_run_id'
       is not distinct from v_watermark ->> 'pending_run_id' then
    v_current := jsonb_set(v_current, array[c_watermark], v_watermark, true);
  end if;
  insert into admin_config (key, value, updated_at)
  values ('BULK_OPERATIONS', v_current, now())
  on conflict (key) do update
    set value      = excluded.value,
        updated_at = excluded.updated_at;
exception
  when query_canceled or assert_failure or others then
    if v_change_locked then
      perform pg_advisory_unlock(hashtext('style-group-change-clock-2421'));
    end if;
    raise;
end;
$function$;
