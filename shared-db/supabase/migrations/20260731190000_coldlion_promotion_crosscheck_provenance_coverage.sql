-- Step 5.6 CROSS-CHECK COVERAGE: the runner/database agreement check guarded only ONE of the
-- function's three write paths.
-- Plan: plan_coldlion_licensor_property_accelerated_cutover.md, Step 7A.
--
-- Forward correction of plm.promote_coldlion_source_owned only. 20260729230000,
-- 20260729234500, 20260729235500 and 20260730000500 are applied to preview
-- rjyboqwcdzcocqgmsyel and are therefore immutable (AGENTS.md section 4 rule 4). No table,
-- index, policy, grant, trigger or other function changes here; this migration reads and
-- writes no data.
--
-- REBASED ONTO 20260731180000 (2026-07-31). This migration was originally authored as
-- version 20260731170000 against the body of 20260730000500. FOUR sessions independently
-- authored `create or replace` migrations for this one function at the same time, and
-- `create or replace` is last-writer-wins, so the file that merged last would have silently
-- ERASED the others. Note there was no textual merge conflict to warn anyone: each migration
-- is a NEW file. The function body below is therefore taken verbatim from the current
-- definition on main and has ONLY this migration's cross-check change layered on top:
--
--   * 20260731163000 removed the dead in-function failure recording. PRESERVED below: there
--     is still NO body-level `exception when others` handler, and the refusal paths in 5.4
--     and 5.6 do NOT try to mark their own ingest.sync_run row failed. The two new refusals
--     this migration adds follow that same convention deliberately — see 5.6.
--   * 20260731180000 added the section 5.0 serialization guard on advisory lock 720260729.
--     PRESERVED below, unchanged.
--
-- WHERE DURABLE FAILURE RECORDING ACTUALLY LIVES — DO NOT DELETE IT
-- ----------------------------------------------------------------
-- Carried forward, because this file is now the newest definition of the function and is the
-- first place a future session will look. Failure recording is OUT OF BAND in
-- `tools/promote-coldlion-source-owned.mjs`, and it must stay that way. Its catch block runs
-- AFTER the aborted promotion transaction is gone, and issues two SEPARATE psql transactions
-- that therefore survive the rollback:
--
--   1. buildPromotionAlertSql() -> public.record_taxonomy_sync_alert(...) at severity 'critical'
--      (named arguments on purpose), which is what trips the breaker autotrip and fires
--      pg_notify on two consecutive failures;
--   2. buildFailedSyncRunSql() -> a FRESH ingest.sync_run row with status 'failed', carrying the
--      failing stage and the error text.
--
-- Nothing inside the aborted transaction can leave a durable trace of its own abort, so a
-- separate transaction is not a workaround — it is the ONLY place this can work. Do not
-- "restore" an in-function exception handler here. NOTE the contrast with section 5.0: the
-- skipped_already_running row DOES commit, because that path RETURNS normally instead of
-- raising, so nothing rolls it back.
--
-- THE FAULT
-- ---------
-- Section 5.6 asserts that the runner's plan and the database's own recomputation agree
-- before anything is applied. That assertion compared exactly ONE set, `v_server_keys`:
--     where quarantine_reason is null
--       and resolution_status = 'manually_matched'
--       and present_this_cycle
--       and (normalize(source_name) = normalize(canonical_name)
--            and (source_name <> canonical_name
--                 or coalesce(ref_source_name,'') <> coalesce(source_name,'')))
-- which is the curated-name subset — clean rows whose name is being restyled (or whose
-- provenance source_name is catching up on the same row).
--
-- Step 5.8, however, updates core.taxonomy_source_ref for a strictly WIDER set:
--     ... and p.quarantine_reason is distinct from 'wrong_type'
--         and (coalesce(r.source_name,'') <> coalesce(p.source_name,'')
--              or coalesce(r.source_code,'') <> p.mg_code)
-- That leaves two mutation paths that no cross-check ever looked at:
--
--   1. THE source_code REFRESH PATH. `or coalesce(r.source_code,'') <> p.mg_code` writes
--      taxonomy_source_ref.source_code. A row whose names all agree but whose stored
--      source_code has drifted is mutated while both the runner plan and v_server_keys are
--      empty. Neither side ever proposed it and neither side would notice it.
--
--   2. THE HELD-ROW PROVENANCE REFRESH PATH. 5.8 deliberately excludes only 'wrong_type', so
--      a row quarantined as source_name_divergence (or ambiguous_match, cross_typed,
--      code_collision, rekeyed_record, parentless_record, new_source_record) still gets its
--      provenance refreshed — that is the design, so ColdLion's truth is never lost while a
--      human reviews the curated name. But v_server_keys requires `quarantine_reason is
--      null`, so every one of those writes was outside the assertion.
--
-- Net effect: on two of the three change classes, drift or an unexpected mutation would pass
-- the cross-check unnoticed, and the lane's headline safety property — "nothing is applied
-- that two independent computations did not both predict" — was only true of curated names.
-- This is not a data-corruption bug that has fired; it is the GUARD being narrower than what
-- it guards, which is exactly the silent-failure class this repository treats as first class.
--
-- THE FIX
-- -------
-- Add a SECOND cross-checked set, `provenance_refreshes`, whose server-side predicate is
-- character-for-character the 5.8 UPDATE predicate. It therefore covers BOTH missing paths at
-- once, and it does so by mirroring the mutation itself rather than by re-deriving a subset —
-- so if 5.8 ever changes, the assertion is wrong in an obvious, loud way instead of silently
-- drifting narrow again. It is computed at 5.6, BEFORE 5.8 runs, so it compares the rows that
-- are ABOUT to be written.
--
-- The existing `promotions` comparison is left exactly as it was. It is a real assertion about
-- the curated-name rule and the two sets deliberately overlap; narrowing or merging them would
-- trade one blind spot for another.
--
-- FAIL-CLOSED ON AN OLD RUNNER. If a plan is supplied at all but has no
-- `provenance_refreshes` key, the promotion is REFUSED rather than silently falling back to
-- the old, narrower check. A runner that predates this migration cannot predict these rows, so
-- accepting its plan would mean applying provenance writes with no cross-check while the log
-- still said "plan verified" — a false assurance is worse than no assurance. jsonb `?`
-- distinguishes an ABSENT key (old runner, refuse) from an empty array (new runner, correctly
-- predicting no provenance work this cycle, which is the steady-state no-op case).
--
-- Passing p_client_plan => null remains supported and unchanged: it means "no independent plan
-- to compare", the pre-existing documented mode for a direct operator call.
--
-- Nothing here enables the production lane. COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED is
-- still not created, and the recurring lane stays preview-only until Step 8 approval.

create or replace function plm.promote_coldlion_source_owned(
  p_expected jsonb,
  p_client_plan jsonb default null,
  p_is_drill boolean default false
)
returns table (
  sync_run_id            uuid,
  mode                   text,
  source_rows            integer,
  linked_rows            integer,
  promotions             integer,
  curated_name_changes   integer,
  provenance_refreshes   integer,
  unchanged_rows         integer,
  quarantined_rows       integer,
  protected_violations   integer
)
language plpgsql
security definer
set search_path = plm, ingest, core, app, extensions, public
as $$
declare
  v_run_id            uuid;
  v_snapshot_run_id   uuid;
  v_env               text := current_database();
  v_before_uuid       text;
  v_before_status     text;
  v_before_parent     text;
  v_after_uuid        text;
  v_after_status      text;
  v_after_parent      text;
  v_lic_before        bigint;
  v_prop_before       bigint;
  v_lic_after         bigint;
  v_prop_after        bigint;
  v_source_rows       integer := 0;
  v_linked_rows       integer := 0;
  v_promotions        integer := 0;
  v_name_changes      integer := 0;
  v_prov_refresh      integer := 0;
  v_unchanged         integer := 0;
  v_quarantined       integer := 0;
  v_violations        integer := 0;
  v_client_keys       text[];
  v_server_keys       text[];
  -- FIX 5: the second cross-checked set — every row 5.8 is about to write.
  v_client_prov_keys  text[];
  v_server_prov_keys  text[];
  v_lock_key          constant bigint := 720260729;
  v_lock_acquired     boolean;
begin
  -- ---------------------------------------------------------------------------------
  -- 5.0 SERIALIZATION GUARD (added 2026-07-31). Take the promotion lane lock FIRST,
  --     before the breaker check and before any read, so a second caller decides
  --     "skip" immediately instead of half-computing a cycle it must then discard.
  --
  --     THE KEY IS A DOCUMENTED CONSTANT: 720260729. It is a literal, not
  --     hashtext(...), on purpose - hashtext() is only guaranteed stable within a
  --     PostgreSQL major version, so a major upgrade could silently move the lock and
  --     let two runs interleave with no visible change anywhere. The digits encode the
  --     lane: 7 = Step 7A, 20260729 = the date the recurring promotion shipped. It is
  --     registered in docs/advisory-lock-registry.md; never reuse it for anything else.
  --
  --     TRANSACTION-SCOPED (pg_try_advisory_xact_lock, not pg_advisory_lock): the lock
  --     is released by COMMIT or ROLLBACK, so a crashed or cancelled run can never
  --     leave the lane wedged. TRY, not a blocking wait: a scheduled run must not sit
  --     in a queue behind a manual drill and then apply a stale plan computed minutes
  --     earlier against a snapshot that has since moved.
  --
  --     WHY THIS EXISTS: the recurring lane is driven both by a scheduled GitHub
  --     Actions workflow and by manual drills. Nothing stopped a drill and a scheduled
  --     run from operating on the same mirror rows at the same time, duplicating
  --     promotion work and producing two overlapping ingest.sync_run rows that make the
  --     bookkeeping unreadable.
  --
  --     NOT A SILENT NO-OP. This repository forbids silent failures, so losing the race
  --     is RECORDED, not swallowed: a cancelled ingest.sync_run row is committed under
  --     the same source_name with metadata.outcome = skipped_already_running, and the
  --     function returns mode = skipped_already_running with zero counts. Status is
  --     cancelled, NOT failed, and that distinction is load-bearing: the host runner
  --     escalates on two CONSECUTIVE failed rows (tools/coldlion-sync-common.mjs
  --     buildFailedSyncRunSql -> pg_notify), and a healthy overlap must never trip that
  --     breaker. A skipped cycle is a normal, expected, visible event - the next
  --     scheduled cycle promotes whatever this one deferred.
  --
  --     NOTE this INSERT is committed, not rolled back: the function returns normally
  --     here, so no RAISE discards it. That is what makes it a durable record and not
  --     the dead-write pattern that 20260731163000 removed.
  -- ---------------------------------------------------------------------------------
  select pg_try_advisory_xact_lock(v_lock_key) into v_lock_acquired;

  if not coalesce(v_lock_acquired, false) then
    insert into ingest.sync_run (source_system, source_name, status, started_at, finished_at, error, metadata)
    values ('coldlion', 'coldlion_licensors_properties_promote_source_owned',
            'cancelled', now(), now(),
            'ColdLion recurring promotion SKIPPED: another promotion transaction already holds the lane advisory lock 720260729. Nothing was read or written. This is a normal overlap between the scheduled run and a manual drill, not a failure.',
            jsonb_build_object(
              'mode', 'promote_source_owned',
              'rule_id', 'coldlion_source_name_normalized_equivalent_v1',
              'is_drill', p_is_drill,
              'outcome', 'skipped_already_running',
              'advisory_lock_key', v_lock_key,
              'counts_toward_consecutive_failure_breaker', false,
              'environment', v_env,
              'session_user', session_user::text))
    returning id into v_run_id;

    raise warning
      'ColdLion recurring promotion SKIPPED (sync_run %): another promotion already holds advisory lock %. No rows were read or written.',
      v_run_id, v_lock_key;

    return query select v_run_id, 'skipped_already_running'::text,
                        0, 0, 0, 0, 0, 0, 0, 0;
    return;
  end if;

  -- ---------------------------------------------------------------------------------
  -- 5.1 The breaker must be closed. A tripped breaker refuses promotion outright.
  -- ---------------------------------------------------------------------------------
  if plm.taxonomy_circuit_breaker_is_open('coldlion_licensor_property') then
    perform plm.trip_taxonomy_circuit_breaker(
      'promote_source_owned attempted while the breaker was already tripped',
      'breaker_open', 'coldlion_licensor_property', null, v_env, session_user, p_is_drill,
      jsonb_build_object('mode', 'promote_source_owned'));
    raise exception
      'ColdLion promotion refused: the circuit breaker for lane coldlion_licensor_property is TRIPPED. Promotion stays disabled until an explicitly authorized reset after a green preview evaluation.'
      using errcode = 'P0001';
  end if;

  -- ---------------------------------------------------------------------------------
  -- 5.2 Promotion may only ever operate over the human-approved link set. The pins are
  --     the same Phase 4 approval Albert signed off: 542 rows / 271 distinct canonical.
  --     A caller cannot widen the scope by inventing a contract.
  -- ---------------------------------------------------------------------------------
  if p_expected is null or jsonb_typeof(p_expected) <> 'object'
     or lower(btrim(coalesce(p_expected ->> 'hash', ''))) <> '1230f5a12d0f2a3029f1d3df17fc5b5f'
     or btrim(coalesce(p_expected ->> 'count', '')) <> '542'
     or btrim(coalesce(p_expected ->> 'distinct_canonical', '')) <> '271' then
    raise exception
      'promote_source_owned rejected: the expected contract must be exactly the approved Phase 4 set (hash 1230f5a12d0f2a3029f1d3df17fc5b5f, count 542, distinct_canonical 271 — Albert Hazan approval). Promotion can never operate over an unapproved link scope.'
      using errcode = 'P0001';
  end if;

  -- ---------------------------------------------------------------------------------
  -- 5.3 Protected hashes + canonical row counts BEFORE any write.
  -- ---------------------------------------------------------------------------------
  select md5(coalesce(string_agg(id::text, '|' order by id::text), '')) into v_before_uuid
  from (select id from core.licensor union all select id from core.property) u;
  select md5(coalesce(string_agg(id::text || '|' || status::text, '|' order by id::text), '')) into v_before_status
  from (select id, status::text from core.licensor union all select id, status::text from core.property) s;
  select md5(coalesce(string_agg(id::text || '|' || licensor_id::text, '|' order by id::text), '')) into v_before_parent
  from core.property;
  select count(*) into v_lic_before from core.licensor;
  select count(*) into v_prop_before from core.property;

  insert into ingest.sync_run (source_system, source_name, status, started_at, metadata)
  values ('coldlion', 'coldlion_licensors_properties_promote_source_owned', 'running', now(),
          jsonb_build_object('mode', 'promote_source_owned',
                             'rule_id', 'coldlion_source_name_normalized_equivalent_v1',
                             'is_drill', p_is_drill,
                             'protected_hashes_before',
                             jsonb_build_object('uuid', v_before_uuid,
                                                'status', v_before_status,
                                                'parent_edge', v_before_parent)))
  returning id into v_run_id;

  -- ---------------------------------------------------------------------------------
  -- 5.4 Which ColdLion snapshot is this cycle promoting? The most recent SUCCESSFUL
  --     mirror_only run. Mirror rows stamped with that run are "present this cycle";
  --     approved-linked rows NOT stamped with it are absent, i.e. review items.
  -- ---------------------------------------------------------------------------------
  select id into v_snapshot_run_id
  from ingest.sync_run
  where source_name = 'coldlion_licensors_properties_api' and status = 'succeeded'
  order by started_at desc nulls last
  limit 1;

  if v_snapshot_run_id is null then
    -- DEAD CODE REMOVED (2026-07-31): an `update ingest.sync_run set status = 'failed'`
    -- stood here. The RAISE below aborts the transaction, so the 5.3 INSERT of this run row
    -- is rolled back with it and the UPDATE could never persist. See the header note:
    -- tools/promote-coldlion-source-owned.mjs records this failure out of band.
    raise exception
      'ColdLion promotion refused: there is no successful mirror_only snapshot to promote. The recurring lane runs the snapshot first, on purpose — promoting stale mirror rows would present old ERP truth as current.'
      using errcode = 'P0001';
  end if;

  -- ---------------------------------------------------------------------------------
  -- 5.5 Build the decision set, resolving EVERY row by the full typed key
  --     (company_code, division_code, mg_type_code, mg_code) — never mg_code alone.
  --     `FR` is a licensor here and a property in ColdLion; codes are unique only
  --     within (division, mg_type_code). Matching on code alone corrupts the taxonomy.
  --
  --     FIX 5 adds ref_source_code to this projection. The 5.6 cross-check now has to
  --     reason about the source_code refresh path, and it must read the SAME snapshot of
  --     core.taxonomy_source_ref that 5.8 will compare against.
  -- ---------------------------------------------------------------------------------
  create temporary table coldlion_promote_rows on commit drop as
  with mirror as (
    select 'licensor'::text as entity_type, company_code, division_code, mg_type_code, mg_code,
           name as source_name, licensor_id as canonical_id, resolution_status, last_sync_run_id
    from plm.erp_licensor
    union all
    select 'property'::text, company_code, division_code, mg_type_code, mg_code,
           name, property_id, resolution_status, last_sync_run_id
    from plm.erp_property
  ),
  joined as (
    select m.*,
           -- FIX 4: coalesce to FALSE. A NULL last_sync_run_id made present_this_cycle NULL,
           -- so `not present_this_cycle` evaluated to NULL and the missing_source_record arm
           -- never fired: a record ColdLion stopped sending was SILENTLY neither promoted nor
           -- quarantined. Absence must always be visible as a review item.
           coalesce(m.last_sync_run_id = v_snapshot_run_id, false) as present_this_cycle,
           c.canonical_name, c.canonical_code, c.canonical_status, c.canonical_licensor_id,
           r.id as source_ref_id, r.source_name as ref_source_name, r.source_code as ref_source_code
    from mirror m
    left join lateral (
      select l.name as canonical_name, l.code as canonical_code,
             l.status::text as canonical_status, null::uuid as canonical_licensor_id
      from core.licensor l where m.entity_type = 'licensor' and l.id = m.canonical_id
      union all
      select p.name, p.code, p.status::text, p.licensor_id
      from core.property p where m.entity_type = 'property' and p.id = m.canonical_id
    ) c on true
    left join core.taxonomy_source_ref r
      on r.source_system = 'coldlion'
     and r.source_id = m.company_code || '/' || m.division_code || '/' || m.mg_type_code || '/' || m.mg_code
    -- FIX 1: the select-list alias present_this_cycle is NOT visible in WHERE, so the
    -- expression is repeated here. The original raised 42703 on every call.
    where m.resolution_status = 'manually_matched'
       or m.last_sync_run_id = v_snapshot_run_id
  ),
  -- FIX 2 — WHAT IS AND IS NOT A COLLISION.
  -- The original rule treated ANY canonical row reachable from more than one typed key as a
  -- collision. Rehearsed against preview on 2026-07-29 it quarantined 542 of 542 rows, i.e.
  -- the ENTIRE feed, because multi-key fan-in is the APPROVED DESIGN: Albert's approved
  -- Phase 4 mapping deliberately points 542 ColdLion source rows at 271 canonical rows (the
  -- same property legitimately exists under both CW001 and SP001, and both keys mean the
  -- same canonical entity).
  -- Fan-in is therefore NOT a fault. The real hazard is fan-in where the source rows
  -- DISAGREE about the name, because promotion would then have to pick a winner — and
  -- picking a winner silently is exactly the corruption this lane exists to prevent.
  -- DO NOT 'simplify' this back to key_count > 1; that disables the whole feed.
  collisions as (
    select canonical_id,
           count(distinct company_code || '/' || division_code || '/' || mg_type_code || '/' || mg_code) as key_count,
           count(distinct division_code) as division_count,
           count(distinct company_code || '/' || mg_type_code || '/' || mg_code) as keys_without_division,
           count(distinct plm.coldlion_normalize_name(source_name))
             filter (where present_this_cycle) as distinct_proposed_names
    from joined
    where canonical_id is not null and resolution_status = 'manually_matched'
    group by canonical_id
  )
  select j.entity_type, j.company_code, j.division_code, j.mg_type_code, j.mg_code,
         j.source_name, j.canonical_id, j.canonical_name, j.canonical_code,
         j.canonical_status, j.canonical_licensor_id, j.resolution_status,
         j.present_this_cycle, j.source_ref_id, j.ref_source_name, j.ref_source_code,
         case
           when j.mg_type_code !~ '^[0-9]{2}$'
             or btrim(coalesce(j.company_code, '')) = ''
             or btrim(coalesce(j.division_code, '')) = ''
             or btrim(coalesce(j.mg_code, '')) = ''
             then 'wrong_type'
           when j.resolution_status <> 'manually_matched' and j.present_this_cycle
             then 'new_source_record'
           when j.resolution_status = 'manually_matched' and not j.present_this_cycle
             then 'missing_source_record'
           when j.canonical_id is null
             then 'ambiguous_match'
           when j.canonical_name is null
             then 'cross_typed'
           when col.key_count > 1 and col.distinct_proposed_names > 1
                and col.keys_without_division = 1 and col.division_count > 1
             then 'cross_division_collision'
           when col.key_count > 1 and col.distinct_proposed_names > 1
             then 'code_collision'
           when coalesce(j.canonical_code, '') <> j.mg_code
             then 'rekeyed_record'
           when j.entity_type = 'property' and j.canonical_licensor_id is null
             then 'parentless_record'
           when btrim(coalesce(j.source_name, '')) = ''
             then 'source_name_divergence'
           when plm.coldlion_normalize_name(j.source_name) <> plm.coldlion_normalize_name(j.canonical_name)
             then 'source_name_divergence'
           else null
         end as quarantine_reason
  from joined j
  left join collisions col on col.canonical_id = j.canonical_id;

  select count(*) into v_source_rows from coldlion_promote_rows where present_this_cycle;
  select count(*) into v_linked_rows from coldlion_promote_rows where resolution_status = 'manually_matched';

  -- ---------------------------------------------------------------------------------
  -- 5.6 Cross-check the runner's plan. Disagreement is fail-closed, never "trust one".
  --
  --     TWO sets are compared, because the function makes changes on two independent
  --     paths and a guard that covers one of them is not a guard:
  --       (a) `promotions`           — the curated-name rule (5.9).
  --       (b) `provenance_refreshes` — every row 5.8 will write to
  --                                    core.taxonomy_source_ref, INCLUDING the
  --                                    source_code-only refresh and the refresh of a row
  --                                    that is held for review. FIX 5.
  --
  --     NOTE for both refusals added below: they RAISE and do NOT first try to mark this
  --     run's ingest.sync_run row failed. That is deliberate and matches 20260731163000 —
  --     the RAISE aborts the transaction, so the 5.3 INSERT that created the run row is
  --     rolled back with it and any such UPDATE could never persist. The runner records
  --     the failure out of band. See the header.
  -- ---------------------------------------------------------------------------------
  if p_client_plan is not null then
    if jsonb_typeof(p_client_plan) <> 'object'
       or coalesce(p_client_plan ->> 'rule', '') <> 'coldlion_source_name_normalized_equivalent_v1' then
      -- DEAD CODE REMOVED (2026-07-31) — same reason as 5.4; see the header note.
      raise exception
        'ColdLion promotion refused: the runner plan is malformed or was produced by a different rule than coldlion_source_name_normalized_equivalent_v1.'
        using errcode = 'P0001';
    end if;

    -- FIX 5: an old runner cannot predict the provenance-refresh set, so its plan must be
    -- REFUSED rather than accepted under the old narrower assertion. `?` tests key PRESENCE,
    -- so an empty array (a correct prediction of "no provenance work this cycle") is accepted
    -- while an absent key is not.
    if not (p_client_plan ? 'provenance_refreshes') then
      raise exception
        'ColdLion promotion refused: the runner plan has no provenance_refreshes key, so it was produced by a runner that predates the provenance cross-check. That runner cannot predict the source_code refresh or the held-row provenance refresh, so accepting its plan would apply those writes with NO cross-check while reporting the plan as verified. Update tools/promote-coldlion-source-owned.mjs.'
        using errcode = 'P0001';
    end if;

    select coalesce(array_agg(k order by k), '{}') into v_client_keys
    from jsonb_array_elements(coalesce(p_client_plan -> 'promotions', '[]'::jsonb)) e,
         lateral (select e ->> 'key' as k) x;

    select coalesce(array_agg(k order by k), '{}') into v_server_keys
    from coldlion_promote_rows,
         lateral (select company_code || '/' || division_code || '/' || mg_type_code || '/' || mg_code as k) x
    where quarantine_reason is null
      and resolution_status = 'manually_matched'
      and present_this_cycle
      and (plm.coldlion_normalize_name(source_name) = plm.coldlion_normalize_name(canonical_name)
           and (source_name <> canonical_name or coalesce(ref_source_name, '') <> coalesce(source_name, '')));

    if v_client_keys <> v_server_keys then
      -- DEAD CODE REMOVED (2026-07-31) — same reason as 5.4; see the header note.
      raise exception
        'ColdLion promotion refused: the runner plan and the database recomputation disagree on which rows may be promoted. Runner=%, database=%. Two independent computations that disagree mean one of them is wrong, so nothing is promoted.',
        v_client_keys, v_server_keys
        using errcode = 'P0001';
    end if;

    -- FIX 5 — the provenance set. The predicate below is deliberately the SAME predicate as
    -- the 5.8 UPDATE, term for term, so the assertion mirrors the mutation instead of
    -- re-deriving a subset of it. If 5.8 is ever edited, edit this in the same commit.
    --
    -- DISTINCT on both sides: one typed key can legitimately appear on more than one mirror
    -- row (licensor and property share a key space), and both rows resolve to the same
    -- taxonomy_source_ref. Comparing bags rather than sets would raise a false disagreement
    -- on a perfectly valid cycle, and a guard that cries wolf gets switched off.
    select coalesce(array_agg(distinct k order by k), '{}') into v_client_prov_keys
    from jsonb_array_elements(coalesce(p_client_plan -> 'provenance_refreshes', '[]'::jsonb)) e,
         lateral (select e ->> 'key' as k) x;

    select coalesce(array_agg(distinct k order by k), '{}') into v_server_prov_keys
    from coldlion_promote_rows p,
         lateral (select p.company_code || '/' || p.division_code || '/' || p.mg_type_code || '/' || p.mg_code as k) x
    where p.source_ref_id is not null
      and p.resolution_status = 'manually_matched'
      and p.present_this_cycle
      and p.quarantine_reason is distinct from 'wrong_type'
      and (coalesce(p.ref_source_name, '') <> coalesce(p.source_name, '')
           or coalesce(p.ref_source_code, '') <> p.mg_code);

    if v_client_prov_keys <> v_server_prov_keys then
      raise exception
        'ColdLion promotion refused: the runner plan and the database recomputation disagree on which rows will have their ColdLion provenance refreshed (core.taxonomy_source_ref.source_name / .source_code). Runner=%, database=%. This covers the source_code refresh and the refresh of rows held for review, so a disagreement here means a provenance write nobody planned — nothing is promoted.',
        v_client_prov_keys, v_server_prov_keys
        using errcode = 'P0001';
    end if;
  end if;

  -- ---------------------------------------------------------------------------------
  -- 5.7 Record every quarantine (append-only). The canonical layer is untouched here.
  -- ---------------------------------------------------------------------------------
  insert into plm.coldlion_promotion_quarantine (
    sync_run_id, entity_type, company_code, division_code, mg_type_code, mg_code,
    canonical_id, canonical_name, source_name, reason, detail, environment, is_drill)
  select v_run_id, entity_type, company_code, division_code, mg_type_code, mg_code,
         canonical_id, canonical_name, source_name, quarantine_reason,
         case quarantine_reason
           when 'new_source_record' then 'ColdLion sent a record with no approved canonical link; canonical rows are never auto-created'
           when 'missing_source_record' then 'an approved-linked record was absent from this ColdLion snapshot; absence never deletes, inactivates, or unlinks a canonical row'
           when 'ambiguous_match' then 'the typed key does not resolve to exactly one canonical row'
           when 'cross_typed' then 'the approved link points at a canonical row of the other entity type'
           when 'code_collision' then 'the canonical row is reachable from more than one typed key'
           when 'cross_division_collision' then 'the same company/type/code appears in more than one division for one canonical row'
           when 'wrong_type' then 'incomplete or malformed typed key, or the (division, mg_type_code) header does not denote a licensed entity'
           when 'rekeyed_record' then 'the canonical code no longer equals the ColdLion mg_code'
           when 'parentless_record' then 'canonical property has no licensor parent; the parent edge is Supabase-curated'
           when 'source_name_divergence' then 'ColdLion''s descriptive value is not a presentation variant of the curated name; a human must confirm this is a rename and not a re-pointed code'
         end,
         v_env, p_is_drill
  from coldlion_promote_rows
  where quarantine_reason is not null;
  v_quarantined := coalesce((select count(*) from coldlion_promote_rows where quarantine_reason is not null), 0);

  -- Audit the held decisions too, so a reviewer sees the refused name change explicitly.
  insert into plm.coldlion_promotion_audit (
    sync_run_id, rule_id, entity_type, entity_table, entity_id,
    company_code, division_code, mg_type_code, mg_code,
    field_name, old_value, new_value, decision, decision_detail, environment, is_drill)
  select v_run_id, 'coldlion_source_name_normalized_equivalent_v1', entity_type,
         case entity_type when 'licensor' then 'core.licensor' else 'core.property' end,
         canonical_id, company_code, division_code, mg_type_code, mg_code,
         case entity_type when 'licensor' then 'core.licensor.name' else 'core.property.name' end,
         canonical_name, source_name, 'held_for_review', quarantine_reason, v_env, p_is_drill
  from coldlion_promote_rows
  where quarantine_reason = 'source_name_divergence' and canonical_id is not null;

  -- ---------------------------------------------------------------------------------
  -- 5.8 Refresh the PROVENANCE layer for every valid linked row. This is where
  --     ColdLion's current descriptive truth always lands, even when the curated
  --     display name is held for review — so nothing upstream is ever lost.
  --
  --     THE PREDICATE BELOW IS MIRRORED, TERM FOR TERM, BY THE v_server_prov_keys
  --     ASSERTION IN 5.6. Change one, change the other in the same commit — otherwise
  --     the cross-check silently stops covering what it claims to cover, which is the
  --     exact fault this migration corrects.
  -- ---------------------------------------------------------------------------------
  with refreshed as (
    update core.taxonomy_source_ref r
       set source_name = p.source_name,
           source_code = p.mg_code
      from coldlion_promote_rows p
     where r.id = p.source_ref_id
       and p.source_ref_id is not null
       and p.resolution_status = 'manually_matched'
       and p.present_this_cycle
       and p.quarantine_reason is distinct from 'wrong_type'
       and (coalesce(r.source_name, '') <> coalesce(p.source_name, '')
            or coalesce(r.source_code, '') <> p.mg_code)
    returning r.id, p.entity_type, p.company_code, p.division_code, p.mg_type_code,
              p.mg_code, p.canonical_id, p.source_name
  )
  insert into plm.coldlion_promotion_audit (
    sync_run_id, rule_id, entity_type, entity_table, entity_id,
    company_code, division_code, mg_type_code, mg_code,
    field_name, old_value, new_value, decision, decision_detail, environment, is_drill)
  select v_run_id, 'coldlion_source_name_normalized_equivalent_v1', entity_type,
         case entity_type when 'licensor' then 'core.licensor' else 'core.property' end,
         canonical_id, company_code, division_code, mg_type_code, mg_code,
         'core.taxonomy_source_ref.source_name', null, source_name, 'applied',
         'provenance refresh: ColdLion owns its source descriptive value unconditionally',
         v_env, p_is_drill
  from refreshed;
  -- FIX 3: qualify the table. sync_run_id is BOTH a RETURNS TABLE output column of this
  -- function and a column of the audit table, so an unqualified reference is ambiguous (42702).
  v_prov_refresh := coalesce((select count(*) from plm.coldlion_promotion_audit a
                              where a.sync_run_id = v_run_id
                                and a.field_name = 'core.taxonomy_source_ref.source_name'
                                and a.decision = 'applied'), 0);

  -- ---------------------------------------------------------------------------------
  -- 5.9 The ONE approved deterministic curated-name rule.
  --     Apply the ColdLion name over the curated display name ONLY when the two are the
  --     same name presented differently (normalized-equivalent). A normalized-DIFFERENT
  --     name already quarantined in 5.7 and is not reachable here.
  -- ---------------------------------------------------------------------------------
  with eligible as (
    select * from coldlion_promote_rows
    where quarantine_reason is null
      and resolution_status = 'manually_matched'
      and present_this_cycle
      and canonical_id is not null
      and source_name is distinct from canonical_name
      and plm.coldlion_normalize_name(source_name) = plm.coldlion_normalize_name(canonical_name)
  ),
  lic as (
    update core.licensor l
       set name = e.source_name, updated_at = now()
      from eligible e
     where e.entity_type = 'licensor' and l.id = e.canonical_id
    returning l.id, e.entity_type, e.company_code, e.division_code, e.mg_type_code,
              e.mg_code, e.canonical_name as old_name, e.source_name as new_name
  ),
  prop as (
    update core.property p
       set name = e.source_name, updated_at = now()
      from eligible e
     where e.entity_type = 'property' and p.id = e.canonical_id
    returning p.id, e.entity_type, e.company_code, e.division_code, e.mg_type_code,
              e.mg_code, e.canonical_name as old_name, e.source_name as new_name
  ),
  changed as (select * from lic union all select * from prop)
  insert into plm.coldlion_promotion_audit (
    sync_run_id, rule_id, entity_type, entity_table, entity_id,
    company_code, division_code, mg_type_code, mg_code,
    field_name, old_value, new_value, decision, decision_detail, environment, is_drill)
  select v_run_id, 'coldlion_source_name_normalized_equivalent_v1', entity_type,
         case entity_type when 'licensor' then 'core.licensor' else 'core.property' end,
         id, company_code, division_code, mg_type_code, mg_code,
         case entity_type when 'licensor' then 'core.licensor.name' else 'core.property.name' end,
         old_name, new_name, 'applied',
         'normalized-equivalent presentation change (same name, different casing/spacing/punctuation)',
         v_env, p_is_drill
  from changed;

  select count(*) into v_name_changes
  from plm.coldlion_promotion_audit a
  where a.sync_run_id = v_run_id and a.decision = 'applied'
    and a.field_name in ('core.licensor.name', 'core.property.name');

  v_promotions := v_prov_refresh + v_name_changes;

  select count(*) into v_unchanged
  from coldlion_promote_rows
  where quarantine_reason is null and resolution_status = 'manually_matched' and present_this_cycle
    and source_name = canonical_name
    and coalesce(ref_source_name, '') = coalesce(source_name, '');

  -- ---------------------------------------------------------------------------------
  -- 5.10 PROTECTED-INVARIANT GUARD. Nothing above may have changed a canonical UUID,
  --      a lifecycle status, a Property parent edge, or the canonical row counts.
  --      A mismatch raises, which rolls the whole cycle back — the canonical layer is
  --      never left partially promoted.
  -- ---------------------------------------------------------------------------------
  select md5(coalesce(string_agg(id::text, '|' order by id::text), '')) into v_after_uuid
  from (select id from core.licensor union all select id from core.property) u;
  select md5(coalesce(string_agg(id::text || '|' || status::text, '|' order by id::text), '')) into v_after_status
  from (select id, status::text from core.licensor union all select id, status::text from core.property) s;
  select md5(coalesce(string_agg(id::text || '|' || licensor_id::text, '|' order by id::text), '')) into v_after_parent
  from core.property;
  select count(*) into v_lic_after from core.licensor;
  select count(*) into v_prop_after from core.property;

  if v_after_uuid <> v_before_uuid or v_after_status <> v_before_status
     or v_after_parent <> v_before_parent
     or v_lic_after <> v_lic_before or v_prop_after <> v_prop_before then
    v_violations := 1;
    insert into plm.coldlion_promotion_audit (
      sync_run_id, rule_id, entity_type, entity_table, entity_id,
      company_code, division_code, mg_type_code, mg_code,
      field_name, old_value, new_value, decision, decision_detail, environment, is_drill)
    values (v_run_id, 'coldlion_source_name_normalized_equivalent_v1', 'licensor', 'core.licensor',
            '00000000-0000-0000-0000-000000000000', 'n/a', 'n/a', '00', 'n/a',
            'core.licensor.name', v_before_uuid, v_after_uuid, 'refused',
            'protected-invariant violation: canonical UUID/status/parent-edge hash or row count changed inside the promotion transaction',
            v_env, p_is_drill);
    raise exception
      'ColdLion promotion ABORTED on a protected invariant: canonical UUID/status/parent hashes or row counts changed inside the transaction (uuid %/%, status %/%, parent %/%, licensor %/%, property %/%). ColdLion never owns UUIDs, lifecycle status, or Property parents. Nothing was promoted.',
      v_before_uuid, v_after_uuid, v_before_status, v_after_status,
      v_before_parent, v_after_parent, v_lic_before, v_lic_after, v_prop_before, v_prop_after
      using errcode = 'P0001';
  end if;

  update ingest.sync_run
     set status = 'succeeded', finished_at = now(),
         metadata = metadata || jsonb_build_object(
           'snapshot_run_id', v_snapshot_run_id,
           'source_rows', v_source_rows,
           'linked_rows', v_linked_rows,
           'promotions', v_promotions,
           'curated_name_changes', v_name_changes,
           'provenance_refreshes', v_prov_refresh,
           'unchanged_rows', v_unchanged,
           'quarantined_rows', v_quarantined,
           -- Evidence that BOTH cross-checked sets were actually compared this cycle, not
           -- merely that the call returned. `null` means p_client_plan was not supplied.
           'plan_crosscheck', case when p_client_plan is null then null else jsonb_build_object(
             'promotion_keys', coalesce(array_length(v_server_keys, 1), 0),
             'provenance_keys', coalesce(array_length(v_server_prov_keys, 1), 0),
             'agreed', true) end,
           'protected_hashes_after', jsonb_build_object(
             'uuid', v_after_uuid, 'status', v_after_status, 'parent_edge', v_after_parent),
           'protected_hashes_unchanged', true)
   where id = v_run_id;

  return query select v_run_id, 'promote_source_owned'::text, v_source_rows, v_linked_rows,
                      v_promotions, v_name_changes, v_prov_refresh, v_unchanged,
                      v_quarantined, v_violations;

  -- NO body-level `exception when others` handler here, deliberately. See the header:
  -- one existed only to run a dead UPDATE, and its presence is what made that UPDATE dead.
  -- Errors propagate to the caller unchanged, exactly as they did before.
end;
$$;

comment on function plm.promote_coldlion_source_owned(jsonb, jsonb, boolean) is
  'Guarded recurring promotion of ColdLion source-owned Licensor/Property fields (Step 7A). SERIALIZED since 2026-07-31 by transaction-scoped advisory lock 720260729 (see docs/advisory-lock-registry.md): a caller that cannot take the lock does NOT wait and does NOT silently no-op - it commits a CANCELLED ingest.sync_run row with metadata.outcome = skipped_already_running and returns mode = skipped_already_running with zero counts, which the host runner reports as exit code 3 and which never counts toward the two-consecutive-failure breaker. Step 5.6 cross-checks the runner plan on BOTH change paths: the curated-name promotions set and the provenance_refreshes set (core.taxonomy_source_ref.source_name/.source_code, including source_code-only refreshes and refreshes of rows held for review); a plan without a provenance_refreshes key is refused as an out-of-date runner, and metadata.plan_crosscheck records that both sets were compared. Otherwise unchanged: breaker must be closed, the expected contract must be the exact approved Phase 4 set (hash 1230f5a12d0f2a3029f1d3df17fc5b5f / 542 / 271), only core.taxonomy_source_ref.source_name/.source_code and normalized-equivalent core.licensor.name / core.property.name may change, and canonical UUIDs, lifecycle status, Property parent edges and canonical row counts are hash-verified before and after inside the transaction. Failure recording is deliberately OUT OF BAND in tools/promote-coldlion-source-owned.mjs (see 20260731163000); there is no in-function exception handler. Preview-only; the production lane is not enabled.';
