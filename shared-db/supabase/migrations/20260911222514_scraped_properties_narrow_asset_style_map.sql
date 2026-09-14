-- Issue #2744 forward 2: the unfiltered Scraped Properties listing regressed
-- after 20260911170526 (measured 8400 ms cancelled / 5196-7083 ms against a
-- 4275 ms pre-apply baseline). Read-only production EXPLAIN as the authenticated
-- role showed the cost is not the ten-table union -- the page limit pushes down
-- and `ordered` completes in 132 ms. It is style-guide resolution: the page's
-- retained (property, asset) pairs were hash-joined against the whole 61 MB
-- plm.dcp_asset heap (187,487 rows), and the build side spilled to temp.
--
-- This forward resolves style guides through a narrow (id, style_guide_id) asset
-- map, so the hash build carries two columns instead of the full asset row, and
-- evaluates each page's retained-asset set once instead of twice (both retained
-- CTEs are referenced by the count and the style paths).
--
-- Style-guide NAMES still resolve downstream from the page's own style ids, so
-- the whole catalog is never materialized with folder names -- that wide shape
-- is what #2744 was filed against and it stays retired.
--
-- Measured read-only on production, interleaved on one session under identical
-- live load, page size 500, role authenticated, inside begin; ... rollback;
--   before: 9991 / 4867 / 4466 ms      after: 2671 / 2525 / 3273 ms
-- The baseline's 9991 ms tail is what produced the 8400 ms acceptance
-- cancellation; the fixed statement's worst run was 3273 ms.
--
-- Result parity: 1,311,298 bytes byte-identical on the unfiltered default page,
-- and byte-identical on Cinderella, Bambi, Cars 2 and Georgia Green Glass.
--
-- Rejected by measurement, recorded so it is not retried: removing the double
-- evaluation alone bought nothing (4285 / 4226 / 4656 ms), and raising work_mem
-- 12x bought nothing. The narrow projection is the whole win.
-- derived-from: 20260911170526

do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'api.db_data_admin_scraped_properties(text,text,integer)'::regprocedure
  ) into v_definition;

  if position('page_dcp_retained_assets as not materialized' in v_definition)=0
     or position('page_lucasfilm_dcp_retained_assets as not materialized' in v_definition)=0
     or position('join plm.dcp_asset a on a.id=r.asset_id' in v_definition)=0
     or position('join plm.lucasfilm_dcp_asset a on a.id=r.asset_id' in v_definition)=0
     or position('), dcp_property_style_ids as materialized (' in v_definition)=0
     or position('app.require_licensing_manager_access()' in v_definition)=0
     or position('l.row_key collate "C" > v_cursor_key collate "C"' in v_definition)=0 then
    raise exception using errcode='55000',
      message='#2744 forward-2 predecessor differs from applied 20260911170526';
  end if;

  -- Evaluate each page's retained-asset set once; inlined, the lateral ran twice.
  v_definition:=replace(v_definition,
    'page_dcp_retained_assets as not materialized',
    'page_dcp_retained_assets as materialized');
  v_definition:=replace(v_definition,
    'page_lucasfilm_dcp_retained_assets as not materialized',
    'page_lucasfilm_dcp_retained_assets as materialized');

  -- Narrow asset -> style map: two columns, so the hash build no longer drags
  -- the full asset row through work_mem and spills to temp.
  v_definition:=replace(v_definition,
    '), dcp_property_style_ids as materialized (',
    '), dcp_asset_style as materialized (
    select a.id,a.style_guide_id from plm.dcp_asset a
  ), lucasfilm_dcp_asset_style as materialized (
    select a.id,a.style_guide_id from plm.lucasfilm_dcp_asset a
  ), dcp_property_style_ids as materialized (');
  v_definition:=replace(v_definition,
    'join plm.dcp_asset a on a.id=r.asset_id',
    'join dcp_asset_style a on a.id=r.asset_id');
  v_definition:=replace(v_definition,
    'join plm.lucasfilm_dcp_asset a on a.id=r.asset_id',
    'join lucasfilm_dcp_asset_style a on a.id=r.asset_id');

  if position('dcp_asset_context' in v_definition)>0
     or position('page_dcp_retained_assets as materialized' in v_definition)=0
     or position('page_lucasfilm_dcp_retained_assets as materialized' in v_definition)=0
     or position('dcp_asset_style as materialized' in v_definition)=0
     or position('lucasfilm_dcp_asset_style as materialized' in v_definition)=0
     or position('join dcp_asset_style a on a.id=r.asset_id' in v_definition)=0
     or position('join lucasfilm_dcp_asset_style a on a.id=r.asset_id' in v_definition)=0
     or position('left join plm.dcp_style_guide g on g.id=s.style_guide_id' in v_definition)=0
     or position('app.require_licensing_manager_access()' in v_definition)=0
     or position('l.row_key collate "C" > v_cursor_key collate "C"' in v_definition)=0 then
    raise exception using errcode='55000',
      message='#2744 forward-2 narrow asset style map postconditions failed';
  end if;

  execute v_definition;
end
$migration$;
