-- Purge completed/failed render_queue rows older than 30 days.
-- Pending and claimed rows are never touched.
SELECT cron.schedule(
  'purge-render-queue-old-rows',
  '0 3 * * *',  -- daily at 03:00 UTC
  $$
    DELETE FROM public.render_queue
    WHERE status IN ('completed', 'failed')
      AND created_at < NOW() - INTERVAL '30 days';
  $$
);

-- Purge completed/failed style_guide_render_queue rows older than 30 days.
SELECT cron.schedule(
  'purge-sg-render-queue-old-rows',
  '15 3 * * *',  -- daily at 03:15 UTC
  $$
    DELETE FROM public.style_guide_render_queue
    WHERE status IN ('completed', 'failed')
      AND created_at < NOW() - INTERVAL '30 days';
  $$
);

-- Purge asset_path_history rows older than 90 days.
-- AssetDetailPanel reads this table; 90 days of history is plenty.
SELECT cron.schedule(
  'purge-asset-path-history-old-rows',
  '30 3 * * *',  -- daily at 03:30 UTC
  $$
    DELETE FROM public.asset_path_history
    WHERE detected_at < NOW() - INTERVAL '90 days';
  $$
);
