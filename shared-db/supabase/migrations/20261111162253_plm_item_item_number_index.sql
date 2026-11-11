-- u2giants/popdam3#804 (task 2): api.plm_item_list lookups by style_number
-- full-scan plm.item on every call.
-- Production profile 2026-11-11 11:22 AM EST (read-only): the view exposes
-- plm.item.item_number as style_number, and the planner already pushes a
-- style_number filter through the view's row_number() window (item_number is
-- its partition key) down to plm.item. But plm.item has no plain index on
-- item_number (only upper(trim(item_number)) and style_number), so each lookup
-- is a sequential scan of a 75 MB heap: 728k seq scans / 12.6 B rows read
-- since 2026-11-06, ~728k PostgREST calls at 13-38 ms, ~2,400 s/day.
-- A plain btree on item_number turns that scan into one index probe.
-- No view change: output is unchanged by construction. Additive only.
begin;
set local lock_timeout='500ms';
set local statement_timeout='120s';
set local search_path=pg_catalog,public,extensions;

create index if not exists item_item_number_idx
  on plm.item (item_number);

commit;
