-- The PopSG aggregation matviews (popsg_aggregation_matviews) refresh at crawl
-- completion, but style_guide_files also changes between crawls when the render
-- queue fills in thumbnail_url. Without a periodic refresh, a group's
-- representative sample_thumbnail_url in guides mode would lag until the next
-- (nightly) crawl. Refresh every 15 min (CONCURRENTLY, ~1.8s, no read lock) to
-- bound staleness regardless of crawl cadence.
SELECT cron.schedule(
  'refresh-style-guide-matviews',
  '*/15 * * * *',
  $$ SELECT public.refresh_style_guide_matviews(); $$
);
