-- =====================================================================================
-- WildBrain parity: classify plm.wildbrain_* in api.source_capture_inventory, and give
-- plm.finalize_wildbrain_capture the extra-key sweep its sibling gates already have.
--
-- Issues u2giants/shared-db #1239 and #1240, claim #1254. Orchestrator marker #1229.
--
-- OBJECTS WRITTEN BY THIS MIGRATION -- and nothing else:
--   view     api.source_capture_inventory   (create or replace, plus its comment/grants)
--   function plm.finalize_wildbrain_capture(uuid, jsonb, jsonb)
--
-- It creates no table, no column, no constraint, no index, no policy, and it writes no
-- data row of any kind. It does not touch the plm.wildbrain_* TABLES -- those belong to
-- another author's claim (#1249) and are read here only through pg_class.
--
-- -------------------------------------------------------------------------------------
-- PART 1 (#1239) -- WildBrain was unclassified, so the inventory ANSWERED WRONGLY.
--
-- The WildBrain landing (20260819014639) created eleven plm.wildbrain_* tables but never
-- extended api.source_capture_inventory. Every other landing schema classifies itself
-- there. WildBrain therefore fell through the classifier's `else` arm to
-- source_system = 'other' with count_basis 'retained_only' and the generic note "no
-- source-specific latest-complete contract is defined for this table" -- which is not an
-- absence, it is a false statement: WildBrain HAS a latest-complete contract, identical
-- to the NBCU, Sega and Peanuts ones. Verified on production qsllyeztdwjgirsysgai before
-- authoring: all eleven wildbrain tables reported 'other' / 'retained_only'.
--
-- PROVENANCE OF THE VIEW BODY BELOW -- READ THIS BEFORE EDITING IT.
-- This body is the CURRENT definition on main as of authoring, which is the one shipped
-- by 20260819125713 (the Peanuts landing), with the WildBrain source added and NOTHING
-- else changed. It is NOT derived from 20260819015333 (Sega). That distinction is the
-- whole point: this view has been replaced four times, and 20260819125713 merged and
-- applied to production today. A `create or replace` derived from any earlier body would
-- have silently REVERTED the Peanuts arms -- an invisible regression that no syntax check
-- and no ledger row would catch.
--
-- WHAT WAS ADDED, EXHAUSTIVELY:
--   1. `wildbrain_capture_id` in the `latest` CTE -- the newest complete WildBrain capture.
--   2. `wildbrain\_%` -> source_system 'wildbrain' in the classifier, appended AFTER every
--      existing arm so no pre-existing prefix can be shadowed. Note that `wb\_%` ->
--      'warner' already sits above it and matches a DIFFERENT prefix: `wildbrain_` does
--      not begin with `wb_`, so the two never collide.
--   3. WildBrain branches in latest_count, count_basis, latest_complete_status and
--      count_note, mirroring the NBCU, Sega and Peanuts rules exactly -- one latest
--      complete capture; loading, rejected and abandoned attempts stay retained-only.
--
-- Every pre-existing source keeps its exact classification, counting rule, basis, status
-- and note, and the ten output columns keep their names, types and order so existing
-- SELECT * consumers do not shift. Both facts are asserted in
-- supabase/tests/wildbrain_landing_contracts.sql, and the pre-existing tripwires in
-- sega_landing_contracts.sql (F1) and peanuts_landing_contracts.sql (G) each gained
-- exactly one v_map row, which is the ONLY edit this change makes to either file.
--
-- The view exposes only counts and status. NO WildBrain row value becomes visible through
-- it, so there is no licensed-content exposure here.
--
-- -------------------------------------------------------------------------------------
-- PART 2 (#1240) -- the WildBrain gate had no extra-key sweep. IT SHOULD, AND NOW DOES.
--
-- plm.finalize_sega_capture sweeps every key of expected_counts and observed_counts that
-- is outside its known entity list and applies the full type / non-negative-integer /
-- bigint-range rule to it. plm.finalize_wildbrain_capture applied that rule to its ten
-- known keys and to nothing else.
--
-- WHY THE ANSWER IS "YES, IT SHOULD SWEEP" -- and this is a reason, not a symmetry
-- argument. plm.begin_wildbrain_capture ALREADY sweeps: it refuses a capture whose
-- expected_counts carries ANY value, under ANY key, that is not a non-negative whole JSON
-- number. Its own comment says so, and then says the value is "refused again at the
-- publication gate, which re-reads the stored object rather than trusting that this ran."
-- For the ten entity keys that was true. For every other key it was NOT: expected_counts
-- is a plain jsonb column that any later statement can UPDATE after begin_ has run, and
-- the gate is the only thing that re-reads it. So the promise the begin_ function makes
-- in writing was unenforced for exactly the keys nobody was watching. That is the same
-- defect shape as #1219 and #1221 -- a guarantee that holds only because some earlier
-- step happened to run -- and it is why this is a real gap rather than a tidiness one.
--
-- WHAT THIS DOES NOT CLAIM: an extra key cannot skip an entity count. All ten entity keys
-- remain individually required and individually compared, and this sweep deliberately
-- SKIPS them (`not (v_obs ? key)`) so it can never double-report one. Like the Sega sweep
-- it is a truthfulness fix and defence in depth, not the closing of a publication hole.
--
-- THIS IS A BEHAVIOUR CHANGE: the gate now refuses shapes it previously accepted --
-- a non-number, a negative, a fractional, or an oversized value under a key outside the
-- ten. LIVE EXPOSURE WAS MEASURED, NOT ASSUMED: on production qsllyeztdwjgirsysgai,
-- `select count(*) from plm.wildbrain_capture` returned 0 at authoring time. There is no
-- capture in any status, so no capture that published before this migration could be
-- refused by it, and none can be re-finalized either (finalize is a no-op on 'complete').
--
-- THE RULE IS APPLIED THE ONLY SAFE WAY, and the ordering is load-bearing:
--   a. jsonb_typeof first, in its own branch, so nothing casts a JSON string;
--   b. sign and trunc() next, through ::numeric -- never a raw ::bigint, because 1.0 and
--      1e20 are legal JSON numbers whose TEXT rendering makes ::bigint RAISE, and a raise
--      here aborts finalize BEFORE the rejection row is written, wedging the capture in
--      'loading' with an empty error_summary (#1221);
--   c. the bigint range refused BY NAME, before any cast that could raise.
-- Separate `elsif` branches, never one `or`-ed predicate: SQL does not promise to
-- short-circuit `or`, so a combined test can evaluate the very cast it exists to prevent.
--
-- The function body below is reproduced in FULL -- `create or replace function` has no
-- partial form -- and is byte-identical to the body shipped by 20260819112524 except for
-- the two sweep loops, the `v_val` declaration they need, and the comment additions
-- described here. Everything 20260819112524 fixed (the numeric-cast wedge and the
-- one-root gate) is carried forward unchanged; re-read it there before editing this.
--
-- The set of conditions that can reject a capture GROWS, reusing the SAME code names the
-- entity-key checks already emit, exactly as Sega does, so a consumer matching on codes
-- sees no new vocabulary -- only a new `entity` value:
--   expected_count_not_a_number, expected_count_not_a_nonnegative_integer,
--   expected_count_out_of_range, reported_count_not_a_number,
--   reported_count_not_a_nonnegative_integer, reported_count_out_of_range.
-- =====================================================================================


create or replace view api.source_capture_inventory as
with latest as (
  select
    (select capture_id from plm.pmt_capture
      where status = 'complete' and capture_kind = 'full'
      order by completed_at desc nulls last, started_at desc, capture_id desc limit 1)
      as pmt_capture_id,
    (select id from plm.nbcu_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as nbcu_capture_id,
    (select crawl_id from plm.dcp_crawl
      where status = 'complete'
      order by captured_on desc, finished_at desc, crawl_id desc limit 1)
      as dcp_crawl_id,
    (select metadata_run_id from plm.dcp_metadata_run
      where status = 'complete'
      order by captured_on desc, finished_at desc, metadata_run_id desc limit 1)
      as dcp_metadata_run_id,
    (select id from plm.sega_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as sega_capture_id,
    (select id from plm.peanuts_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as peanuts_capture_id,
    (select id from plm.wildbrain_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as wildbrain_capture_id
), catalog as (
  select
    c.oid,
    c.relname,
    exists (select 1 from pg_attribute a where a.attrelid = c.oid
      and a.attnum > 0 and not a.attisdropped and a.attname = 'capture_id') as has_capture_id,
    exists (select 1 from pg_attribute a where a.attrelid = c.oid
      and a.attnum > 0 and not a.attisdropped and a.attname = 'crawl_id') as has_crawl_id,
    exists (select 1 from pg_attribute a where a.attrelid = c.oid
      and a.attnum > 0 and not a.attisdropped and a.attname = 'metadata_run_id') as has_metadata_run_id,
    exists (
      select 1 from pg_attribute a
      where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        and a.attname in ('core_property_id','core_character_id','core_licensor_id',
                          'resolved_at','resolution_status')
    ) as carries_resolution,
    obj_description(c.oid, 'pg_class') as table_comment
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'plm' and c.relkind = 'r'
), classified as (
  select c.*,
    case
      when c.relname like 'dcp\_%' or c.relname like 'opa\_%' then 'disney'
      when c.relname like 'pmt\_%' then 'paramount'
      when c.relname like 'nbcu\_%' then 'nbcu'
      when c.relname like 'wb\_%' then 'warner'
      when c.relname like 'erp\_%' then 'coldlion'
      when c.relname like 'sega\_%' then 'sega'
      when c.relname like 'peanuts\_%' then 'peanuts'
      -- Appended BELOW every pre-existing arm, so nothing above can change meaning. It
      -- cannot be shadowed by the `wb\_%` -> warner arm either: `wildbrain_` does not
      -- start with `wb_`.
      when c.relname like 'wildbrain\_%' then 'wildbrain'
      else 'other'
    end as source_system
  from catalog c
), counted as (
  select c.*, l.*,
    (xpath('/row/cnt/text()', query_to_xml(
      format('select count(*) as cnt from plm.%I', c.relname), false, true, ''
    )))[1]::text::bigint as retained_count,
    case
      -- OPA tables are deliberately upserted current state, not retained captures.
      when c.relname like 'opa\_%' then
        (xpath('/row/cnt/text()', query_to_xml(
          format('select count(*) as cnt from plm.%I', c.relname), false, true, ''
        )))[1]::text::bigint

      -- Paramount: one latest complete FULL capture, matching api.pmt_latest_complete_capture.
      when c.relname = 'pmt_capture' then case when l.pmt_capture_id is null then null else 1::bigint end
      when c.relname like 'pmt\_%' and c.has_capture_id and l.pmt_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
          c.relname, l.pmt_capture_id::text), false, true, '')))[1]::text::bigint

      -- NBCU: one latest complete capture; rejected and abandoned attempts stay retained only.
      when c.relname = 'nbcu_capture' then case when l.nbcu_capture_id is null then null else 1::bigint end
      when c.relname like 'nbcu\_%' and c.has_capture_id and l.nbcu_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
          c.relname, l.nbcu_capture_id::text), false, true, '')))[1]::text::bigint

      -- Sega: identical contract to NBCU -- one latest complete capture, and loading,
      -- rejected and abandoned attempts stay retained only.
      when c.relname = 'sega_capture' then case when l.sega_capture_id is null then null else 1::bigint end
      when c.relname like 'sega\_%' and c.has_capture_id and l.sega_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
          c.relname, l.sega_capture_id::text), false, true, '')))[1]::text::bigint

      -- Peanuts: identical contract to NBCU and Sega -- one latest complete capture, and
      -- loading, rejected and abandoned attempts stay retained only.
      when c.relname = 'peanuts_capture' then case when l.peanuts_capture_id is null then null else 1::bigint end
      when c.relname like 'peanuts\_%' and c.has_capture_id and l.peanuts_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
          c.relname, l.peanuts_capture_id::text), false, true, '')))[1]::text::bigint

      -- WildBrain: identical contract to NBCU, Sega and Peanuts -- one latest complete
      -- capture, and loading, rejected and abandoned attempts stay retained only.
      when c.relname = 'wildbrain_capture' then case when l.wildbrain_capture_id is null then null else 1::bigint end
      when c.relname like 'wildbrain\_%' and c.has_capture_id and l.wildbrain_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
          c.relname, l.wildbrain_capture_id::text), false, true, '')))[1]::text::bigint

      -- DCP path crawl: asset identity is stable, so membership comes through dcp_asset_crawl.
      when c.relname = 'dcp_crawl' then case when l.dcp_crawl_id is null then null else 1::bigint end
      when c.relname = 'dcp_asset' and l.dcp_crawl_id is not null then
        (select count(*) from plm.dcp_asset_crawl ac where ac.crawl_id = l.dcp_crawl_id)
      when c.relname like 'dcp\_%' and c.has_crawl_id and l.dcp_crawl_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where crawl_id = %L::uuid',
          c.relname, l.dcp_crawl_id::text), false, true, '')))[1]::text::bigint
      when c.relname = 'dcp_crawl_gap' and l.dcp_crawl_id is not null then
        (select count(*) from plm.dcp_crawl_gap g
          join plm.dcp_crawl_section s on s.id = g.crawl_section_id
          where s.crawl_id = l.dcp_crawl_id)

      -- DCP metadata has its own complete-run clock, separate from path crawls.
      when c.relname = 'dcp_metadata_run' then
        case when l.dcp_metadata_run_id is null then null else 1::bigint end
      when c.relname like 'dcp\_%' and c.has_metadata_run_id
           and l.dcp_metadata_run_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where metadata_run_id = %L::uuid',
          c.relname, l.dcp_metadata_run_id::text), false, true, '')))[1]::text::bigint
      else null
    end as latest_count
  from classified c cross join latest l
)
select
  source_system,
  relname as table_name,
  retained_count as row_count,
  carries_resolution,
  table_comment,
  retained_count as retained_row_count,
  latest_count as latest_complete_row_count,
  case
    when relname like 'opa\_%' then 'current_snapshot'
    when relname like 'pmt\_%' and (relname = 'pmt_capture' or has_capture_id) then 'latest_complete'
    when relname like 'nbcu\_%' and (relname = 'nbcu_capture' or has_capture_id) then 'latest_complete'
    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id) then 'latest_complete'
    when relname like 'peanuts\_%' and (relname = 'peanuts_capture' or has_capture_id) then 'latest_complete'
    when relname like 'wildbrain\_%' and (relname = 'wildbrain_capture' or has_capture_id) then 'latest_complete'
    when relname in ('dcp_crawl','dcp_asset','dcp_crawl_gap')
         or (relname like 'dcp\_%' and has_crawl_id) then 'latest_complete'
    when relname = 'dcp_metadata_run' or (relname like 'dcp\_%' and has_metadata_run_id)
      then 'latest_complete'
    else 'retained_only'
  end as count_basis,
  case
    when relname like 'pmt\_%' and (relname = 'pmt_capture' or has_capture_id)
      then case when pmt_capture_id is null then null else 'complete' end
    when relname like 'nbcu\_%' and (relname = 'nbcu_capture' or has_capture_id)
      then case when nbcu_capture_id is null then null else 'complete' end
    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id)
      then case when sega_capture_id is null then null else 'complete' end
    when relname like 'peanuts\_%' and (relname = 'peanuts_capture' or has_capture_id)
      then case when peanuts_capture_id is null then null else 'complete' end
    when relname like 'wildbrain\_%' and (relname = 'wildbrain_capture' or has_capture_id)
      then case when wildbrain_capture_id is null then null else 'complete' end
    when relname in ('dcp_crawl','dcp_asset','dcp_crawl_gap')
         or (relname like 'dcp\_%' and has_crawl_id)
      then case when dcp_crawl_id is null then null else 'complete' end
    when relname = 'dcp_metadata_run' or (relname like 'dcp\_%' and has_metadata_run_id)
      then case when dcp_metadata_run_id is null then null else 'complete' end
    else null
  end as latest_complete_status,
  case
    when relname like 'opa\_%' then
      'Current upserted OPA snapshot; there is no retained-capture clock for this table.'
    when relname like 'pmt\_%' and (relname = 'pmt_capture' or has_capture_id)
         and pmt_capture_id is null then
      'No complete full Paramount capture exists; latest-complete count is unknown, not zero.'
    when relname like 'pmt\_%' and (relname = 'pmt_capture' or has_capture_id) then
      'Latest complete full Paramount capture; failed, abandoned, targeted and test captures excluded.'
    when relname like 'nbcu\_%' and (relname = 'nbcu_capture' or has_capture_id)
         and nbcu_capture_id is null then
      'No complete NBCU capture exists; latest-complete count is unknown, not zero.'
    when relname like 'nbcu\_%' and (relname = 'nbcu_capture' or has_capture_id) then
      'Latest complete NBCU capture; loading, rejected and abandoned captures excluded.'
    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id)
         and sega_capture_id is null then
      'No complete Sega capture exists; latest-complete count is unknown, not zero.'
    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id) then
      'Latest complete Sega capture; loading, rejected and abandoned captures excluded.'
    when relname like 'peanuts\_%' and (relname = 'peanuts_capture' or has_capture_id)
         and peanuts_capture_id is null then
      'No complete Peanuts capture exists; latest-complete count is unknown, not zero.'
    when relname like 'peanuts\_%' and (relname = 'peanuts_capture' or has_capture_id) then
      'Latest complete Peanuts capture; loading, rejected and abandoned captures excluded.'
    when relname like 'wildbrain\_%' and (relname = 'wildbrain_capture' or has_capture_id)
         and wildbrain_capture_id is null then
      'No complete WildBrain capture exists; latest-complete count is unknown, not zero.'
    when relname like 'wildbrain\_%' and (relname = 'wildbrain_capture' or has_capture_id) then
      'Latest complete WildBrain capture; loading, rejected and abandoned captures excluded.'
    when (relname in ('dcp_crawl','dcp_asset','dcp_crawl_gap')
          or (relname like 'dcp\_%' and has_crawl_id)) and dcp_crawl_id is null then
      'No complete DCP crawl exists; latest-complete membership is unknown, not zero.'
    when relname in ('dcp_crawl','dcp_asset','dcp_crawl_gap')
         or (relname like 'dcp\_%' and has_crawl_id) then
      'Latest complete DCP path crawl, using immutable crawl membership where required.'
    when (relname = 'dcp_metadata_run' or (relname like 'dcp\_%' and has_metadata_run_id))
         and dcp_metadata_run_id is null then
      'No complete DCP metadata run exists; latest-complete count is unknown, not zero.'
    when relname = 'dcp_metadata_run' or (relname like 'dcp\_%' and has_metadata_run_id) then
      'Latest complete DCP metadata run, separate from the path-crawl clock.'
    when relname = 'dcp_style_guide' then
      'Retained style-guide identities only. Historical latest-complete membership cannot be derived from mutable last_seen_crawl_id; NULL is intentional.'
    when relname like 'dcp\_%' then
      'Retained DCP rows only; this table has no exact immutable latest-complete membership path.'
    else
      'Retained rows only; no source-specific latest-complete contract is defined for this table.'
  end as count_note
from counted;

comment on view api.source_capture_inventory is
  'Source landing inventory with two distinct facts. row_count remains a compatibility alias '
  'for retained_row_count, which counts every retained row including failed attempts. '
  'latest_complete_row_count reports current complete-capture coverage only where exact '
  'membership can be derived; NULL means unavailable or not applicable, never zero. '
  'count_basis, latest_complete_status and count_note state the rule. carries_resolution '
  'still describes table shape and never proves that a scrape ran. Counts and status only: '
  'no licensed source row value is exposed here.';

revoke all on api.source_capture_inventory from public;
revoke all on api.source_capture_inventory from anon;
grant select on api.source_capture_inventory to authenticated, service_role;



create or replace function plm.finalize_wildbrain_capture(
  p_capture_id     uuid,
  p_observed_counts jsonb,
  p_error_summary   jsonb
) returns void
language plpgsql
security definer
set search_path = plm, pg_temp
as $$
declare
  v_cap   plm.wildbrain_capture%rowtype;
  v_exp   jsonb;
  v_obs   jsonb := '{}'::jsonb;
  v_err   jsonb := '[]'::jsonb;
  v_n     bigint;
  v_want  bigint;
  v_key   text;
  -- The value half of the extra-key sweep added for #1240. Read as jsonb and inspected
  -- with jsonb_typeof BEFORE anything casts it, so a JSON string never reaches ::numeric.
  v_val   jsonb;
  -- The largest value a bigint can hold, as a numeric. Compared against BEFORE any cast,
  -- so an oversized count is refused by name instead of raising `bigint out of range`
  -- and wedging the capture in 'loading' (#1221).
  v_max   constant numeric := 9223372036854775807::numeric;
  v_pairs text[][] := array[
    ['eras','wildbrain_era'],
    ['creative_groups','wildbrain_creative_group'],
    ['asset_categories','wildbrain_asset_category'],
    ['asset_natures','wildbrain_asset_nature'],
    ['characters','wildbrain_character'],
    ['assets','wildbrain_asset'],
    ['asset_characters','wildbrain_asset_character'],
    ['guides','wildbrain_guide'],
    ['guide_aliases','wildbrain_guide_alias'],
    ['asset_guides','wildbrain_asset_guide']
  ];
  i integer;
begin
  if p_capture_id is null then
    raise exception 'finalize_wildbrain_capture: capture id is required';
  end if;
  if p_observed_counts is not null and jsonb_typeof(p_observed_counts) <> 'object' then
    raise exception 'finalize_wildbrain_capture: observed_counts must be a JSON object when given';
  end if;
  if p_error_summary is not null and jsonb_typeof(p_error_summary) <> 'array' then
    raise exception 'finalize_wildbrain_capture: error_summary must be a JSON array when given';
  end if;

  -- Row lock: two loaders finalizing the same capture must not interleave their counts.
  select * into v_cap from plm.wildbrain_capture where id = p_capture_id for update;
  if not found then
    raise exception 'finalize_wildbrain_capture: no capture %', p_capture_id;
  end if;
  if v_cap.status = 'complete' then
    -- Idempotent. A retry after a successful finalize is a no-op, not an error, and it
    -- must NOT re-run the gate against a snapshot that is already published.
    return;
  end if;
  if v_cap.status <> 'loading' then
    raise exception 'finalize_wildbrain_capture: capture % is %, not loading',
      p_capture_id, v_cap.status;
  end if;

  v_exp := v_cap.expected_counts;

  -- ---- A. The loader's own reported errors. Anything the loader saw and reported is a
  -- rejection on its own; the checks below are additional, not a replacement.
  if p_error_summary is not null and jsonb_array_length(p_error_summary) > 0 then
    v_err := v_err || jsonb_build_object(
      'code','loader_reported_errors',
      'count', jsonb_array_length(p_error_summary),
      'errors', p_error_summary);
  end if;

  -- ---- B. Paging and scope invariants. pagination_verified is the one that stops a
  -- silently-short capture from being published (see the table comment).
  if not v_cap.pagination_verified then
    v_err := v_err || jsonb_build_object('code','pagination_not_verified');
  end if;
  -- Belt and braces over the table CHECKs: if a future migration ever loosened them,
  -- this gate still refuses to publish.
  if v_cap.truncated_child_lists <> 0 then
    v_err := v_err || jsonb_build_object('code','truncated_child_lists',
                                         'observed', v_cap.truncated_child_lists);
  end if;
  if v_cap.media_downloaded <> 0 then
    v_err := v_err || jsonb_build_object('code','media_downloaded_nonzero',
                                         'observed', v_cap.media_downloaded);
  end if;

  -- ---- C. Row counts, COUNTED FROM THE TABLES, never from a ledger or a summary
  -- document. This repository has shipped a migration that recorded a clean ledger row
  -- while its object did nothing, so "it reported success" is not evidence of anything.
  -- Every one of the ten keys is REQUIRED in expected_counts: a missing key is a
  -- rejection, not a skipped check, because a skipped check is how a truncated capture
  -- passes.
  for i in 1 .. array_length(v_pairs, 1) loop
    v_key := v_pairs[i][1];
    execute format('select count(*) from plm.%I where capture_id = $1', v_pairs[i][2])
      into v_n using p_capture_id;
    v_obs := v_obs || jsonb_build_object(v_key, v_n);

    -- A KEY PRESENT WITH JSON `null` IS NOT A SUPPLIED COUNT. `v_exp ? v_key` is TRUE for
    -- {"assets": null}, and every comparison against the resulting SQL NULL is UNKNOWN --
    -- so a naive `if v_n <> v_want` would never fire and the count would go UNCHECKED,
    -- which is the same publication failure as omitting the key. jsonb_build_object with
    -- an unset variable produces exactly that shape. So the value must be a JSON NUMBER,
    -- and it must be a non-negative integer: a fractional or negative expectation is a
    -- broken loader, not a count.
    if not (v_exp ? v_key) then
      v_err := v_err || jsonb_build_object('code','expected_count_missing','entity',v_key);
    elsif jsonb_typeof(v_exp -> v_key) <> 'number' then
      v_err := v_err || jsonb_build_object('code','expected_count_not_a_number','entity',v_key,
                                           'json_type', jsonb_typeof(v_exp -> v_key));
    elsif (v_exp ->> v_key)::numeric < 0
       or (v_exp ->> v_key)::numeric <> trunc((v_exp ->> v_key)::numeric) then
      v_err := v_err || jsonb_build_object('code','expected_count_not_a_nonnegative_integer',
                                           'entity',v_key,'expected', v_exp -> v_key);
    -- A whole, non-negative number can still be too large for a bigint. Refuse it HERE,
    -- by name, because the cast below would raise instead -- and a raise aborts finalize
    -- before the rejection row is written, leaving the capture wedged in 'loading' with
    -- no error_summary and a retry that dies identically (#1221 / #1222).
    elsif (v_exp ->> v_key)::numeric > v_max then
      v_err := v_err || jsonb_build_object('code','expected_count_out_of_range',
                                           'entity',v_key,'expected', v_exp -> v_key,
                                           'max', v_max);
    else
      -- Through NUMERIC, not straight from text. `->>` renders the JSON number 1.0 as the
      -- TEXT '1.0', and '1.0'::bigint raises -- even though 1.0 passed every guard above
      -- because it IS a whole non-negative number. The trunc() guard above makes this
      -- conversion exact, so it never rounds a real count.
      v_want := (v_exp ->> v_key)::numeric::bigint;
      if v_n <> v_want then
        v_err := v_err || jsonb_build_object('code','count_mismatch','entity',v_key,
                                             'expected',v_want,'observed',v_n);
      end if;
    end if;
  end loop;

  -- If the loader supplied its own observed counts, they must AGREE with what is actually
  -- in the tables. A loader whose idea of what it wrote differs from what landed has a
  -- bug, and publishing its number instead of the measured one would hide it.
  if p_observed_counts is not null then
    for i in 1 .. array_length(v_pairs, 1) loop
      v_key := v_pairs[i][1];
      -- Same JSON-null trap as the expected counts above: a present-but-null value would
      -- make the comparison UNKNOWN and skip the check silently, so a non-number that is
      -- present is itself a disagreement.
      if (p_observed_counts ? v_key)
         and jsonb_typeof(p_observed_counts -> v_key) <> 'number' then
        v_err := v_err || jsonb_build_object('code','loader_observed_count_not_a_number',
                    'entity', v_key,
                    'json_type', jsonb_typeof(p_observed_counts -> v_key));
      elsif (p_observed_counts ? v_key)
         and (p_observed_counts ->> v_key)::numeric <> (v_obs ->> v_key)::numeric then
        v_err := v_err || jsonb_build_object('code','loader_observed_count_disagrees',
                    'entity', v_key,
                    'loader_reported', p_observed_counts -> v_key,
                    'measured', (v_obs ->> v_key)::bigint);
      end if;
    end loop;
  end if;

  -- ---- C2. THE EXTRA-KEY SWEEP (#1240). The two loops above inspect ONLY the ten entity
  -- keys this schema knows. A stored expected_counts, or a reported observed_counts, may
  -- carry other keys -- a future loader will add some -- and a value there that is not a
  -- non-negative whole number is the same class of defect: something that looks supplied
  -- and compares to nothing.
  --
  -- begin_wildbrain_capture already refuses those shapes at creation, for EVERY key, and
  -- its comment promises they are "refused again at the publication gate, which re-reads
  -- the stored object rather than trusting that this ran". That promise was true of the
  -- ten entity keys and false of every other key: expected_counts is an ordinary jsonb
  -- column, any later statement can UPDATE it after begin_ has run, and this gate is the
  -- only thing that re-reads it. A guard that holds only because an earlier step happened
  -- to run is the #1219 / #1221 shape, so the sweep closes it here rather than leaving the
  -- comment overstating the code. plm.finalize_sega_capture has swept since 20260819112524;
  -- this is the same rule, not a copy for the sake of looking alike.
  --
  -- SCOPE, STATED PLAINLY: an extra key can never skip an entity count -- all ten remain
  -- required and individually compared above -- so this is defence in depth and a
  -- truthfulness fix, not the closing of a publication hole.
  --
  -- `not (v_obs ? e.key)` skips the ten entity keys, which are already fully checked; at
  -- this point v_obs holds exactly those ten (characters_not_in_source_dictionary is added
  -- further below, deliberately after this sweep, so it is never swept as an input).
  --
  -- THE THREE TESTS ARE SEPARATE `elsif` BRANCHES IN THIS ORDER AND NO OTHER: type, then
  -- sign/whole through ::numeric, then bigint range refused BY NAME. `or`-ing them would
  -- let SQL evaluate a cast on a JSON string; casting through ::bigint from `->>`/`#>>`
  -- text would RAISE on 1.0 or 1e20 and abort finalize before the rejection row is
  -- written, wedging the capture in 'loading' with an empty error_summary (#1221).
  for v_key, v_val in select e.key, e.value from jsonb_each(v_exp) e
                       where not (v_obs ? e.key) loop
    if jsonb_typeof(v_val) <> 'number' then
      v_err := v_err || jsonb_build_object('code','expected_count_not_a_number',
                                           'entity',v_key,
                                           'json_type', jsonb_typeof(v_val));
    elsif (v_val #>> '{}')::numeric < 0
       or (v_val #>> '{}')::numeric <> trunc((v_val #>> '{}')::numeric) then
      v_err := v_err || jsonb_build_object('code','expected_count_not_a_nonnegative_integer',
                                           'entity',v_key,'expected', v_val);
    elsif (v_val #>> '{}')::numeric > v_max then
      v_err := v_err || jsonb_build_object('code','expected_count_out_of_range',
                                           'entity',v_key,'expected', v_val,'max', v_max);
    end if;
  end loop;

  -- The same sweep over anything the loader reported outside the ten. jsonb_each is
  -- strict, so a NULL p_observed_counts yields no rows and this loop simply does not run
  -- -- observed counts remain optional exactly as before.
  for v_key, v_val in select e.key, e.value from jsonb_each(p_observed_counts) e
                       where not (v_obs ? e.key) loop
    if jsonb_typeof(v_val) <> 'number' then
      v_err := v_err || jsonb_build_object('code','reported_count_not_a_number',
                                           'entity',v_key,
                                           'json_type', jsonb_typeof(v_val));
    elsif (v_val #>> '{}')::numeric < 0
       or (v_val #>> '{}')::numeric <> trunc((v_val #>> '{}')::numeric) then
      v_err := v_err || jsonb_build_object('code','reported_count_not_a_nonnegative_integer',
                                           'entity',v_key,'reported', v_val);
    elsif (v_val #>> '{}')::numeric > v_max then
      v_err := v_err || jsonb_build_object('code','reported_count_out_of_range',
                                           'entity',v_key,'reported', v_val,'max', v_max);
    end if;
  end loop;

  -- ---- D. Duplicate source ids. The primary keys already make these impossible within a
  -- capture; this asserts the constraints are still in force rather than trusting that
  -- nobody weakened one.
  select count(*) into v_n
    from (select asset_source_id from plm.wildbrain_asset where capture_id = p_capture_id
          group by asset_source_id having count(*) > 1) d;
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','duplicate_asset_source_id','count',v_n);
  end if;
  select count(*) into v_n
    from (select asset_uuid from plm.wildbrain_asset where capture_id = p_capture_id
          group by asset_uuid having count(*) > 1) d;
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','duplicate_asset_uuid','count',v_n);
  end if;
  select count(*) into v_n
    from (select character_source_id from plm.wildbrain_character where capture_id = p_capture_id
          group by character_source_id having count(*) > 1) d;
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','duplicate_character_source_id','count',v_n);
  end if;
  select count(*) into v_n
    from (select era_source_id from plm.wildbrain_era where capture_id = p_capture_id
          group by era_source_id having count(*) > 1) d;
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','duplicate_era_source_id','count',v_n);
  end if;

  -- ---- E. Orphaned relationship endpoints. The composite FKs already make a
  -- cross-capture edge impossible; same reasoning as D.
  select count(*) into v_n
    from plm.wildbrain_asset_character l
   where l.capture_id = p_capture_id
     and (not exists (select 1 from plm.wildbrain_asset a
                       where a.capture_id = l.capture_id and a.asset_source_id = l.asset_source_id)
       or not exists (select 1 from plm.wildbrain_character c
                       where c.capture_id = l.capture_id
                         and c.character_source_id = l.character_source_id));
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','orphan_asset_character_link','count',v_n);
  end if;

  select count(*) into v_n
    from plm.wildbrain_asset_guide l
   where l.capture_id = p_capture_id
     and (not exists (select 1 from plm.wildbrain_asset a
                       where a.capture_id = l.capture_id and a.asset_source_id = l.asset_source_id)
       or not exists (select 1 from plm.wildbrain_guide g
                       where g.capture_id = l.capture_id and g.guide_key = l.guide_key));
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','orphan_asset_guide_link','count',v_n);
  end if;

  select count(*) into v_n
    from plm.wildbrain_guide_alias al
   where al.capture_id = p_capture_id
     and not exists (select 1 from plm.wildbrain_guide g
                      where g.capture_id = al.capture_id and g.guide_key = al.guide_key);
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','orphan_guide_alias','count',v_n);
  end if;

  -- ---- F. Every asset must carry a resolved era. era_source_id is NOT NULL and
  -- FK-bound, so this is the same class of assertion as D and E -- and it is the single
  -- most load-bearing fact in this schema, because the whole property axis hangs off it.
  select count(*) into v_n
    from plm.wildbrain_asset a
   where a.capture_id = p_capture_id
     and (a.era_source_id is null
       or not exists (select 1 from plm.wildbrain_era e
                       where e.capture_id = a.capture_id and e.era_source_id = a.era_source_id));
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','asset_without_resolved_era','count',v_n);
  end if;

  -- ---- G. Era hierarchy: every non-null parent must resolve INSIDE the same capture.
  select count(*) into v_n
    from plm.wildbrain_era e
   where e.capture_id = p_capture_id
     and e.parent_era_source_id is not null
     and not exists (select 1 from plm.wildbrain_era p
                      where p.capture_id = e.capture_id
                        and p.era_source_id = e.parent_era_source_id);
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','era_parent_unresolved','count',v_n);
  end if;

  -- ---- G2. EXACTLY ONE ROOT. The licensee account sees one property, so a second root
  -- is either an unlicensed tree that leaked into the crawl or a lost parent link.
  -- Re-asserted here for the same reason as D and E: the partial unique index makes it
  -- impossible, and this refuses to publish if a future migration ever drops it.
  --
  -- A ROOT IS MEASURED AS `parent_era_source_id is null` -- THE SAME FACT G3 WALKS BELOW,
  -- NOT the is_root flag. Counting the flag here made G2 and G3 two DIFFERENT questions
  -- that agreed only while the table CHECK wildbrain_era_root_matches_parent_chk was
  -- present, and the gate never re-asserted that CHECK. With it dropped, a parent-null row
  -- carrying is_root = false is invisible to a flag count while G3 seeds its walk from it
  -- and reaches its whole subtree -- so two disjoint era trees publish as one licensed
  -- property with every count matching. That is the same defect shape as #1219: a guard
  -- that holds only because a separate constraint happens to still exist (#1221).
  select count(*) into v_n
    from plm.wildbrain_era
   where capture_id = p_capture_id and parent_era_source_id is null;
  if v_n > 1 then
    v_err := v_err || jsonb_build_object('code','multiple_root_eras','count',v_n);
  end if;
  -- And the CHECK's own rule, re-asserted rather than assumed -- exactly as D, E, G and H
  -- re-assert theirs. Deleting the constraint now changes nothing that this gate admits.
  select count(*) into v_want
    from plm.wildbrain_era
   where capture_id = p_capture_id
     and is_root <> (parent_era_source_id is null);
  if v_want <> 0 then
    v_err := v_err || jsonb_build_object('code','era_root_flag_disagrees_with_parent',
                                         'count',v_want);
  end if;
  select count(*) into v_want from plm.wildbrain_era where capture_id = p_capture_id;
  if v_want > 0 and v_n = 0 then
    v_err := v_err || jsonb_build_object('code','no_root_era','eras',v_want);
  end if;

  -- ---- G3. NO CYCLE. Nothing above can see one: the self-parent CHECK stops only
  -- A -> A, the composite FK stops only a cross-capture parent, and A -> B -> A satisfies
  -- every one of them AND matches expected_counts, so without this a capture containing a
  -- loop publishes clean and every later walk of the property axis either loops forever
  -- or silently truncates.
  --
  -- Measured as REACHABILITY FROM THE ROOT rather than by chasing parents, because that
  -- walk provably terminates: parent_era_source_id is a single column, so an era has at
  -- most one parent, so no member of a cycle can also be a descendant of the root -- it
  -- would need two parents. The recursion therefore visits each era at most once and can
  -- never follow the loop. Anything not reached is in a cycle or hangs off one, and both
  -- are the same verdict: not landable.
  with recursive reachable as (
    select e.era_source_id
      from plm.wildbrain_era e
     where e.capture_id = p_capture_id
       and e.parent_era_source_id is null
    union all
    select c.era_source_id
      from plm.wildbrain_era c
      join reachable r on c.parent_era_source_id = r.era_source_id
     where c.capture_id = p_capture_id
  )
  select count(*) into v_n from reachable;
  if v_n <> v_want then
    v_err := v_err || jsonb_build_object('code','era_cycle_or_unreachable',
                                         'reachable_from_root', v_n, 'eras', v_want);
  end if;

  -- ---- H. Guide key derivation. The same rule the table CHECK pins, re-asserted here so
  -- that weakening the constraint does not silently disable the guarantee.
  select count(*) into v_n
    from plm.wildbrain_guide g
   where g.capture_id = p_capture_id
     and g.guide_key <> btrim(
           regexp_replace(replace(lower(g.normalized_guide_label), '"', ''),
                          '[[:space:]]+', ' ', 'g'));
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','guide_key_not_normalization','count',v_n);
  end if;

  -- ---- I. Every asset-to-guide row must cite a KNOWN alias of its own guide.
  select count(*) into v_n
    from plm.wildbrain_asset_guide ag
   where ag.capture_id = p_capture_id
     and not exists (select 1 from plm.wildbrain_guide_alias al
                      where al.capture_id = ag.capture_id
                        and al.guide_key  = ag.guide_key
                        and al.alias_label = ag.alias_label);
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','asset_guide_unknown_alias','count',v_n);
  end if;

  -- NOT A REJECTION CONDITION, STATED EXPLICITLY SO NOBODY ADDS IT: a character row with
  -- in_source_dictionary = false is a licensor defect preserved as evidence. It is
  -- COUNTED here for visibility and it never blocks publication.
  select count(*) into v_n
    from plm.wildbrain_character
   where capture_id = p_capture_id and in_source_dictionary = false;
  v_obs := v_obs || jsonb_build_object('characters_not_in_source_dictionary', v_n);

  -- ---- Verdict. There is no partial publish.
  if jsonb_array_length(v_err) > 0 then
    update plm.wildbrain_capture
       set status            = 'rejected',
           observed_counts   = v_obs,
           error_summary     = v_err,
           load_completed_at = null
     where id = p_capture_id;
    raise warning
      'finalize_wildbrain_capture: capture % REJECTED with % error(s); read status and error_summary',
      p_capture_id, jsonb_array_length(v_err);
    return;
  end if;

  update plm.wildbrain_capture
     set status            = 'complete',
         observed_counts   = v_obs,
         error_summary     = '[]'::jsonb,
         load_completed_at = now()
   where id = p_capture_id;
end;
$$;

comment on function plm.finalize_wildbrain_capture(uuid,jsonb,jsonb) is
  'The publication gate. Under a row lock it counts every table for the capture and '
  'refuses to publish on: unverified pagination, a truncated child list, a nonzero media '
  'count, loader-reported errors, duplicate source ids, orphaned relationship endpoints, '
  'an asset with an unresolved era, an era whose parent does not resolve in the same '
  'capture, more than one root era, no root era at all (a root being an era with no '
  'parent -- the same fact the reachability walk uses, so dropping the is_root CHECK '
  'cannot admit a second tree), an is_root flag that disagrees with its own parentage, '
  'an era cycle (measured as '
  'reachability from the root), a guide_key that is not the normalization of its own '
  'normalized label, an asset-guide row citing an unknown alias, an expected count that '
  'is missing or is not a JSON number that is a non-negative integer, an expected count '
  'too large for a bigint (refused BY NAME, because casting it would raise and leave the '
  'capture wedged in loading with no error_summary), ANY KEY OUTSIDE THOSE TEN -- in the '
  'stored expected_counts or in the reported observed_counts -- whose value is not a JSON '
  'number that is a non-negative integer within bigint range, or any count that '
  'differs from expected_counts. All pass -> status complete. Any fail -> status rejected with the '
  'errors PERSISTED and a server WARNING raised; the previous complete capture stays '
  'current. THE CALLER MUST RE-READ status -- it cannot raise on a validation failure '
  'without rolling back the very rejection record it is required to keep. A character '
  'with in_source_dictionary = false is explicitly NOT a rejection condition. '
  'service_role only.';



-- =====================================================================================
-- Self-verification. Runs INSIDE the migration transaction, so a failure here rolls the
-- whole thing back rather than recording a clean ledger row over a broken object. This
-- repository has shipped a migration whose ledger row said success while its object did
-- nothing, so "it applied" is not evidence.
-- =====================================================================================
do $$
declare
  v_n      integer;
  v_tables integer;
  v_cols   text;
begin
  -- 1. Every plm.wildbrain_* base table is classified 'wildbrain', and none is left over
  --    in 'other'. Counted against pg_class rather than a literal, so this stays true if
  --    the table set changes; the literal count is asserted separately below.
  select count(*) into v_tables
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'plm' and c.relkind = 'r' and c.relname like 'wildbrain\_%';
  if v_tables = 0 then
    raise exception 'verify: no plm.wildbrain_* tables exist; this migration is pointless here';
  end if;
  select count(*) into v_n from api.source_capture_inventory
   where table_name like 'wildbrain\_%' and source_system = 'wildbrain';
  if v_n <> v_tables then
    raise exception 'verify: % of % wildbrain tables classified as wildbrain', v_n, v_tables;
  end if;
  select count(*) into v_n from api.source_capture_inventory
   where table_name like 'wildbrain\_%' and count_basis <> 'latest_complete';
  if v_n <> 0 then
    raise exception 'verify: % wildbrain tables are not on the latest_complete basis', v_n;
  end if;

  -- 2. No pre-existing source lost its classification. Restated here independently of the
  --    view, so agreeing with itself is not possible.
  if (select count(*) from api.source_capture_inventory
       where table_name like 'nbcu\_%' and source_system <> 'nbcu') <> 0
     or (select count(*) from api.source_capture_inventory
       where table_name like 'sega\_%' and source_system <> 'sega') <> 0
     or (select count(*) from api.source_capture_inventory
       where table_name like 'peanuts\_%' and source_system <> 'peanuts') <> 0
     or (select count(*) from api.source_capture_inventory
       where table_name like 'wb\_%' and source_system <> 'warner') <> 0
     or (select count(*) from api.source_capture_inventory
       where table_name like 'erp\_%' and source_system <> 'coldlion') <> 0
     or (select count(*) from api.source_capture_inventory
       where table_name like 'pmt\_%' and source_system <> 'paramount') <> 0
     or (select count(*) from api.source_capture_inventory
       where (table_name like 'dcp\_%' or table_name like 'opa\_%')
         and source_system <> 'disney') <> 0 then
    raise exception 'verify: a pre-existing source changed classification';
  end if;

  -- 3. The Peanuts arms this body was derived from are still present and still working.
  --    A body derived from an older migration would pass check 2 (peanuts_* would simply
  --    be 'other'), so this is the check that catches the revert #1239 warned about.
  if (select count(*) from api.source_capture_inventory
       where table_name like 'peanuts\_%' and count_basis = 'latest_complete') = 0 then
    raise exception 'verify: the Peanuts latest-complete contract is missing -- this body was derived from a stale migration';
  end if;

  -- 4. The ten output columns, in order.
  select string_agg(column_name, ',' order by ordinal_position) into v_cols
    from information_schema.columns
   where table_schema = 'api' and table_name = 'source_capture_inventory';
  if v_cols <> 'source_system,table_name,row_count,carries_resolution,table_comment,'
             || 'retained_row_count,latest_complete_row_count,count_basis,'
             || 'latest_complete_status,count_note' then
    raise exception 'verify: the view output columns changed: %', v_cols;
  end if;

  -- 5. Grants unchanged: anon must not read it, authenticated and service_role must.
  if has_table_privilege('anon', 'api.source_capture_inventory', 'SELECT')
     or not has_table_privilege('authenticated', 'api.source_capture_inventory', 'SELECT')
     or not has_table_privilege('service_role', 'api.source_capture_inventory', 'SELECT') then
    raise exception 'verify: the view read grants changed';
  end if;

  -- 6. The gate function still exists with the signature the loaders call.
  if to_regprocedure('plm.finalize_wildbrain_capture(uuid,jsonb,jsonb)') is null then
    raise exception 'verify: plm.finalize_wildbrain_capture(uuid,jsonb,jsonb) is missing';
  end if;
  -- And it really carries the sweep: the source must contain the skip predicate that
  -- makes it a sweep rather than the ten-key loop it replaced.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'plm' and p.proname = 'finalize_wildbrain_capture'
         and p.prosrc like '%not (v_obs ? e.key)%') <> 1 then
    raise exception 'verify: the extra-key sweep is not present in the installed function body';
  end if;

  raise notice 'verify passed: % wildbrain tables classified, sweep installed', v_tables;
end;
$$;
