
-- Function: cleanup_mega_group_tags_batch
-- Surgically removes contaminated propagated tags from mega-groups.

CREATE OR REPLACE FUNCTION public.cleanup_mega_group_tags_batch(
  p_cursor uuid DEFAULT NULL,
  p_batch_size integer DEFAULT 5,
  p_min_group_size integer DEFAULT 50
)
RETURNS TABLE(
  next_cursor uuid,
  groups_processed integer,
  tags_deleted integer,
  characters_deleted integer,
  metadata_cleared integer,
  done boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
DECLARE
  v_group record;
  v_groups_processed int := 0;
  v_tags_deleted int := 0;
  v_chars_deleted int := 0;
  v_meta_cleared int := 0;
  v_last_id uuid;
  v_group_count int := 0;
  v_batch_tags int;
  v_batch_chars int;
  v_batch_meta int;
BEGIN
  FOR v_group IN
    SELECT sg.id
    FROM style_groups sg
    WHERE sg.asset_count >= p_min_group_size
      AND (p_cursor IS NULL OR sg.id > p_cursor)
    ORDER BY sg.id
    LIMIT p_batch_size
  LOOP
    v_group_count := v_group_count + 1;
    v_last_id := v_group.id;

    -- 1) Delete contaminated tags from NON-directly-tagged assets (ai_tagged_at IS NULL)
    --    These assets only have propagated tags — delete all AI tags.
    WITH non_tagged_assets AS (
      SELECT a.id FROM assets a
      WHERE a.style_group_id = v_group.id
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NULL
    ),
    del_tags_null AS (
      DELETE FROM asset_tags at
      USING non_tagged_assets nta
      WHERE at.asset_id = nta.id
        AND at.source = 'ai'
      RETURNING 1
    ),
    -- 2) Delete contaminated tags from DIRECTLY-tagged assets
    --    Keep tags created within 5 min of ai_tagged_at; delete the rest.
    tagged_assets AS (
      SELECT a.id, a.ai_tagged_at FROM assets a
      WHERE a.style_group_id = v_group.id
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NOT NULL
    ),
    del_tags_late AS (
      DELETE FROM asset_tags at
      USING tagged_assets ta
      WHERE at.asset_id = ta.id
        AND at.source = 'ai'
        AND at.created_at > ta.ai_tagged_at + interval '5 minutes'
      RETURNING 1
    )
    SELECT
      (SELECT count(*) FROM del_tags_null) + (SELECT count(*) FROM del_tags_late)
    INTO v_batch_tags;

    v_tags_deleted := v_tags_deleted + COALESCE(v_batch_tags, 0);

    -- 3) Delete contaminated asset_characters (same logic)
    WITH non_tagged_assets AS (
      SELECT a.id FROM assets a
      WHERE a.style_group_id = v_group.id
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NULL
    ),
    del_chars_null AS (
      DELETE FROM asset_characters ac
      USING non_tagged_assets nta
      WHERE ac.asset_id = nta.id
      RETURNING 1
    ),
    tagged_assets AS (
      SELECT a.id, a.ai_tagged_at FROM assets a
      WHERE a.style_group_id = v_group.id
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NOT NULL
    )
    SELECT (SELECT count(*) FROM del_chars_null)
    INTO v_batch_chars;

    v_chars_deleted := v_chars_deleted + COALESCE(v_batch_chars, 0);

    -- 4) Clear propagated metadata on non-tagged assets
    WITH cleared AS (
      UPDATE assets a
      SET
        big_theme = NULL,
        little_theme = NULL,
        design_style = NULL,
        cover_description = NULL
      WHERE a.style_group_id = v_group.id
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NULL
        AND (a.big_theme IS NOT NULL OR a.little_theme IS NOT NULL
             OR a.design_style IS NOT NULL OR a.cover_description IS NOT NULL)
      RETURNING 1
    )
    SELECT count(*) INTO v_batch_meta FROM cleared;

    v_meta_cleared := v_meta_cleared + COALESCE(v_batch_meta, 0);
    v_groups_processed := v_groups_processed + 1;
  END LOOP;

  RETURN QUERY SELECT
    v_last_id,
    v_groups_processed,
    v_tags_deleted,
    v_chars_deleted,
    v_meta_cleared,
    (v_group_count < p_batch_size);
END;
$$;
