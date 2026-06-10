-- Schedule nightly Rebuild Style Groups at 1am EST / 2am EDT (06:00 UTC).
-- pg_cron does not support per-job timezone; UTC-5 (EST) is used as base.
-- 1-hour drift in summer (EDT) is acceptable for a maintenance job.

CREATE OR REPLACE FUNCTION public.queue_nightly_rebuild_style_groups()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current jsonb;
  v_status  text;
  v_now     timestamptz := now();
  v_state   jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('BULK_OPERATIONS'));

  SELECT value INTO v_current
  FROM admin_config
  WHERE key = 'BULK_OPERATIONS';

  v_current := COALESCE(v_current, '{}'::jsonb);
  v_status  := v_current->'rebuild-style-groups'->>'status';

  -- Skip if already running or queued
  IF v_status IN ('running', 'queued') THEN
    RETURN;
  END IF;

  v_state := jsonb_build_object(
    'status',         'queued',
    'cursor',         0,
    'params',         jsonb_build_object('force_restart', true),
    'started_at',     v_now::text,
    'updated_at',     v_now::text,
    'progress',       '{}'::jsonb,
    'run_id',         gen_random_uuid()::text,
    'queue_position', (EXTRACT(EPOCH FROM v_now) * 1000)::bigint,
    'requested_by',   'pg_cron'
  );

  v_current := jsonb_set(v_current, ARRAY['rebuild-style-groups'], v_state);

  INSERT INTO admin_config (key, value, updated_at)
  VALUES ('BULK_OPERATIONS', v_current, v_now)
  ON CONFLICT (key) DO UPDATE
    SET value      = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at;
END;
$$;

SELECT cron.schedule(
  'nightly-rebuild-style-groups',
  '0 6 * * *',
  $$ SELECT public.queue_nightly_rebuild_style_groups(); $$
);
