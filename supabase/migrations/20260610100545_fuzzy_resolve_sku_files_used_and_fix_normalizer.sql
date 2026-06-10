-- 1. Fix normalize_for_sg_match: it stripped [^a-z0-9] BEFORE lower(), which DELETED all
--    uppercase letters (e.g. "2994221_BG101" -> "2994221101") instead of lowercasing them,
--    so any case difference broke exact resolution. Lowercase first.
CREATE OR REPLACE FUNCTION public.normalize_for_sg_match(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT regexp_replace(lower(regexp_replace(p, '\.[^.]+$', '')), '[^a-z0-9]', '', 'g')
$function$;

-- 2. Resolution tracking on sku_files_used so re-resolution is incremental + reviewable.
ALTER TABLE public.sku_files_used
  ADD COLUMN IF NOT EXISTS match_best_score      real,
  ADD COLUMN IF NOT EXISTS match_attempts        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_match_attempt_at timestamptz;

COMMENT ON COLUMN public.sku_files_used.match_best_score IS
  'Best trigram similarity (0-1) found vs an active style_guide_files filename on the last '
  'resolution attempt. >=0.6 auto-links; 0.3-0.6 is a pending suggestion for human review.';

-- 3. Fuzzy/continuous resolver. NOTE: this initial version did an unindexed exact
--    normalize_for_sg_match(filename) scan per row and timed out on the 214k-row library;
--    superseded by 20260610100856 (trigram-only). Kept here as the as-applied record.
CREATE OR REPLACE FUNCTION public.resolve_sku_files_used_fuzzy(p_threshold real DEFAULT 0.6)
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
  r       record;
  v_id    uuid;
  v_score real;
  v_norm  text;
  v_linked int := 0;
BEGIN
  FOR r IN
    SELECT id, file_name FROM sku_files_used WHERE style_guide_file_id IS NULL
  LOOP
    v_id := NULL; v_score := NULL;
    v_norm := normalize_for_sg_match(r.file_name);

    IF v_norm <> '' THEN
      SELECT f.id INTO v_id
      FROM style_guide_files f
      WHERE f.is_active AND normalize_for_sg_match(f.filename) = v_norm
      ORDER BY f.modified_at DESC NULLS LAST
      LIMIT 1;
      IF v_id IS NOT NULL THEN v_score := 1.0; END IF;
    END IF;

    IF v_id IS NULL THEN
      SELECT f.id, similarity(lower(f.filename), lower(r.file_name))
        INTO v_id, v_score
      FROM style_guide_files f
      WHERE f.is_active AND lower(f.filename) % lower(r.file_name)
      ORDER BY similarity(lower(f.filename), lower(r.file_name)) DESC
      LIMIT 1;
      IF v_score IS NULL OR v_score < p_threshold THEN
        v_id := NULL;
      END IF;
    END IF;

    UPDATE sku_files_used
       SET style_guide_file_id  = COALESCE(v_id, style_guide_file_id),
           match_best_score      = GREATEST(COALESCE(match_best_score, 0), COALESCE(v_score, 0)),
           match_attempts        = match_attempts + 1,
           last_match_attempt_at = now()
     WHERE id = r.id;

    IF v_id IS NOT NULL THEN v_linked := v_linked + 1; END IF;
  END LOOP;
  RETURN v_linked;
END;
$function$;

-- 4. Run it nightly, after the 02:00 UTC crawl has completed, so restored/added PopSG assets
--    get linked automatically as the library heals.
SELECT cron.schedule('resolve-sku-files-used-nightly', '0 4 * * *',
                     $$SELECT public.resolve_sku_files_used_fuzzy(0.6)$$);
