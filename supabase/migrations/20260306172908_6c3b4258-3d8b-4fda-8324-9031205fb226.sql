
-- Atomic BULK_OPERATIONS updater with advisory locking.
-- Prevents read-modify-write race conditions between bulk-job-runner and UI.

CREATE OR REPLACE FUNCTION public.update_bulk_operation(
  p_op_key text,
  p_op_state jsonb,
  p_only_if_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current jsonb;
  v_existing_status text;
BEGIN
  -- Serialize all writers on the BULK_OPERATIONS config key
  PERFORM pg_advisory_xact_lock(hashtext('BULK_OPERATIONS'));

  -- Read current value
  SELECT value INTO v_current
  FROM admin_config
  WHERE key = 'BULK_OPERATIONS';

  v_current := COALESCE(v_current, '{}'::jsonb);

  -- Conditional update: only proceed if current status matches expected
  IF p_only_if_status IS NOT NULL THEN
    v_existing_status := v_current->p_op_key->>'status';
    IF v_existing_status IS DISTINCT FROM p_only_if_status THEN
      -- Return current state unchanged (caller can detect no-op)
      RETURN v_current;
    END IF;
  END IF;

  -- Atomically set the single operation key
  v_current := jsonb_set(v_current, ARRAY[p_op_key], p_op_state);

  -- Upsert into admin_config
  INSERT INTO admin_config (key, value, updated_at)
  VALUES ('BULK_OPERATIONS', v_current, now())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at;

  RETURN v_current;
END;
$$;

-- Batch variant: atomically merge multiple operation keys at once.
-- Used by bulk-job-runner for final writes that may include auto-queued ops.

CREATE OR REPLACE FUNCTION public.update_bulk_operations_batch(
  p_updates jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current jsonb;
  v_key text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('BULK_OPERATIONS'));

  SELECT value INTO v_current
  FROM admin_config
  WHERE key = 'BULK_OPERATIONS';

  v_current := COALESCE(v_current, '{}'::jsonb);

  -- Merge each key from p_updates into the current state
  FOR v_key IN SELECT jsonb_object_keys(p_updates) LOOP
    v_current := jsonb_set(v_current, ARRAY[v_key], p_updates->v_key);
  END LOOP;

  INSERT INTO admin_config (key, value, updated_at)
  VALUES ('BULK_OPERATIONS', v_current, now())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at;

  RETURN v_current;
END;
$$;
