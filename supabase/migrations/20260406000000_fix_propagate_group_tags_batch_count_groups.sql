-- Fix propagate_group_tags_batch: count groups processed, not individual tag/character rows.
--
-- Bug: the previous implementation accumulated
--   (count of inserted_tags rows) + (count of inserted_chars rows)
-- as `propagated`. A group with 2 siblings × 10 tags produces 20 increments
-- per group, so `propagated` quickly exceeds `total` (group count).
-- The UI showed "14,775 / 9,751 (100%)" — wrong unit, wrong math.
--
-- Fix: use SELECT 1 INTO v_dummy to keep the CTE chain as a single SQL statement
-- (PostgreSQL requires all CTEs to be part of one statement).  Data-modifying
-- CTEs (inserted_tags, inserted_chars, meta_updates) always execute to completion
-- per PostgreSQL semantics, even though the outer SELECT just reads a literal 1.
-- Then increment v_total_propagated by 1 (one group), not by tag/char row counts.

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
AS $$
DECLARE
  v_next_cursor uuid;
  v_total_propagated int := 0;
  v_group_count int := 0;
  v_dummy int;
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
    claimable_for_meta AS (
      SELECT a.id
      FROM assets a
      CROSS JOIN source_asset sa
      WHERE a.style_group_id = v_next_cursor
        AND a.is_deleted = false
        AND a.id != sa.id
        AND (
          (a.licensor_id IS NULL AND sa.licensor_id IS NOT NULL) OR
          (a.property_id IS NULL AND sa.property_id IS NOT NULL) OR
          (a.is_licensed IS NOT TRUE AND sa.is_licensed = true) OR
          (a.big_theme IS NULL AND sa.big_theme IS NOT NULL) OR
          (a.little_theme IS NULL AND sa.little_theme IS NOT NULL) OR
          (a.design_style IS NULL AND sa.design_style IS NOT NULL) OR
          (a.cover_description IS NULL AND sa.cover_description IS NOT NULL)
        )
      FOR UPDATE OF a SKIP LOCKED
    ),
    meta_updates AS (
      UPDATE assets a
      SET
        licensor_id       = COALESCE(a.licensor_id, sa.licensor_id),
        property_id       = COALESCE(a.property_id, sa.property_id),
        is_licensed       = CASE WHEN a.is_licensed = true THEN true ELSE COALESCE(sa.is_licensed, a.is_licensed) END,
        big_theme         = COALESCE(a.big_theme, sa.big_theme),
        little_theme      = COALESCE(a.little_theme, sa.little_theme),
        design_style      = COALESCE(a.design_style, sa.design_style),
        cover_description = COALESCE(a.cover_description, sa.cover_description)
      FROM source_asset sa, claimable_for_meta cfm
      WHERE a.id = cfm.id
      RETURNING 1
    )
    -- SELECT 1 keeps the whole block as one SQL statement so all CTEs share scope.
    -- PostgreSQL always executes data-modifying CTEs (inserted_tags, inserted_chars,
    -- meta_updates) to completion regardless of what the outer SELECT reads.
    SELECT 1 INTO v_dummy;

    -- Count groups visited (not individual tag/char rows). This matches the `total`
    -- unit (also a group count) so the UI percentage is correct.
    v_total_propagated := v_total_propagated + 1;

  END LOOP;

  RETURN QUERY SELECT
    v_next_cursor,
    v_total_propagated,
    0::int,
    (v_group_count < p_batch_size);
END;
$$;
