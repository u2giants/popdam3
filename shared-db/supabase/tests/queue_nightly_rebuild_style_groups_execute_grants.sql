-- Contracts for the #2769 EXECUTE restriction on public.queue_nightly_rebuild_style_groups().
--
-- What is being pinned:
--   1. PUBLIC, anon and authenticated hold NO EXECUTE on the function. It is SECURITY DEFINER
--      and owned by postgres, so any grant to a client role lets a signed-in (or anonymous)
--      API caller enqueue a full style-group rebuild with owner rights.
--   2. postgres (the pg_cron role) and service_role keep EXECUTE, so the */10 poll and
--      server-side operators still work.
--   3. The detector itself can fail: inside a savepoint the old authenticated grant is
--      restored and the same check must report it, then the savepoint is rolled back.
--
-- This test FAILS against the pre-#2769 ACL, which granted EXECUTE to authenticated.

begin;

create or replace function pg_temp.rebuild_queue_grant_violations()
returns text
language plpgsql
as $$
declare
  v_oid oid := to_regprocedure('public.queue_nightly_rebuild_style_groups()');
  v_bad text;
begin
  if v_oid is null then
    return 'function public.queue_nightly_rebuild_style_groups() is missing';
  end if;

  select string_agg(x, '; ' order by x) into v_bad from (
    -- has_function_privilege honours PUBLIC membership, so anon/authenticated also catch
    -- a grant made to PUBLIC.
    select r || ' may EXECUTE' as x
      from unnest(array['anon', 'authenticated']) r
     where has_function_privilege(r, v_oid, 'EXECUTE')
    union all
    select 'PUBLIC holds EXECUTE'
     where exists (
       select 1
         from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = v_oid and a.grantee = 0 and a.privilege_type = 'EXECUTE')
    union all
    select r || ' lost EXECUTE'
      from unnest(array['service_role', 'postgres']) r
     where not has_function_privilege(r, v_oid, 'EXECUTE')
  ) s;

  return v_bad;
end;
$$;

do $contract$
declare
  v_bad text := pg_temp.rebuild_queue_grant_violations();
begin
  if v_bad is not null then
    raise exception 'CONTRACT (#2769): EXECUTE on queue_nightly_rebuild_style_groups() is wrong: %', v_bad;
  end if;
  raise notice 'OK: queue_nightly_rebuild_style_groups() is executable only by postgres and service_role.';
end
$contract$;

-- Instrument check: the detector must report a restored client grant.
savepoint prove_detector_can_fail;
grant execute on function public.queue_nightly_rebuild_style_groups() to authenticated;
do $mutation$
declare
  v_bad text := pg_temp.rebuild_queue_grant_violations();
begin
  if v_bad is null or position('authenticated may EXECUTE' in v_bad) = 0 then
    raise exception 'CONTRACT (#2769): detector did not flag a restored authenticated grant (got %)', v_bad;
  end if;
  raise notice 'OK: detector flags a restored authenticated grant.';
end
$mutation$;
rollback to savepoint prove_detector_can_fail;

rollback;
