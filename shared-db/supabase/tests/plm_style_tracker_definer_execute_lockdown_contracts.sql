-- Contract tests for 20261106163507_plm_security_definer_execute_lockdown.sql
-- (issue #4474, claim #5880). Self-contained begin/rollback: nothing persists
-- even when run directly; CI additionally wraps it
-- (.github/workflows/database-contract-tests.yml).
--
-- A. Catalogue: after the lockdown, neither plm SECURITY DEFINER function
--    holds an ACL entry for PUBLIC (grantee oid 0), anon or authenticated,
--    service_role keeps EXECUTE on both, and both stay SECURITY DEFINER. The
--    public.refresh_style_tracker_item_bridge() wrapper's authenticated grant
--    is deliberately NOT asserted here: it is a production-live property (the
--    ephemeral replay history does not reproduce it) and it is asserted by the
--    committed live-proof probe .github/live-proofs/4474.sql instead. Roles
--    absent from the test database simply match no ACL entry (null grantee),
--    so the assertions hold vacuously there and bind on Supabase-shaped
--    databases where the roles exist.
begin;

do $a$
declare
  v_bad text;
  v_anon oid := (select oid from pg_roles where rolname = 'anon');
  v_auth oid := (select oid from pg_roles where rolname = 'authenticated');
  v_svc  oid := (select oid from pg_roles where rolname = 'service_role');
begin
  -- A1: no PUBLIC/anon/authenticated ACL entry on either locked function.
  select string_agg(p.proname || ':' || a.privilege_type, ', ') into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(p.proacl) a
  where n.nspname = 'plm'
    and p.proname in ('apply_style_tracker_designer_resolutions', 'refresh_style_tracker_item_bridge')
    and a.grantee in (0, v_anon, v_auth);
  if v_bad is not null then
    raise exception 'A1 PUBLIC/anon/authenticated still hold % on the locked plm functions', v_bad;
  end if;

  -- A2: service_role still holds EXECUTE on both.
  if v_svc is not null then
    select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(p.proacl) a
    where n.nspname = 'plm'
      and p.proname in ('apply_style_tracker_designer_resolutions', 'refresh_style_tracker_item_bridge')
      and a.grantee = v_svc and a.privilege_type = 'EXECUTE';
    if v_bad is null then
      raise exception 'A2 service_role lost EXECUTE on the locked plm functions';
    end if;
  end if;

  -- A3: both locked functions are still SECURITY DEFINER (the lockdown must not
  -- have altered them any other way).
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'plm'
    and p.proname in ('apply_style_tracker_designer_resolutions', 'refresh_style_tracker_item_bridge')
    and not p.prosecdef;
  if v_bad is not null then
    raise exception 'A3 % stopped being SECURITY DEFINER', v_bad;
  end if;

  -- A4: the public zero-arg wrapper is untouched by this change: this
  -- migration writes no DDL against public.* (checked by the migration body
  -- itself and by admission's exact-object match), so no catalogue assertion is
  -- needed here; the wrapper's live authenticated grant is proven on production
  -- by .github/live-proofs/4474.sql.
end
$a$;

rollback;
