-- #6456: revoke API-role EXECUTE on public.rls_auto_enable(), the one
-- security-definer function the #6416 probe found callable with empty args
-- and erroring (HTTP 400) over the preview Data API as anon (2026-11-16).
--
-- DECISION (coordinator, 2026-11-16): revoke API-role execute (the
-- #6415/#6455 shape), keeping postgres/service_role.
--
-- Call-site verification (2026-11-16, edge-dev): ZERO application call sites
-- as anon/authenticated in popdam3, poppim-web, popcrm, pop-mock, or
-- supabase/tests. All repo references are in shared-db mirrors (docs,
-- migrations, scripts) — not application code. The function is an event-trigger
-- helper (auto-enables RLS on new tables); its event-trigger firing is
-- unaffected by role EXECUTE grants.
--
-- ROLLBACK (named): forward migration restoring the captured grants:
--   grant execute on function public.rls_auto_enable() to public, anon, authenticated;

begin;

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- Fail closed: prove the outcome rather than land a false sense of security.
do $$
begin
  if has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE')
  then
    raise exception 'public.rls_auto_enable() is still reachable by anon/authenticated';
  end if;
end
$$;

commit;
