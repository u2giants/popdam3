-- Issue #2885: reissue the already-proven #2879 inventory definitions under a
-- fresh version whose verification sidecar exists from authoring outset.
-- No source rows or DB Data Admin listing behavior are changed.
-- derived-from: 20260914061331

create or replace function api.source_capture_inventory_exact(p_table_name text default null)
returns table(
  source_system text, table_name name, row_count bigint, carries_resolution boolean,
  table_comment text, retained_row_count bigint, latest_complete_row_count bigint,
  count_basis text, latest_complete_status text, count_note text)
language sql
security definer
set search_path = pg_catalog, api, plm
as $inventory_exact$
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
    (select id from plm.sega_submission_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as sega_submission_capture_id,
    (select id from plm.peanuts_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as peanuts_capture_id,
    (select id from plm.wildbrain_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as wildbrain_capture_id,
    (select id from plm.sesame_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as sesame_capture_id,
    (select id from plm.coke_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as coke_capture_id,
    (select id from plm.pmt_trackerplus_submission_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as pmt_trackerplus_capture_id,
    -- Restored from 20260909115140: the coherent OPA capture root. Dropping it here
    -- would silently revert the three append-only OPA tables to a snapshot count.
    (select id from plm.opa_capture where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as opa_capture_id
), catalog as (
  select
    c.oid,
    c.relname,
    exists (select 1 from pg_attribute a where a.attrelid = c.oid
      and a.attnum > 0 and not a.attisdropped and a.attname = 'capture_id') as has_capture_id,
    exists (select 1 from pg_attribute a where a.attrelid = c.oid
      and a.attnum > 0 and not a.attisdropped
      and a.attname = 'submission_capture_id') as has_submission_capture_id,
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
    and (p_table_name is null or c.relname = p_table_name)
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
      -- Appended below every pre-existing arm; no earlier classification changes.
      when c.relname like 'sesame\_%' then 'sesame'
      when c.relname like 'coke\_%' then 'coca-cola'
      -- Appended below every pre-existing arm. These two families landed AFTER the
      -- inventory was written and were reported as 'other'. Neither can shadow an
      -- earlier arm: no earlier prefix is a prefix of 'marvel_' or 'wwe_'.
      when c.relname like 'lucasfilm\_dcp\_%' then 'lucasfilm_dcpvault'
      when c.relname like 'twentieth_century\_dcp\_%' then 'twentieth_century_dcpvault'
      when c.relname like 'marvel\_%' then 'marvel'
      when c.relname like 'wwe\_%' then 'wwe'
      else 'other'
    end as source_system
  from catalog c
), counted as (
  select c.*, l.*,
    (xpath('/row/cnt/text()', query_to_xml(
      format('select count(*) as cnt from plm.%I', c.relname), false, true, ''
    )))[1]::text::bigint as retained_count,
    case
      -- The three append-only OPA capture tables must use one completed root. These
      -- arms come from 20260909115140 and must stay AHEAD of the broader mutable OPA
      -- current-snapshot family below.
      when c.relname = 'opa_capture' then
        case when l.opa_capture_id is null then null else 1::bigint end
      when c.relname in ('opa_capture_scope', 'opa_property_character_capture') then
        case when l.opa_capture_id is null then null else
          (xpath('/row/cnt/text()', query_to_xml(format(
            'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
            c.relname, l.opa_capture_id::text), false, true, '')))[1]::text::bigint
        end

      -- Other OPA tables are deliberately upserted current state, not retained captures.
      when c.relname like 'opa\_%' then
        (xpath('/row/cnt/text()', query_to_xml(
          format('select count(*) as cnt from plm.%I', c.relname), false, true, ''
        )))[1]::text::bigint

      -- Paramount TrackerPlus submissions have their own complete-capture clock and are
      -- tested BEFORE the pmt_ arms below, which would otherwise pin them to the
      -- Creative Library capture. The inner null test keeps them off that clock even
      -- when no complete TrackerPlus capture exists yet.
      when c.relname = 'pmt_trackerplus_submission_capture' then
        case when l.pmt_trackerplus_capture_id is null then null else 1::bigint end
      when c.relname like 'pmt\_trackerplus\_%' and c.has_capture_id then
        case when l.pmt_trackerplus_capture_id is null then null else
          (xpath('/row/cnt/text()', query_to_xml(format(
            'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
            c.relname, l.pmt_trackerplus_capture_id::text), false, true, '')))[1]::text::bigint
        end

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

      -- Sega submission vocabulary has its own complete-capture clock.
      when c.relname = 'sega_submission_capture' then
        case when l.sega_submission_capture_id is null then null else 1::bigint end
      when c.relname = 'sega_submission_property' and c.has_submission_capture_id
           and l.sega_submission_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where submission_capture_id = %L::uuid',
          c.relname, l.sega_submission_capture_id::text), false, true, '')))[1]::text::bigint

      -- Sega asset evidence: one latest complete capture.
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

      -- Sesame: identical complete-capture contract to NBCU, Sega, Peanuts and WildBrain.
      when c.relname = 'sesame_capture' then case when l.sesame_capture_id is null then null else 1::bigint end
      when c.relname like 'sesame\_%' and c.has_capture_id and l.sesame_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
          c.relname, l.sesame_capture_id::text), false, true, '')))[1]::text::bigint

      -- Coca-Cola: one latest complete capture; incomplete attempts remain retained only.
      when c.relname = 'coke_capture' then case when l.coke_capture_id is null then null else 1::bigint end
      when c.relname like 'coke\_%' and c.has_capture_id and l.coke_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
          c.relname, l.coke_capture_id::text), false, true, '')))[1]::text::bigint

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
    when relname in ('opa_capture','opa_capture_scope','opa_property_character_capture')
      then 'latest_complete'
    when relname like 'opa\_%' then 'current_snapshot'
    when relname like 'pmt\_trackerplus\_%'
         and (relname = 'pmt_trackerplus_submission_capture' or has_capture_id)
      then 'latest_complete'
    when relname like 'pmt\_%' and (relname = 'pmt_capture' or has_capture_id) then 'latest_complete'
    when relname like 'nbcu\_%' and (relname = 'nbcu_capture' or has_capture_id) then 'latest_complete'
    when relname in ('sega_submission_capture','sega_submission_property') then 'latest_complete'
    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id) then 'latest_complete'
    when relname like 'peanuts\_%' and (relname = 'peanuts_capture' or has_capture_id) then 'latest_complete'
    when relname like 'wildbrain\_%' and (relname = 'wildbrain_capture' or has_capture_id) then 'latest_complete'
    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id) then 'latest_complete'
    when relname like 'coke\_%' and (relname = 'coke_capture' or has_capture_id) then 'latest_complete'
    when relname in ('dcp_crawl','dcp_asset','dcp_crawl_gap')
         or (relname like 'dcp\_%' and has_crawl_id) then 'latest_complete'
    when relname = 'dcp_metadata_run' or (relname like 'dcp\_%' and has_metadata_run_id)
      then 'latest_complete'
    else 'retained_only'
  end as count_basis,
  case
    when relname in ('opa_capture','opa_capture_scope','opa_property_character_capture')
      then case when opa_capture_id is null then null else 'complete' end
    when relname like 'pmt\_trackerplus\_%'
         and (relname = 'pmt_trackerplus_submission_capture' or has_capture_id)
      then case when pmt_trackerplus_capture_id is null then null else 'complete' end
    when relname like 'pmt\_%' and (relname = 'pmt_capture' or has_capture_id)
      then case when pmt_capture_id is null then null else 'complete' end
    when relname like 'nbcu\_%' and (relname = 'nbcu_capture' or has_capture_id)
      then case when nbcu_capture_id is null then null else 'complete' end
    when relname in ('sega_submission_capture','sega_submission_property')
      then case when sega_submission_capture_id is null then null else 'complete' end
    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id)
      then case when sega_capture_id is null then null else 'complete' end
    when relname like 'peanuts\_%' and (relname = 'peanuts_capture' or has_capture_id)
      then case when peanuts_capture_id is null then null else 'complete' end
    when relname like 'wildbrain\_%' and (relname = 'wildbrain_capture' or has_capture_id)
      then case when wildbrain_capture_id is null then null else 'complete' end
    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id)
      then case when sesame_capture_id is null then null else 'complete' end
    when relname like 'coke\_%' and (relname = 'coke_capture' or has_capture_id)
      then case when coke_capture_id is null then null else 'complete' end
    when relname in ('dcp_crawl','dcp_asset','dcp_crawl_gap')
         or (relname like 'dcp\_%' and has_crawl_id)
      then case when dcp_crawl_id is null then null else 'complete' end
    when relname = 'dcp_metadata_run' or (relname like 'dcp\_%' and has_metadata_run_id)
      then case when dcp_metadata_run_id is null then null else 'complete' end
    else null
  end as latest_complete_status,
  case
    when relname in ('opa_capture','opa_capture_scope','opa_property_character_capture') then
      case when opa_capture_id is null
        then 'No complete coherent OPA capture exists; latest-complete count is unknown, not zero.'
        else 'Latest complete coherent OPA capture; loading and rejected roots are excluded and no licensed row value is exposed.' end
    when relname like 'opa\_%' then
      'Current upserted OPA snapshot; coherent capture evidence is available only on the three capture tables.'
    when relname like 'pmt\_trackerplus\_%'
         and (relname = 'pmt_trackerplus_submission_capture' or has_capture_id)
         and pmt_trackerplus_capture_id is null then
      'No complete Paramount TrackerPlus submission capture exists; latest-complete count is unknown, not zero.'
    when relname like 'pmt\_trackerplus\_%'
         and (relname = 'pmt_trackerplus_submission_capture' or has_capture_id) then
      'Latest complete Paramount TrackerPlus submission capture; loading and rejected captures excluded.'
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
    when relname in ('sega_submission_capture','sega_submission_property')
         and sega_submission_capture_id is null then
      'No complete Sega submission vocabulary capture exists; latest-complete count is unknown, not zero.'
    when relname in ('sega_submission_capture','sega_submission_property') then
      'Latest complete read-only Sega submission vocabulary capture; rejected attempts excluded.'
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
    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id)
         and sesame_capture_id is null then
      'No complete Sesame capture exists; latest-complete count is unknown, not zero.'
    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id) then
      'Latest complete Sesame capture; loading, rejected and abandoned captures excluded.'
    when relname like 'coke\_%' and (relname = 'coke_capture' or has_capture_id)
         and coke_capture_id is null then
      'No complete Coca-Cola capture exists; latest-complete count is unknown, not zero.'
    when relname like 'coke\_%' and (relname = 'coke_capture' or has_capture_id) then
      'Latest complete Coca-Cola capture; loading and rejected captures excluded.'
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
$inventory_exact$;

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
    (select id from plm.sega_submission_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as sega_submission_capture_id,
    (select id from plm.peanuts_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as peanuts_capture_id,
    (select id from plm.wildbrain_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as wildbrain_capture_id,
    (select id from plm.sesame_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as sesame_capture_id,
    (select id from plm.coke_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as coke_capture_id,
    (select id from plm.pmt_trackerplus_submission_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as pmt_trackerplus_capture_id,
    -- Restored from 20260909115140: the coherent OPA capture root. Dropping it here
    -- would silently revert the three append-only OPA tables to a snapshot count.
    (select id from plm.opa_capture where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as opa_capture_id
), catalog as (
  select
    c.oid,
    c.relname,
    exists (select 1 from pg_attribute a where a.attrelid = c.oid
      and a.attnum > 0 and not a.attisdropped and a.attname = 'capture_id') as has_capture_id,
    exists (select 1 from pg_attribute a where a.attrelid = c.oid
      and a.attnum > 0 and not a.attisdropped
      and a.attname = 'submission_capture_id') as has_submission_capture_id,
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
      -- Appended below every pre-existing arm; no earlier classification changes.
      when c.relname like 'sesame\_%' then 'sesame'
      when c.relname like 'coke\_%' then 'coca-cola'
      -- Appended below every pre-existing arm. These two families landed AFTER the
      -- inventory was written and were reported as 'other'. Neither can shadow an
      -- earlier arm: no earlier prefix is a prefix of 'marvel_' or 'wwe_'.
      when c.relname like 'lucasfilm\_dcp\_%' then 'lucasfilm_dcpvault'
      when c.relname like 'twentieth_century\_dcp\_%' then 'twentieth_century_dcpvault'
      when c.relname like 'marvel\_%' then 'marvel'
      when c.relname like 'wwe\_%' then 'wwe'
      else 'other'
    end as source_system
  from catalog c
), counted as (
  select c.*, l.*,
    null::bigint as retained_count,
    null::bigint as latest_count
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
    when relname in ('opa_capture','opa_capture_scope','opa_property_character_capture')
      then 'latest_complete'
    when relname like 'opa\_%' then 'current_snapshot'
    when relname like 'pmt\_trackerplus\_%'
         and (relname = 'pmt_trackerplus_submission_capture' or has_capture_id)
      then 'latest_complete'
    when relname like 'pmt\_%' and (relname = 'pmt_capture' or has_capture_id) then 'latest_complete'
    when relname like 'nbcu\_%' and (relname = 'nbcu_capture' or has_capture_id) then 'latest_complete'
    when relname in ('sega_submission_capture','sega_submission_property') then 'latest_complete'
    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id) then 'latest_complete'
    when relname like 'peanuts\_%' and (relname = 'peanuts_capture' or has_capture_id) then 'latest_complete'
    when relname like 'wildbrain\_%' and (relname = 'wildbrain_capture' or has_capture_id) then 'latest_complete'
    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id) then 'latest_complete'
    when relname like 'coke\_%' and (relname = 'coke_capture' or has_capture_id) then 'latest_complete'
    when relname in ('dcp_crawl','dcp_asset','dcp_crawl_gap')
         or (relname like 'dcp\_%' and has_crawl_id) then 'latest_complete'
    when relname = 'dcp_metadata_run' or (relname like 'dcp\_%' and has_metadata_run_id)
      then 'latest_complete'
    else 'retained_only'
  end as count_basis,
  case
    when relname in ('opa_capture','opa_capture_scope','opa_property_character_capture')
      then case when opa_capture_id is null then null else 'complete' end
    when relname like 'pmt\_trackerplus\_%'
         and (relname = 'pmt_trackerplus_submission_capture' or has_capture_id)
      then case when pmt_trackerplus_capture_id is null then null else 'complete' end
    when relname like 'pmt\_%' and (relname = 'pmt_capture' or has_capture_id)
      then case when pmt_capture_id is null then null else 'complete' end
    when relname like 'nbcu\_%' and (relname = 'nbcu_capture' or has_capture_id)
      then case when nbcu_capture_id is null then null else 'complete' end
    when relname in ('sega_submission_capture','sega_submission_property')
      then case when sega_submission_capture_id is null then null else 'complete' end
    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id)
      then case when sega_capture_id is null then null else 'complete' end
    when relname like 'peanuts\_%' and (relname = 'peanuts_capture' or has_capture_id)
      then case when peanuts_capture_id is null then null else 'complete' end
    when relname like 'wildbrain\_%' and (relname = 'wildbrain_capture' or has_capture_id)
      then case when wildbrain_capture_id is null then null else 'complete' end
    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id)
      then case when sesame_capture_id is null then null else 'complete' end
    when relname like 'coke\_%' and (relname = 'coke_capture' or has_capture_id)
      then case when coke_capture_id is null then null else 'complete' end
    when relname in ('dcp_crawl','dcp_asset','dcp_crawl_gap')
         or (relname like 'dcp\_%' and has_crawl_id)
      then case when dcp_crawl_id is null then null else 'complete' end
    when relname = 'dcp_metadata_run' or (relname like 'dcp\_%' and has_metadata_run_id)
      then case when dcp_metadata_run_id is null then null else 'complete' end
    else null
  end as latest_complete_status,
  case
    when relname in ('opa_capture','opa_capture_scope','opa_property_character_capture') then
      case when opa_capture_id is null
        then 'No complete coherent OPA capture exists; latest-complete count is unknown, not zero.'
        else 'Latest complete coherent OPA capture; loading and rejected roots are excluded and no licensed row value is exposed.' end
    when relname like 'opa\_%' then
      'Current upserted OPA snapshot; coherent capture evidence is available only on the three capture tables.'
    when relname like 'pmt\_trackerplus\_%'
         and (relname = 'pmt_trackerplus_submission_capture' or has_capture_id)
         and pmt_trackerplus_capture_id is null then
      'No complete Paramount TrackerPlus submission capture exists; latest-complete count is unknown, not zero.'
    when relname like 'pmt\_trackerplus\_%'
         and (relname = 'pmt_trackerplus_submission_capture' or has_capture_id) then
      'Latest complete Paramount TrackerPlus submission capture; loading and rejected captures excluded.'
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
    when relname in ('sega_submission_capture','sega_submission_property')
         and sega_submission_capture_id is null then
      'No complete Sega submission vocabulary capture exists; latest-complete count is unknown, not zero.'
    when relname in ('sega_submission_capture','sega_submission_property') then
      'Latest complete read-only Sega submission vocabulary capture; rejected attempts excluded.'
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
    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id)
         and sesame_capture_id is null then
      'No complete Sesame capture exists; latest-complete count is unknown, not zero.'
    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id) then
      'Latest complete Sesame capture; loading, rejected and abandoned captures excluded.'
    when relname like 'coke\_%' and (relname = 'coke_capture' or has_capture_id)
         and coke_capture_id is null then
      'No complete Coca-Cola capture exists; latest-complete count is unknown, not zero.'
    when relname like 'coke\_%' and (relname = 'coke_capture' or has_capture_id) then
      'Latest complete Coca-Cola capture; loading and rejected captures excluded.'
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
from counted;;

do $verify$
declare
  v_function text;
  v_view text;
begin
  v_function := pg_get_functiondef(
    'api.source_capture_inventory_exact(text)'::regprocedure);
  v_view := pg_get_viewdef('api.source_capture_inventory'::regclass, true);
  if position('lucasfilm_dcpvault' in v_function)=0
     or position('twentieth_century_dcpvault' in v_function)=0
     or position('lucasfilm_dcpvault' in v_view)=0
     or position('twentieth_century_dcpvault' in v_view)=0 then
    raise exception '#2879: both inventory definitions must retain both DCP family mappings';
  end if;
end
$verify$;
