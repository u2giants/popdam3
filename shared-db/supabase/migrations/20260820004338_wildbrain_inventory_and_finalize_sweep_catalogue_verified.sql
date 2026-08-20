-- =====================================================================================
-- SUPERSEDES 20260819151536 FOR PRODUCTION. Same two objects, same two outcomes, a
-- verification block that cannot exceed the production statement timeout.
--
-- Issue u2giants/shared-db #1280, claim #1281. Orchestrator marker #1229.
-- Original work: #1239 (WildBrain classification) and #1240 (the extra-key sweep).
--
-- OBJECTS WRITTEN BY THIS MIGRATION -- and nothing else:
--   view     api.source_capture_inventory   (create or replace, plus its comment/grants)
--   function plm.finalize_wildbrain_capture(uuid, jsonb, jsonb)
--
-- It creates no table, no column, no constraint, no index, no policy, and it writes no
-- data row of any kind. It does not touch the plm.wildbrain_* TABLES; they are read here
-- only through the system catalogue.
--
-- -------------------------------------------------------------------------------------
-- WHY THIS FILE EXISTS
--
-- 20260819151536 is merged to main and applied to PREVIEW, and it CANNOT be applied to
-- PRODUCTION. It applies, and then its own in-file verification block is cancelled by the
-- statement timeout (SQLSTATE 57014), which rolls the whole apply back. Reproduced twice:
-- runs 32311544882 and 32312000123. Production is unchanged and its ledger reads blank for
-- that version before and after both attempts.
--
-- The cause is the verification, not the change. That block asked
-- api.source_capture_inventory eleven separate questions. Every one of those queries makes
-- the view compute its whole target list, and that target list runs
-- `query_to_xml('select count(*) from plm.<table>')` for EVERY base table in schema plm --
-- an unfiltered exact count of the real NBCU, Paramount, Disney, Warner, WildBrain, Sega,
-- Peanuts and ColdLion captures, eleven times over. On preview, which holds almost no
-- licensor data, that is free. On production it is minutes of shared reads inside the
-- apply transaction.
--
-- Filtering did not save it and cannot: every one of those eleven queries ALREADY carried
-- a `where table_name like '...'` restriction and the block still timed out. query_to_xml
-- is VOLATILE, so the planner will not push an outer qualifier underneath the subquery
-- that computes it; the counts are evaluated for every plm table before the filter is
-- applied. That is the measured behaviour, and it is why the verification below never
-- reads api.source_capture_inventory at all.
--
-- AGENTS.md §4.4 forbids editing an applied migration, so 20260819151536 stays exactly as
-- it is and this file carries its logic forward. Both object bodies below are copied from
-- it byte for byte.
--
-- -------------------------------------------------------------------------------------
-- PROVENANCE OF THE TWO BODIES -- READ THIS BEFORE EDITING THEM.
--
-- Both bodies are the CURRENT definitions on main as of authoring, confirmed by listing
-- every migration that redefines each object and taking the newest:
--
--   view api.source_capture_inventory
--     20260814030000 -> 20260814233342 -> 20260819015333 (Sega) -> 20260819125713
--     (Peanuts) -> 20260819151536 (WildBrain, this lineage's head). NOTHING after it
--     touches the view: 20260819212002, the Sesame Workshop landing, does not redefine
--     it. So the body below is 20260819151536's, which is the Peanuts body plus the
--     WildBrain arms and nothing else. Deriving from an older body would silently revert
--     the Peanuts arms; verification check 4 below fails if that ever happens.
--
--   function plm.finalize_wildbrain_capture(uuid,jsonb,jsonb)
--     20260819014639 -> 20260819112524 -> 20260819151536 (head). Nothing after it.
--
-- WHAT THIS DELIVERS, unchanged from 20260819151536:
--   #1239  The eleven plm.wildbrain_* tables are classified source_system 'wildbrain' on
--          the 'latest_complete' basis, instead of falling through the classifier's final
--          `else` arm to 'other' / 'retained_only' with the note "no source-specific
--          latest-complete contract is defined for this table" -- which is not a missing
--          answer, it is a wrong one. WildBrain has the same latest-complete contract as
--          NBCU, Sega and Peanuts.
--   #1240  plm.finalize_wildbrain_capture sweeps keys OUTSIDE its ten entity names --
--          in the stored expected_counts and in the reported observed_counts -- with the
--          full type / non-negative-integer / bigint-range rule, not the type test alone.
--
-- -------------------------------------------------------------------------------------
-- APPLYING THIS TO A DATABASE THAT ALREADY HAS 20260819151536 (i.e. preview)
--
-- Safe, and deliberately so. Both statements are `create or replace` of an object whose
-- installed body is already byte-identical, so on preview this migration is a no-op that
-- reinstalls what is there; on production it installs both objects for the first time.
-- The verification below asserts the END STATE of the catalogue and never asserts that
-- this migration was the thing that produced it, which is what lets one file be correct
-- on both databases. Nothing here reads or writes a data row, so there is no second
-- application to be non-idempotent about.
--
-- LEDGER NOTE FOR WHOEVER PROMOTES THIS -- not something this file can fix.
-- Production's ledger still has no row for 20260819151536, and `supabase db push` applies
-- pending versions in order, so it will attempt that file FIRST and fail exactly as
-- before. Landing this migration on production therefore needs a governed decision about
-- 20260819151536's production ledger state. That decision belongs to the orchestrator; it
-- is out of this claim's objects and is not attempted here.
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
--
-- COST, STATED PER STATEMENT, AGAINST A PRODUCTION-SIZED DATABASE. This is the whole
-- point of issue #1280, so it is written down rather than assumed.
--
--   It NEVER reads api.source_capture_inventory, and it NEVER reads any plm.* TABLE.
--   There is not one `count(*)` over source data anywhere below. Every statement reads
--   only the system catalogue, whose size is set by the number of database objects
--   (thousands of rows, all in shared buffers) and is completely independent of how many
--   captured licensor rows production holds. Concretely:
--
--   check 1  pg_class join pg_namespace, filtered to schema plm, relkind 'r'. One index
--            scan of pg_class. Bounded by the number of tables (~hundreds), not rows.
--   check 2  the same relation joined to pg_attribute by attrelid, for the eleven
--            wildbrain tables only. Bounded by the number of COLUMNS on eleven tables.
--   check 3  pure string work on those eleven relname values in memory. No I/O.
--   check 4  one pg_get_viewdef() call -- a catalogue read of one pg_rewrite row plus
--            deparsing, tens of kilobytes of text -- then strpos/position tests on that
--            text in memory. It does not execute the view.
--   check 5  information_schema.columns for one relation: catalogue only.
--   check 6  has_table_privilege x3: three ACL lookups on one pg_class row.
--   check 7  to_regprocedure plus one pg_proc row read for prosrc. Catalogue only.
--
--   Worst case for the whole block is dominated by check 4's deparse, which is
--   milliseconds. There is no statement here whose cost grows with the NBCU, Paramount,
--   Disney, Warner, WildBrain, Sega, Peanuts or ColdLion capture volume, so there is no
--   statement here that can approach the statement timeout. No pg_class.reltuples
--   estimate is used, because nothing below needs a row count of any kind, exact or
--   estimated.
--
-- WHAT IS PROVED HERE, AND WHAT IS PROVED ELSEWHERE. Checks 1-3 establish the exact
-- catalogue facts the view's WildBrain arms consume -- the eleven table names and their
-- capture_id column -- and check 4 establishes that those arms are present in the
-- INSTALLED view definition and are positioned below every pre-existing arm, so no
-- earlier arm can shadow them and they cannot shadow an earlier one. Together those
-- determine the view's answer for every wildbrain row without executing it.
--
-- The BEHAVIOURAL proof -- that the view really reports 'wildbrain' /'latest_complete'
-- with the right counts, and that the gate really refuses a bad extra key -- is not
-- weakened, it is asserted where it costs nothing: sections I, I7 and F15 of
-- supabase/tests/wildbrain_landing_contracts.sql, which
-- .github/workflows/database-contract-tests.yml runs against a THROWAWAY empty stack on
-- every pull request. An empty database is where a full-view row count is affordable.
-- Running it a second time inside a production apply transaction bought no new
-- information and cost the migration its ability to apply at all.
--
-- FALSIFICATION EVIDENCE. Every check below was disabled one at a time on a throwaway
-- local PostgreSQL 18.6 cluster carrying a stub plm/api schema, and every one of them
-- failed the run. Nothing here is a guard that only passes:
--   drop capture_id from plm.wildbrain_era            -> check 2
--   rename wildbrain_asset to wb_wildbrain_asset      -> check 3 (and 1's table count)
--   rename wildbrain_asset to zz_wildbrain_asset      -> check 3
--   drop every plm.wildbrain_* table                  -> check 1 (raises immediately)
--   reinstall the view without the wildbrain arm      -> check 4a
--   reinstall the view without the peanuts arm        -> check 4b
--   reinstall the view without the WildBrain note     -> check 4a
--   move the wildbrain arm above the pmt/wb/sega arms -> check 4c
--   add an eleventh output column to the view         -> check 5
--   grant select on the view to anon                  -> check 6
--   drop the gate function                            -> check 7 (raises immediately)
--   gate body without the extra-key skip predicate    -> check 7
--   gate body with the skip predicate but no by-name
--     range refusal                                   -> check 7
-- The unmutated block passed in 14 ms on that cluster, and applying this whole migration
-- twice in a row on it left the same passing result -- see the idempotency note above.
--
-- Every failure below increments a counter and is re-raised as one exception at the end,
-- so no check can report a problem through a `raise warning` that psql would not fail on.
-- =====================================================================================
do $$
declare
  v_fail   integer := 0;
  v_notes  text    := '';
  v_tables integer;
  v_n      integer;
  v_cols   text;
  v_def    text;
  v_pos    integer;
  v_prefix text;
  v_rel    text;

  -- The classifier arms that existed BEFORE WildBrain, in the order the view tests them.
  -- Kept as data so check 4 can assert both presence and position without repeating
  -- itself, and so adding a source means adding one element, never editing a condition.
  c_prior_patterns constant text[] := array[
    '''dcp\_%''', '''opa\_%''', '''pmt\_%''', '''nbcu\_%''',
    '''wb\_%''', '''erp\_%''', '''sega\_%''', '''peanuts\_%'''
  ];
  c_prior_labels constant text[] := array[
    '''disney''', '''paramount''', '''nbcu''', '''warner''',
    '''coldlion''', '''sega''', '''peanuts'''
  ];
begin
  ---------------------------------------------------------------------------------------
  -- 1. There are plm.wildbrain_* base tables to classify. Counted from pg_class, never
  --    pinned to a literal: this must fail when the table SET CHANGES, not merely when it
  --    grows, and a literal 11 here would refuse a legitimate twelfth table forever.
  ---------------------------------------------------------------------------------------
  select count(*) into v_tables
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'plm' and c.relkind = 'r' and c.relname like 'wildbrain\_%';
  if v_tables = 0 then
    raise exception 'verify 1: no plm.wildbrain_* tables exist; this migration is pointless here';
  end if;

  ---------------------------------------------------------------------------------------
  -- 2. Every one of them carries the column the view's latest-complete arm reads. The
  --    view puts a wildbrain table on the 'latest_complete' basis when it is
  --    wildbrain_capture OR it has a capture_id column; anything else falls back to
  --    'retained_only'. Asserting the input is asserting the output, at catalogue cost.
  ---------------------------------------------------------------------------------------
  select count(*) into v_n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'plm' and c.relkind = 'r' and c.relname like 'wildbrain\_%'
     and c.relname <> 'wildbrain_capture'
     and not exists (select 1 from pg_attribute a
                      where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                        and a.attname = 'capture_id');
  if v_n <> 0 then
    v_fail := v_fail + 1;
    v_notes := v_notes || format(
      E'\n  2: %s wildbrain table(s) have no capture_id column, so the view cannot put them on the latest_complete basis', v_n);
  end if;

  ---------------------------------------------------------------------------------------
  -- 3. No WildBrain table is named in a way that an EARLIER arm of the classifier
  --    claims. The classifier is first-match-wins and the wildbrain arm is last, so a
  --    WildBrain table called wb_wildbrain_asset would be reported as 'warner' and a
  --    check that only looks at names already matching 'wildbrain\_%' would never see it.
  --    So this scans every plm table whose name MENTIONS wildbrain and fails on any that
  --    the wildbrain arm cannot reach. That is the test that fails when this guard is
  --    disabled; restricting the scan to 'wildbrain\_%' makes it unfalsifiable.
  ---------------------------------------------------------------------------------------
  for v_rel in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'plm' and c.relkind = 'r'
       and c.relname like '%wildbrain%' and c.relname not like 'wildbrain\_%'
  loop
    foreach v_prefix in array array['dcp_','opa_','pmt_','nbcu_','wb_','erp_','sega_','peanuts_']
    loop
      if left(v_rel, length(v_prefix)) = v_prefix then
        v_fail := v_fail + 1;
        v_notes := v_notes || format(
          E'\n  3: plm.%s is a WildBrain table matched by the earlier %s arm, so it is classified as that source, not as wildbrain',
          v_rel, v_prefix);
      end if;
    end loop;
    if v_rel <> 'wildbrain' then
      v_fail := v_fail + 1;
      v_notes := v_notes || format(
        E'\n  3: plm.%s mentions wildbrain but does not match the wildbrain\_%% arm, so it falls through to ''other''',
        v_rel);
    end if;
  end loop;

  ---------------------------------------------------------------------------------------
  -- 4. The INSTALLED view definition -- read back from the catalogue, not from this file
  --    -- carries the WildBrain arms AND every pre-existing arm, with WildBrain appended
  --    BELOW them and above the final `else 'other'`.
  --
  --    This is the check that catches a body derived from a stale migration, which is the
  --    revert #1239 warned about and 20260819151536 guarded against by querying the view.
  --    A body taken from 20260819015333 (Sega) would have no peanuts arm and would fail
  --    here; a body taken from before 20260819125713 would fail here; a body that
  --    inserted the wildbrain arm ABOVE an existing prefix would fail the position test.
  ---------------------------------------------------------------------------------------
  v_def := pg_get_viewdef('api.source_capture_inventory'::regclass, true);

  -- 4a. The WildBrain classification arm, its latest-capture source, and its note text.
  if position('''wildbrain\_%''' in v_def) = 0 then
    v_fail := v_fail + 1;
    v_notes := v_notes || E'\n  4a: the installed view has no wildbrain_ prefix arm';
  end if;
  if position('''wildbrain''' in v_def) = 0 then
    v_fail := v_fail + 1;
    v_notes := v_notes || E'\n  4a: the installed view never yields source_system ''wildbrain''';
  end if;
  if position('wildbrain_capture_id' in v_def) = 0 then
    v_fail := v_fail + 1;
    v_notes := v_notes || E'\n  4a: the installed view has no latest-complete WildBrain capture selector';
  end if;
  if position('Latest complete WildBrain capture' in v_def) = 0 then
    v_fail := v_fail + 1;
    v_notes := v_notes || E'\n  4a: the installed view has no WildBrain count_note, so wildbrain rows still carry the generic retained-only note';
  end if;

  -- 4b. Every pre-existing source label is still produced. Restated against the
  --     definition text rather than against the view's own output, so the check cannot
  --     agree with itself.
  foreach v_prefix in array c_prior_labels loop
    if position(v_prefix in v_def) = 0 then
      v_fail := v_fail + 1;
      v_notes := v_notes || format(
        E'\n  4b: the installed view no longer produces source_system %s -- this body was derived from a stale migration', v_prefix);
    end if;
  end loop;

  -- 4c. Position. The WildBrain arm must sit BELOW every pre-existing prefix arm and
  --     ABOVE the final `else ''other''`, which is exactly what makes "appended, nothing
  --     above can change meaning" a fact instead of a comment.
  v_pos := position('''wildbrain\_%''' in v_def);
  if v_pos > 0 then
    foreach v_prefix in array c_prior_patterns loop
      if position(v_prefix in v_def) = 0 then
        v_fail := v_fail + 1;
        v_notes := v_notes || format(
          E'\n  4c: the installed view no longer tests prefix %s', v_prefix);
      elsif position(v_prefix in v_def) > v_pos then
        v_fail := v_fail + 1;
        v_notes := v_notes || format(
          E'\n  4c: prefix %s is tested AFTER the wildbrain arm, so the wildbrain arm now shadows it', v_prefix);
      end if;
    end loop;
    if position('''other''' in v_def) = 0 then
      v_fail := v_fail + 1;
      v_notes := v_notes || E'\n  4c: the installed view has no final else arm';
    elsif position('''other''' in v_def) < v_pos then
      v_fail := v_fail + 1;
      v_notes := v_notes || E'\n  4c: the final else arm precedes the wildbrain arm, so wildbrain tables still fall through to ''other''';
    end if;
  end if;

  ---------------------------------------------------------------------------------------
  -- 5. The ten output columns, in order. A consumer contract, and the cheapest possible
  --    proof that the replacement did not reshape the view.
  ---------------------------------------------------------------------------------------
  select string_agg(column_name, ',' order by ordinal_position) into v_cols
    from information_schema.columns
   where table_schema = 'api' and table_name = 'source_capture_inventory';
  if v_cols is distinct from 'source_system,table_name,row_count,carries_resolution,table_comment,'
             || 'retained_row_count,latest_complete_row_count,count_basis,'
             || 'latest_complete_status,count_note' then
    v_fail := v_fail + 1;
    v_notes := v_notes || format(E'\n  5: the view output columns changed: %s', coalesce(v_cols, '<view missing>'));
  end if;

  ---------------------------------------------------------------------------------------
  -- 6. Grants unchanged: anon must not read it, authenticated and service_role must.
  ---------------------------------------------------------------------------------------
  if has_table_privilege('anon', 'api.source_capture_inventory', 'SELECT')
     or not has_table_privilege('authenticated', 'api.source_capture_inventory', 'SELECT')
     or not has_table_privilege('service_role', 'api.source_capture_inventory', 'SELECT') then
    v_fail := v_fail + 1;
    v_notes := v_notes || E'\n  6: the view read grants changed';
  end if;

  ---------------------------------------------------------------------------------------
  -- 7. The gate function exists with the signature the loaders call, and really carries
  --    the sweep -- both halves of it. Presence of the skip predicate proves it iterates
  --    keys OUTSIDE the ten entity names; presence of the by-name range refusal proves
  --    those extra keys get the full rule and not the type test alone, which was the
  --    entire point of #1240.
  ---------------------------------------------------------------------------------------
  if to_regprocedure('plm.finalize_wildbrain_capture(uuid,jsonb,jsonb)') is null then
    raise exception 'verify 7: plm.finalize_wildbrain_capture(uuid,jsonb,jsonb) is missing';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'plm' and p.proname = 'finalize_wildbrain_capture'
         and p.prosrc like '%not (v_obs ? e.key)%') <> 1 then
    v_fail := v_fail + 1;
    v_notes := v_notes || E'\n  7: the extra-key sweep is not present in the installed function body';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'plm' and p.proname = 'finalize_wildbrain_capture'
         and p.prosrc like '%(v_val #>> ''{}'')::numeric > v_max%') <> 1 then
    v_fail := v_fail + 1;
    v_notes := v_notes || E'\n  7: the swept extra keys are not range-refused BY NAME before any bigint cast';
  end if;

  ---------------------------------------------------------------------------------------
  -- One exception carries every failure. A `raise warning` here would leave psql green.
  ---------------------------------------------------------------------------------------
  if v_fail > 0 then
    raise exception 'verify FAILED (% check(s)):%', v_fail, v_notes;
  end if;

  raise notice 'verify passed at catalogue cost only: % wildbrain tables, view arms and gate sweep installed', v_tables;
end;
$$;
