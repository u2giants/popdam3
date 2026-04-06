-- Speed up stale-claim detection and worker claim queries on tiff_optimization_queue.
-- Both columns appear in WHERE clauses for polling and cleanup queries.
CREATE INDEX IF NOT EXISTS tiff_optimization_queue_claimed_by_idx
  ON tiff_optimization_queue (claimed_by)
  WHERE claimed_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS tiff_optimization_queue_claimed_at_idx
  ON tiff_optimization_queue (claimed_at)
  WHERE claimed_at IS NOT NULL;
