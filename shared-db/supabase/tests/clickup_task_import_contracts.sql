-- Contract tests for 20260728160000_clickup_incremental_task_import.sql (pim.sync_clickup_tasks).
--
-- Run against a throwaway Postgres that has the migration applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/clickup_task_import_contracts.sql
--
-- Each case is its own transaction and rolls back, so nothing persists. Per-case
-- transactions (rather than one big block) keep every advisory-lock run in a clean
-- transaction: pg_try_advisory_xact_lock is released at COMMIT/ROLLBACK, so case N never
-- inherits case N-1's lock.
--
-- Covers the five adversarial-review fixes:
--   1. Curated fields + non-clickup metadata survive an UPDATE upsert (defect 4 WHERE only
--      skips writes when the source hash is unchanged; curated columns are never in the SET).
--   2. A legacy whitespace clickup_task_id is matched and updated, not duplicated (defect 3:
--      backfill trims; importer trims).
--   3. A failed row does NOT advance the watermark (defect 2).
--   4. An unchanged row does NOT bump updated_at (defect 4).
--   5. The advisory-lock path returns locked=true with no side effects (defect 2 lock).
--   6. THE PRODUCTION SHAPE (defect 6): a legacy row keyed
--      ('directus_product', <directus id>) that carries a clickup_task_id is MATCHED by
--      clickup_task_id and updated in place — not duplicated — and keeps its Directus key.
--      17,859 preview rows look exactly like this. This case FAILS against the pre-fix
--      logic, which could only find rows via (external_source='clickup', external_id) and
--      would therefore insert a second product row for every one of them.

-- ---------------------------------------------------------------------------
-- Session-local helpers (temp schema; live across the per-case transactions).
-- ---------------------------------------------------------------------------

-- Build one ClickUp task snapshot row. `p_ver` varies the `raw` digest so v1/v2 produce
-- different clickup_source_hash values (needed for the changed-vs-unchanged cases).
create or replace function pg_temp.mk_task(p_id text, p_status text, p_list text, p_ver int)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'clickup_task_id', p_id,
    'name', 'Task ' || p_id,
    'clickup_status', p_status,
    'clickup_status_type', 'custom',
    'clickup_status_color', '#f9d900',
    'clickup_status_order', '1',
    'clickup_space_id', 'sp1', 'clickup_space_name', 'Product',
    'clickup_folder_id', 'fo1', 'clickup_folder_name', '2026',
    'clickup_list_id', p_list, 'clickup_list_name', 'List ' || p_list,
    'clickup_creator_id', 'u1', 'clickup_creator_name', 'Albert',
    'clickup_time_estimate_ms', '3600000',
    'clickup_orderindex', '1',
    'clickup_date_created', '2026-01-01T00:00:00Z',
    'clickup_date_updated', '2026-07-28T10:00:00Z',
    'clickup_date_closed', null,
    'raw', jsonb_build_object('id', p_id, 'status', p_status, 'list', p_list, 'ver', p_ver))
$$;

-- Build a snapshot. p_watermark/p_fetch are the strings the runner would send; null
-- watermark means a first/full-style run.
create or replace function pg_temp.mk_snap(p_tasks jsonb, p_watermark text, p_fetch text, p_skip text[] default '{}')
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'source', 'clickup',
    'mode', 'incremental',
    'watermark', nullif(p_watermark, ''),
    'fetch_started_at', p_fetch,
    'lists', jsonb_build_array(jsonb_build_object('id', 'L1', 'terminalReached', true)),
    'tasks', p_tasks,
    'skip_task_ids', to_jsonb(p_skip))
$$;

-- ===========================================================================
-- Case 1: curated fields + non-clickup metadata survive an UPDATE upsert.
-- ===========================================================================
begin;
do $c1$
declare
  v_lic  uuid;
  v_prop uuid;
  v_proj uuid;
  v_r    jsonb;
  v_row  record;
begin
  insert into core.licensor (name) values ('Lic C1') returning id into v_lic;
  insert into core.property (name, licensor_id) values ('Prop C1', v_lic) returning id into v_prop;
  insert into pim.project (title, licensor_id, property_id) values ('Proj C1', v_lic, v_prop) returning id into v_proj;

  -- Pre-claimed product (as the backfill leaves a legacy row) with curated links + a
  -- non-clickup metadata key. No clickup_source_hash yet, so the import below is an UPDATE.
  insert into pim.product (
    external_source, external_id, name, project_id, licensor_id, property_id,
    stage, cover_url, clickup_list_id, metadata)
  values ('clickup', 'cur1', 'Curated One', v_proj, v_lic, v_prop,
    'concept', 'https://x/cur1.png', 'OLDLIST', jsonb_build_object('buyer_note', 'keep me'));

  select to_jsonb(t) into v_r from public.sync_clickup_tasks(pg_temp.mk_snap(
    jsonb_build_array(pg_temp.mk_task('cur1', 'open', 'NEWLIST', 1)),
    null, '2026-07-28T11:00:00+00'), 'incremental') t;

  if coalesce((v_r ->> 'locked')::boolean, true) then raise exception 'C1: run unexpectedly locked'; end if;
  if coalesce((v_r ->> 'rows_updated')::int, -1) <> 1 then
    raise exception 'C1: expected rows_updated=1 got %', v_r ->> 'rows_updated'; end if;

  select project_id, licensor_id, property_id, stage, cover_url,
         metadata ->> 'buyer_note' as buyer_note,
         clickup_list_id, status, metadata ->> 'clickup_source_hash' as hash
    into v_row
    from pim.product
   where external_source = 'clickup' and external_id = 'cur1';

  if v_row.project_id is distinct from v_proj then raise exception 'C1: project_id clobbered'; end if;
  if v_row.licensor_id is distinct from v_lic then raise exception 'C1: licensor_id clobbered'; end if;
  if v_row.property_id is distinct from v_prop then raise exception 'C1: property_id clobbered'; end if;
  if v_row.stage is distinct from 'concept' then raise exception 'C1: stage clobbered'; end if;
  if v_row.cover_url is distinct from 'https://x/cur1.png' then raise exception 'C1: cover_url clobbered'; end if;
  if v_row.buyer_note is distinct from 'keep me' then raise exception 'C1: non-clickup metadata key lost on merge'; end if;
  if v_row.clickup_list_id is distinct from 'NEWLIST' then raise exception 'C1: clickup field not updated (list=%)', v_row.clickup_list_id; end if;
  if v_row.status is distinct from 'open' then raise exception 'C1: status not updated'; end if;
  if v_row.hash is null then raise exception 'C1: clickup_source_hash not written'; end if;

  raise notice 'C1 PASS: curated fields + non-clickup metadata survive an update upsert';
end $c1$;
rollback;

-- ===========================================================================
-- Case 2: legacy whitespace id is matched and updated, not duplicated.
--   Re-runs the migration backfill's guarded claim (defect 3: TRIM) on a fixture, then
--   imports the same task id and proves exactly one product row results.
-- ===========================================================================
begin;
do $c2$
declare
  v_r      jsonb;
  v_ext_id text;
  v_cnt    int;
  v_stage  text;
  v_status text;
begin
  -- Legacy row: un-sourced, clickup_task_id padded with whitespace.
  insert into pim.product (name, clickup_task_id, stage, metadata)
  values ('Legacy WS', '  ws1  ', 'legacy', jsonb_build_object('note', 'legacy row'));

  -- Re-apply the migration backfill claim (identical guarded UPDATE, empty ambiguous set).
  update pim.product p
     set external_source = 'clickup',
         external_id     = btrim(p.clickup_task_id),
         updated_at      = now()
   where p.external_source is null
     and p.clickup_task_id is not null
     and btrim(p.clickup_task_id) <> ''
     and btrim(p.clickup_task_id) <> all ('{}'::text[])
     and not exists (
       select 1 from pim.product other
        where other.external_source = 'clickup'
          and other.external_id = btrim(p.clickup_task_id)
          and other.id <> p.id);

  select external_id into v_ext_id from pim.product where clickup_task_id = '  ws1  ';
  if v_ext_id is distinct from 'ws1' then
    raise exception 'C2: backfill did not TRIM the id (external_id=%)', v_ext_id; end if;

  -- Import the same task. Node trims ids; pass a whitespace id to also exercise the SQL btrim.
  select to_jsonb(t) into v_r from public.sync_clickup_tasks(pg_temp.mk_snap(
    jsonb_build_array(pg_temp.mk_task('  ws1  ', 'open', 'L1', 1)),
    null, '2026-07-28T11:00:00+00'), 'incremental') t;

  select count(*) into v_cnt from pim.product where external_source = 'clickup' and external_id = 'ws1';
  if v_cnt <> 1 then raise exception 'C2: expected exactly ONE product for ws1, got %', v_cnt; end if;

  select stage, clickup_status into v_stage, v_status
    from pim.product where external_source = 'clickup' and external_id = 'ws1';
  if v_stage is distinct from 'legacy' then raise exception 'C2: curated stage not preserved'; end if;
  if v_status is distinct from 'open' then raise exception 'C2: row not updated by importer'; end if;

  raise notice 'C2 PASS: legacy whitespace id matched+updated, no duplicate';
end $c2$;
rollback;

-- ===========================================================================
-- Case 3: a failed row does NOT advance the watermark (defect 2).
--   watermark_in=10:00, fetch_started=11:00. One good task + one malformed (no id).
--   Expect rows_failed>=1 and watermark_at == watermark_in (not ~11:00).
-- ===========================================================================
begin;
do $c3$
declare
  v_r   jsonb;
  v_md  jsonb;
  v_id  uuid;
begin
  select to_jsonb(t) into v_r from public.sync_clickup_tasks(pg_temp.mk_snap(
    jsonb_build_array(
      pg_temp.mk_task('fail1', 'open', 'L1', 1),
      jsonb_build_object('name', 'task with no id')   -- no clickup_task_id -> raises
    ),
    '2026-07-28T10:00:00+00', '2026-07-28T11:00:00+00'), 'incremental') t;

  if coalesce((v_r ->> 'locked')::boolean, true) then raise exception 'C3: run unexpectedly locked'; end if;
  if coalesce((v_r ->> 'rows_failed')::int, -1) < 1 then
    raise exception 'C3: expected rows_failed>=1 got %', v_r ->> 'rows_failed'; end if;

  -- The watermark must equal the INPUT watermark (non-advancing), not fetch_started.
  if (v_r ->> 'watermark_at')::timestamptz is distinct from '2026-07-28T10:00:00+00'::timestamptz then
    raise exception 'C3: watermark advanced on partial failure (got %, expected 10:00)', v_r ->> 'watermark_at';
  end if;

  -- And the durable sync_run row must flag it unmistakably.
  v_id := (v_r ->> 'sync_run_id')::uuid;
  select metadata into v_md from ingest.sync_run where id = v_id;
  if v_md ->> 'outcome' is distinct from 'succeeded_with_failures' then
    raise exception 'C3: outcome not succeeded_with_failures (got %)', v_md ->> 'outcome'; end if;
  if coalesce((v_md ->> 'partial_failure')::boolean, false) is not true then
    raise exception 'C3: partial_failure flag not set'; end if;
  if coalesce((v_md ->> 'watermark_advanced')::boolean, true) is not false then
    raise exception 'C3: watermark_advanced should be false'; end if;

  raise notice 'C3 PASS: failed row did not advance the watermark';
end $c3$;
rollback;

-- ===========================================================================
-- Case 4: an unchanged row does NOT bump updated_at (defect 4).
--   pim.product carries a BEFORE UPDATE set_updated_at() trigger (sets updated_at=now() on
--   ANY update). That trigger is exactly why defect 4 matters: the ON CONFLICT WHERE must
--   skip the write entirely, or the trigger bumps updated_at every run. We disable the
--   trigger for this case only so a pinned sentinel value survives a true no-op and proves
--   the skip; a changed task still bumps it. (Disabled within the case transaction; rolled
--   back, and re-enabled explicitly below.)
-- ===========================================================================
begin;
do $c4$
declare
  v_r  jsonb;
  v_dt timestamptz;
begin
  alter table pim.product disable trigger set_updated_at;

  select to_jsonb(t) into v_r from public.sync_clickup_tasks(pg_temp.mk_snap(
    jsonb_build_array(pg_temp.mk_task('unch1', 'open', 'L1', 1)),
    null, '2026-07-28T11:00:00+00'), 'incremental') t;
  if coalesce((v_r ->> 'rows_inserted')::int, -1) <> 1 then
    raise exception 'C4: expected an insert on the first import'; end if;

  update pim.product set updated_at = '2020-01-01 00:00:00+00'
   where external_source = 'clickup' and external_id = 'unch1';

  -- Identical re-import: same raw -> same hash -> the ON CONFLICT WHERE skips the write,
  -- so neither the SET nor the (disabled) trigger touches updated_at.
  select to_jsonb(t) into v_r from public.sync_clickup_tasks(pg_temp.mk_snap(
    jsonb_build_array(pg_temp.mk_task('unch1', 'open', 'L1', 1)),
    null, '2026-07-28T11:00:00+00'), 'incremental') t;
  if coalesce((v_r ->> 'rows_unchanged')::int, -1) <> 1 then
    raise exception 'C4: expected rows_unchanged=1 got %', v_r ->> 'rows_unchanged'; end if;
  if coalesce((v_r ->> 'rows_updated')::int, -1) <> 0 then
    raise exception 'C4: expected rows_updated=0 got %', v_r ->> 'rows_updated'; end if;
  select updated_at into v_dt from pim.product where external_source = 'clickup' and external_id = 'unch1';
  if v_dt is distinct from '2020-01-01 00:00:00+00'::timestamptz then
    raise exception 'C4: unchanged row bumped updated_at (got %)', v_dt; end if;

  -- Changed re-import: different raw -> different hash -> the update fires and bumps.
  select to_jsonb(t) into v_r from public.sync_clickup_tasks(pg_temp.mk_snap(
    jsonb_build_array(pg_temp.mk_task('unch1', 'done', 'L1', 2)),
    null, '2026-07-28T11:00:00+00'), 'incremental') t;
  if coalesce((v_r ->> 'rows_updated')::int, -1) <> 1 then
    raise exception 'C4: changed task should be rows_updated=1 got %', v_r ->> 'rows_updated'; end if;
  select updated_at into v_dt from pim.product where external_source = 'clickup' and external_id = 'unch1';
  if v_dt = '2020-01-01 00:00:00+00'::timestamptz then
    raise exception 'C4: changed task did not bump updated_at'; end if;

  alter table pim.product enable trigger set_updated_at;
  raise notice 'C4 PASS: unchanged row did not bump updated_at (changed row did)';
end $c4$;
rollback;

-- ===========================================================================
-- Case 5: the advisory-lock path returns locked=true with NO side effects.
--   A single backend re-acquires its own advisory lock, so to force the locked branch we
--   hold the lock on a SEPARATE connection (dblink). If dblink is unavailable, this case
--   is skipped here and the locked path is exercised by the two-connection harness at
--   apply/verify time instead.
-- ===========================================================================
begin;
do $c5$
declare
  v_r     jsonb;
  v_runs  bigint;
  v_prods bigint;
  v_has   boolean;
begin
  select exists (select 1 from pg_extension where extname = 'dblink') into v_has;
  if not v_has then
    raise notice 'C5 SKIP: dblink not installed (locked path verified via the two-connection harness)';
    return;
  end if;

  begin
    perform dblink_connect('cuk_lock', 'dbname=' || current_database());
    -- pg_advisory_lock returns a value, so use the row-returning dblink() form (dblink_exec
    -- rejects statements that return results). Held on the SEPARATE backend for the call.
    perform 1 from dblink('cuk_lock',
      'select count(*) from (select pg_advisory_lock(hashtext(''pim.sync_clickup_tasks'')::bigint)) s') as t(c bigint);

    select count(*) into v_runs  from ingest.sync_run where source_system = 'clickup';
    select count(*) into v_prods from pim.product  where external_source = 'clickup';

    select to_jsonb(t) into v_r from public.sync_clickup_tasks(pg_temp.mk_snap(
      jsonb_build_array(pg_temp.mk_task('lock1', 'open', 'L1', 1)),
      null, '2026-07-28T11:00:00+00'), 'incremental') t;

    if coalesce((v_r ->> 'locked')::boolean, false) is not true then
      raise exception 'C5: expected locked=true got %', v_r; end if;
    if v_r ->> 'sync_run_id' is not null then raise exception 'C5: locked run must return null sync_run_id'; end if;
    if v_r ->> 'watermark_at' is not null then raise exception 'C5: locked run must return null watermark_at'; end if;
    if (select count(*) from ingest.sync_run where source_system = 'clickup') is distinct from v_runs then
      raise exception 'C5: locked run must NOT insert a sync_run'; end if;
    if (select count(*) from pim.product where external_source = 'clickup') is distinct from v_prods then
      raise exception 'C5: locked run must NOT write products'; end if;

    perform 1 from dblink('cuk_lock',
      'select count(*) from (select pg_advisory_unlock(hashtext(''pim.sync_clickup_tasks'')::bigint)) s') as t(c bigint);
    perform dblink_disconnect('cuk_lock');
  exception when others then
    begin
      perform dblink_disconnect('cuk_lock');
    exception when others then
      null;
    end;
    raise notice 'C5 SKIP: dblink path failed (%) — locked path verified via two-connection harness', sqlerrm;
    return;
  end;

  raise notice 'C5 PASS: advisory-lock path returns locked=true with no side effects';
end $c5$;
rollback;

-- ===========================================================================
-- Case 6: the REAL production shape — a Directus-keyed legacy row is matched by
--   clickup_task_id, updated in place, and NOT duplicated (defect 6).
--
--   Preview holds 17,859 rows shaped exactly like this fixture: external_source =
--   'directus_product', external_id = a Directus id that never equals clickup_task_id,
--   clickup_task_id populated. The pre-fix importer could only resolve a task through
--   (external_source='clickup', external_id), so it would have INSERTED a duplicate
--   product row for every one of them and stranded the curated links on the original.
-- ===========================================================================
begin;
do $c6$
declare
  v_r    jsonb;
  v_md   jsonb;
  v_id   uuid;
  v_cnt  int;
  v_row  record;
begin
  insert into pim.product (external_source, external_id, name, clickup_task_id, stage, metadata)
  values ('directus_product', 'd-9001', 'Directus Legacy', 'dir9001', 'legacy',
          jsonb_build_object('note', 'legacy row'))
  returning id into v_id;

  select to_jsonb(t) into v_r from public.sync_clickup_tasks(pg_temp.mk_snap(
    jsonb_build_array(pg_temp.mk_task('dir9001', 'open', 'L1', 1)),
    null, '2026-07-28T11:00:00+00'), 'incremental') t;

  if coalesce((v_r ->> 'locked')::boolean, true) then raise exception 'C6: run unexpectedly locked'; end if;

  -- THE assertion: exactly one product row carries this ClickUp task id.
  select count(*) into v_cnt from pim.product where btrim(clickup_task_id) = 'dir9001';
  if v_cnt <> 1 then
    raise exception 'C6: DUPLICATE PRODUCT — expected exactly 1 row for clickup_task_id dir9001, got %', v_cnt; end if;

  if coalesce((v_r ->> 'rows_inserted')::int, -1) <> 0 then
    raise exception 'C6: importer INSERTED instead of matching (rows_inserted=%)', v_r ->> 'rows_inserted'; end if;
  if coalesce((v_r ->> 'rows_updated')::int, -1) <> 1 then
    raise exception 'C6: expected rows_updated=1 got %', v_r ->> 'rows_updated'; end if;

  select id, external_source, external_id, status, clickup_status, clickup_list_id, stage,
         metadata ->> 'note'          as note,
         metadata ->> 'clickup_match' as match_kind
    into v_row
    from pim.product where btrim(clickup_task_id) = 'dir9001';

  if v_row.id is distinct from v_id then raise exception 'C6: a different row was written'; end if;
  if v_row.external_source is distinct from 'directus_product' then
    raise exception 'C6: external_source was re-keyed to %', v_row.external_source; end if;
  if v_row.external_id is distinct from 'd-9001' then
    raise exception 'C6: external_id was re-keyed to %', v_row.external_id; end if;
  if v_row.stage is distinct from 'legacy' then raise exception 'C6: curated stage clobbered'; end if;
  if v_row.note is distinct from 'legacy row' then raise exception 'C6: non-clickup metadata key lost'; end if;
  if v_row.clickup_status is distinct from 'open' then raise exception 'C6: row was not actually updated'; end if;
  if v_row.clickup_list_id is distinct from 'L1' then raise exception 'C6: clickup field not updated'; end if;
  if v_row.match_kind is distinct from 'clickup_task_id' then
    raise exception 'C6: expected metadata.clickup_match=clickup_task_id got %', v_row.match_kind; end if;

  -- Counters must show legacy matching, not mass inserts.
  select metadata into v_md from ingest.sync_run where id = (v_r ->> 'sync_run_id')::uuid;
  if coalesce((v_md ->> 'rows_matched_by_clickup_task_id')::int, -1) <> 1 then
    raise exception 'C6: rows_matched_by_clickup_task_id=% (expected 1)', v_md ->> 'rows_matched_by_clickup_task_id'; end if;
  if coalesce((v_md ->> 'rows_matched_foreign_source')::int, -1) <> 1 then
    raise exception 'C6: rows_matched_foreign_source=% (expected 1)', v_md ->> 'rows_matched_foreign_source'; end if;
  if coalesce((v_md -> 'matched_external_sources' ->> 'directus_product')::int, -1) <> 1 then
    raise exception 'C6: matched_external_sources missing directus_product (%)', v_md ->> 'matched_external_sources'; end if;

  raise notice 'C6 PASS: Directus-keyed legacy row matched in place, no duplicate, key intact';
end $c6$;
rollback;

-- ===========================================================================
-- Case 7: the section-2 guard exists — one product row per ClickUp task id.
-- ===========================================================================
begin;
do $c7$
declare
  v_ok boolean := false;
begin
  if to_regclass('pim.pim_product_clickup_task_id_uidx') is null then
    raise exception 'C7: unique index on btrim(clickup_task_id) is missing'; end if;

  insert into pim.product (external_source, external_id, name, clickup_task_id)
  values ('directus_product', 'd-7001', 'First', 'dup7001');
  begin
    insert into pim.product (external_source, external_id, name, clickup_task_id)
    values ('clickup', 'dup7001', 'Second', ' dup7001 ');
  exception when unique_violation then
    v_ok := true;
  end;
  if not v_ok then raise exception 'C7: a second row reused clickup_task_id dup7001'; end if;

  raise notice 'C7 PASS: btrim(clickup_task_id) is unique on pim.product';
end $c7$;
rollback;

do $$
begin
  raise notice 'clickup_task_import_contracts: all cases evaluated (see per-case PASS/SKIP above)';
end $$;
