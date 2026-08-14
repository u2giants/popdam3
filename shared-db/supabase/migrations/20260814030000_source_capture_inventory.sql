-- api.source_capture_inventory — one query that answers "did this scrape land anything?"
--
-- WHY THIS EXISTS
-- On 2026-08-13 an AI session counted plm.dcp_property and plm.wb_property, found both
-- empty, and reported to the owner that "Warner and Disney have landed zero rows". That
-- was wrong for Disney: the DCP loader had written 156,644 assets to plm.dcp_asset, 2,967
-- style guides to plm.dcp_style_guide and 10,262 rows to plm.opa_property_character. The
-- session guessed table names from a naming convention that does not hold, and the guess
-- looked exactly like a true answer.
--
-- Documentation alone does not fix this: the failure mode is a session that never thinks
-- to look up which table a loader writes to. So the fix is a view, not a paragraph. Ask
-- the database instead of guessing:
--
--     select * from api.source_capture_inventory order by source_system, row_count desc;
--
-- Counts are EXACT and computed at query time, and the table list comes from the live
-- catalog. A new landing table added by any future scrape appears automatically with no
-- change here — the view cannot silently go stale the way a hand-maintained list would.
--
-- Cost note: this counts every plm table on each call and is meant for interactive
-- inspection, not for application hot paths.

create or replace view api.source_capture_inventory as
select
  case
    when c.relname like 'dcp\_%' or c.relname like 'opa\_%' then 'disney'
    when c.relname like 'pmt\_%'  then 'paramount'
    when c.relname like 'nbcu\_%' then 'nbcu'
    when c.relname like 'wb\_%'   then 'warner'
    when c.relname like 'erp\_%'  then 'coldlion'
    else 'other'
  end                                                            as source_system,
  c.relname                                                      as table_name,
  -- Exact live count. query_to_xml runs the count per table without dynamic SQL in a
  -- function, which keeps this a plain view usable by read-only roles.
  (xpath(
     '/row/cnt/text()',
     query_to_xml(format('select count(*) as cnt from plm.%I', c.relname), false, true, '')
   ))[1]::text::bigint                                           as row_count,
  -- Whether the table can carry a resolution to a canonical core.* row. A table can be
  -- BOTH a landing table and resolvable (pmt_property and nbcu_property are), so this is
  -- reported as a property of the table, never used to guess whether a scrape ran.
  exists (
    select 1 from pg_attribute a
    where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      and a.attname in ('core_property_id','core_character_id','core_licensor_id',
                        'resolved_at','resolution_status')
  )                                                              as carries_resolution,
  obj_description(c.oid, 'pg_class')                             as table_comment
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'plm'
  and c.relkind = 'r';

comment on view api.source_capture_inventory is
  'Exact live row counts for every plm landing table, grouped by source system. Ask this '
  'BEFORE concluding a scrape landed nothing. Table names do not reliably indicate where a '
  'loader wrote: on 2026-08-13 empty plm.dcp_property was misread as "Disney landed zero '
  'rows" while plm.dcp_asset held 156,644 rows. carries_resolution describes the table, it '
  'does NOT indicate whether the scrape ran.';

revoke all on api.source_capture_inventory from public;
grant select on api.source_capture_inventory to authenticated, service_role;

-- Point the specific tables that caused the misreading back at the view. These comments
-- surface in list_tables/\d output, which is where a session guessing at names will land.
comment on table plm.dcp_property is
  'Disney DCP property entities. EMPTY DOES NOT MEAN THE DISNEY SCRAPE DID NOT RUN. As of '
  '2026-08-13 Disney properties exist as names in plm.opa_property_character (1,444 '
  'distinct) and assets in plm.dcp_asset (156,644); this table fills when DCP property '
  'extraction and resolution run. Check api.source_capture_inventory first.';

comment on table plm.dcp_character is
  'Disney DCP character entities. EMPTY DOES NOT MEAN THE DISNEY SCRAPE DID NOT RUN. As of '
  '2026-08-13 Disney characters exist as names in plm.opa_property_character (9,591 '
  'distinct). Check api.source_capture_inventory first.';

comment on table plm.wb_property is
  'Warner STARLABS property landing table. Empty as of 2026-08-13, and for Warner that IS '
  'accurate - no wb_* table holds any row because the loader was never written (issue '
  '#900). Confirm with api.source_capture_inventory rather than assuming.';
