-- Restore PopSG visibility after an empty/inaccessible crawl marked every
-- style guide file inactive. This is intentionally guarded so it only runs
-- when the public PopSG library is completely empty.
DO $$
DECLARE
  v_active_count integer;
  v_inactive_count integer;
  v_reactivated_count integer := 0;
BEGIN
  SELECT count(*) INTO v_active_count
  FROM public.style_guide_files
  WHERE is_active = true;

  SELECT count(*) INTO v_inactive_count
  FROM public.style_guide_files
  WHERE is_active = false;

  IF v_active_count = 0 AND v_inactive_count > 0 THEN
    UPDATE public.style_guide_files
    SET is_active = true,
        last_seen_at = greatest(last_seen_at, now())
    WHERE is_active = false;

    GET DIAGNOSTICS v_reactivated_count = ROW_COUNT;

    INSERT INTO public.admin_config (key, value, updated_at)
    VALUES (
      'STYLE_GUIDE_CRAWL_REQUEST',
      jsonb_build_object(
        'status', 'completed',
        'completed_at', now()::text,
        'files_found', v_reactivated_count,
        'repaired_at', now()::text,
        'repair', 'reactivated style_guide_files after empty PopSG crawl'
      ),
      now()
    )
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_at = EXCLUDED.updated_at;

    RAISE NOTICE 'Reactivated % PopSG style guide files after empty crawl', v_reactivated_count;
  ELSE
    RAISE NOTICE 'PopSG repair skipped: active %, inactive %', v_active_count, v_inactive_count;
  END IF;
END $$;
