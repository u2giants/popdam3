-- Issue #1284: make ordinary source-inventory reads bounded while preserving exact counts.
-- Reserved migration 20260825011609; claim #1455.
-- Re-derived from the current origin/main view head, 20260825003536 (#1283).
--
-- Ordinary reads now use catalogues plus indexed latest-capture selectors only. Count columns
-- remain in the ten-column contract but are truthfully NULL (unknown, never zero). Callers that
-- genuinely need exact counts opt into api.source_capture_inventory_exact(text); a named-table
-- request filters the catalogue before query_to_xml executes, so one table costs one table scan.
-- NULL requests the historical all-table exact inventory. No estimate is ever presented as fact.

create or replace function api.source_capture_inventory_exact(p_table_name text default null)
returns table (
  source_system text,
  table_name name,
  row_count bigint,
  carries_resolution boolean,
  table_comment text,
  retained_row_count bigint,
  latest_complete_row_count bigint,
  count_basis text,
  latest_complete_status text,
  count_note text
)
language sql
security definer
set search_path = pg_catalog, api, plm
as $function$
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
      as wildbrain_capture_id,
    (select id from plm.sesame_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as sesame_capture_id
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

      -- Sesame: identical complete-capture contract to NBCU, Sega, Peanuts and WildBrain.
      when c.relname = 'sesame_capture' then case when l.sesame_capture_id is null then null else 1::bigint end
      when c.relname like 'sesame\_%' and c.has_capture_id and l.sesame_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
          c.relname, l.sesame_capture_id::text), false, true, '')))[1]::text::bigint

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
    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id) then 'latest_complete'
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
    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id)
      then case when sesame_capture_id is null then null else 'complete' end
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
    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id)
         and sesame_capture_id is null then
      'No complete Sesame capture exists; latest-complete count is unknown, not zero.'
    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id) then
      'Latest complete Sesame capture; loading, rejected and abandoned captures excluded.'
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
$function$;

comment on function api.source_capture_inventory_exact(text) is
  'Opt-in exact counterpart to api.source_capture_inventory. Pass one exact plm table name to count only that table before any volatile query_to_xml work; pass NULL to count all landing tables. Returns the same ten-column contract. SECURITY DEFINER exposes counts only, never licensed row values.';

revoke all on function api.source_capture_inventory_exact(text) from public;
revoke all on function api.source_capture_inventory_exact(text) from anon;
grant execute on function api.source_capture_inventory_exact(text) to authenticated, service_role;

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
      as wildbrain_capture_id,
    (select id from plm.sesame_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as sesame_capture_id
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
      -- Appended below every pre-existing arm; no earlier classification changes.
      when c.relname like 'sesame\_%' then 'sesame'
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
    when relname like 'opa\_%' then 'current_snapshot'
    when relname like 'pmt\_%' and (relname = 'pmt_capture' or has_capture_id) then 'latest_complete'
    when relname like 'nbcu\_%' and (relname = 'nbcu_capture' or has_capture_id) then 'latest_complete'
    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id) then 'latest_complete'
    when relname like 'peanuts\_%' and (relname = 'peanuts_capture' or has_capture_id) then 'latest_complete'
    when relname like 'wildbrain\_%' and (relname = 'wildbrain_capture' or has_capture_id) then 'latest_complete'
    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id) then 'latest_complete'
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
    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id)
      then case when sesame_capture_id is null then null else 'complete' end
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
    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id)
         and sesame_capture_id is null then
      'No complete Sesame capture exists; latest-complete count is unknown, not zero.'
    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id) then
      'Latest complete Sesame capture; loading, rejected and abandoned captures excluded.'
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
  end || ' Exact counts are intentionally omitted from ordinary inventory reads; call api.source_capture_inventory_exact(table_name) to opt in.' as count_note
from counted;

comment on view api.source_capture_inventory is
  'Bounded metadata inventory for every plm landing table. It preserves source classification, count basis, latest-complete status and the historical ten-column shape without scanning captured rows. row_count, retained_row_count and latest_complete_row_count are intentionally NULL (unknown, never zero). Exact callers opt into api.source_capture_inventory_exact(table_name). carries_resolution describes table shape and never proves that a scrape ran. No licensed source row value is exposed here.';

revoke all on api.source_capture_inventory from public;
revoke all on api.source_capture_inventory from anon;
grant select on api.source_capture_inventory to authenticated, service_role;

-- Apply verification. The unknown-table probe exercises only function ACL dispatch; catalogue
-- filtering returns no row before query_to_xml can execute.
do $$
declare
  v_view text := pg_get_viewdef('api.source_capture_inventory'::regclass,true);
  v_fn text;
  v_cols text;
begin
  select p.prosrc into v_fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='api' and p.proname='source_capture_inventory_exact'
     and p.proargtypes='25'::oidvector;
  if v_fn is null then raise exception 'exact inventory function is missing'; end if;
  if position('query_to_xml' in lower(v_view)) <> 0 or position('count(*)' in lower(v_view)) <> 0 then
    raise exception 'ordinary inventory view still contains exact-count work';
  end if;
  if position('null::bigint as retained_count' in lower(v_view))=0
     or position('null::bigint as latest_count' in lower(v_view))=0 then
    raise exception 'ordinary inventory counts are not explicit truthful NULLs';
  end if;
  if position('query_to_xml' in v_fn)=0 or position('p_table_name' in v_fn)=0
     or position('c.relname = p_table_name' in v_fn)=0 then
    raise exception 'exact function lost exact counting or pre-count table scoping';
  end if;
  select string_agg(column_name,',' order by ordinal_position) into v_cols
    from information_schema.columns where table_schema='api' and table_name='source_capture_inventory';
  if v_cols is distinct from 'source_system,table_name,row_count,carries_resolution,table_comment,'
      || 'retained_row_count,latest_complete_row_count,count_basis,'
      || 'latest_complete_status,count_note' then raise exception 'view column contract changed: %',v_cols; end if;
  if has_table_privilege('anon','api.source_capture_inventory','SELECT')
     or not has_table_privilege('authenticated','api.source_capture_inventory','SELECT')
     or not has_table_privilege('service_role','api.source_capture_inventory','SELECT') then
    raise exception 'ordinary view grants changed';
  end if;
  if exists (
       select 1 from pg_proc p
       cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
       where p.oid='api.source_capture_inventory_exact(text)'::regprocedure
         and a.privilege_type='EXECUTE' and a.grantee in (0,'anon'::regrole)
     )
     or not exists (
       select 1 from pg_proc p
       cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
       where p.oid='api.source_capture_inventory_exact(text)'::regprocedure
         and a.privilege_type='EXECUTE' and a.grantee='authenticated'::regrole
     )
     or not exists (
       select 1 from pg_proc p
       cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
       where p.oid='api.source_capture_inventory_exact(text)'::regprocedure
         and a.privilege_type='EXECUTE' and a.grantee='service_role'::regrole
     ) then
    raise exception 'exact function direct ACL is wrong';
  end if;
  begin
    execute 'set local role anon';
    perform * from api.source_capture_inventory_exact('ZZVERIFY-not-a-table');
    execute 'reset role';
    raise exception 'anon executed exact inventory';
  exception when insufficient_privilege then
    execute 'reset role';
  end;
  execute 'set local role authenticated';
  perform * from api.source_capture_inventory_exact('ZZVERIFY-not-a-table');
  execute 'reset role';
  execute 'set local role service_role';
  perform * from api.source_capture_inventory_exact('ZZVERIFY-not-a-table');
  execute 'reset role';
  raise notice 'source inventory split verified at catalogue cost only';
end;
$$;
