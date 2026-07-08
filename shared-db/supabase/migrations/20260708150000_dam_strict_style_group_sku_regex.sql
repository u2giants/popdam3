-- DAM: keep database style-group rebuild SKU extraction aligned with the app-side
-- extractor in supabase/functions/_shared/style-grouping.ts.
--
-- The previous rebuild RPC matched any path segment that merely started with
-- 1-6 letters followed by a digit. Category folders such as
-- "B3M_3FZ - 3D Lenticular framed" therefore collapsed thousands of files into
-- one bogus style group. Real PopDAM SKU folders are purely alphanumeric and at
-- at least 7 characters long, with both letters and digits. Some valid SKUs
-- start with a digit, for example "3FZ93DYEC01".

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
  v_done boolean;
BEGIN
  WITH asset_batch AS (
    SELECT a.id, a.relative_path, a.filename, a.file_type,
           a.is_licensed, a.licensor_id, a.licensor_code, a.licensor_name,
           a.property_id, a.property_code, a.property_name,
           a.product_category, a.division_code, a.division_name,
           a.mg01_code, a.mg01_name, a.mg02_code, a.mg02_name,
           a.mg03_code, a.mg03_name, a.size_code, a.size_name
    FROM public.assets a
    WHERE a.is_deleted = false
      AND (p_last_asset_id IS NULL OR a.id > p_last_asset_id)
    ORDER BY a.id
    LIMIT p_batch_size
  ),
  asset_skus AS (
    SELECT ab.*,
      (
        SELECT seg
        FROM unnest(string_to_array(ab.relative_path, '/')) WITH ORDINALITY AS t(seg, ord)
        WHERE seg ~ '^[A-Za-z0-9]+$'
          AND seg ~ '[A-Za-z]'
          AND seg ~ '[0-9]'
          AND length(seg) >= 7
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
    RETURNING id, sku
  ),
  assigned AS (
    UPDATE public.assets a
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
