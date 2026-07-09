-- DAM: preserve existing substring search behavior while using indexed full-text
-- search for extracted PDF text. Queries like "3fz" must still match a SKU such
-- as "3FZ93DYEC01".

CREATE OR REPLACE FUNCTION public.search_assets_full_text(
  p_query text,
  p_limit int DEFAULT 10000
)
RETURNS TABLE(
  asset_id uuid,
  style_group_id uuid,
  rank real
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '8s'
AS $$
  WITH normalized AS (
    SELECT nullif(trim(p_query), '') AS query_text,
           greatest(1, least(coalesce(p_limit, 10000), 20000)) AS result_limit
  ),
  q AS (
    SELECT websearch_to_tsquery('simple', query_text) AS tsq,
           '%' || query_text || '%' AS like_pattern,
           result_limit
    FROM normalized
    WHERE query_text IS NOT NULL
  ),
  asset_matches AS (
    SELECT
      a.id AS asset_id,
      a.style_group_id,
      greatest(
        ts_rank_cd(
          to_tsvector(
            'simple',
            (coalesce(a.filename, '') || ' ' || coalesce(a.relative_path, '') || ' ' || coalesce(a.cover_description, '') || ' ' || coalesce(a.ai_description, '') || ' ' || coalesce(a.scene_description, '') || ' ' || coalesce(a.customer, '') || ' ' || coalesce(a.program, '') || ' ' || coalesce(a.licensor_name, '') || ' ' || coalesce(a.property_name, '') || ' ' || coalesce(a.product_category, ''))
          ),
          q.tsq
        ),
        0.01
      ) AS rank
    FROM public.assets a
    CROSS JOIN q
    WHERE a.is_deleted = false
      AND (
        to_tsvector(
          'simple',
          (coalesce(a.filename, '') || ' ' || coalesce(a.relative_path, '') || ' ' || coalesce(a.cover_description, '') || ' ' || coalesce(a.ai_description, '') || ' ' || coalesce(a.scene_description, '') || ' ' || coalesce(a.customer, '') || ' ' || coalesce(a.program, '') || ' ' || coalesce(a.licensor_name, '') || ' ' || coalesce(a.property_name, '') || ' ' || coalesce(a.product_category, ''))
        ) @@ q.tsq
        OR a.filename ILIKE q.like_pattern
        OR a.relative_path ILIKE q.like_pattern
        OR a.cover_description ILIKE q.like_pattern
        OR a.ai_description ILIKE q.like_pattern
        OR a.scene_description ILIKE q.like_pattern
        OR a.customer ILIKE q.like_pattern
        OR a.program ILIKE q.like_pattern
        OR a.licensor_name ILIKE q.like_pattern
        OR a.property_name ILIKE q.like_pattern
        OR a.product_category ILIKE q.like_pattern
      )
  ),
  pdf_matches AS (
    SELECT
      pts.asset_id,
      a.style_group_id,
      ts_rank_cd(to_tsvector('simple', coalesce(pts.extracted_text, '')), q.tsq) * 0.5 AS rank
    FROM public.pdf_text_samples pts
    JOIN public.assets a ON a.id = pts.asset_id
    CROSS JOIN q
    WHERE a.is_deleted = false
      AND pts.extracted_text IS NOT NULL
      AND to_tsvector('simple', coalesce(pts.extracted_text, '')) @@ q.tsq
  ),
  combined AS (
    SELECT * FROM asset_matches
    UNION ALL
    SELECT * FROM pdf_matches
  )
  SELECT
    combined.asset_id,
    combined.style_group_id,
    max(combined.rank)::real AS rank
  FROM combined
  GROUP BY combined.asset_id, combined.style_group_id
  ORDER BY max(combined.rank) DESC, combined.asset_id
  LIMIT (SELECT result_limit FROM q);
$$;

CREATE OR REPLACE FUNCTION public.search_style_groups_full_text(
  p_query text,
  p_limit int DEFAULT 10000
)
RETURNS TABLE(
  style_group_id uuid,
  rank real
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '8s'
AS $$
  WITH normalized AS (
    SELECT nullif(trim(p_query), '') AS query_text,
           greatest(1, least(coalesce(p_limit, 10000), 20000)) AS result_limit
  ),
  q AS (
    SELECT websearch_to_tsquery('simple', query_text) AS tsq,
           '%' || query_text || '%' AS like_pattern,
           result_limit
    FROM normalized
    WHERE query_text IS NOT NULL
  ),
  group_matches AS (
    SELECT
      sg.id AS style_group_id,
      greatest(
        ts_rank_cd(
          to_tsvector(
            'simple',
            (coalesce(sg.sku, '') || ' ' || coalesce(sg.folder_path, '') || ' ' || coalesce(sg.cover_description, '') || ' ' || coalesce(sg.customer, '') || ' ' || coalesce(sg.program, '') || ' ' || coalesce(sg.licensor_name, '') || ' ' || coalesce(sg.property_name, '') || ' ' || coalesce(sg.product_category, ''))
          ),
          q.tsq
        ),
        0.01
      ) AS rank
    FROM public.style_groups sg
    CROSS JOIN q
    WHERE to_tsvector(
      'simple',
      (coalesce(sg.sku, '') || ' ' || coalesce(sg.folder_path, '') || ' ' || coalesce(sg.cover_description, '') || ' ' || coalesce(sg.customer, '') || ' ' || coalesce(sg.program, '') || ' ' || coalesce(sg.licensor_name, '') || ' ' || coalesce(sg.property_name, '') || ' ' || coalesce(sg.product_category, ''))
    ) @@ q.tsq
    OR sg.sku ILIKE q.like_pattern
    OR sg.folder_path ILIKE q.like_pattern
    OR sg.cover_description ILIKE q.like_pattern
    OR sg.customer ILIKE q.like_pattern
    OR sg.program ILIKE q.like_pattern
    OR sg.licensor_name ILIKE q.like_pattern
    OR sg.property_name ILIKE q.like_pattern
    OR sg.product_category ILIKE q.like_pattern
  ),
  asset_group_matches AS (
    SELECT
      m.style_group_id,
      max(m.rank) * 0.8 AS rank
    FROM public.search_assets_full_text(p_query, p_limit) m
    WHERE m.style_group_id IS NOT NULL
    GROUP BY m.style_group_id
  ),
  combined AS (
    SELECT * FROM group_matches
    UNION ALL
    SELECT * FROM asset_group_matches
  )
  SELECT
    combined.style_group_id,
    max(combined.rank)::real AS rank
  FROM combined
  GROUP BY combined.style_group_id
  ORDER BY max(combined.rank) DESC, combined.style_group_id
  LIMIT (SELECT result_limit FROM q);
$$;

GRANT EXECUTE ON FUNCTION public.search_assets_full_text(text, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_style_groups_full_text(text, int) TO authenticated, service_role;
