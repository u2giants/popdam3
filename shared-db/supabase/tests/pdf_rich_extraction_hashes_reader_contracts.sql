-- Contracts for the failed-extraction reader expansion of migration
-- 20261105041612_rich_pdf_retry_status.sql (PR #5627, claim #5626), consumed by
-- the popdam3 worker's bounded retry for failed rich-PDF extraction
-- (u2giants/popdam3#469, app PR #779).
--
-- What is being pinned:
--   1. public.get_pdf_rich_extraction_hashes(uuid[]) returns EXACTLY
--      (asset_id uuid, source_text_sha256 text, parse_error text,
--      extracted_at timestamp with time zone), in that order. The worker reads
--      parse_error and extracted_at to tell a finished success (same hash, skip
--      forever) from a saved provider failure (same hash, retry after cooldown).
--      A later drop/recreate that narrows the row type silently re-breaks that
--      retry: a failed extraction under an unchanged text hash becomes
--      permanently "done" with empty data again.
--   2. The VALUES come from dam.pdf_rich_extraction, including a saved failure
--      (non-null parse_error) and its extraction time, and only for the
--      requested assets.
--   3. EXECUTE is service_role only. anon, authenticated and PUBLIC hold
--      nothing -- including the NULL-proacl trap (NULL proacl is the DEFAULT
--      acl, EXECUTE to PUBLIC). The reader exposes extraction text hashes and
--      provider failure messages; a browser role must not reach it.
--   4. SECURITY DEFINER with search_path pinned to empty, as the migration
--      created it, so the body cannot be redirected through a caller's path.
--
-- The detector itself is proved able to fail (savepoint probe), following
-- dam_search_embed_worker_execute_grants_contracts.sql.
-- Synthetic rows use ZZTEST-469 names only and are rolled back; nothing
-- survives this test.

begin;

-- =====================================================================================
-- A. Preconditions + catalog facts (necessary, and by themselves not sufficient).
-- =====================================================================================
create or replace function pg_temp.pdf_rich_extraction_hashes_acl_violations()
returns text
language plpgsql
as $$
declare
  v_bad text;
begin
  select string_agg(x, '; ' order by x) into v_bad from (
    select 'service_role lacks EXECUTE on get_pdf_rich_extraction_hashes' as x
     where not has_function_privilege('service_role', 'public.get_pdf_rich_extraction_hashes(uuid[])', 'EXECUTE')
    union all
    select r || ' may EXECUTE the worker-only reader'
      from unnest(array['anon', 'authenticated']) r
     where has_function_privilege(r, 'public.get_pdf_rich_extraction_hashes(uuid[])', 'EXECUTE')
    union all
    select 'PUBLIC may EXECUTE the worker-only reader'
     where exists (
       select 1
         from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = 'public.get_pdf_rich_extraction_hashes(uuid[])'::regprocedure
          and a.grantee = 0 and a.privilege_type = 'EXECUTE')
  ) s;
  return v_bad;
end;
$$;

do $$
declare
  v_sig text;
  v_bad text;
begin
  if to_regprocedure('public.get_pdf_rich_extraction_hashes(uuid[])') is null then
    raise exception 'CONTRACT (#5626): public.get_pdf_rich_extraction_hashes(uuid[]) does not exist';
  end if;

  -- Return shape: names, types and order of the table columns.
  -- proallargtypes is oidvector; unnest() takes anyarray, so it must be cast.
  select string_agg(a.name || ' ' || format_type(a.typ, null), ',' order by a.ord)
    into v_sig
    from pg_proc p
    cross join lateral unnest(p.proargnames, p.proargmodes, p.proallargtypes::oid[])
      with ordinality as a(name, mode, typ, ord)
   where p.oid = 'public.get_pdf_rich_extraction_hashes(uuid[])'::regprocedure
     and a.mode in ('o', 't', 'b');
  if coalesce(v_sig, '') <> 'asset_id uuid,source_text_sha256 text,parse_error text,extracted_at timestamp with time zone' then
    raise exception 'CONTRACT (#5626): reader return shape drifted, got %', coalesce(v_sig, '<none>');
  end if;

  -- Security posture pinned by 20261105041612.
  if not exists (select 1 from pg_proc
                  where oid = 'public.get_pdf_rich_extraction_hashes(uuid[])'::regprocedure
                    and prosecdef) then
    raise exception 'CONTRACT (#5626): reader is not SECURITY DEFINER';
  end if;
  if not exists (
    select 1
      from pg_proc p, unnest(coalesce(p.proconfig, '{}'::text[])) cfg
     where p.oid = 'public.get_pdf_rich_extraction_hashes(uuid[])'::regprocedure
       and cfg like 'search_path=%') then
    raise exception 'CONTRACT (#5626): reader search_path is not pinned';
  end if;

  v_bad := pg_temp.pdf_rich_extraction_hashes_acl_violations();
  if v_bad is not null then
    raise exception 'CONTRACT (#5626): reader ACL is wrong: %', v_bad;
  end if;
  raise notice 'OK: reader shape, security posture and service_role-only ACL.';
end
$$;

-- =====================================================================================
-- B. Behavioural read: saved hash, saved failure and failure age come through,
--    only for the requested assets.
-- =====================================================================================
do $$
declare
  a_fail uuid;
  a_ok uuid;
  a_missing uuid := '00000000-0000-4000-8000-00000000dead';
  v_row record;
  v_n int;
begin
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at)
    values ('zz469-fail.pdf', 'zz469/zz469-fail.pdf', 'pdf', 'zz469-fail', now())
    returning id into a_fail;
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at)
    values ('zz469-ok.pdf', 'zz469/zz469-ok.pdf', 'pdf', 'zz469-ok', now())
    returning id into a_ok;

  insert into dam.pdf_rich_extraction (asset_id, source_text_sha256, parse_error, extracted_at, data)
    values (a_fail, 'zz469-hash-fail', 'ZZTEST-469 provider outage', now() - interval '2 days', '{}'),
           (a_ok,   'zz469-hash-ok',   null,                        now() - interval '2 days', '{}');

  select count(*) into v_n
    from public.get_pdf_rich_extraction_hashes(array[a_fail, a_ok, a_missing]);
  if v_n <> 2 then
    raise exception 'CONTRACT (#5626): reader returned % rows for 2 saved assets (missing id must not appear)', v_n;
  end if;

  select * into v_row from public.get_pdf_rich_extraction_hashes(array[a_fail]);
  if v_row.asset_id is distinct from a_fail
     or v_row.source_text_sha256 is distinct from 'zz469-hash-fail'
     or v_row.parse_error is distinct from 'ZZTEST-469 provider outage'
     or v_row.extracted_at is null then
    raise exception 'CONTRACT (#5626): failure row did not come through intact (hash %, parse_error %, extracted_at %)',
      v_row.source_text_sha256, v_row.parse_error, v_row.extracted_at;
  end if;

  select * into v_row from public.get_pdf_rich_extraction_hashes(array[a_ok]);
  if v_row.parse_error is not null or v_row.source_text_sha256 is distinct from 'zz469-hash-ok' then
    raise exception 'CONTRACT (#5626): success row did not come through intact (hash %, parse_error %)',
      v_row.source_text_sha256, v_row.parse_error;
  end if;
  raise notice 'OK: reader returns saved hash, parse_error and extracted_at per requested asset.';
end
$$;

-- =====================================================================================
-- C. Execute-as-role probes: the ACL is exercised AS the roles it constrains.
-- =====================================================================================
set local role service_role;
do $$
declare
  v_n int;
begin
  select count(*) into v_n from public.get_pdf_rich_extraction_hashes(array[]::uuid[]);
  raise notice 'OK: service_role executed the reader (% rows for an empty id list)', v_n;
end
$$;
reset role;

set local role anon;
do $$
begin
  begin
    perform 1 from public.get_pdf_rich_extraction_hashes(array[]::uuid[]);
    raise exception 'CONTRACT (#5626): anon executed the worker-only reader';
  exception when insufficient_privilege then
    raise notice 'OK: anon denied EXECUTE on the worker-only reader.';
  end;
end
$$;
reset role;

set local role authenticated;
do $$
begin
  begin
    perform 1 from public.get_pdf_rich_extraction_hashes(array[]::uuid[]);
    raise exception 'CONTRACT (#5626): authenticated executed the worker-only reader';
  exception when insufficient_privilege then
    raise notice 'OK: authenticated denied EXECUTE on the worker-only reader.';
  end;
end
$$;
reset role;

-- =====================================================================================
-- D. Detector check: a stripped service_role grant must be flagged.
-- =====================================================================================
savepoint prove_detector_can_fail;
revoke execute on function public.get_pdf_rich_extraction_hashes(uuid[]) from service_role;
do $$
declare
  v_bad text := pg_temp.pdf_rich_extraction_hashes_acl_violations();
begin
  if v_bad is null or position('service_role lacks EXECUTE' in v_bad) = 0 then
    raise exception 'CONTRACT (#5626): detector did not flag a stripped service_role grant (got %)', v_bad;
  end if;
  raise notice 'OK: detector flags a stripped service_role grant.';
end
$$;
rollback to savepoint prove_detector_can_fail;

rollback;
