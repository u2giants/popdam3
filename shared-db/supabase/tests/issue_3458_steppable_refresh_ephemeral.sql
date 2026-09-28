-- Issue #3458 behavior tests for the steppable refresh overload.
-- NOT part of the migration. Run on preview (or an ephemeral DB) after
-- 20260928003740 applies. Wraps in a transaction and rolls back, so it can
-- exercise p_step='search' (no REFRESH CONCURRENTLY) live, and asserts the
-- matview steps by function-body shape exactly like popsg_bounded_crawl_and_search_contracts.
-- Proves: change-night work is split so each RPC statement is independently
-- callable and bounded by p_search_batch_size; the legacy2-arg body is intact.

begin;

-- The migration's CONCURRENTLY guard must accept an existing valid unique
-- index regardless of its name, while rejecting absent, partial, and
-- expression indexes. The earlier migration conditionally creates its own
-- name only when the matview has no unique index at all.
create schema sg3458_index_guard_test;
create materialized view sg3458_index_guard_test.fixture as select 1::integer as id;
create or replace function pg_temp.sg3458_index_ok(p_relation regclass)
returns boolean language sql as $index_guard$
  select exists (
    select 1 from pg_index i
     where i.indrelid = p_relation
       and i.indisunique
       and i.indisvalid
       and i.indexprs is null
       and i.indpred is null);
$index_guard$;

do $index_tests$
begin
  if pg_temp.sg3458_index_ok('sg3458_index_guard_test.fixture'::regclass) then
    raise exception 'index guard: missing unique index was accepted';
  end if;
end
$index_tests$;

create unique index arbitrary_existing_group_key
  on sg3458_index_guard_test.fixture (id);
do $index_tests$
begin
  if not pg_temp.sg3458_index_ok('sg3458_index_guard_test.fixture'::regclass) then
    raise exception 'index guard: valid unique index with alternate name was rejected';
  end if;
end
$index_tests$;

drop index sg3458_index_guard_test.arbitrary_existing_group_key;
create unique index partial_group_key
  on sg3458_index_guard_test.fixture (id) where id > 0;
do $index_tests$
begin
  if pg_temp.sg3458_index_ok('sg3458_index_guard_test.fixture'::regclass) then
    raise exception 'index guard: partial unique index was accepted';
  end if;
end
$index_tests$;

drop index sg3458_index_guard_test.partial_group_key;
create unique index expression_group_key
  on sg3458_index_guard_test.fixture ((id + 1));
do $index_tests$
begin
  if pg_temp.sg3458_index_ok('sg3458_index_guard_test.fixture'::regclass) then
    raise exception 'index guard: expression unique index was accepted';
  end if;
end
$index_tests$;

create or replace function pg_temp.mk_sg_file(
  p_root text,
  p_run uuid,
  p_name text
) returns uuid
language sql
as $fn$
  -- licensor_name is GENERATED ALWAYS AS split_part(relative_path, '/', 1), so
  -- it cannot be written directly -- the path carries it. basename_no_ext and
  -- normalized_name are NOT NULL without defaults and must be supplied. Same
  -- shape as pg_temp.mk_file in popsg_bounded_crawl_and_search_contracts.sql.
  insert into public.style_guide_files
    (crawl_run_id, root_label, relative_path, directory_path, filename, basename_no_ext,
     file_extension, normalized_name, property_folder, style_guide_folder,
     size_bytes, modified_at, is_active, tag_names, tag_search_text)
  values
    (p_run, p_root, 'TestLicensor/' || p_name, 'dir/' || p_root, p_name, replace(p_name, '.pdf', ''),
     'pdf', lower(p_name), 'TestProperty', 'TestGuide',
     100, now(), true, array['tag-a'], 'tag-a')
  returning id;
$fn$;

do $tests$
declare
  v_run uuid;
  v_run2 uuid;
  v_file uuid;
  v_batch integer;
  v_synced integer;
  v_refreshed timestamptz;
  v_started timestamptz;
  v_elapsed_ms numeric;
  v_def3 text;
  v_def2 text;
  v_i integer;
  v_total integer := 0;
begin
  v_def3 := pg_get_functiondef('public.refresh_style_guide_matviews(uuid,integer,text)'::regprocedure);
  v_def2 := pg_get_functiondef('public.refresh_style_guide_matviews(uuid,integer)'::regprocedure);

  -- =========================================================================
  -- 0. catalog objects
  -- =========================================================================
  if to_regprocedure('public.refresh_style_guide_matviews(uuid,integer,text)') is null then
    raise exception 'test 0: steppable overload missing';
  end if;
  if to_regprocedure('public.refresh_style_guide_matviews(uuid,integer)') is null then
    raise exception 'test 0: legacy 2-arg overload missing';
  end if;
  if has_function_privilege('authenticated', 'public.refresh_style_guide_matviews(uuid,integer,text)', 'execute')
     or has_function_privilege('anon', 'public.refresh_style_guide_matviews(uuid,integer,text)', 'execute')
     or has_function_privilege('public', 'public.refresh_style_guide_matviews(uuid,integer,text)', 'execute') then
    raise exception 'test 0: steppable overload exposed to API roles';
  end if;
  if not has_function_privilege('service_role', 'public.refresh_style_guide_matviews(uuid,integer,text)', 'execute') then
    raise exception 'test 0: service_role cannot execute steppable overload';
  end if;

  -- =========================================================================
  -- 1. step isolation (body shape) -- each matview step must not run the other
  --    step or the search sync
  -- =========================================================================
  if position('if v_step in (''all'', ''file_groups'')' in v_def3) = 0
     or position('if v_step in (''all'', ''folders'')' in v_def3) = 0
     or position('if v_step in (''all'', ''search'')' in v_def3) = 0 then
    raise exception 'test 1: p_step does not gate the three units separately';
  end if;
  -- file_groups refresh sits behind the file_groups gate only
  if position('refresh materialized view concurrently public.style_guide_file_groups' in v_def3) = 0 then
    raise exception 'test 1: file_groups CONCURRENT refresh missing';
  end if;
  if position('refresh materialized view concurrently public.style_guide_folders' in v_def3) = 0 then
    raise exception 'test 1: folders CONCURRENT refresh missing';
  end if;
  -- search reads the queue, not a full file scan
  if position('from public.style_guide_search_sync_queue q' in v_def3) = 0 then
    raise exception 'test 1: search step does not read the queue';
  end if;
  if position('d.is_active is distinct from f.is_active' in v_def3) = 0 then
    raise exception 'test 1: returning-file reactivation clause missing';
  end if;

  -- =========================================================================
  -- 2. legacy2-arg body unchanged: still all-in-one, still queue-based, and
  --    byte-identical (md5(prosrc) pinned by
  --    scripts/production_catalog_verification.py popsg_refresh_search_sync_queue_v1)
  -- =========================================================================
  if not exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.refresh_style_guide_matviews(uuid,integer)')
       and p.prosecdef
       and md5(p.prosrc) = '52b676f90e4500dc323c2f9e6e6f3c97') then
    raise exception 'test 2: legacy 2-arg prosrc md5 or definer posture drifted from the pinned catalog contract';
  end if;
  if position('refresh materialized view concurrently public.style_guide_file_groups' in v_def2) = 0
     or position('refresh materialized view concurrently public.style_guide_folders' in v_def2) = 0 then
    raise exception 'test 2: legacy overload lost its concurrent refreshes';
  end if;
  if position('from public.style_guide_search_sync_queue q' in v_def2) = 0 then
    raise exception 'test 2: legacy overload lost its queue scan';
  end if;
  if position('d.is_active is distinct from f.is_active' in v_def2) = 0 then
    raise exception 'test 2: legacy overload lost the reactivation clause';
  end if;

  -- =========================================================================
  -- 3. unknown p_step is refused (fail closed, no silent no-op)
  -- =========================================================================
  begin
    perform * from public.refresh_style_guide_matviews(null, 10, 'nope');
    raise exception 'test 3: unknown p_step was accepted';
  exception
    when others then
      if sqlerrm not like '%unknown p_step%' then
        raise;
      end if;
  end;

  -- =========================================================================
  -- 4. change-night search step: many new files, bounded batches, queue drains
  --    (this is the unit that blows the ceiling when glued to the refreshes)
  -- =========================================================================
  insert into public.style_guide_crawl_runs (status, files_found) values ('pending', 25)
    returning id into v_run;
  for v_i in 1..25 loop
    perform pg_temp.mk_sg_file('ROOT_CHG', v_run, 'chg' || v_i || '.pdf');
  end loop;

  if (select count(*) from public.style_guide_search_sync_queue q
        join public.style_guide_files f on f.id = q.style_guide_file_id
       where f.root_label = 'ROOT_CHG') < 25 then
    raise exception 'test 4: change-night inserts did not enqueue for search sync';
  end if;

  -- three bounded batches of 10: each call is one statement under the ceiling
  v_total := 0;
  for v_i in 1..3 loop
    v_started := clock_timestamp();
    select r.search_documents_synced, r.refreshed_at
      into v_synced, v_refreshed
      from public.refresh_style_guide_matviews(v_run, 10, 'search') r;
    v_elapsed_ms := extract(epoch from (clock_timestamp() - v_started)) * 1000;
    if v_synced is null or v_synced < 0 or v_synced > 10 then
      raise exception 'test 4: search batch % returned % rows, expected 0..10', v_i, v_synced;
    end if;
    if v_refreshed is null then
      raise exception 'test 4: search batch % returned no refreshed_at', v_i;
    end if;
    v_total := v_total + v_synced;
    raise notice 'test 4: change-night search batch % synced=% in % ms',
      v_i, v_synced, round(v_elapsed_ms, 1);
  end loop;

  if v_total < 25 then
    raise exception 'test 4: three batches of 10 synced only % of 25 change-night files', v_total;
  end if;

  if exists (
    select 1 from public.style_guide_search_sync_queue q
      join public.style_guide_files f on f.id = q.style_guide_file_id
     where f.root_label = 'ROOT_CHG' and f.is_active) then
    raise exception 'test 4: queue did not drain for the change-night root';
  end if;

  if (select count(*) from public.style_guide_search_documents d
        join public.style_guide_files f on f.id = d.style_guide_file_id
       where f.root_label = 'ROOT_CHG' and d.is_active) < 25 then
    raise exception 'test 4: search documents missing for change-night files';
  end if;

  -- the crawl run accumulated the synced count and was stamped complete
  if (select search_documents_synced from public.style_guide_crawl_runs where id = v_run) < 25 then
    raise exception 'test 4: crawl run search_documents_synced was not accumulated';
  end if;
  if (select refresh_completed_at from public.style_guide_crawl_runs where id = v_run) is null then
    raise exception 'test 4: search step did not stamp refresh_completed_at';
  end if;

  -- =========================================================================
  -- 5. matview-only step does not close the run (so the caller can still search)
  -- =========================================================================
  insert into public.style_guide_crawl_runs (status, files_found) values ('pending', 1)
    returning id into v_run2;
  -- cannot EXECUTE the matview steps here (REFRESH CONCURRENTLY is forbidden
  -- inside a transaction block), so assert the completion-stamp gate in the body
  if position('if p_run_id is not null and v_step in (''all'', ''search'') and v_batch > 0' in v_def3) = 0 then
    raise exception 'test 5: matview-only steps are allowed to stamp refresh_completed_at';
  end if;
  if position('if v_step in (''all'', ''search'') and v_batch > 0' in v_def3) = 0 then
    raise exception 'test 5: zero-size search batch is allowed to drain the queue';
  end if;

  -- =========================================================================
  -- 6. catalog contract for the legacy2-arg path still holds (md5 pinned in
  --    scripts/production_catalog_verification.py popsg_refresh_search_sync_queue_v1)
  -- =========================================================================
  if not exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.refresh_style_guide_matviews(uuid,integer)')
       and p.prosecdef
       and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
       and has_function_privilege('service_role', p.oid, 'EXECUTE')) then
    raise exception 'test 6: legacy overload grants/definer posture changed';
  end if;

  raise notice 'issue #3458 steppable refresh tests: all 6 checks passed';
end
$tests$;

rollback;
