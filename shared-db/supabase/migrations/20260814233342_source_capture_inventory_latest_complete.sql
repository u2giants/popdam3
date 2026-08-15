-- Issue #969: retained rows are evidence history, not current source coverage.
-- Preserve the original five columns in their original order and append the
-- explicit counting contract so existing SELECT * consumers do not shift.

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
      as dcp_metadata_run_id
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
  'still describes table shape and never proves that a scrape ran.';

revoke all on api.source_capture_inventory from public;
revoke all on api.source_capture_inventory from anon;
grant select on api.source_capture_inventory to authenticated, service_role;
