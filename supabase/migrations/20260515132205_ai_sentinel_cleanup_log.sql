-- Tracks .ai files deleted because they were saved without PDF content (the sentinel string).
-- Also records the replacement PDF/PNG/JPG tech pack found in the same folder/subfolders.
-- TEMPORARY: This table exists only for the one-time reconciliation pass.
-- Once all .ai sentinel files are cleaned up and the ingestion logic is confirmed
-- to prevent this from recurring, this table and the associated admin handlers can be dropped.
CREATE TABLE ai_sentinel_cleanup_log (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_asset_id                     uuid NOT NULL,
  ai_filename                     text NOT NULL,
  ai_relative_path                text NOT NULL,
  replacement_asset_id            uuid,
  replacement_filename            text,
  replacement_relative_path       text,
  replacement_had_thumbnail       boolean,
  replacement_queued_for_thumbnail boolean DEFAULT false,
  created_at                      timestamptz DEFAULT now()
);

CREATE INDEX idx_ai_sentinel_cleanup_log_asset ON ai_sentinel_cleanup_log(ai_asset_id);

GRANT SELECT, INSERT ON ai_sentinel_cleanup_log TO service_role;
