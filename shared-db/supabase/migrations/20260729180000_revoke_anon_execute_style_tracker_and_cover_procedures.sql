-- Follow-up to 20260729120000_lock_down_public_security_definer_execute.sql
--
-- That migration closed the accidental anon exposure created by Supabase's
-- default ACLs, but deliberately spared four functions that a migration had
-- explicitly granted to `anon` on purpose. Reversing a deliberate grant is a
-- different decision from fixing an accidental one, so it was reported rather
-- than changed. This migration makes that decision, having now traced the real
-- callers.
--
-- Reviewed independently by GLM 5.2 (`.ai/reviews/20260729-public-execute-lockdown-glm.md`),
-- which flagged the remaining anonymous WRITE as a fast-follow rather than
-- backlog. Verified against production before writing this.
--
-- ---------------------------------------------------------------------------
-- 1. Why the remaining anon grants have to go
-- ---------------------------------------------------------------------------
-- `public.upsert_style_tracker_value_resolution(...)` is SECURITY DEFINER and
-- WRITES: it upserts `plm.style_tracker_value_resolution` and rewrites
-- `plm.style_tracker_item_bridge`, including setting `creative_designer_id` and
-- flipping `match_status` to matched/verified. Granted to `anon`, an
-- unauthenticated caller holding only the public ANON key could link tracker
-- rows to arbitrary entities and mark them verified. That is unauthenticated
-- data tampering, confirmed live on production (qsllyeztdwjgirsysgai) on
-- 2026-07-29.
--
-- `public.refresh_style_tracker_item_bridge()` lets an anonymous caller trigger
-- a full bridge rebuild (resource abuse).
--
-- `public.search_style_tracker_link_candidates(...)` returns fuzzy-matched ids
-- and names from `core.customer` / licensor data to an anonymous caller
-- (information disclosure).
--
-- ---------------------------------------------------------------------------
-- 2. Why this does not break the app
-- ---------------------------------------------------------------------------
-- All three are called from PopDAM's `src/pages/StylesPage.tsx`
-- (u2giants/popdam3) -- a browser page behind login. A logged-in user
-- authenticates as `authenticated`, NOT `anon`, so removing the `anon` grant
-- does not affect that screen. Their production ACLs before this migration each
-- carried both grants:
--     postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres
-- This migration removes PUBLIC and `anon` only, and re-asserts `authenticated`
-- and `service_role` explicitly so the intent is visible in the final ACL.
--
-- `public.get_dam_material_facets()` was in the previous migration's allowlist
-- but is SECURITY INVOKER, so it was always a no-op there and is left alone
-- here: an invoker-rights function runs as the caller and is still subject to
-- RLS. Documented to stop the next reader hunting for a bug.

begin;

do $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select format('public.%I(%s)', p.proname,
                  pg_get_function_identity_arguments(p.oid)) as sig
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.prokind = 'f'
      and p.prosecdef
      and p.proname in (
        'upsert_style_tracker_value_resolution',
        'refresh_style_tracker_item_bridge',
        'search_style_tracker_link_candidates'
      )
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
    n := n + 1;
  end loop;

  raise notice 'revoked anon EXECUTE on % style-tracker function(s)', n;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Close the procedure gap in the event-trigger backstop
-- ---------------------------------------------------------------------------
-- The previous version filtered on `command_tag = 'CREATE FUNCTION'` and
-- `object_type = 'function'`, so a SECURITY DEFINER *procedure* created in
-- `public` would inherit the same anon-executable default ACL and never be
-- locked down. There are no SECURITY DEFINER procedures in `public` on
-- production today (verified 2026-07-29), so this is a latent trap rather than a
-- live hole -- but the guard is only worth having if it is complete.
--
-- `revoke execute on routine` covers both functions and procedures (PG11+).
create or replace function public.lock_down_new_public_function_execute()
  returns event_trigger
  language plpgsql
  security definer
  set search_path to 'pg_catalog'
as $fn$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE FUNCTION', 'CREATE PROCEDURE')
      and object_type in ('function', 'procedure')
      and schema_name = 'public'
  loop
    begin
      execute format(
        'revoke execute on routine %s from public, anon',
        cmd.object_identity
      );
      raise log 'lock_down_new_public_function_execute: locked %', cmd.object_identity;
    exception
      when others then
        -- Never break a migration; loud log, never a silent success.
        raise warning 'lock_down_new_public_function_execute: FAILED to lock % (%)',
          cmd.object_identity, sqlerrm;
    end;
  end loop;
end;
$fn$;

drop event trigger if exists lock_down_new_public_function_execute_trg;
create event trigger lock_down_new_public_function_execute_trg
  on ddl_command_end
  when tag in ('CREATE FUNCTION', 'CREATE PROCEDURE')
  execute function public.lock_down_new_public_function_execute();

-- ---------------------------------------------------------------------------
-- 4. Assert the outcome, for functions AND procedures.
-- ---------------------------------------------------------------------------
do $$
declare
  leaked text;
begin
  -- Only has_role / has_app_access may remain anon-reachable. They are called
  -- from inside RLS policies that genuinely evaluate as `anon`, so removing
  -- EXECUTE would turn empty result sets into hard 42501 errors app-wide.
  select string_agg(format('%s.%s', ns.nspname, p.proname), ', ' order by p.proname)
    into leaked
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  join pg_type t on t.oid = p.prorettype
  where ns.nspname = 'public'
    and p.prosecdef
    and p.prokind in ('f', 'p')
    and t.typname not in ('trigger', 'event_trigger')
    and p.proname not in ('has_role', 'has_app_access')
    and has_function_privilege('anon', p.oid, 'EXECUTE');

  if leaked is not null then
    raise exception
      'anon still holds EXECUTE on public SECURITY DEFINER routine(s): %', leaked;
  end if;
end
$$;

-- The app must keep working: assert the logged-in path survived.
do $$
declare
  missing text;
begin
  select string_agg(p.proname, ', ' order by p.proname)
    into missing
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in (
      'upsert_style_tracker_value_resolution',
      'refresh_style_tracker_item_bridge',
      'search_style_tracker_link_candidates'
    )
    and not has_function_privilege('authenticated', p.oid, 'EXECUTE');

  if missing is not null then
    raise exception
      'PopDAM StylesPage would break: authenticated lost EXECUTE on %', missing;
  end if;
end
$$;

commit;
