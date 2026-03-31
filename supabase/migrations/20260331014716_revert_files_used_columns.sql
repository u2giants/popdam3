DROP TRIGGER IF EXISTS trg_sync_files_used ON assets;
DROP FUNCTION IF EXISTS sync_files_used_to_group();
ALTER TABLE assets DROP COLUMN IF EXISTS files_used;
ALTER TABLE style_groups DROP COLUMN IF EXISTS files_used;
