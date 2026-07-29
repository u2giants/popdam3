-- ClickUp incremental task import — schema + guarded importer.
-- Migration: 20260728160000_clickup_incremental_task_import.sql
--
-- What this does
-- --------------
-- Poppim's pim.product rows carry ClickUp-native fields from a one-time historical
-- import: clickup_task_id / clickup_parent_id / clickup_status as real columns, and
-- ~20 more ClickUp fields inside the metadata jsonb blob. There has never been an
-- ongoing import. This migration adds the database half of one:
--
--   1. First-class clickup_* columns on pim.product for the fields that today only
--      live in metadata (the api.pm_product_board / api.pm_pipeline_page views read
--      them out of metadata with `metadata ->> 'clickup_...'`).
--   2. A scoped, dedupe-safe backfill so the LEGACY rows are matched by the import
--      convention (external_source, external_id) instead of being duplicated.
--   3. pim.sync_clickup_tasks(snapshot jsonb, mode text) + a public wrapper — the
--      SECURITY DEFINER importer called by tools/sync-clickup-tasks.mjs.
--
-- Scope: ClickUp-NATIVE task fields only (status, folder/list/space, creator, time
-- estimate, orderindex, timestamps). Mapping ClickUp CUSTOM fields
-- (buyer/licensor/customer/factory) into first-class product relationships is a
-- separate, larger effort and is deliberately NOT attempted here.
--
-- View compatibility: the existing views still read these values out of `metadata`.
-- The importer therefore writes BOTH the new columns AND the matching metadata keys,
-- so no view has to change in this migration and nothing that reads metadata today
-- regresses. A later migration can flip the views over to the columns.
--
-- Field-ownership contract. The importer may write ONLY:
--   * ingest.raw_record            (bronze audit copy of each ClickUp task)
--   * ingest.sync_run              (run accounting + the incremental watermark)
--   * pim.product                  ClickUp-owned fields only: name, status,
--                                  clickup_*, and the clickup_* keys inside metadata.
-- It MUST NOT touch project_id, design_id, plm_item_id, company_id,
-- buyer_contact_id, factory_id, licensor_id, property_id, product_type_id, code,
-- stage, lifecycle_status, cover_url, or any non-clickup metadata key. Those are
-- curated in Poppim and must survive every sync.

-- =====================================================================================
-- 1. New ClickUp-native columns on pim.product.
--    Nullable and additive: no existing row or view changes behavior.
-- =====================================================================================
alter table pim.product
  add column if not exists clickup_creator_id       text,
  add column if not exists clickup_creator_name     text,
  add column if not exists clickup_folder_id        text,
  add column if not exists clickup_list_id          text,
  add column if not exists clickup_space_id         text,
  add column if not exists clickup_space_name       text,
  add column if not exists clickup_status_color     text,
  add column if not exists clickup_status_order     numeric,
  add column if not exists clickup_status_type      text,
  add column if not exists clickup_time_estimate_ms bigint,
  add column if not exists clickup_orderindex       text;

comment on column pim.product.clickup_list_id is
'ClickUp list id the task belongs to. Written by the ClickUp task importer; also mirrored into metadata->>''clickup_list_id'' for the existing api.pm_* views.';

-- Incremental syncs filter by list; legacy rows are matched by (external_source,
-- external_id). This index keeps the per-list re-sync lookup cheap.
create index if not exists pim_product_clickup_list_updated_idx
  on pim.product (clickup_list_id, updated_at desc);

-- =====================================================================================
-- 2. Backfill — SCOPED and DEDUPE-SAFE, not a blind mass UPDATE.
--
--    The real identity/dedupe key on pim.product is
--    `unique nulls not distinct (external_source, external_id)`, NOT clickup_task_id
--    (which has no unique constraint). Legacy rows have clickup_task_id set but
--    external_source/external_id NULL, so without this backfill the first import run
--    would insert a duplicate row for every historical task.
--
--    Three guards:
--      a. only rows where external_source IS NULL (never stomp a row already claimed
--         by another source system);
--      b. only clickup_task_id values that appear on exactly ONE such row — an
--         ambiguous id would violate the unique constraint;
--      c. only ids not already used as (clickup, external_id) by some other row.
--    Anything skipped is RECORDED, not silently dropped: a 'skipped' ingest.sync_run
--    row lists the ambiguous ids so a human can reconcile them by hand.
-- =====================================================================================
do $backfill$
declare
  v_ambiguous text[];
  v_updated   integer := 0;
begin
  select coalesce(array_agg(clickup_task_id order by clickup_task_id), '{}'::text[])
    into v_ambiguous
  from (
    select clickup_task_id
    from pim.product
    where clickup_task_id is not null
      and btrim(clickup_task_id) <> ''
      and external_source is null
    group by clickup_task_id
    having count(*) > 1
  ) dup;

  with claimable as (
    select p.id, p.clickup_task_id
    from pim.product p
    where p.clickup_task_id is not null
      and btrim(p.clickup_task_id) <> ''
      and p.external_source is null
      and not (p.clickup_task_id = any (v_ambiguous))
      and not exists (
        select 1 from pim.product other
        where other.external_source = 'clickup'
          and other.external_id = p.clickup_task_id
      )
  )
  update pim.product p
     set external_source = 'clickup',
         external_id     = c.clickup_task_id,
         updated_at      = now()
    from claimable c
   where p.id = c.id;

  get diagnostics v_updated = row_count;

  insert into ingest.sync_run
    (source_system, source_name, status, started_at, finished_at,
     rows_seen, rows_inserted, rows_updated, rows_failed, metadata)
  values
    ('clickup', 'clickup_external_id_backfill', 'succeeded', now(), now(),
     v_updated + coalesce(array_length(v_ambiguous, 1), 0), 0, v_updated,
     coalesce(array_length(v_ambiguous, 1), 0),
     jsonb_build_object(
       'migration', '20260728160000_clickup_incremental_task_import',
       'stage', 'backfill',
       'rows_claimed', v_updated,
       'ambiguous_clickup_task_ids', to_jsonb(v_ambiguous),
       'note', 'Ambiguous ids appear on more than one un-sourced pim.product row and were skipped; reconcile by hand before they can be synced.'));

  raise notice 'ClickUp backfill: % row(s) claimed, % ambiguous id(s) skipped',
    v_updated, coalesce(array_length(v_ambiguous, 1), 0);
end;
$backfill$;

-- =====================================================================================
-- 3. Internal importer.
--
--    Two review-driven design points:
--      * ADVISORY LOCK (pg_try_advisory_xact_lock, not the blocking form) so two runs
--        cannot race each other. If another run holds it we return a 'locked' result
--        cleanly instead of queueing behind it or corrupting the watermark.
--      * PER-ROW ON CONFLICT upsert inside a loop, each row wrapped in its own
--        exception block. One malformed task fails and is counted in rows_failed; it
--        does NOT roll back the rest of the batch. A single bulk statement would.
--
--    Watermark contract: the caller uses THIS run's started_at (returned as
--    watermark_at) as the next run's `date_updated_gt` cutoff — never finished_at.
--    Using finished_at would silently drop any task edited in ClickUp between the API
--    query and the commit.
-- =====================================================================================
create or replace function pim.sync_clickup_tasks(
  p_snapshot jsonb,
  p_mode text default 'incremental'
)
returns table (
  sync_run_id    uuid,
  mode           text,
  locked         boolean,
  rows_seen      integer,
  rows_inserted  integer,
  rows_updated   integer,
  rows_unchanged integer,
  rows_failed    integer,
  watermark_at   timestamptz,
  snapshot_hash  text
)
language plpgsql
security definer
set search_path = pim, ingest, app, extensions, public
as $$
declare
  v_sync_id       uuid;
  v_mode          text := coalesce(p_mode, 'incremental');
  v_tasks         jsonb;
  v_lists         jsonb;
  v_watermark_in  timestamptz;
  v_started_at    timestamptz;
  v_task          jsonb;
  v_task_id       text;
  v_existing      uuid;
  v_hash          text;
  v_old_hash      text;
  v_meta          jsonb;
  v_seen          integer := 0;
  v_ins           integer := 0;
  v_upd           integer := 0;
  v_unch          integer := 0;
  v_failed        integer := 0;
  v_errors        jsonb := '[]'::jsonb;
  v_term_bad      integer;
  v_snapshot_hash text;
begin
  -- ------------------------------------------------------------------
  -- 3.0 Mode + payload shape guards.
  -- ------------------------------------------------------------------
  if v_mode not in ('incremental', 'full') then
    raise exception 'mode must be incremental or full (received %)', v_mode
      using errcode = 'P0001';
  end if;

  if jsonb_typeof(coalesce(p_snapshot, 'null'::jsonb)) <> 'object' then
    raise exception 'snapshot must be a JSON object' using errcode = 'P0001';
  end if;

  v_tasks := coalesce(p_snapshot -> 'tasks', 'null'::jsonb);
  v_lists := coalesce(p_snapshot -> 'lists', 'null'::jsonb);
  if jsonb_typeof(v_tasks) <> 'array' or jsonb_typeof(v_lists) <> 'array' then
    raise exception 'snapshot.tasks and snapshot.lists must each be a JSON array'
      using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_lists) = 0 then
    raise exception 'snapshot.lists is empty — refusing a run that fetched no ClickUp list'
      using errcode = 'P0001';
  end if;

  -- Pagination completeness: a silently truncated pull would advance the watermark
  -- past tasks we never saw, and they would never be picked up again.
  select count(*) filter (where (l.value ->> 'terminalReached')::boolean is distinct from true)
    into v_term_bad
    from jsonb_array_elements(v_lists) l(value);
  if v_term_bad > 0 then
    raise exception 'incomplete pagination: % list(s) did not reach a terminal page (silent page skip would corrupt the watermark)',
      v_term_bad using errcode = 'P0001';
  end if;

  -- An empty INCREMENTAL pull is normal (nothing changed since the watermark) and must
  -- still record a successful run so the watermark advances. An empty FULL pull is not.
  if v_mode = 'full' and jsonb_array_length(v_tasks) = 0 then
    raise exception 'refusing a full-mode run that returned zero tasks'
      using errcode = 'P0001';
  end if;

  v_watermark_in := nullif(p_snapshot ->> 'watermark', '')::timestamptz;

  -- ------------------------------------------------------------------
  -- 3.1 Concurrency. try, not blocking: a second run returns cleanly rather than
  --     sitting on the lock and then importing against a stale watermark.
  -- ------------------------------------------------------------------
  if not pg_try_advisory_xact_lock(hashtext('pim.sync_clickup_tasks')::bigint) then
    return query select null::uuid, v_mode, true, 0, 0, 0, 0, 0,
                        null::timestamptz, null::text;
    return;
  end if;

  -- ------------------------------------------------------------------
  -- 3.2 Open run accounting. started_at IS the next run's watermark.
  -- ------------------------------------------------------------------
  v_started_at := now();
  insert into ingest.sync_run (source_system, source_name, status, started_at, metadata)
  values ('clickup', 'clickup_tasks_api', 'running', v_started_at,
          jsonb_build_object(
            'endpoint', 'GET /list/{list_id}/task',
            'mode', v_mode,
            'stage', 'running',
            'watermark_in', v_watermark_in,
            'lists', v_lists))
  returning id into v_sync_id;

  -- ------------------------------------------------------------------
  -- 3.3 Per-row upsert loop. Each task is isolated: a bad row is counted and
  --     described in metadata.errors, the rest of the batch still lands.
  -- ------------------------------------------------------------------
  for v_task in select value from jsonb_array_elements(v_tasks) loop
    v_seen := v_seen + 1;
    v_task_id := nullif(btrim(coalesce(v_task ->> 'clickup_task_id', '')), '');
    begin
      if v_task_id is null then
        raise exception 'task is missing clickup_task_id';
      end if;

      v_hash := md5(coalesce(v_task -> 'raw', v_task)::text);

      -- Metadata keys the existing api.pm_* views still read from. Kept in sync with
      -- the new columns so no view has to change in this migration.
      v_meta := jsonb_strip_nulls(jsonb_build_object(
        'clickup_status_type',      v_task ->> 'clickup_status_type',
        'clickup_status_color',     v_task ->> 'clickup_status_color',
        'clickup_status_order',     v_task ->> 'clickup_status_order',
        'clickup_space_id',         v_task ->> 'clickup_space_id',
        'clickup_space_name',       v_task ->> 'clickup_space_name',
        'clickup_folder_id',        v_task ->> 'clickup_folder_id',
        'clickup_folder_name',      v_task ->> 'clickup_folder_name',
        'clickup_list_id',          v_task ->> 'clickup_list_id',
        'clickup_list_name',        v_task ->> 'clickup_list_name',
        'clickup_creator_id',       v_task ->> 'clickup_creator_id',
        'clickup_creator_name',     v_task ->> 'clickup_creator_name',
        'clickup_time_estimate_ms', v_task ->> 'clickup_time_estimate_ms',
        'clickup_orderindex',       v_task ->> 'clickup_orderindex',
        'clickup_date_created',     v_task ->> 'clickup_date_created',
        'clickup_date_updated',     v_task ->> 'clickup_date_updated',
        'clickup_date_closed',      v_task ->> 'clickup_date_closed',
        'clickup_source_hash',      v_hash));

      select p.id, p.metadata ->> 'clickup_source_hash'
        into v_existing, v_old_hash
        from pim.product p
       where p.external_source = 'clickup'
         and p.external_id = v_task_id
       limit 1;

      -- Bronze: keep the raw ClickUp payload for audit/replay.
      insert into ingest.raw_record
        (sync_run_id, source_system, source_table, source_id, record_hash, payload, imported_at)
      values
        (v_sync_id, 'clickup', 'task', v_task_id, v_hash,
         coalesce(v_task -> 'raw', v_task), now())
      on conflict (source_system, source_table, source_id) do update set
        sync_run_id = excluded.sync_run_id,
        record_hash = excluded.record_hash,
        payload     = excluded.payload,
        imported_at = excluded.imported_at;

      insert into pim.product (
        external_source, external_id, name, status,
        clickup_task_id, clickup_parent_id, clickup_status,
        clickup_status_type, clickup_status_color, clickup_status_order,
        clickup_space_id, clickup_space_name, clickup_folder_id,
        clickup_list_id, clickup_creator_id, clickup_creator_name,
        clickup_time_estimate_ms, clickup_orderindex,
        metadata, updated_at
      )
      values (
        'clickup', v_task_id,
        coalesce(nullif(btrim(coalesce(v_task ->> 'name', '')), ''),
                 'Untitled ClickUp task ' || v_task_id),
        v_task ->> 'clickup_status',
        v_task_id,
        nullif(v_task ->> 'clickup_parent_id', ''),
        v_task ->> 'clickup_status',
        v_task ->> 'clickup_status_type',
        v_task ->> 'clickup_status_color',
        nullif(v_task ->> 'clickup_status_order', '')::numeric,
        v_task ->> 'clickup_space_id',
        v_task ->> 'clickup_space_name',
        v_task ->> 'clickup_folder_id',
        v_task ->> 'clickup_list_id',
        v_task ->> 'clickup_creator_id',
        v_task ->> 'clickup_creator_name',
        nullif(v_task ->> 'clickup_time_estimate_ms', '')::bigint,
        v_task ->> 'clickup_orderindex',
        v_meta, now()
      )
      on conflict (external_source, external_id) do update set
        -- ClickUp-owned fields ONLY. Curated Poppim fields (project_id, licensor_id,
        -- stage, cover_url, ...) are deliberately absent from this SET list.
        name                     = excluded.name,
        status                   = excluded.status,
        clickup_task_id          = excluded.clickup_task_id,
        clickup_parent_id        = excluded.clickup_parent_id,
        clickup_status           = excluded.clickup_status,
        clickup_status_type      = excluded.clickup_status_type,
        clickup_status_color     = excluded.clickup_status_color,
        clickup_status_order     = excluded.clickup_status_order,
        clickup_space_id         = excluded.clickup_space_id,
        clickup_space_name       = excluded.clickup_space_name,
        clickup_folder_id        = excluded.clickup_folder_id,
        clickup_list_id          = excluded.clickup_list_id,
        clickup_creator_id       = excluded.clickup_creator_id,
        clickup_creator_name     = excluded.clickup_creator_name,
        clickup_time_estimate_ms = excluded.clickup_time_estimate_ms,
        clickup_orderindex       = excluded.clickup_orderindex,
        -- Merge, do not replace: non-ClickUp metadata keys must survive.
        metadata                 = pim.product.metadata || excluded.metadata,
        updated_at               = now();

      if v_existing is null then
        v_ins := v_ins + 1;
      elsif v_old_hash is distinct from v_hash then
        v_upd := v_upd + 1;
      else
        v_unch := v_unch + 1;
      end if;

    exception when others then
      -- Isolated failure: count it, describe it, keep going.
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object(
        'clickup_task_id', v_task_id,
        'sqlstate', sqlstate,
        'error', left(sqlerrm, 500));
    end;
  end loop;

  -- ------------------------------------------------------------------
  -- 3.4 Replayability evidence.
  -- ------------------------------------------------------------------
  select coalesce(md5(string_agg(md5(t.value::text), '|' order by t.value ->> 'clickup_task_id')), md5(''))
    into v_snapshot_hash
    from jsonb_array_elements(v_tasks) t(value);

  -- ------------------------------------------------------------------
  -- 3.5 Close run accounting. Status stays 'succeeded' even with a few failed rows —
  --     partial failure is expected behaviour here, and rows_failed carries it. The
  --     watermark still advances, so a permanently malformed task cannot wedge the
  --     sync; the failure detail lives in metadata.errors for a human.
  -- ------------------------------------------------------------------
  update ingest.sync_run
     set status      = 'succeeded',
         finished_at = now(),
         rows_seen     = v_seen,
         rows_inserted = v_ins,
         rows_updated  = v_upd,
         rows_failed   = v_failed,
         metadata = metadata || jsonb_build_object(
           'stage', 'succeeded',
           'mode', v_mode,
           'watermark_in', v_watermark_in,
           'watermark_at', v_started_at,
           'rows_unchanged', v_unch,
           'snapshot_hash', v_snapshot_hash,
           'errors', v_errors)
   where id = v_sync_id;

  return query select v_sync_id, v_mode, false, v_seen, v_ins, v_upd, v_unch,
                      v_failed, v_started_at, v_snapshot_hash;

exception when others then
  -- Rolls back with the caller's transaction. The RUNNER records the durable failed
  -- sync_run row in a SEPARATE transaction (buildFailedSyncRunSql).
  if v_sync_id is not null then
    update ingest.sync_run
       set status = 'failed', finished_at = now(), error = sqlerrm,
           metadata = metadata || jsonb_build_object('stage', 'failed', 'mode', v_mode)
     where id = v_sync_id;
  end if;
  raise;
end;
$$;

comment on function pim.sync_clickup_tasks(jsonb, text) is
'Guarded incremental importer for ClickUp tasks into pim.product. Upserts on (external_source=''clickup'', external_id=<clickup task id>) — the app-wide import key — one row at a time with ON CONFLICT so a single malformed task is counted in rows_failed instead of discarding the batch. Serializes on pg_try_advisory_xact_lock (returns locked=true rather than queueing). Writes ONLY ingest.raw_record, ingest.sync_run, and ClickUp-owned fields on pim.product; never touches curated links (project/licensor/property/factory/company) or non-clickup metadata keys. Returns watermark_at = this run started_at, which is the next run''s date_updated_gt cutoff.';

-- =====================================================================================
-- 4. public wrapper (AGENTS §8.1) so a service-role caller needs no raw DB password.
-- =====================================================================================
create or replace function public.sync_clickup_tasks(
  p_snapshot jsonb,
  p_mode text default 'incremental'
)
returns table (
  sync_run_id    uuid,
  mode           text,
  locked         boolean,
  rows_seen      integer,
  rows_inserted  integer,
  rows_updated   integer,
  rows_unchanged integer,
  rows_failed    integer,
  watermark_at   timestamptz,
  snapshot_hash  text
)
language plpgsql
security definer
set search_path = public, pim
as $$
begin
  return query select * from pim.sync_clickup_tasks(p_snapshot, p_mode);
end;
$$;

comment on function public.sync_clickup_tasks(jsonb, text) is
'Thin SECURITY DEFINER wrapper over pim.sync_clickup_tasks so a serverless/service-role caller imports ClickUp tasks without a raw DB password.';

revoke all on function pim.sync_clickup_tasks(jsonb, text) from public;
revoke all on function public.sync_clickup_tasks(jsonb, text) from public;
grant execute on function pim.sync_clickup_tasks(jsonb, text) to service_role;
grant execute on function public.sync_clickup_tasks(jsonb, text) to service_role;

-- =====================================================================================
-- 5. Read-only run-accounting surface (matches the ColdLion precedent).
-- =====================================================================================
create or replace function api.clickup_task_sync_run_list(p_limit integer default 50)
returns setof ingest.sync_run
language sql
stable
security definer
set search_path = api, ingest, app
as $$
  select *
  from ingest.sync_run
  where app.has_role('administrator')
    and source_system = 'clickup'
  order by started_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;

comment on function api.clickup_task_sync_run_list(integer) is
'Read-only, admin-gated list of ClickUp task sync runs (including the one-time external_id backfill). ingest is not PostgREST-exposed.';

revoke all on function api.clickup_task_sync_run_list(integer) from public;
grant execute on function api.clickup_task_sync_run_list(integer) to authenticated, service_role;
