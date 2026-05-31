SELECT cron.schedule(
  'nightly-reconcile-sg-asset-counts',
  '45 3 * * *',
  $$
    SELECT public.refresh_style_group_counts_batch(array_agg(id))
    FROM public.style_groups;
  $$
);
