-- #2769: restrict EXECUTE on public.queue_nightly_rebuild_style_groups() to service roles.
--
-- The #2440 migration (20260909005945) restated the baseline ACL, which granted EXECUTE to
-- `authenticated`. The function is SECURITY DEFINER and owned by postgres: any signed-in user
-- could call it over PostgREST (`rpc/queue_nightly_rebuild_style_groups`) and, with the
-- owner's rights, enqueue a full style-group rebuild or force the chunked counts reconcile.
--
-- Who actually calls it (verified read-only on production qsllyeztdwjgirsysgai, 2026-09-11):
--   * pg_cron job `nightly-rebuild-style-groups` (`*/10 * * * *`), command
--     `select public.queue_nightly_rebuild_style_groups()`, run as `postgres`.
--   * No application code. u2giants/popdam3, poppim-web and popcrm-web reference the name
--     only in generated database type files; the PopDAM worker polls
--     admin_config.BULK_OPERATIONS and never calls this function.
--   * No other database function calls it.
-- Production ACL before this migration: {postgres=X, authenticated=X, service_role=X};
-- PUBLIC and anon hold nothing.
--
-- After: postgres (owner, the cron role) and service_role (server-side operators) keep
-- EXECUTE; PUBLIC, anon and authenticated hold none. No function body, schedule or row
-- changes. `create or replace` in a later migration preserves this ACL.
--
-- Contracts: supabase/tests/queue_nightly_rebuild_style_groups_execute_grants.sql
-- derived-from: 20260909005945

revoke execute on function public.queue_nightly_rebuild_style_groups() from public;
revoke execute on function public.queue_nightly_rebuild_style_groups() from anon;
revoke execute on function public.queue_nightly_rebuild_style_groups() from authenticated;

grant execute on function public.queue_nightly_rebuild_style_groups() to service_role;
grant execute on function public.queue_nightly_rebuild_style_groups() to postgres;
