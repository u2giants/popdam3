-- Schedule nightly style-guide crawl at 9pm EST / 10pm EDT (02:00 UTC).
-- pg_cron on this Supabase version does not support per-job timezone,
-- so we use the equivalent UTC offset for EST (UTC-5).  1-hour drift in
-- summer (EDT) is acceptable for a maintenance crawl.
SELECT cron.schedule(
  'nightly-sg-crawl',
  '0 2 * * *',
  $$
    INSERT INTO public.admin_config (key, value, updated_at)
    VALUES (
      'STYLE_GUIDE_CRAWL_REQUEST',
      jsonb_build_object(
        'request_id',   gen_random_uuid()::text,
        'status',       'pending',
        'requested_at', now()::text,
        'requested_by', 'pg_cron'
      ),
      now()
    )
    ON CONFLICT (key) DO UPDATE
      SET value      = EXCLUDED.value,
          updated_at = EXCLUDED.updated_at;
  $$
);
