-- #6415: revoke superfluous anon/authenticated EXECUTE on trigger-returning
-- functions. Part of the #2326 program (plan Step 6, Step 2 access-matrix
-- finding 3).
--
-- WHY
-- ---
-- A trigger function is not an RPC: `prorettype = trigger` means the function
-- can ONLY be invoked by a trigger (a direct call raises "trigger functions can
-- only be called as triggers"). Yet every EXECUTE grant on one is attack
-- surface and advisor noise: PostgREST will happily publish it as
-- /rest/v1/rpc/<name> to whatever roles hold EXECUTE, where it can only fail.
-- Trigger firing is unaffected by role EXECUTE grants (checked at CREATE
-- TRIGGER time, not at fire time) — the contract tests named in the PR prove
-- that on preview before this ships.
--
-- SCOPE (pinned at authoring time 2026-11-15 8:30 PM EST; exact list in the
-- implementing PR body, issue #6415)
-- -----
-- Every function with `prorettype = 'trigger'::regtype` outside auth/extensions
-- that anon or authenticated can EXECUTE — EXCEPT the platform-owned schemas
-- pg_catalog / storage / realtime / cron / repack:
--   * their functions are owned by supabase_admin / supabase_storage_admin /
--     supabase_realtime_admin; the migration role (postgres, not superuser,
--     not a member of supabase_admin — verified read-only 2026-11-15) cannot
--     legally revoke on them ("must be owner of function"), and
--   * this repo does not patch vendor/platform objects (Prime Directive), and
--   * none of those schemas is in pgrst.db_schemas
--     (public, graphql_public, api, crm, pim, core, app — live 2026-11-15),
--     so no Data API RPC surface exists there.
-- The post-change census is therefore 0 within the revocable scope; the
-- platform residual is recorded (NOTICE below and the PR/evidence doc) as an
-- explicit boundary, not silently dropped.
--
-- WHY `from public, anon, authenticated` AND NOT JUST `from anon, authenticated`
-- -----------------------------------------------------------------------
-- Most of these functions carry no explicit role grant at all: their ACL is
-- the function default (`PUBLIC` EXECUTE). Revoking the named roles alone is a
-- no-op — anon/authenticated still hold EXECUTE through PUBLIC and the census
-- query would never reach 0. The PUBLIC pseudo-role is the real grant here
-- (same trap the 2026-07-29 public EXECUTE lockdown documents in the other
-- direction). postgres / service_role / admin-role grants are left untouched.
--
-- ROLLBACK (named)
-- ----------------
-- Forward migration re-granting, for exactly the names the implementing PR
-- lists (captured there as the pre-change grant table):
--   grant execute on function <schema>.<name>(...) to public, anon, authenticated;
-- For names whose only pre-change grant was the function default, `to public`
-- restores the original state; the explicit anon/authenticated grants it also
-- writes are harmless and match the 24 functions that had explicit grants.
--
-- Catalog-driven loop (repository pattern, 20260729130000_production_safe_
-- public_execute_lockdown.sql): the list moves (78 on 2026-09-10, 133 on
-- 2026-11-15, 104 in scope today), and a hard-coded name list is exactly how
-- that migration aborted on production. The census predicate IS the scope.

begin;

do $$
declare
  r record;
  n integer := 0;
  remaining integer;
  platform_remaining integer;
  leftover text;
begin
  for r in
    select format('%I.%I(%s)', n.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid)) as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prorettype = 'trigger'::regtype
      and n.nspname not in ('auth', 'extensions',
                            'pg_catalog', 'storage', 'realtime', 'cron', 'repack')
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    order by 1
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated', r.sig);
    n := n + 1;
  end loop;

  raise notice 'revoked EXECUTE on % trigger function(s) in revocable scope', n;

  -- Assert: nothing reachable by anon/authenticated remains in scope.
  select count(*), string_agg(format('%I.%I', n.nspname, p.proname), ', ')
    into remaining, leftover
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.prorettype = 'trigger'::regtype
    and n.nspname not in ('auth', 'extensions',
                          'pg_catalog', 'storage', 'realtime', 'cron', 'repack')
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE'));

  if remaining > 0 then
    raise exception 'trigger functions still exposed after revoke: %', leftover;
  end if;

  -- Record the platform residual explicitly (out of this repo's authority).
  select count(*) into platform_remaining
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.prorettype = 'trigger'::regtype
    and n.nspname in ('pg_catalog', 'storage', 'realtime', 'cron', 'repack')
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE'));

  raise notice
    'platform-owned trigger functions left untouched (accepted boundary): %',
    platform_remaining;
end
$$;

commit;
