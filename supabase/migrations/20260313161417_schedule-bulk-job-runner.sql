-- Schedule bulk-job-runner edge function every minute via pg_cron + pg_net.
-- The service role key is read from Supabase Vault (secret name: SUPABASE_SERVICE_ROLE_KEY).
-- To add it: Dashboard → Vault → New Secret → name "SUPABASE_SERVICE_ROLE_KEY", value = your service role key.

select cron.schedule(
  'invoke-bulk-job-runner',
  '* * * * *',
  $$
  select
    net.http_post(
      url     := 'https://ryltkzzernhwnojzouyb.supabase.co/functions/v1/bulk-job-runner',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret
          from   vault.decrypted_secrets
          where  name = 'SUPABASE_SERVICE_ROLE_KEY'
          limit  1
        )
      ),
      body    := '{}'::jsonb
    ) as request_id;
  $$
);
