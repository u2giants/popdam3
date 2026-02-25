DELETE FROM render_queue WHERE status IN ('failed', 'claimed');

INSERT INTO render_queue (asset_id, status, attempts)
SELECT DISTINCT a.id, 'pending'::queue_status, 0
FROM assets a
WHERE a.file_type = 'ai'
  AND a.thumbnail_url IS NULL
  AND a.is_deleted = false
  AND NOT EXISTS (
    SELECT 1 FROM render_queue rq WHERE rq.asset_id = a.id AND rq.status IN ('pending', 'claimed')
  );