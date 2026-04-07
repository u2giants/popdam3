-- Fix "canceling statement due to lock timeout" during style group rebuild.
-- All style-group batch functions previously set statement_timeout but not lock_timeout.
-- Supabase sets a lock_timeout at the role/database level; row-level UPDATE statements
-- waiting on contended locks were hitting that limit before they could even run.
-- Setting lock_timeout = '0' inside each function disables the lock wait limit for the
-- duration of the call (still bounded by statement_timeout).

CREATE OR REPLACE FUNCTION public.clear_style_group_batch(
  p_last_id uuid DEFAULT NULL,
  p_batch_size integer DEFAULT 200
)
RETURNS TABLE(cleared_count integer, last_id uuid, has_more boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
SET lock_timeout TO '0'
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

CREATE OR REPLACE FUNCTION public.rebuild_style_groups_batch(
  p_last_asset_id uuid DEFAULT NULL,
  p_batch_size int DEFAULT 500
)
RETURNS TABLE(
  next_cursor uuid,
  groups_created int,
  assets_assigned int,
  assets_ungrouped int,
  done boolean
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
  v_fetched int := 0;
  v_done boolean;
BEGIN
  -- 1. Fetch batch of assets, extract SKU folder using regex
  WITH asset_batch AS (
    SELECT a.id, a.relative_path, a.filename, a.file_type,
           a.is_licensed, a.licensor_id, a.licensor_code, a.licensor_name,
           a.property_id, a.property_code, a.property_name,
           a.product_category, a.division_code, a.division_name,
           a.mg01_code, a.mg01_name, a.mg02_code, a.mg02_name,
           a.mg03_code, a.mg03_name, a.size_code, a.size_name
    FROM assets a
    WHERE a.is_deleted = false
      AND (p_last_asset_id IS NULL OR a.id > p_last_asset_id)
    ORDER BY a.id
    LIMIT p_batch_size
  ),
  -- Extract SKU: walk path segments, find first matching ^[A-Za-z]{1,6}\d with len >= 10
  asset_skus AS (
    SELECT ab.*,
      (
        SELECT seg
        FROM unnest(string_to_array(ab.relative_path, '/')) WITH ORDINALITY AS t(seg, ord)
        WHERE seg ~ '^[A-Za-z]{1,6}[0-9]'
          AND length(seg) >= 10
          AND ord < array_length(string_to_array(ab.relative_path, '/'), 1)
        ORDER BY ord
        LIMIT 1
      ) AS sku
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
    INSERT INTO style_groups (
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
    RETURNING id, sku
  ),
  assigned AS (
    UPDATE assets a
    SET style_group_id = ug.id
    FROM grouped_assets ga
    JOIN upserted_groups ug ON ug.sku = ga.sku
    WHERE a.id = ga.id
    RETURNING 1
  )
  SELECT
    (SELECT bs.last_id FROM batch_stats bs),
    (SELECT count(*)::int FROM upserted_groups),
    (SELECT count(*)::int FROM assigned),
    (SELECT count(*)::int FROM asset_skus WHERE sku IS NULL),
    (SELECT bs.total_fetched FROM batch_stats bs) < p_batch_size
  INTO v_last_id, v_groups_created, v_assets_assigned, v_ungrouped, v_done;

  RETURN QUERY SELECT v_last_id, v_groups_created, v_assets_assigned, v_ungrouped, COALESCE(v_done, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_style_group_counts_batch(p_group_ids uuid[])
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
 SET lock_timeout TO '0'
AS $$
  WITH agg AS (
    SELECT
      a.style_group_id,
      COUNT(*)::integer AS asset_count,
      MAX(a.modified_at) AS latest_file_date
    FROM public.assets a
    WHERE a.is_deleted = false
      AND a.style_group_id = ANY(p_group_ids)
    GROUP BY a.style_group_id
  ),
  upd AS (
    UPDATE public.style_groups sg
    SET
      asset_count = COALESCE(agg.asset_count, 0),
      latest_file_date = agg.latest_file_date,
      updated_at = now()
    FROM agg
    WHERE sg.id = agg.style_group_id
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM upd;
$$;

CREATE OR REPLACE FUNCTION public.refresh_style_group_primaries(p_group_ids uuid[])
RETURNS integer LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '30s'
SET lock_timeout TO '0'
AS $$
  WITH picked AS (
    SELECT DISTINCT ON (sg.id)
      sg.id AS style_group_id,
      a.id AS primary_asset_id,
      a.asset_type::text AS primary_asset_type,
      a.thumbnail_url AS primary_thumbnail_url,
      a.thumbnail_error AS primary_thumbnail_error
    FROM public.style_groups sg
    LEFT JOIN public.assets a
      ON a.style_group_id = sg.id AND a.is_deleted = false
    WHERE sg.id = ANY(p_group_ids)
    ORDER BY sg.id, a.primary_sort_tier ASC, a.created_at ASC
  ),
  upd AS (
    UPDATE public.style_groups sg SET
      primary_asset_id = picked.primary_asset_id,
      primary_asset_type = picked.primary_asset_type,
      primary_thumbnail_url = picked.primary_thumbnail_url,
      primary_thumbnail_error = picked.primary_thumbnail_error,
      updated_at = now()
    FROM picked WHERE sg.id = picked.style_group_id
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM upd;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_style_group_stats_batch(
  p_cursor uuid DEFAULT NULL,
  p_batch_size int DEFAULT 200,
  p_sub text DEFAULT 'counts'
)
RETURNS TABLE(next_cursor uuid, processed int, sub text, done boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
SET lock_timeout TO '0'
AS $$
DECLARE
  v_ids uuid[];
  v_count int;
  v_last_id uuid;
  v_done boolean;
BEGIN
  -- Fetch batch of style_group IDs using keyset pagination
  SELECT array_agg(sg.id ORDER BY sg.id), count(*)::int
  INTO v_ids, v_count
  FROM (
    SELECT sg2.id
    FROM style_groups sg2
    WHERE (p_cursor IS NULL OR sg2.id > p_cursor)
    ORDER BY sg2.id
    LIMIT p_batch_size
  ) sg;

  v_done := (v_count < p_batch_size);

  IF v_count = 0 THEN
    -- No more groups in this sub-stage
    IF p_sub = 'counts' THEN
      -- Signal transition to primaries
      RETURN QUERY SELECT NULL::uuid, 0, 'counts_done'::text, false;
    ELSE
      -- Primaries done = fully complete
      RETURN QUERY SELECT NULL::uuid, 0, 'complete'::text, true;
    END IF;
    RETURN;
  END IF;

  v_last_id := v_ids[array_length(v_ids, 1)];

  IF p_sub = 'counts' THEN
    -- Refresh counts + latest_file_date for this batch
    PERFORM refresh_style_group_counts_batch(v_ids);

    IF v_done THEN
      -- Counts exhausted → signal transition
      RETURN QUERY SELECT v_last_id, v_count, 'counts_done'::text, false;
    ELSE
      RETURN QUERY SELECT v_last_id, v_count, 'counts'::text, false;
    END IF;

  ELSIF p_sub = 'primaries' THEN
    -- Refresh primary asset selection for this batch
    PERFORM refresh_style_group_primaries(v_ids);

    RETURN QUERY SELECT v_last_id, v_count, p_sub, v_done;

  ELSE
    RAISE EXCEPTION 'Unknown sub-stage: %', p_sub;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.propagate_group_tags_batch(
  p_cursor uuid DEFAULT NULL,
  p_batch_size int DEFAULT 100
)
RETURNS TABLE(
  next_cursor uuid,
  propagated int,
  skipped int,
  done boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
SET lock_timeout = '0'
AS $$
DECLARE
  v_next_cursor uuid;
  v_total_propagated int := 0;
  v_group_count int := 0;
  v_batch_propagated int;
  v_file_specific_tags text[] := ARRAY[
    'art_piece','art piece','product','product shot','product photo',
    'packaging','package','tech_pack','tech pack','technical pack',
    'photography','photo','mockup','mock up','mock-up',
    'front view','back view','side view','flat lay','flatlay',
    'render','3d render'
  ];
BEGIN
  FOR v_next_cursor IN
    SELECT sg.id
    FROM style_groups sg
    WHERE (p_cursor IS NULL OR sg.id > p_cursor)
    ORDER BY sg.id
    LIMIT p_batch_size
  LOOP
    v_group_count := v_group_count + 1;

    WITH source_asset AS (
      SELECT a.id, a.licensor_id, a.property_id, a.is_licensed,
             a.big_theme, a.little_theme, a.design_style, a.cover_description
      FROM assets a
      WHERE a.style_group_id = v_next_cursor
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NOT NULL
      ORDER BY a.primary_sort_tier ASC, a.ai_tagged_at ASC
      LIMIT 1
    ),
    source_tags AS (
      SELECT at2.tag
      FROM asset_tags at2
      JOIN source_asset sa ON sa.id = at2.asset_id
      WHERE at2.source = 'ai'
        AND lower(trim(at2.tag)) != ALL(v_file_specific_tags)
    ),
    source_chars AS (
      SELECT ac.character_id
      FROM asset_characters ac
      JOIN source_asset sa ON sa.id = ac.asset_id
    ),
    siblings AS (
      SELECT a.id, a.licensor_id, a.property_id, a.is_licensed,
             a.big_theme, a.little_theme, a.design_style, a.cover_description
      FROM assets a
      CROSS JOIN source_asset sa
      WHERE a.style_group_id = v_next_cursor
        AND a.is_deleted = false
        AND a.id != sa.id
    ),
    inserted_tags AS (
      INSERT INTO asset_tags (asset_id, tag, source)
      SELECT s.id, st.tag, 'ai'
      FROM siblings s
      CROSS JOIN source_tags st
      ON CONFLICT (asset_id, tag) DO NOTHING
      RETURNING 1
    ),
    inserted_chars AS (
      INSERT INTO asset_characters (asset_id, character_id)
      SELECT s.id, sc.character_id
      FROM siblings s
      CROSS JOIN source_chars sc
      ON CONFLICT (asset_id, character_id) DO NOTHING
      RETURNING 1
    ),
    meta_updates AS (
      UPDATE assets a
      SET
        licensor_id = COALESCE(a.licensor_id, sa.licensor_id),
        property_id = COALESCE(a.property_id, sa.property_id),
        is_licensed = CASE WHEN a.is_licensed = true THEN true ELSE COALESCE(sa.is_licensed, a.is_licensed) END,
        big_theme = COALESCE(a.big_theme, sa.big_theme),
        little_theme = COALESCE(a.little_theme, sa.little_theme),
        design_style = COALESCE(a.design_style, sa.design_style),
        cover_description = COALESCE(a.cover_description, sa.cover_description)
      FROM source_asset sa, siblings s
      WHERE a.id = s.id
        AND (
          (a.licensor_id IS NULL AND sa.licensor_id IS NOT NULL) OR
          (a.property_id IS NULL AND sa.property_id IS NOT NULL) OR
          (a.is_licensed IS NOT TRUE AND sa.is_licensed = true) OR
          (a.big_theme IS NULL AND sa.big_theme IS NOT NULL) OR
          (a.little_theme IS NULL AND sa.little_theme IS NOT NULL) OR
          (a.design_style IS NULL AND sa.design_style IS NOT NULL) OR
          (a.cover_description IS NULL AND sa.cover_description IS NOT NULL)
        )
      RETURNING 1
    )
    SELECT
      (SELECT count(*)::int FROM inserted_tags) + (SELECT count(*)::int FROM inserted_chars)
    INTO v_batch_propagated;

    v_total_propagated := v_total_propagated + COALESCE(v_batch_propagated, 0);
  END LOOP;

  RETURN QUERY SELECT
    v_next_cursor,
    v_total_propagated,
    0::int,
    (v_group_count < p_batch_size);
END;
$$;
