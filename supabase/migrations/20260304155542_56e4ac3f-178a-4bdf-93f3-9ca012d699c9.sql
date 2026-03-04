-- Performance hardening for rebuild-style-groups stage 1 clear_assets
-- 1) Add a partial index that matches the stage-1 scan predicate and keyset order
CREATE INDEX IF NOT EXISTS idx_assets_clear_style_cursor
ON public.assets (id)
WHERE is_deleted = false AND style_group_id IS NOT NULL;

-- 2) Replace clear_style_group_batch with a keyset CTE implementation (no temp table)
CREATE OR REPLACE FUNCTION public.clear_style_group_batch(
  p_last_id uuid DEFAULT NULL,
  p_batch_size integer DEFAULT 200
)
RETURNS TABLE(cleared_count integer, last_id uuid, has_more boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
DECLARE
  v_start_id uuid := COALESCE(p_last_id, '00000000-0000-0000-0000-000000000000'::uuid);
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 THEN
    p_batch_size := 1;
  END IF;

  RETURN QUERY
  WITH batch AS (
    SELECT a.id
    FROM public.assets a
    WHERE a.is_deleted = false
      AND a.style_group_id IS NOT NULL
      AND a.id > v_start_id
    ORDER BY a.id ASC
    LIMIT p_batch_size
  ),
  upd AS (
    UPDATE public.assets a
    SET style_group_id = NULL
    FROM batch b
    WHERE a.id = b.id
    RETURNING a.id
  ),
  stats AS (
    SELECT
      COUNT(*)::integer AS c,
      MAX(id) AS m
    FROM upd
  )
  SELECT
    COALESCE(stats.c, 0) AS cleared_count,
    stats.m AS last_id,
    COALESCE(stats.c, 0) = p_batch_size AS has_more
  FROM stats;
END;
$$;