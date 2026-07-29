-- ClickUp incremental task import — FORWARD CORRECTNESS FIX.
-- Migration: 20260728181500_clickup_incremental_task_import_fixes.sql
--
-- Why this exists (read before editing anything ClickUp-import related)
-- --------------------------------------------------------------------
-- `20260728160000_clickup_incremental_task_import.sql` shipped the ClickUp importer with
-- five correctness defects found in adversarial review. That migration was swept onto
-- `main` by an unrelated PR and is ALREADY APPLIED to the preview database. AGENTS.md §4.4
-- forbids editing a migration that has been applied anywhere — two sessions silently
-- clobber each other that way, and Supabase's ledger keys on the timestamp, so an edited
-- file would never re-run. The fix therefore lands here, as a NEW forward migration that
-- replaces the function bodies.
--
-- This file itself has NEVER been applied to any database (it was first added on the
-- unpushed branch fix/clickup-importer-correctness), so it is edited in place rather than
-- chained behind yet another migration. AGENTS.md §4.4 only forbids editing a migration
-- that has already been applied somewhere.
--
-- This migration is a pure forward fix. It does NOT re-declare or alter the columns, index,
-- comments, or api.clickup_task_sync_run_list() created by 20260728160000 — those objects
-- already exist and are correct. Any DDL touched here is `if not exists` guarded.
--
-- What each fix addresses
-- -----------------------
--   Defect 1 — watermark was taken from the run's own start time (now() at INSERT), so any
--     ClickUp task edited between the API fetch and the commit was skipped forever. Fixed:
--     the watermark is the caller's PRE-FETCH timestamp (snapshot.fetch_started_at, captured
--     before the first ClickUp API call) minus a 60-second overlap. date_updated_gt is
--     strict and the upsert is idempotent, so overlapping is free and gap-free.
--
--   Defect 2 — the watermark advanced even when rows failed, so a row that errored was never
--     retried and its edit was lost. Fixed: when rows_failed > 0 the watermark does NOT
--     advance (it stays at watermark_in) and the run is marked unmistakably with
--     metadata.outcome='succeeded_with_failures', partial_failure=true, and
--     watermark_advanced=false. ingest.sync_status has no 'partial' value, so status stays
--     'succeeded' and the flags carry the truth. Because a permanently-bad task would now
--     wedge the watermark forever, snapshot.skip_task_ids is the escape hatch: acknowledged
--     ids are skipped wholesale (counted in metadata.rows_skipped, never in rows_failed).
--     Removing an id from that list re-enables it.
--
--   Defect 3 — the backfill claimed external_id from the UNTRIMMED clickup_task_id, so a
--     legacy row holding '123 ' was claimed as ('clickup','123 ') while the importer writes
--     ('clickup','123'). The importer would then INSERT a second product row and strand the
--     curated links (project/licensor/property/stage/cover) on the orphan. Fixed: every
--     comparison is on the TRIMMED id — the importer trims, and section 1 below repairs any
--     untrimmed external_id that a previous run of the broken backfill left behind.
--     (The backfill itself is gone; see defect 6.)
--
--   Defect 4 — every run rewrote every row, bumping updated_at even when nothing in ClickUp
--     changed. pim.product carries a BEFORE UPDATE set_updated_at() trigger, so the churn
--     poisoned anything sorting or filtering on updated_at, including the new
--     (clickup_list_id, updated_at) index. Fixed: the ON CONFLICT DO UPDATE now carries a
--     WHERE that skips the write entirely when the clickup_source_hash is unchanged.
--
--   Defect 5 — skipped rows were dropped silently. Fixed: the importer records
--     skipped_task_ids per run and the trim repair records collisions it could not fix.
--
--   Defect 6 — THE BIG ONE (found 2026-07-29 by querying the real preview database).
--     Both 20260728160000 and the first draft of this file assumed legacy pim.product rows
--     carry `external_source IS NULL`, so a backfill could "claim" them onto
--     ('clickup', clickup_task_id) and let ON CONFLICT (external_source, external_id) find
--     them. The real data says otherwise:
--
--       external_source = 'directus_product' : 17,859 rows. EVERY one has clickup_task_id
--                                              set, and external_id is a Directus id —
--                                              0 of them equal clickup_task_id.
--       external_source = 'clickup'          :     50 rows (external_id = clickup_task_id).
--       external_source IS NULL              :      0 rows.
--
--     So the backfill claimed NOTHING, the ON CONFLICT key could not see the 17,859
--     Directus-keyed rows, and the importer would have INSERTED A DUPLICATE PRODUCT ROW
--     FOR EVERY ONE OF THEM on a database three live apps read.
--
--     Fix (owner's decision): MATCH ON clickup_task_id FIRST and LEAVE THE DIRECTUS KEY
--     INTACT. Legacy rows are NOT re-keyed. Resolution order per incoming task:
--       1. a row whose btrim(clickup_task_id) equals the incoming trimmed id -> UPDATE IN
--          PLACE, and never touch its external_source / external_id;
--       2. otherwise the ('clickup', <task id>) upsert, for genuinely new tasks.
--     Step 1 rows are unreachable by ON CONFLICT, so the per-task logic is now an explicit
--     lookup + UPDATE-by-id, with the ON CONFLICT insert kept only for the step-2 path (it
--     also still guards against a race inserting the same new task twice).
--
--     Because that made clickup_task_id a real import key, section 2 adds the guard that
--     was missing: a UNIQUE INDEX on btrim(clickup_task_id). See section 2 for the
--     cross-app implications — this is a shared-schema change.
--
--     The old backfill is GONE. It is not merely a no-op on preview; claiming legacy rows
--     is exactly what the owner rejected. Nothing in this migration rewrites a product key.
--
--     Counters: the run records rows_matched_by_clickup_task_id vs
--     rows_matched_by_clickup_key vs rows_matched_foreign_source (plus a per-source
--     breakdown), and each imported row carries metadata.clickup_match, so a reviewer can
--     see that legacy matching actually happened instead of a mass insert.
--
-- Contract tests: supabase/tests/clickup_task_import_contracts.sql.
-- Runner: tools/sync-clickup-tasks.mjs (sends fetch_started_at and skip_task_ids).

-- =====================================================================================
-- 1. Repair any UNTRIMMED external_id left by the original (broken) backfill.
--
--    Idempotent and constraint-safe: a value whose trimmed form is already owned by a
--    different row is SKIPPED and recorded, never force-written into a unique violation.
--    On a database where the original backfill claimed only clean ids (verified true on
--    preview on 2026-07-28) this pass finds nothing and records a zero-row run.
-- =====================================================================================
do $repair$
declare
  v_collide text[];
  v_fixed   integer := 0;
begin
  select coalesce(array_agg(distinct p.external_id order by p.external_id), '{}'::text[])
    into v_collide
    from pim.product p
   where p.external_source = 'clickup'
     and p.external_id is distinct from btrim(p.external_id)
     and exists (
       select 1 from pim.product other
        where other.external_source = 'clickup'
          and other.external_id = btrim(p.external_id)
          and other.id <> p.id);

  update pim.product p
     set external_id = btrim(p.external_id)
   where p.external_source = 'clickup'
     and p.external_id is distinct from btrim(p.external_id)
     and btrim(p.external_id) <> ''
     and not exists (
       select 1 from pim.product other
        where other.external_source = 'clickup'
          and other.external_id = btrim(p.external_id)
          and other.id <> p.id);

  get diagnostics v_fixed = row_count;

  if v_fixed > 0 or coalesce(array_length(v_collide, 1), 0) > 0 then
    insert into ingest.sync_run
      (source_system, source_name, status, started_at, finished_at,
       rows_seen, rows_inserted, rows_updated, rows_failed, metadata)
    values
      ('clickup', 'clickup_external_id_trim_repair', 'succeeded', now(), now(),
       v_fixed + coalesce(array_length(v_collide, 1), 0), 0, v_fixed,
       coalesce(array_length(v_collide, 1), 0),
       jsonb_build_object(
         'migration', '20260728181500_clickup_incremental_task_import_fixes',
         'stage', 'trim_repair',
         'rows_trimmed', v_fixed,
         'collision_external_ids', to_jsonb(v_collide),
         'note', 'Untrimmed clickup external_id values written by the original 20260728160000 backfill were trimmed. collision_external_ids could not be trimmed without violating the (external_source, external_id) unique constraint and must be reconciled by hand.'));
  end if;

  raise notice 'ClickUp external_id trim repair: % row(s) trimmed, % collision(s) skipped',
    v_fixed, coalesce(array_length(v_collide, 1), 0);
end;
$repair$;

-- =====================================================================================
-- 2. GUARD: make clickup_task_id a real, unique import key (defect 6).
--
--    *** SHARED-SCHEMA CHANGE — read this before merging. ***
--    This adds a UNIQUE INDEX on btrim(clickup_task_id) over pim.product, for non-null,
--    non-blank ids. pim.product is read and written by PopPIM and read by other POP apps,
--    so any app that inserts a pim.product row carrying a clickup_task_id already used by
--    another row will now get a unique-violation instead of silently forking the product.
--    That is the intended behaviour: the importer resolves a task to a product BY this
--    column, and two rows sharing an id would make the match non-deterministic and would
--    re-open exactly the duplicate-row bug this migration exists to close.
--
--    Verified safe on the real preview data on 2026-07-29: 17,909 rows carry a
--    clickup_task_id and there are 17,909 distinct values — zero duplicates — and no id
--    appears under more than one external_source.
--
--    Blank/whitespace-only ids are excluded from the index. They are not usable import
--    keys (the importer nullifs a blank id and fails the task), and without the exclusion
--    two blank rows would collide and fail this migration for no benefit.
--
--    FAIL LOUDLY, NEVER SKIP SILENTLY: the pre-check below raises with the offending ids if
--    duplicates exist, and the post-check raises if the index is not present afterwards. So
--    `if not exists` can only mean "already correct", never "quietly skipped".
-- =====================================================================================
do $guard_pre$
declare
  v_dupes text[];
begin
  select coalesce(array_agg(task_id order by task_id), '{}'::text[])
    into v_dupes
  from (
    select btrim(clickup_task_id) as task_id
      from pim.product
     where clickup_task_id is not null
       and btrim(clickup_task_id) <> ''
     group by btrim(clickup_task_id)
    having count(*) > 1
     limit 50
  ) d;

  if coalesce(array_length(v_dupes, 1), 0) > 0 then
    raise exception
      'cannot make clickup_task_id unique: % duplicate id(s) exist on pim.product (first 50: %). Reconcile the duplicate product rows by hand, then re-apply.',
      coalesce(array_length(v_dupes, 1), 0), v_dupes
      using errcode = 'P0001';
  end if;
end;
$guard_pre$;

create unique index if not exists pim_product_clickup_task_id_uidx
  on pim.product (btrim(clickup_task_id))
  where clickup_task_id is not null and btrim(clickup_task_id) <> '';

comment on index pim.pim_product_clickup_task_id_uidx is
'One product row per ClickUp task. pim.sync_clickup_tasks resolves an incoming task to an existing product by btrim(clickup_task_id) FIRST (legacy rows are keyed on external_source=''directus_product'' and are unreachable via the (external_source, external_id) ClickUp key), so this uniqueness is what makes that match deterministic. Do not drop it without changing the importer.';

do $guard_post$
begin
  if to_regclass('pim.pim_product_clickup_task_id_uidx') is null then
    raise exception 'pim_product_clickup_task_id_uidx was not created — refusing to continue'
      using errcode = 'P0001';
  end if;
  raise notice 'ClickUp guard: unique index on btrim(clickup_task_id) present';
end;
$guard_post$;

-- =====================================================================================
-- 3. Internal importer.
--
--    Two review-driven design points:
--      * ADVISORY LOCK (pg_try_advisory_xact_lock, not the blocking form) so two runs
--        cannot race each other. If another run holds it we return a 'locked' result
--        cleanly instead of queueing behind it or corrupting the watermark.
--      * PER-ROW resolve-then-write inside a loop, each row wrapped in its own
--        exception block. One malformed task fails and is counted in rows_failed; it
--        does NOT roll back the rest of the batch. A single bulk statement would.
--
--    Row resolution (defect 6) — the incoming trimmed task id is matched in this order:
--      1. an existing pim.product whose btrim(clickup_task_id) equals it. This is how the
--         17,859 legacy rows keyed ('directus_product', <directus id>) are found. They are
--         UPDATED IN PLACE by id; their external_source and external_id are NEVER touched.
--         The unique index from section 2 makes this match single-valued.
--      2. otherwise the ('clickup', <task id>) key, via an INSERT ... ON CONFLICT. This
--         path is for genuinely new tasks; the ON CONFLICT also absorbs a concurrent
--         insert of the same new task.
--    Both paths write ClickUp-owned fields only and both honour the unchanged-hash skip.
--
--    Watermark contract: the caller captures a PRE-FETCH timestamp (before any ClickUp API
--    call) and passes it as snapshot.fetch_started_at. The function stores/returns THAT
--    (minus a 60s overlap) as watermark_at, the next run's date_updated_gt cutoff — never
--    started_at/finished_at, which would silently drop a task edited while the run was
--    still pulling lists. On partial failure (rows_failed > 0) the watermark does NOT
--    advance, so failed rows are retried next run; acknowledged permanently-bad ids
--    (snapshot.skip_task_ids) are skipped wholesale so they cannot wedge the advance.
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
  v_fetch_started timestamptz;   -- caller-captured PRE-FETCH timestamp (defect 1)
  v_started_at    timestamptz;   -- run accounting: when this run began fetching
  v_watermark_out timestamptz;   -- watermark the NEXT run must use as date_updated_gt
  v_task          jsonb;
  v_task_id       text;
  v_skip_ids      text[];        -- acknowledged permanently-bad ids (escape hatch, defect 2)
  v_skipped       integer := 0;
  v_skipped_ids   text[] := '{}';
  v_existing      uuid;
  v_hash          text;
  v_old_hash      text;
  v_match_kind    text;          -- 'clickup_task_id' | 'clickup_key' | 'new' (defect 6)
  v_match_source  text;          -- external_source of the row matched by clickup_task_id
  v_by_task_id    integer := 0;  -- matched via btrim(clickup_task_id)
  v_by_clickup_key integer := 0; -- matched via (external_source='clickup', external_id)
  v_foreign_match integer := 0;  -- subset of v_by_task_id owned by a NON-clickup source
  v_src_counts    jsonb := '{}'::jsonb;  -- external_source -> rows matched, for review
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
  -- Defect 1: the watermark stored for the next run is the caller's PRE-FETCH timestamp
  -- (captured before any ClickUp API call), never now()/finished_at. Fall back to now()
  -- only so a hand-built snapshot cannot hard-fail; the runner always sends it.
  v_fetch_started := coalesce(nullif(p_snapshot ->> 'fetch_started_at', '')::timestamptz, now());
  v_started_at    := v_fetch_started;

  -- Defect 2 escape hatch: ids the operator has acknowledged as permanently bad. They are
  -- skipped before the upsert (counted in rows_skipped, NOT rows_failed), so they neither
  -- poison rows_failed nor wedge the watermark. Removing an id from the list re-enables it.
  v_skip_ids := case
    when jsonb_typeof(coalesce(p_snapshot -> 'skip_task_ids', 'null'::jsonb)) = 'array'
    then coalesce(
      (select array_agg(nullif(btrim(s.value), ''))
         from jsonb_array_elements_text(p_snapshot -> 'skip_task_ids') s(value)),
      '{}'::text[])
    else '{}'::text[]
  end;

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
  -- 3.2 Open run accounting. started_at is the run-accounting "fetch began at" time; it
  --     is NOT the watermark (the watermark is computed at close, see 3.5).
  -- ------------------------------------------------------------------
  insert into ingest.sync_run (source_system, source_name, status, started_at, metadata)
  values ('clickup', 'clickup_tasks_api', 'running', v_started_at,
          jsonb_build_object(
            'endpoint', 'GET /list/{list_id}/task',
            'mode', v_mode,
            'stage', 'running',
            'watermark_in', v_watermark_in,
            'fetch_started_at', v_fetch_started,
            'lists', v_lists))
  returning id into v_sync_id;

  -- ------------------------------------------------------------------
  -- 3.3 Per-row upsert loop. Each task is isolated: a bad row is counted and
  --     described in metadata.errors, the rest of the batch still lands.
  -- ------------------------------------------------------------------
  for v_task in select value from jsonb_array_elements(v_tasks) loop
    v_seen := v_seen + 1;
    v_task_id := nullif(btrim(coalesce(v_task ->> 'clickup_task_id', '')), '');

    -- Escape hatch (defect 2): acknowledged bad ids are skipped wholesale — not attempted,
    -- not failed — so a permanently malformed task cannot wedge the watermark forever.
    if v_task_id is not null and v_task_id = any (v_skip_ids) then
      v_skipped := v_skipped + 1;
      v_skipped_ids := v_skipped_ids || v_task_id;
      continue;
    end if;

    begin
      if v_task_id is null then
        raise exception 'task is missing clickup_task_id';
      end if;

      v_hash := md5(coalesce(v_task -> 'raw', v_task)::text);

      -- ---- Row resolution (defect 6) ------------------------------------------------
      -- STEP 1: match on the trimmed clickup_task_id, whatever the row's external_source
      -- is. This is the only way to reach the legacy rows keyed on Directus ids. Section
      -- 2's unique index guarantees at most one match.
      v_existing     := null;
      v_old_hash     := null;
      v_match_source := null;

      select p.id, p.metadata ->> 'clickup_source_hash', p.external_source
        into v_existing, v_old_hash, v_match_source
        from pim.product p
       where p.clickup_task_id is not null
         and btrim(p.clickup_task_id) = v_task_id
       limit 1;

      if v_existing is not null then
        v_match_kind := 'clickup_task_id';
      else
        -- STEP 2: fall back to the ClickUp import key for genuinely new tasks.
        select p.id, p.metadata ->> 'clickup_source_hash', p.external_source
          into v_existing, v_old_hash, v_match_source
          from pim.product p
         where p.external_source = 'clickup'
           and p.external_id = v_task_id
         limit 1;
        v_match_kind := case when v_existing is null then 'new' else 'clickup_key' end;
      end if;

      -- Metadata keys the existing api.pm_* views still read from. Kept in sync with
      -- the new columns so no view has to change in this migration.
      v_meta := jsonb_strip_nulls(jsonb_build_object(
        'clickup_match',            v_match_kind,
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

      if v_existing is not null then
        -- ---- STEP 1/2 WRITE: update the resolved row IN PLACE, by id. -----------------
        -- external_source and external_id are deliberately absent from this SET list: a
        -- legacy row keeps its Directus key forever. So are the curated Poppim fields
        -- (project_id, licensor_id, property_id, factory_id, company_id, stage,
        -- cover_url). The WHERE carries defect 4's unchanged-hash skip, so an unchanged
        -- task performs no write at all and the BEFORE UPDATE set_updated_at() trigger
        -- never fires.
        update pim.product p set
          name                     = coalesce(nullif(btrim(coalesce(v_task ->> 'name', '')), ''),
                                              'Untitled ClickUp task ' || v_task_id),
          status                   = v_task ->> 'clickup_status',
          clickup_task_id          = v_task_id,
          clickup_parent_id        = nullif(v_task ->> 'clickup_parent_id', ''),
          clickup_status           = v_task ->> 'clickup_status',
          clickup_status_type      = v_task ->> 'clickup_status_type',
          clickup_status_color     = v_task ->> 'clickup_status_color',
          clickup_status_order     = nullif(v_task ->> 'clickup_status_order', '')::numeric,
          clickup_space_id         = v_task ->> 'clickup_space_id',
          clickup_space_name       = v_task ->> 'clickup_space_name',
          clickup_folder_id        = v_task ->> 'clickup_folder_id',
          clickup_list_id          = v_task ->> 'clickup_list_id',
          clickup_creator_id       = v_task ->> 'clickup_creator_id',
          clickup_creator_name     = v_task ->> 'clickup_creator_name',
          clickup_time_estimate_ms = nullif(v_task ->> 'clickup_time_estimate_ms', '')::bigint,
          clickup_orderindex       = v_task ->> 'clickup_orderindex',
          -- Merge, do not replace: non-ClickUp metadata keys must survive.
          metadata                 = p.metadata || v_meta,
          updated_at               = now()
        where p.id = v_existing
          and p.metadata ->> 'clickup_source_hash' is distinct from v_hash;
      else
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
        updated_at               = now()
      -- Defect 4: only write when the ClickUp source hash actually changed. An unchanged
      -- task must not bump updated_at (it poisons anything sorting/filtering on it and the
      -- new (clickup_list_id, updated_at) index). The hash is the full raw-task digest, so
      -- "hash unchanged" == "every ClickUp field identical" == safe to no-op the conflict.
      where pim.product.metadata ->> 'clickup_source_hash'
            is distinct from excluded.metadata ->> 'clickup_source_hash';
      end if;

      if v_existing is null then
        v_ins := v_ins + 1;
      elsif v_old_hash is distinct from v_hash then
        v_upd := v_upd + 1;
      else
        v_unch := v_unch + 1;
      end if;

      -- Match accounting (defect 6). A reviewer must be able to see that legacy rows were
      -- MATCHED rather than duplicated: on the first real run against production-shaped
      -- data, rows_matched_by_clickup_task_id should be ~17.9k and rows_inserted ~0.
      if v_match_kind = 'clickup_task_id' then
        v_by_task_id := v_by_task_id + 1;
        if v_match_source is distinct from 'clickup' then
          v_foreign_match := v_foreign_match + 1;
        end if;
        v_src_counts := jsonb_set(
          v_src_counts,
          array[coalesce(v_match_source, '(null)')],
          to_jsonb(coalesce((v_src_counts ->> coalesce(v_match_source, '(null)'))::int, 0) + 1),
          true);
      elsif v_match_kind = 'clickup_key' then
        v_by_clickup_key := v_by_clickup_key + 1;
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
  -- 3.5 Watermark + close run accounting (defects 1 and 2). On a clean run the watermark
  --     advances to just before this run's fetch started (minus a 60s overlap, since
  --     date_updated_gt is strict and the upsert is idempotent). When rows_failed > 0 the
  --     watermark does NOT advance (the failed rows are retried next run); the run stays
  --     'succeeded' (ingest.sync_status has no 'partial' value) but is marked unmistakably
  --     via outcome='succeeded_with_failures' and partial_failure=true. Acknowledged bad
  --     ids (skip_task_ids) never reach rows_failed; they are the escape hatch for a task
  --     that would otherwise wedge the watermark.
  -- ------------------------------------------------------------------
  if v_failed > 0 then
    v_watermark_out := v_watermark_in;
  else
    v_watermark_out := v_fetch_started - interval '60 second';
  end if;

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
           'fetch_started_at', v_fetch_started,
           'watermark_at', v_watermark_out,
           'watermark_advanced', (v_failed = 0),
           'outcome', case when v_failed > 0 then 'succeeded_with_failures' else 'succeeded_clean' end,
           'partial_failure', (v_failed > 0),
           'rows_unchanged', v_unch,
           'rows_matched_by_clickup_task_id', v_by_task_id,
           'rows_matched_by_clickup_key', v_by_clickup_key,
           'rows_matched_foreign_source', v_foreign_match,
           'matched_external_sources', v_src_counts,
           'rows_skipped', v_skipped,
           'skipped_task_ids', to_jsonb(v_skipped_ids),
           'snapshot_hash', v_snapshot_hash,
           'errors', v_errors)
   where id = v_sync_id;

  return query select v_sync_id, v_mode, false, v_seen, v_ins, v_upd, v_unch,
                      v_failed, v_watermark_out, v_snapshot_hash;

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
'Guarded incremental importer for ClickUp tasks into pim.product. Resolves each task to a product by btrim(clickup_task_id) FIRST — that is how the ~17.9k legacy rows keyed (external_source=''directus_product'', external_id=<directus id>) are matched, and those rows are updated IN PLACE with their external_source/external_id left untouched — and only falls back to the (external_source=''clickup'', external_id=<task id>) upsert for genuinely new tasks. One row at a time, each in its own exception block, so a single malformed task is counted in rows_failed instead of discarding the batch, and a row is written only when its source hash actually changed (unchanged rows do not bump updated_at). Serializes on pg_try_advisory_xact_lock (returns locked=true rather than queueing). Writes ONLY ingest.raw_record, ingest.sync_run, and ClickUp-owned fields on pim.product; never touches curated links (project/licensor/property/factory/company) or non-clickup metadata keys. Returns watermark_at = the caller''s PRE-FETCH timestamp (snapshot.fetch_started_at) minus a 60s overlap, which is the next run''s date_updated_gt cutoff; when rows_failed > 0 the watermark does NOT advance so the failed rows are retried. snapshot.skip_task_ids is the escape hatch for acknowledged permanently-bad ids.';

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
