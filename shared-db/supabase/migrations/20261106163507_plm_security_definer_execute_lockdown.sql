-- Lock down EXECUTE on the two callable SECURITY DEFINER functions in `plm`
-- that 20260729120000 did not cover (it locked down schema `public` only).
--
-- WHY THIS EXISTS (#4474)
-- -----------------------
-- `plm.apply_style_tracker_designer_resolutions()` and
-- `plm.refresh_style_tracker_item_bridge()` are SECURITY DEFINER, owned by
-- `postgres`, and both write `plm.style_tracker_item_bridge`. On production
-- (qsllyeztdwjgirsysgai, read-only, re-verified 2026-11-06 ~10:00 AM EST and
-- before that 2026-11-05 5:45 PM EST) both carried
--
--   proacl = {=X/postgres, postgres=X/postgres, service_role=X/postgres}
--
-- The leading `=X/postgres` is PostgreSQL's hardwired "functions are
-- EXECUTE-able by PUBLIC" default. anon and authenticated are members of
-- PUBLIC, so has_function_privilege('anon'|'authenticated', ...) returned
-- true for both, and every designflow_prod_*_grants role read true purely
-- through PUBLIC membership.
--
-- `plm` is not in pgrst.db_schemas (public, graphql_public, api, crm, pim,
-- core, app), so PostgREST RPC cannot reach plm.* today; the exposure is the
-- direct-role/latent one. The 20260729120000 lockdown could not have covered
-- it: that migration's event trigger and default-privilege repair are scoped
-- to schema `public` only.
--
-- Consumer impact (verified read-only 2026-11-05 against origin/main of
-- popdam3, poppim-web, popcrm-web, popcre/designflow-*): zero legitimate
-- anon/authenticated callers of either plm function. The browser calls the
-- UNQUALIFIED rpc `refresh_style_tracker_item_bridge`, which resolves to the
-- `public.refresh_style_tracker_item_bridge()` zero-arg wrapper; that wrapper
-- is a deliberate allowlist entry of 20260729120000 and keeps its
-- authenticated grant — untouched here.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- Revokes EXECUTE from PUBLIC, anon and authenticated on the two zero-arg
-- plm functions (the only overloads that exist), re-asserts the service_role
-- grant so the final ACL states intent explicitly, then fails closed if
-- either role can still run either function or service_role lost access.
begin;

revoke execute on function plm.apply_style_tracker_designer_resolutions() from public, anon, authenticated;
grant  execute on function plm.apply_style_tracker_designer_resolutions() to service_role;

revoke execute on function plm.refresh_style_tracker_item_bridge() from public, anon, authenticated;
grant  execute on function plm.refresh_style_tracker_item_bridge() to service_role;

-- Fail closed: prove the outcome rather than land a false sense of security.
do $$
begin
  if has_function_privilege('anon', 'plm.apply_style_tracker_designer_resolutions()', 'EXECUTE')
     or has_function_privilege('authenticated', 'plm.apply_style_tracker_designer_resolutions()', 'EXECUTE')
  then
    raise exception 'plm.apply_style_tracker_designer_resolutions() is still reachable by anon/authenticated';
  end if;

  if has_function_privilege('anon', 'plm.refresh_style_tracker_item_bridge()', 'EXECUTE')
     or has_function_privilege('authenticated', 'plm.refresh_style_tracker_item_bridge()', 'EXECUTE')
  then
    raise exception 'plm.refresh_style_tracker_item_bridge() is still reachable by anon/authenticated';
  end if;

  if not has_function_privilege('service_role', 'plm.apply_style_tracker_designer_resolutions()', 'EXECUTE') then
    raise exception 'plm.apply_style_tracker_designer_resolutions() lost its service_role grant';
  end if;

  if not has_function_privilege('service_role', 'plm.refresh_style_tracker_item_bridge()', 'EXECUTE') then
    raise exception 'plm.refresh_style_tracker_item_bridge() lost its service_role grant';
  end if;
end
$$;

commit;
