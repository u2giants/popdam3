-- Production-safe re-issue of the `public` schema EXECUTE lockdown.
--
-- WHY THIS FILE EXISTS (read before assuming it is duplicated work)
-- -----------------------------------------------------------------
-- `20260729120000_lock_down_public_security_definer_execute.sql` cannot be applied
-- to production. Its step 4 hard-codes object names:
--
--   revoke execute on function public.sync_clickup_tasks(jsonb, text) from public, anon, authenticated;
--   revoke execute on function pim.sync_clickup_tasks(jsonb, text)    from public, anon, authenticated;
--
-- `sync_clickup_tasks` does not exist on production. It is created by
-- `20260728174500_clickup_incremental_task_import_reissue.sql`, which is still
-- PENDING on production (verified 2026-07-29: 15 migrations pending, that one
-- among them; `select ... from pg_proc where proname='sync_clickup_tasks'`
-- returns nothing on qsllyeztdwjgirsysgai). `revoke` on a non-existent function
-- raises `undefined_function`, so 20260729120000 would abort the whole
-- production apply.
--
-- AGENTS.md §5 rightly warns against re-issuing a migration's SQL under a fresh
-- timestamp, because the original then stays pending forever. That is not what
-- happens here: 20260729120000 remains valid and will apply cleanly to
-- production later, because 20260728174500 sorts BEFORE it and will have created
-- `sync_clickup_tasks` by then. Both are idempotent, so the replay is a no-op.
-- Editing the landed migration was rejected deliberately -- it is already applied
-- to the preview branch and landed migrations are not edited.
--
-- This file therefore contains only the parts of 20260729120000 that are driven
-- by catalog lookups and so cannot reference a missing object. Nothing here is
-- hard-coded.
--
-- VERSION ORDERING MATTERS
-- ------------------------
-- This is deliberately timestamped 20260729130000, i.e. BETWEEN 20260729120000
-- and 20260729180000. `20260729180000` ends with an assertion that no SECURITY
-- DEFINER routine in `public` other than `has_role`/`has_app_access` is
-- anon-reachable. On production that assertion can only pass if this sweep has
-- already run. Timestamping this file after 180000 would make the production
-- apply fail on that assertion.
--
-- For the full background on the vulnerability -- why `revoke ... from public`
-- alone is insufficient on hosted Supabase, and why ALTER DEFAULT PRIVILEGES
-- cannot close it on its own -- see
-- docs/security/public-schema-execute-audit.md.

begin;

-- ---------------------------------------------------------------------------
-- 1. Strip the Supabase-installed anon/authenticated default grants.
--    Necessary but not sufficient on its own; the event trigger created in
--    20260729180000 is the actual durable guard. Idempotent.
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Revoke PUBLIC + anon EXECUTE on every callable SECURITY DEFINER routine
--    in `public`, minus the documented allowlist.
-- ---------------------------------------------------------------------------
-- Allowlist rationale:
--   has_role / has_app_access   -- called from inside RLS policies that genuinely
--                                  evaluate as `anon` (anon holds SELECT on
--                                  `public` tables), so removing EXECUTE turns
--                                  empty result sets into hard 42501 errors.
--   get_dam_material_facets     -- SECURITY INVOKER; excluded by the prosecdef
--                                  filter anyway. Named only for the reader.
--   the three style-tracker fns -- handled by 20260729180000, which revokes anon
--                                  while preserving the logged-in path.
--
-- `prokind in ('f','p')` and `revoke execute on routine` cover procedures as well
-- as functions: a SECURITY DEFINER *procedure* in `public` would inherit the same
-- anon-executable default ACL. (20260729120000 filtered functions only.)
do $$
declare
  r record;
  n_revoked integer := 0;
begin
  for r in
    select format('public.%I(%s)', p.proname,
                  pg_get_function_identity_arguments(p.oid)) as sig
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    join pg_type t on t.oid = p.prorettype
    where ns.nspname = 'public'
      and p.prosecdef
      and p.prokind in ('f', 'p')
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
    execute format('revoke execute on routine %s from public, anon', r.sig);
    n_revoked := n_revoked + 1;
  end loop;

  raise notice 'revoked PUBLIC+anon EXECUTE on % public SECURITY DEFINER routine(s)', n_revoked;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Also revoke `authenticated` where the declared intent was service_role only.
-- ---------------------------------------------------------------------------
-- Each of these was created with `grant execute ... to service_role;` and no other
-- grantee; `authenticated` reached them purely through the default ACL. Driven by
-- a catalog lookup, so any name absent from this database is simply skipped --
-- which is exactly why this migration is production-safe and 20260729120000 is not.
--
-- Caller-traced 2026-07-29 to confirm none is a browser caller:
--   get_dam_search_embedding_status  -> popdam3 supabase/functions/dam-search-ai (edge fn, service_role)
--   get_pdf_rich_extraction_hashes   -> popdam3 apps/worker/src/handlers/rich-pdf.ts (worker, service_role)
--   upsert_pdf_rich_extraction       -> same worker
-- The rest are importers, job-claim helpers or diagnostics.
do $$
declare
  r record;
  n_revoked integer := 0;
begin
  for r in
    select format('public.%I(%s)', p.proname,
                  pg_get_function_identity_arguments(p.oid)) as sig
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    join pg_type t on t.oid = p.prorettype
    where ns.nspname = 'public'
      and p.prosecdef
      and p.prokind in ('f', 'p')
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
    execute format('revoke execute on routine %s from authenticated', r.sig);
    -- Re-assert the intended grantee so intent is explicit in the final ACL.
    execute format('grant execute on routine %s to service_role', r.sig);
    n_revoked := n_revoked + 1;
  end loop;

  raise notice 'revoked authenticated EXECUTE on % service_role-only routine(s)', n_revoked;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Assert the outcome. Fail rather than land a false sense of security.
-- ---------------------------------------------------------------------------
-- The three style-tracker functions are still expected to be anon-reachable at
-- this point: 20260729180000 revokes them, and it runs after this file.
do $$
declare
  leaked text;
begin
  select string_agg(format('public.%s', p.proname), ', ' order by p.proname)
    into leaked
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  join pg_type t on t.oid = p.prorettype
  where ns.nspname = 'public'
    and p.prosecdef
    and p.prokind in ('f', 'p')
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
      'anon still holds EXECUTE on public SECURITY DEFINER routine(s): %', leaked;
  end if;
end
$$;

commit;
