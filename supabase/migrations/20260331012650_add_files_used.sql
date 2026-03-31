-- Add files_used column to assets and style_groups
ALTER TABLE assets ADD COLUMN IF NOT EXISTS files_used text[];
ALTER TABLE style_groups ADD COLUMN IF NOT EXISTS files_used text[];

-- Trigger: when an asset's files_used is set, propagate to its style_group and all siblings
CREATE OR REPLACE FUNCTION sync_files_used_to_group()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Only propagate if files_used is being set to a non-empty value
  IF NEW.files_used IS NOT NULL AND array_length(NEW.files_used, 1) > 0
     AND NEW.style_group_id IS NOT NULL THEN

    -- Update the parent style_group
    UPDATE style_groups
    SET files_used = NEW.files_used
    WHERE id = NEW.style_group_id;

    -- Update all sibling assets in the same group (excluding self to avoid recursion)
    UPDATE assets
    SET files_used = NEW.files_used
    WHERE style_group_id = NEW.style_group_id
      AND id <> NEW.id;

  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_files_used
AFTER INSERT OR UPDATE OF files_used ON assets
FOR EACH ROW EXECUTE FUNCTION sync_files_used_to_group();
