-- Lock down EXECUTE on SECURITY DEFINER functions in the `public` schema.
--
-- WHY THIS EXISTS
-- ---------------
-- On hosted Supabase, role `postgres` carries default privileges for schema
-- `public` that grant EXECUTE to `anon`, `authenticated` and `service_role` on
-- every function at creation time:
--
--   pg_default_acl (schema 'public', grantor 'postgres') =
--     postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres
--
-- Migrations across this repo therefore wrote:
--
--   revoke all on function public.f(...) from public;
--   grant execute on function public.f(...) to service_role;
--
-- believing that locked the function to service_role. It does not.
-- `revoke ... from public` removes only the PUBLIC pseudo-role; the explicit
-- anon/authenticated grants installed by the default ACL survive untouched.
-- `public` is PostgREST-exposed (pgrst.db_schemas includes `public`), so the
-- net effect is that a caller holding nothing but the project's ANON key can
-- POST /rest/v1/rpc/<name> and run a SECURITY DEFINER function as `postgres`,
-- bypassing RLS entirely.
--
-- Verified on preview (rjyboqwcdzcocqgmsyel) on 2026-07-29: of 99 SECURITY
-- DEFINER functions in `public`, 88 were EXECUTE-able by `anon` -- including
-- `public.sync_clickup_tasks(jsonb, text)` (writes pim.product, ingest.raw_record,
-- ingest.sync_run as postgres) and `public.execute_readonly_query(text)`.
--
-- Local/stock-Postgres testing cannot catch this: there are no anon/authenticated
-- roles, no Supabase default ACLs, and no PostgREST.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- 1. Root cause: strips EXECUTE from the `public`-schema default privileges, so
--    newly created functions are no longer auto-granted to anon/authenticated.
--    From here on, a function is reachable only if a migration grants it.
-- 2. Remediation, part A: revokes EXECUTE from `anon` on every callable
--    SECURITY DEFINER function in `public`, minus a small documented allowlist.
-- 3. Remediation, part B: revokes EXECUTE from `authenticated` as well on the
--    functions whose own migrations declared `to service_role` only -- i.e.
--    where the author's stated intent was already service-role-only.
--
-- Deliberately NOT changed here (see docs/security/public-schema-execute-audit.md):
--   * `authenticated` EXECUTE on app-facing functions (DAM search/facets, style-guide
--     tagging UI actions, etc.). Those may have real browser callers; revoking them
--     blind would break PopDAM/PopPIM. They are reported, not silently changed.
--   * Functions where a migration explicitly granted `anon` on purpose.
--   * Trigger and event-trigger functions: not directly callable and not exposed
--     by PostgREST.

begin;

-- ---------------------------------------------------------------------------
-- 1. Root cause: stop auto-granting EXECUTE on newly created public functions.
-- ---------------------------------------------------------------------------
-- Step 1a: strip the Supabase-installed anon/authenticated default grants.
-- Necessary, but NOT sufficient on its own -- see 1b.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

-- Step 1b: the event-trigger backstop.
--
-- ALTER DEFAULT PRIVILEGES alone cannot close this hole, and that was proved
-- empirically on preview rather than assumed. After 1a, the stored default ACL
-- for grantor `postgres` reads:
--     postgres=X/postgres | service_role=X/postgres
-- with no PUBLIC entry -- yet a function created immediately afterwards still
-- lands with:
--     =X/postgres | postgres=X/postgres | service_role=X/postgres
-- The leading `=X/` is PUBLIC, from PostgreSQL's own hardwired "functions are
-- EXECUTE-able by PUBLIC" default, which survives the ALTER. Adding
-- `revoke execute on functions from public` to the default privileges does not
-- remove it either (verified: the stored row is unchanged and the next function
-- still gets `=X/`). anon and authenticated are members of PUBLIC, so
-- has_function_privilege('anon', ...) stays true and the hole stays open.
--
-- There is also a second default-ACL row we do not control, granted by
-- `supabase_admin`, still listing anon and authenticated.
--
-- So the durable guard is an event trigger that revokes EXECUTE from PUBLIC,
-- anon and authenticated on every function created in `public`. This mirrors the
-- existing `public.rls_auto_enable()` event trigger, which enforces RLS on new
-- public tables for the same "the platform default is wrong for us" reason.
--
-- Ordering note: this fires at ddl_command_end, i.e. immediately after CREATE
-- FUNCTION. A migration that creates a function and then explicitly grants it
-- still works -- the revoke happens first, the intentional grant lands after and
-- wins. Only the *accidental* default grants are removed.
--
-- Scope note (deliberately narrow): this revokes PUBLIC and `anon` only, never
-- `authenticated`. `create or replace function` reports the CREATE FUNCTION tag
-- and preserves the existing ACL, so a future migration that merely patches a
-- function body would otherwise silently strip that function's `authenticated`
-- grant and break a logged-in app screen. Revoking only the unauthenticated
-- grantees closes the internet-facing hole permanently while making that class
-- of silent breakage impossible. `ALTER FUNCTION` is not covered for the same
-- reason -- it never widens an ACL, so there is nothing to defend against.
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
    where command_tag = 'CREATE FUNCTION'
      and object_type = 'function'
      and schema_name = 'public'
  loop
    begin
      execute format(
        'revoke execute on function %s from public, anon',
        cmd.object_identity
      );
      raise log 'lock_down_new_public_function_execute: locked %', cmd.object_identity;
    exception
      when others then
        -- Never let this break a migration; loud log, no silent success claim.
        raise warning 'lock_down_new_public_function_execute: FAILED to lock % (%)',
          cmd.object_identity, sqlerrm;
    end;
  end loop;
end;
$fn$;

drop event trigger if exists lock_down_new_public_function_execute_trg;
create event trigger lock_down_new_public_function_execute_trg
  on ddl_command_end
  when tag in ('CREATE FUNCTION')
  execute function public.lock_down_new_public_function_execute();

-- ---------------------------------------------------------------------------
-- 2. Revoke EXECUTE from `anon` on callable SECURITY DEFINER public functions.
-- ---------------------------------------------------------------------------
-- Allowlist rationale:
--   has_role / has_app_access        -- called from inside 237 RLS policies. `anon`
--                                       holds SELECT on 62 public tables, so those
--                                       policies do evaluate as `anon`; removing
--                                       EXECUTE would turn empty result sets into
--                                       hard 42501 errors.
--   get_dam_material_facets          -- migration explicitly granted `anon`.
--   refresh_style_tracker_item_bridge
--   search_style_tracker_link_candidates
--   upsert_style_tracker_value_resolution
--                                    -- ditto: explicit `grant ... to anon, ...`.
--                                       Reversing a deliberate grant is a separate
--                                       decision; flagged in the audit doc instead.
do $$
declare
  r record;
  n_revoked integer := 0;
begin
  for r in
    select p.oid,
           format(
             'public.%I(%s)',
             p.proname,
             pg_get_function_identity_arguments(p.oid)
           ) as sig
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    join pg_type t on t.oid = p.prorettype
    where ns.nspname = 'public'
      and p.prosecdef
      and t.typname not in ('trigger', 'event_trigger')
      and p.proname not in (
        'has_role',
        'has_app_access',
        'get_dam_material_facets',
        'refresh_style_tracker_item_bridge',
        'search_style_tracker_link_candidates',
        'upsert_style_tracker_value_resolution'
      )
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    -- Revoke the PUBLIC grant too: many of these were never revoked at all, and
    -- leaving PUBLIC=X would re-expose the function to anon via PUBLIC.
    execute format('revoke execute on function %s from public', r.sig);
    execute format('revoke execute on function %s from anon', r.sig);
    n_revoked := n_revoked + 1;
  end loop;

  raise notice 'revoked anon EXECUTE on % public SECURITY DEFINER function(s)', n_revoked;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Also revoke `authenticated` where the declared intent was service_role only.
-- ---------------------------------------------------------------------------
-- Each of these was created with `grant execute ... to service_role;` and no
-- other grantee. `authenticated` reached them purely through the default ACL.
do $$
declare
  r record;
  n_revoked integer := 0;
begin
  for r in
    select format(
             'public.%I(%s)',
             p.proname,
             pg_get_function_identity_arguments(p.oid)
           ) as sig
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    join pg_type t on t.oid = p.prorettype
    where ns.nspname = 'public'
      and p.prosecdef
      and t.typname not in ('trigger', 'event_trigger')
      and p.proname in (
        'advise_dam_search_query_indexes',
        'claim_dam_search_embedding_documents',
        'execute_readonly_query',
        'get_dam_search_embedding_status',
        'get_dam_search_performance_stats',
        'get_pdf_rich_extraction_hashes',
        'mark_dam_search_embedding_error',
        'record_failed_sync_run',
        'refresh_style_guide_file_tag_cache',
        'sync_clickup_tasks',
        'sync_coldlion_vendors',
        'upsert_dam_search_embedding',
        'upsert_pdf_rich_extraction'
      )
  loop
    execute format('revoke execute on function %s from authenticated', r.sig);
    -- Re-assert the intended grantee so intent is explicit in the final ACL.
    execute format('grant execute on function %s to service_role', r.sig);
    n_revoked := n_revoked + 1;
  end loop;

  raise notice 'revoked authenticated EXECUTE on % service_role-only function(s)', n_revoked;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Belt and braces for the function that prompted this migration.
-- ---------------------------------------------------------------------------
revoke execute on function public.sync_clickup_tasks(jsonb, text) from public, anon, authenticated;
grant execute on function public.sync_clickup_tasks(jsonb, text) to service_role;

revoke execute on function pim.sync_clickup_tasks(jsonb, text) from public, anon, authenticated;
grant execute on function pim.sync_clickup_tasks(jsonb, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Assert the outcome. Fail the migration rather than land a false sense of
--    security if anything above did not take.
-- ---------------------------------------------------------------------------
do $$
declare
  leaked text;
begin
  select string_agg(
           format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)),
           ', ' order by p.proname
         )
    into leaked
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  join pg_type t on t.oid = p.prorettype
  where ns.nspname = 'public'
    and p.prosecdef
    and t.typname not in ('trigger', 'event_trigger')
    and p.proname not in (
      'has_role',
      'has_app_access',
      'get_dam_material_facets',
      'refresh_style_tracker_item_bridge',
      'search_style_tracker_link_candidates',
      'upsert_style_tracker_value_resolution'
    )
    and has_function_privilege('anon', p.oid, 'EXECUTE');

  if leaked is not null then
    raise exception
      'anon still holds EXECUTE on public SECURITY DEFINER function(s): %', leaked;
  end if;
end
$$;

-- Prove the default-privileges fix actually holds, by creating a throwaway
-- function and asserting anon cannot reach it. This is the check that caught the
-- incomplete first version of this migration.
do $$
declare
  anon_x boolean;
  auth_x boolean;
begin
  create function public.__acl_probe_tmp() returns int
    language sql security definer as 'select 1';

  select has_function_privilege('anon', p.oid, 'EXECUTE'),
         has_function_privilege('authenticated', p.oid, 'EXECUTE')
    into anon_x, auth_x
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = '__acl_probe_tmp';

  drop function public.__acl_probe_tmp();

  -- anon is the guarantee: an unauthenticated caller holding only the project's
  -- ANON key must never reach a freshly created public function. `authenticated`
  -- is intentionally not asserted here -- see the scope note above.
  if anon_x then
    raise exception
      'newly created public functions are still reachable by anon (anon=%, authenticated=%)',
      anon_x, auth_x;
  end if;
end
$$;

do $$
begin
  if has_function_privilege('anon', 'public.sync_clickup_tasks(jsonb, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.sync_clickup_tasks(jsonb, text)', 'EXECUTE')
  then
    raise exception 'public.sync_clickup_tasks is still reachable by anon/authenticated';
  end if;

  if not has_function_privilege('service_role', 'public.sync_clickup_tasks(jsonb, text)', 'EXECUTE') then
    raise exception 'public.sync_clickup_tasks lost its service_role grant';
  end if;
end
$$;

commit;
