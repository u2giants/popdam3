-- Contracts for the worker EXECUTE grants of
-- 20261102202014_dam_search_embed_rpc_worker_grants.sql (#5492, review finding #5496).
--
-- What is being pinned:
--   1. dam_image_embed_worker (the NOLOGIN parent of the GPU poller's
--      dam_image_embed_login) holds EXECUTE on all four dam_search embedding
--      RPCs. The defining migrations use `drop function if exists` + `create
--      function`, which discards the ACL: any later re-creation of one of
--      these functions silently strips the worker grant and re-breaks the
--      durable search lane (u2giants/popdam3#646) with
--      `permission denied for function`. This test FAILS in that state.
--   2. anon and authenticated hold NO EXECUTE on the claim function: client
--      roles must not gain the lane through this grant (or through PUBLIC).
--   3. The detector itself can fail: inside a savepoint the worker grant is
--      revoked and the same check must report it, then the savepoint is
--      rolled back.
--
-- This test FAILS against the pre-20261102202014 ACL, where only postgres
-- and service_role held EXECUTE.

begin;

create or replace function pg_temp.dam_search_embed_grant_violations()
returns text
language plpgsql
as $$
declare
  v_bad text;
begin
  if not exists (select 1 from pg_roles where rolname = 'dam_image_embed_worker') then
    return 'role dam_image_embed_worker is missing';
  end if;

  select string_agg(x, '; ' order by x) into v_bad from (
    select f || ' lacks EXECUTE for dam_image_embed_worker' as x
      from unnest(array[
        'public.claim_dam_search_embedding_documents(integer, text, integer)',
        'public.upsert_dam_search_embedding(text, uuid, text, uuid, extensions.vector, text)',
        'public.mark_dam_search_embedding_error(text, uuid, text, uuid, text, text)',
        'public.get_dam_search_embedding_status()'
      ]) f
     where not has_function_privilege('dam_image_embed_worker', f, 'EXECUTE')
    union all
    select r || ' may EXECUTE the claim RPC'
      from unnest(array['anon', 'authenticated']) r
     where has_function_privilege(r, 'public.claim_dam_search_embedding_documents(integer, text, integer)', 'EXECUTE')
    union all
    select 'PUBLIC may EXECUTE the claim RPC'
     where exists (
       select 1
         from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = 'public.claim_dam_search_embedding_documents(integer, text, integer)'::regprocedure
          and a.grantee = 0 and a.privilege_type = 'EXECUTE')
  ) s;

  return v_bad;
end;
$$;

do $contract$
declare
  v_bad text := pg_temp.dam_search_embed_grant_violations();
begin
  if v_bad is not null then
    raise exception 'CONTRACT (#5492 / #5496): dam_search embedding RPC ACL is wrong: %', v_bad;
  end if;
  raise notice 'OK: dam_search embedding RPCs executable by dam_image_embed_worker; client roles hold nothing.';
end
$contract$;

-- Instrument check: the detector must report a stripped worker grant.
savepoint prove_detector_can_fail;
revoke execute on function public.claim_dam_search_embedding_documents(integer, text, integer) from dam_image_embed_worker;
do $mutation$
declare
  v_bad text := pg_temp.dam_search_embed_grant_violations();
begin
  if v_bad is null or position('lacks EXECUTE for dam_image_embed_worker' in v_bad) = 0 then
    raise exception 'CONTRACT (#5492 / #5496): detector did not flag a stripped worker grant (got %)', v_bad;
  end if;
  raise notice 'OK: detector flags a stripped worker grant.';
end
$mutation$;
rollback to savepoint prove_detector_can_fail;

rollback;
