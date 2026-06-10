-- Perf fix: the prior version (20260610100545) did an exact normalize_for_sg_match(filename) scan
-- per row, which is unindexed over the 214k-row library -> statement timeout. Use ONLY the trigram
-- fuzzy match (gin index on lower(filename)); lower() handles case-insensitive exact matches
-- (similarity 1.0) anyway.
CREATE OR REPLACE FUNCTION public.resolve_sku_files_used_fuzzy(p_threshold real DEFAULT 0.6)
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
  r        record;
  v_id     uuid;
  v_score  real;
  v_linked int := 0;
BEGIN
  FOR r IN
    SELECT id, file_name FROM sku_files_used WHERE style_guide_file_id IS NULL
  LOOP
    v_id := NULL; v_score := NULL;

    SELECT f.id, similarity(lower(f.filename), lower(r.file_name))
      INTO v_id, v_score
    FROM style_guide_files f
    WHERE f.is_active AND lower(f.filename) % lower(r.file_name)
    ORDER BY similarity(lower(f.filename), lower(r.file_name)) DESC
    LIMIT 1;

    UPDATE sku_files_used
       SET style_guide_file_id  = CASE WHEN v_score >= p_threshold THEN v_id
                                       ELSE style_guide_file_id END,
           match_best_score      = GREATEST(COALESCE(match_best_score, 0), COALESCE(v_score, 0)),
           match_attempts        = match_attempts + 1,
           last_match_attempt_at = now()
     WHERE id = r.id;

    IF v_id IS NOT NULL AND v_score >= p_threshold THEN v_linked := v_linked + 1; END IF;
  END LOOP;
  RETURN v_linked;
END;
$function$;
