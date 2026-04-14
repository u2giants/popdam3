-- Partial index for compat audit batch query.
-- Covers exactly the rows the query filters on (AI assets that have a thumbnail,
-- not deleted) ordered by id, so cursor-based pagination is O(1) instead of
-- requiring a full-table scan at the tail end of the dataset.
CREATE INDEX IF NOT EXISTS idx_assets_compat_audit
  ON assets (id)
  WHERE file_type = 'ai'
    AND is_deleted = false
    AND thumbnail_url IS NOT NULL;
