-- Disable the pg_cron bulk-job-runner schedule.
-- The bulk-job-runner edge function is replaced by the persistent Railway worker
-- (apps/worker), which polls admin_config.BULK_OPERATIONS every 5 seconds and
-- processes operations without the 60s edge function timeout constraint.
--
-- The update_bulk_operations_batch RPC used by the old runner is preserved for
-- backwards compatibility with any direct callers.

SELECT cron.unschedule('invoke-bulk-job-runner');
