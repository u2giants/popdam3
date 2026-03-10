
-- propagate_group_tags_batch: replaces tag-propagation.ts with zero network hops
-- Processes N style groups, propagating product-level tags, characters, and metadata
-- from the source asset to siblings within each group.

CREATE OR REPLACE FUNCTION public.propagate_group_tags_batch(
  p_cursor uuid DEFAULT NULL,
  p_batch_size int DEFAULT 100
)
RETURNS TABLE(next_cursor uuid, propagated int, skipped int, done boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_start_id uuid := COALESCE(p_cursor, '00000000-0000-0000-0000-000000000000'::uuid);
  v_propagated int := 0;
  v_skipped int := 0;
  v_last_id uuid;
  v_batch_count int := 0;
  v_group RECORD;
  v_source_id uuid;
BEGIN
  -- File-specific tags to exclude from propagation
  CREATE TEMP TABLE IF NOT EXISTS _file_specific_tags (tag text PRIMARY KEY) ON COMMIT DROP;
  TRUNCATE _file_specific_tags;
  INSERT INTO _file_specific_tags (tag) VALUES
    ('art_piece'), ('art piece'), ('product'), ('product shot'), ('product photo'),
    ('packaging'), ('package'), ('tech_pack'), ('tech pack'), ('technical pack'),
    ('photography'), ('photo'), ('mockup'), ('mock up'), ('mock-up'),
    ('front view'), ('back view'), ('side view'), ('flat lay'), ('flatlay'),
    ('render'), ('3d render');

  -- Process each group in the batch
  FOR v_group IN
    SELECT sg.id, sg.primary_asset_id
    FROM style_groups sg
    WHERE sg.id > v_start_id
    ORDER BY sg.id
    LIMIT p_batch_size
  LOOP
    v_last_id := v_group.id;
    v_batch_count := v_batch_count + 1;
    v_source_id := NULL;

    -- Find source: primary asset if tagged
    IF v_group.primary_asset_id IS NOT NULL THEN
      SELECT a.id INTO v_source_id
      FROM assets a
      WHERE a.id = v_group.primary_asset_id
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NOT NULL;
    END IF;

    -- Fallback: first tagged asset by primary_sort_tier
    IF v_source_id IS NULL THEN
      SELECT a.id INTO v_source_id
      FROM assets a
      WHERE a.style_group_id = v_group.id
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NOT NULL
      ORDER BY a.primary_sort_tier ASC
      LIMIT 1;
    END IF;

    IF v_source_id IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Propagate tags: insert source's product-level AI tags into siblings that don't have them
    WITH source_product_tags AS (
      SELECT at.tag
      FROM asset_tags at
      WHERE at.asset_id = v_source_id
        AND at.source = 'ai'
        AND NOT EXISTS (SELECT 1 FROM _file_specific_tags f WHERE f.tag = lower(trim(at.tag)))
    ),
    siblings AS (
      SELECT a.id
      FROM assets a
      WHERE a.style_group_id = v_group.id
        AND a.is_deleted = false
        AND a.id != v_source_id
    ),
    new_tags AS (
      INSERT INTO asset_tags (asset_id, tag, source)
      SELECT s.id, spt.tag, 'ai'
      FROM siblings s
      CROSS JOIN source_product_tags spt
      ON CONFLICT (asset_id, tag) DO NOTHING
      RETURNING 1
    )
    SELECT count(*) FROM new_tags; -- side effect: inserts happen

    -- Propagate characters
    WITH source_chars AS (
      SELECT ac.character_id
      FROM asset_characters ac
      WHERE ac.asset_id = v_source_id
    ),
    siblings AS (
      SELECT a.id
      FROM assets a
      WHERE a.style_group_id = v_group.id
        AND a.is_deleted = false
        AND a.id != v_source_id
    )
    INSERT INTO asset_characters (asset_id, character_id)
    SELECT s.id, sc.character_id
    FROM siblings s
    CROSS JOIN source_chars sc
    ON CONFLICT (asset_id, character_id) DO NOTHING;

    -- Propagate metadata (fill nulls only) from source to all siblings
    UPDATE assets dst
    SET
      licensor_id = COALESCE(dst.licensor_id, src.licensor_id),
      property_id = COALESCE(dst.property_id, src.property_id),
      is_licensed = CASE WHEN dst.is_licensed IS NOT TRUE AND src.is_licensed = true THEN true ELSE dst.is_licensed END,
      big_theme = COALESCE(dst.big_theme, src.big_theme),
      little_theme = COALESCE(dst.little_theme, src.little_theme),
      design_style = COALESCE(dst.design_style, src.design_style),
      cover_description = COALESCE(dst.cover_description, src.cover_description)
    FROM assets src
    WHERE src.id = v_source_id
      AND dst.style_group_id = v_group.id
      AND dst.is_deleted = false
      AND dst.id != v_source_id
      AND (
        (dst.licensor_id IS NULL AND src.licensor_id IS NOT NULL) OR
        (dst.property_id IS NULL AND src.property_id IS NOT NULL) OR
        (dst.is_licensed IS NOT TRUE AND src.is_licensed = true) OR
        (dst.big_theme IS NULL AND src.big_theme IS NOT NULL) OR
        (dst.little_theme IS NULL AND src.little_theme IS NOT NULL) OR
        (dst.design_style IS NULL AND src.design_style IS NOT NULL) OR
        (dst.cover_description IS NULL AND src.cover_description IS NOT NULL)
      );

    v_propagated := v_propagated + 1;
  END LOOP;

  RETURN QUERY SELECT
    v_last_id,
    v_propagated,
    v_skipped,
    (v_batch_count < p_batch_size);
END;
$function$;
